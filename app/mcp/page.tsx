'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import {
  Server,
  Plus,
  Trash2,
  Power,
  PowerOff,
  RefreshCw,
  Download,
  Upload,
  ChevronLeft,
  Wrench,
  MessageSquare,
  FileText,
  Play,
  AlertCircle,
  CheckCircle,
  Loader2,
  Settings,
  Terminal,
  Globe,
} from 'lucide-react';
import { useMCP } from '@/lib/mcp/mcp-context';
import {
  MCPServerConfig,
  TransportType,
  MCPTool,
  MCPPrompt,
  MCPResource,
  ExportedConfig,
} from '@/lib/mcp/types';

type TabType = 'tools' | 'prompts' | 'resources';

export default function MCPPage() {
  const {
    servers,
    loading,
    addServer,
    updateServer,
    removeServer,
    connect,
    disconnect,
    fetchCapabilities,
    executeTool,
    getPrompt,
    readResource,
    exportServers,
    importServers,
    connectedCount,
  } = useMCP();

  const [showForm, setShowForm] = useState(false);
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null);
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('tools');
  const [executionResult, setExecutionResult] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    transport: 'stdio' as TransportType,
    command: '',
    args: '',
    env: '',
    url: '',
  });

  const resetForm = () => {
    setFormData({
      name: '',
      transport: 'stdio',
      command: '',
      args: '',
      env: '',
      url: '',
    });
    setEditingServer(null);
    setShowForm(false);
  };

  const handleSubmitServer = () => {
    const config: Omit<MCPServerConfig, 'id'> & { id?: string } = {
      name: formData.name,
      transport: formData.transport,
    };

    if (formData.transport === 'stdio') {
      config.command = formData.command;
      config.args = formData.args ? formData.args.split('\n').filter(Boolean) : [];
      if (formData.env) {
        try {
          config.env = JSON.parse(formData.env);
        } catch {
          alert('환경변수는 유효한 JSON 형식이어야 합니다.');
          return;
        }
      }
    } else {
      config.url = formData.url;
    }

    if (editingServer) {
      updateServer({ ...config, id: editingServer.id } as MCPServerConfig);
    } else {
      addServer(config);
    }

    resetForm();
  };

  const handleEditServer = (config: MCPServerConfig) => {
    setFormData({
      name: config.name,
      transport: config.transport,
      command: config.command || '',
      args: config.args?.join('\n') || '',
      env: config.env ? JSON.stringify(config.env, null, 2) : '',
      url: config.url || '',
    });
    setEditingServer(config);
    setShowForm(true);
  };

  const handleConnect = async (serverId: string) => {
    const success = await connect(serverId);
    if (success) {
      await fetchCapabilities(serverId);
    }
  };

  const handleSelectServer = async (serverId: string) => {
    setSelectedServer(serverId);
    setExecutionResult(null);
    const server = servers.find((s) => s.config.id === serverId);
    if (server?.connectionState.status === 'connected' && !server.capabilities) {
      await fetchCapabilities(serverId);
    }
  };

  const handleExecuteTool = async (tool: MCPTool) => {
    if (!selectedServer) return;

    setIsExecuting(true);
    setExecutionResult(null);

    try {
      let args: Record<string, unknown> = {};
      if (tool.inputSchema && Object.keys(tool.inputSchema).length > 0) {
        const input = prompt(
          `Tool "${tool.name}" 인자 (JSON):\n${JSON.stringify(tool.inputSchema, null, 2)}`,
          '{}'
        );
        if (input === null) {
          setIsExecuting(false);
          return;
        }
        args = JSON.parse(input);
      }

      const result = await executeTool(selectedServer, tool.name, args);
      setExecutionResult(JSON.stringify(result, null, 2));
    } catch (error) {
      setExecutionResult(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleGetPrompt = async (promptItem: MCPPrompt) => {
    if (!selectedServer) return;

    setIsExecuting(true);
    setExecutionResult(null);

    try {
      let args: Record<string, string> = {};
      if (promptItem.arguments && promptItem.arguments.length > 0) {
        const input = prompt(
          `Prompt "${promptItem.name}" 인자 (JSON):\n${JSON.stringify(
            promptItem.arguments.map((a) => ({ [a.name]: a.description || '' })),
            null,
            2
          )}`,
          '{}'
        );
        if (input === null) {
          setIsExecuting(false);
          return;
        }
        args = JSON.parse(input);
      }

      const result = await getPrompt(selectedServer, promptItem.name, args);
      setExecutionResult(JSON.stringify(result, null, 2));
    } catch (error) {
      setExecutionResult(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleReadResource = async (resource: MCPResource) => {
    if (!selectedServer) return;

    setIsExecuting(true);
    setExecutionResult(null);

    try {
      const result = await readResource(selectedServer, resource.uri);
      setExecutionResult(JSON.stringify(result, null, 2));
    } catch (error) {
      setExecutionResult(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleExport = () => {
    const config = exportServers();
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mcp-servers-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const config = JSON.parse(e.target?.result as string) as ExportedConfig;
        const merge = confirm('기존 서버와 병합하시겠습니까?\n취소를 누르면 기존 설정이 대체됩니다.');
        importServers(config, merge);
        alert('설정을 가져왔습니다.');
      } catch {
        alert('유효하지 않은 설정 파일입니다.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const selectedServerData = servers.find((s) => s.config.id === selectedServer);
  const isConnected = selectedServerData?.connectionState.status === 'connected';

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
              <span>채팅으로</span>
            </Link>
            <div className="h-6 w-px bg-slate-700" />
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Server className="w-5 h-5 text-cyan-400" />
              MCP 서버 관리
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-400">
              연결됨: <span className="text-cyan-400 font-medium">{connectedCount}</span>
            </span>
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
              내보내기
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              <Upload className="w-4 h-4" />
              가져오기
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-4 flex gap-4">
        {/* Sidebar - Server List */}
        <div className="w-80 flex-shrink-0">
          <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h2 className="font-medium">서버 목록</h2>
              <button
                onClick={() => {
                  resetForm();
                  setShowForm(true);
                }}
                className="p-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="divide-y divide-slate-800 max-h-[calc(100vh-200px)] overflow-y-auto">
              {servers.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  <Server className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>등록된 서버가 없습니다</p>
                  <button
                    onClick={() => setShowForm(true)}
                    className="mt-3 text-cyan-400 hover:text-cyan-300 text-sm"
                  >
                    서버 추가하기
                  </button>
                </div>
              ) : (
                servers.map((server) => (
                  <div
                    key={server.config.id}
                    onClick={() => handleSelectServer(server.config.id)}
                    className={`p-4 cursor-pointer transition-colors ${
                      selectedServer === server.config.id
                        ? 'bg-slate-800'
                        : 'hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {server.config.transport === 'stdio' ? (
                            <Terminal className="w-4 h-4 text-violet-400" />
                          ) : (
                            <Globe className="w-4 h-4 text-emerald-400" />
                          )}
                          <span className="font-medium truncate">
                            {server.config.name}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          {server.config.transport === 'stdio'
                            ? server.config.command
                            : server.config.url}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        {server.connectionState.status === 'connected' && (
                          <CheckCircle className="w-4 h-4 text-emerald-400" />
                        )}
                        {server.connectionState.status === 'connecting' && (
                          <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
                        )}
                        {server.connectionState.status === 'error' && (
                          <AlertCircle className="w-4 h-4 text-red-400" />
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-3">
                      {server.connectionState.status === 'connected' ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            disconnect(server.config.id);
                          }}
                          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                        >
                          <PowerOff className="w-3 h-3" />
                          연결 해제
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleConnect(server.config.id);
                          }}
                          disabled={server.connectionState.status === 'connecting'}
                          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded transition-colors"
                        >
                          <Power className="w-3 h-3" />
                          연결
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditServer(server.config);
                        }}
                        className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded transition-colors"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm('이 서버를 삭제하시겠습니까?')) {
                            removeServer(server.config.id);
                            if (selectedServer === server.config.id) {
                              setSelectedServer(null);
                            }
                          }
                        }}
                        className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {server.connectionState.status === 'error' && (
                      <div className="mt-2 text-xs text-red-400 truncate">
                        {server.connectionState.error}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {showForm ? (
            /* Server Form */
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
              <h2 className="text-lg font-semibold mb-6">
                {editingServer ? '서버 수정' : '새 서버 추가'}
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    서버 이름
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="My MCP Server"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Transport 타입
                  </label>
                  <div className="flex gap-2">
                    {(['stdio', 'streamable-http', 'sse'] as TransportType[]).map((type) => (
                      <button
                        key={type}
                        onClick={() => setFormData((prev) => ({ ...prev, transport: type }))}
                        className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          formData.transport === type
                            ? 'bg-cyan-600 text-white'
                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                        }`}
                      >
                        {type === 'stdio' && 'STDIO'}
                        {type === 'streamable-http' && 'HTTP'}
                        {type === 'sse' && 'SSE'}
                      </button>
                    ))}
                  </div>
                </div>

                {formData.transport === 'stdio' ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        실행 명령어
                      </label>
                      <input
                        type="text"
                        value={formData.command}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, command: e.target.value }))
                        }
                        placeholder="node, python, npx 등"
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none transition-all"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        인자 (줄바꿈으로 구분)
                      </label>
                      <textarea
                        value={formData.args}
                        onChange={(e) => setFormData((prev) => ({ ...prev, args: e.target.value }))}
                        placeholder="server.js&#10;--port&#10;3000"
                        rows={3}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none transition-all resize-none font-mono text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        환경변수 (JSON)
                      </label>
                      <textarea
                        value={formData.env}
                        onChange={(e) => setFormData((prev) => ({ ...prev, env: e.target.value }))}
                        placeholder='{"API_KEY": "xxx"}'
                        rows={3}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none transition-all resize-none font-mono text-sm"
                      />
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      서버 URL
                    </label>
                    <input
                      type="url"
                      value={formData.url}
                      onChange={(e) => setFormData((prev) => ({ ...prev, url: e.target.value }))}
                      placeholder="http://localhost:3000/mcp"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent outline-none transition-all"
                    />
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleSubmitServer}
                    disabled={!formData.name || (formData.transport === 'stdio' ? !formData.command : !formData.url)}
                    className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
                  >
                    {editingServer ? '수정' : '추가'}
                  </button>
                  <button
                    onClick={resetForm}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          ) : selectedServer && selectedServerData ? (
            /* Server Details */
            <div className="space-y-4">
              {/* Server Info */}
              <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{selectedServerData.config.name}</h2>
                    <p className="text-sm text-slate-500 mt-1">
                      {selectedServerData.config.transport === 'stdio'
                        ? `${selectedServerData.config.command} ${selectedServerData.config.args?.join(' ') || ''}`
                        : selectedServerData.config.url}
                    </p>
                  </div>
                  {isConnected && (
                    <button
                      onClick={() => fetchCapabilities(selectedServer)}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
                    >
                      <RefreshCw className="w-4 h-4" />
                      새로고침
                    </button>
                  )}
                </div>
              </div>

              {!isConnected ? (
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-12 text-center">
                  <Power className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                  <p className="text-slate-400 mb-4">서버에 연결되지 않았습니다</p>
                  <button
                    onClick={() => handleConnect(selectedServer)}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg font-medium transition-colors"
                  >
                    연결하기
                  </button>
                </div>
              ) : (
                <>
                  {/* Tabs */}
                  <div className="bg-slate-900 rounded-xl border border-slate-800">
                    <div className="flex border-b border-slate-800">
                      <button
                        onClick={() => setActiveTab('tools')}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                          activeTab === 'tools'
                            ? 'text-cyan-400 border-b-2 border-cyan-400 -mb-px'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Wrench className="w-4 h-4" />
                        Tools
                        <span className="px-1.5 py-0.5 text-xs bg-slate-800 rounded">
                          {selectedServerData.capabilities?.tools.length || 0}
                        </span>
                      </button>
                      <button
                        onClick={() => setActiveTab('prompts')}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                          activeTab === 'prompts'
                            ? 'text-cyan-400 border-b-2 border-cyan-400 -mb-px'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <MessageSquare className="w-4 h-4" />
                        Prompts
                        <span className="px-1.5 py-0.5 text-xs bg-slate-800 rounded">
                          {selectedServerData.capabilities?.prompts.length || 0}
                        </span>
                      </button>
                      <button
                        onClick={() => setActiveTab('resources')}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                          activeTab === 'resources'
                            ? 'text-cyan-400 border-b-2 border-cyan-400 -mb-px'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <FileText className="w-4 h-4" />
                        Resources
                        <span className="px-1.5 py-0.5 text-xs bg-slate-800 rounded">
                          {selectedServerData.capabilities?.resources.length || 0}
                        </span>
                      </button>
                    </div>

                    {/* Tab Content */}
                    <div className="p-4 max-h-[400px] overflow-y-auto">
                      {activeTab === 'tools' && (
                        <div className="space-y-2">
                          {!selectedServerData.capabilities?.tools.length ? (
                            <p className="text-slate-500 text-center py-8">
                              사용 가능한 Tool이 없습니다
                            </p>
                          ) : (
                            selectedServerData.capabilities.tools.map((tool) => (
                              <div
                                key={tool.name}
                                className="flex items-start justify-between p-3 bg-slate-800/50 rounded-lg"
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="font-mono text-sm text-cyan-400">
                                    {tool.name}
                                  </div>
                                  {tool.description && (
                                    <div className="text-sm text-slate-400 mt-1">
                                      {tool.description}
                                    </div>
                                  )}
                                </div>
                                <button
                                  onClick={() => handleExecuteTool(tool)}
                                  disabled={isExecuting}
                                  className="ml-3 p-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg transition-colors"
                                >
                                  <Play className="w-4 h-4" />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      )}

                      {activeTab === 'prompts' && (
                        <div className="space-y-2">
                          {!selectedServerData.capabilities?.prompts.length ? (
                            <p className="text-slate-500 text-center py-8">
                              사용 가능한 Prompt가 없습니다
                            </p>
                          ) : (
                            selectedServerData.capabilities.prompts.map((prompt) => (
                              <div
                                key={prompt.name}
                                className="flex items-start justify-between p-3 bg-slate-800/50 rounded-lg"
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="font-mono text-sm text-violet-400">
                                    {prompt.name}
                                  </div>
                                  {prompt.description && (
                                    <div className="text-sm text-slate-400 mt-1">
                                      {prompt.description}
                                    </div>
                                  )}
                                  {prompt.arguments && prompt.arguments.length > 0 && (
                                    <div className="text-xs text-slate-500 mt-1">
                                      Args: {prompt.arguments.map((a) => a.name).join(', ')}
                                    </div>
                                  )}
                                </div>
                                <button
                                  onClick={() => handleGetPrompt(prompt)}
                                  disabled={isExecuting}
                                  className="ml-3 p-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg transition-colors"
                                >
                                  <Play className="w-4 h-4" />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      )}

                      {activeTab === 'resources' && (
                        <div className="space-y-2">
                          {!selectedServerData.capabilities?.resources.length ? (
                            <p className="text-slate-500 text-center py-8">
                              사용 가능한 Resource가 없습니다
                            </p>
                          ) : (
                            selectedServerData.capabilities.resources.map((resource) => (
                              <div
                                key={resource.uri}
                                className="flex items-start justify-between p-3 bg-slate-800/50 rounded-lg"
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="font-mono text-sm text-emerald-400 truncate">
                                    {resource.uri}
                                  </div>
                                  {resource.name && (
                                    <div className="text-sm text-slate-300 mt-1">
                                      {resource.name}
                                    </div>
                                  )}
                                  {resource.description && (
                                    <div className="text-sm text-slate-400 mt-1">
                                      {resource.description}
                                    </div>
                                  )}
                                </div>
                                <button
                                  onClick={() => handleReadResource(resource)}
                                  disabled={isExecuting}
                                  className="ml-3 p-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg transition-colors"
                                >
                                  <Play className="w-4 h-4" />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Execution Result */}
                  {(executionResult || isExecuting) && (
                    <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                      <h3 className="text-sm font-medium text-slate-300 mb-3">실행 결과</h3>
                      {isExecuting ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
                        </div>
                      ) : (
                        <pre className="p-4 bg-slate-950 rounded-lg overflow-x-auto text-sm font-mono text-slate-300 max-h-[300px] overflow-y-auto">
                          {executionResult}
                        </pre>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            /* Empty State */
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-12 text-center">
              <Server className="w-16 h-16 text-slate-700 mx-auto mb-4" />
              <h2 className="text-lg font-medium text-slate-400 mb-2">서버를 선택하세요</h2>
              <p className="text-slate-500">
                좌측 목록에서 서버를 선택하거나 새 서버를 추가하세요
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

