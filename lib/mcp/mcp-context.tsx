'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import {
  MCPServerConfig,
  ConnectionStatus,
  ServerConnectionState,
  MCPTool,
  MCPPrompt,
  MCPResource,
  ServerCapabilities,
  ExportedConfig,
} from './types';
import {
  getServers,
  addServer as addServerToStorage,
  updateServer as updateServerInStorage,
  removeServer as removeServerFromStorage,
  exportConfig,
  importConfig,
  generateServerId,
} from './storage';

interface ServerState {
  config: MCPServerConfig;
  connectionState: ServerConnectionState;
  capabilities?: ServerCapabilities;
}

interface MCPContextValue {
  servers: ServerState[];
  loading: boolean;
  
  // 서버 관리
  addServer: (config: Omit<MCPServerConfig, 'id'>) => MCPServerConfig;
  updateServer: (config: MCPServerConfig) => void;
  removeServer: (serverId: string) => Promise<void>;
  
  // 연결 관리
  connect: (serverId: string) => Promise<boolean>;
  disconnect: (serverId: string) => Promise<void>;
  refreshStatus: (serverId: string) => Promise<void>;
  
  // 기능 조회
  fetchCapabilities: (serverId: string) => Promise<ServerCapabilities | null>;
  
  // Tool 실행
  executeTool: (serverId: string, toolName: string, args?: Record<string, unknown>) => Promise<unknown>;
  
  // Prompt 조회
  getPrompt: (serverId: string, promptName: string, args?: Record<string, string>) => Promise<unknown>;
  
  // Resource 읽기
  readResource: (serverId: string, uri: string) => Promise<unknown>;
  
  // 설정 가져오기/내보내기
  exportServers: () => ExportedConfig;
  importServers: (config: ExportedConfig, merge?: boolean) => void;
  
  // 연결된 서버 수
  connectedCount: number;
}

const MCPContext = createContext<MCPContextValue | null>(null);

export function MCPProvider({ children }: { children: ReactNode }) {
  const [servers, setServers] = useState<ServerState[]>([]);
  const [loading, setLoading] = useState(true);

  // 초기 로드 및 서버 연결 상태 동기화
  useEffect(() => {
    async function initializeServers() {
      const storedServers = getServers();
      
      // 먼저 기본 상태로 설정
      const initialServers: ServerState[] = storedServers.map((config) => ({
        config,
        connectionState: { serverId: config.id, status: 'disconnected' as ConnectionStatus },
      }));
      
      setServers(initialServers);
      
      // 서버에서 실제 연결 상태 가져오기
      try {
        const response = await fetch('/api/mcp/connections');
        const data = await response.json();
        const connectedIds: string[] = data.connectedServerIds || [];
        
        if (connectedIds.length > 0) {
          // 연결된 서버들의 상태 업데이트
          setServers((prev) =>
            prev.map((s) =>
              connectedIds.includes(s.config.id)
                ? {
                    ...s,
                    connectionState: {
                      serverId: s.config.id,
                      status: 'connected' as ConnectionStatus,
                      connectedAt: Date.now(),
                    },
                  }
                : s
            )
          );
        }
      } catch (error) {
        console.error('Failed to sync connection status:', error);
      }
      
      setLoading(false);
    }
    
    initializeServers();
  }, []);

  // 서버 추가
  const addServer = useCallback((configWithoutId: Omit<MCPServerConfig, 'id'>): MCPServerConfig => {
    const config: MCPServerConfig = {
      ...configWithoutId,
      id: generateServerId(),
    };
    
    addServerToStorage(config);
    setServers((prev) => [
      ...prev,
      {
        config,
        connectionState: { serverId: config.id, status: 'disconnected' },
      },
    ]);
    
    return config;
  }, []);

  // 서버 업데이트
  const updateServer = useCallback((config: MCPServerConfig) => {
    updateServerInStorage(config);
    setServers((prev) =>
      prev.map((s) =>
        s.config.id === config.id ? { ...s, config } : s
      )
    );
  }, []);

  // 서버 삭제
  const removeServer = useCallback(async (serverId: string) => {
    // 연결 해제
    try {
      await fetch('/api/mcp/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId }),
      });
    } catch {
      // 무시
    }
    
    removeServerFromStorage(serverId);
    setServers((prev) => prev.filter((s) => s.config.id !== serverId));
  }, []);

  // 연결
  const connect = useCallback(async (serverId: string): Promise<boolean> => {
    const server = servers.find((s) => s.config.id === serverId);
    if (!server) return false;

    setServers((prev) =>
      prev.map((s) =>
        s.config.id === serverId
          ? { ...s, connectionState: { serverId, status: 'connecting' } }
          : s
      )
    );

    try {
      const response = await fetch('/api/mcp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: server.config }),
      });

      const data = await response.json();

      if (data.success) {
        setServers((prev) =>
          prev.map((s) =>
            s.config.id === serverId
              ? {
                  ...s,
                  connectionState: {
                    serverId,
                    status: 'connected',
                    connectedAt: Date.now(),
                  },
                }
              : s
          )
        );
        return true;
      } else {
        setServers((prev) =>
          prev.map((s) =>
            s.config.id === serverId
              ? {
                  ...s,
                  connectionState: {
                    serverId,
                    status: 'error',
                    error: data.error,
                  },
                }
              : s
          )
        );
        return false;
      }
    } catch (error) {
      setServers((prev) =>
        prev.map((s) =>
          s.config.id === serverId
            ? {
                ...s,
                connectionState: {
                  serverId,
                  status: 'error',
                  error: error instanceof Error ? error.message : 'Connection failed',
                },
              }
            : s
        )
      );
      return false;
    }
  }, [servers]);

  // 연결 해제
  const disconnect = useCallback(async (serverId: string) => {
    try {
      await fetch('/api/mcp/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId }),
      });
    } catch {
      // 무시
    }

    setServers((prev) =>
      prev.map((s) =>
        s.config.id === serverId
          ? {
              ...s,
              connectionState: { serverId, status: 'disconnected' },
              capabilities: undefined,
            }
          : s
      )
    );
  }, []);

  // 상태 새로고침
  const refreshStatus = useCallback(async (serverId: string) => {
    try {
      const response = await fetch(`/api/mcp/servers/${serverId}/status`);
      const data = await response.json();

      setServers((prev) =>
        prev.map((s) =>
          s.config.id === serverId
            ? {
                ...s,
                connectionState: {
                  serverId,
                  status: data.status,
                  error: data.error,
                  connectedAt: data.connectedAt,
                },
              }
            : s
        )
      );
    } catch (error) {
      console.error('Failed to refresh status:', error);
    }
  }, []);

  // 기능 조회
  const fetchCapabilities = useCallback(async (serverId: string): Promise<ServerCapabilities | null> => {
    try {
      const [toolsRes, promptsRes, resourcesRes] = await Promise.all([
        fetch(`/api/mcp/servers/${serverId}/tools`),
        fetch(`/api/mcp/servers/${serverId}/prompts`),
        fetch(`/api/mcp/servers/${serverId}/resources`),
      ]);

      const [toolsData, promptsData, resourcesData] = await Promise.all([
        toolsRes.json(),
        promptsRes.json(),
        resourcesRes.json(),
      ]);

      const capabilities: ServerCapabilities = {
        tools: (toolsData.tools || []) as MCPTool[],
        prompts: (promptsData.prompts || []) as MCPPrompt[],
        resources: (resourcesData.resources || []) as MCPResource[],
      };

      setServers((prev) =>
        prev.map((s) =>
          s.config.id === serverId ? { ...s, capabilities } : s
        )
      );

      return capabilities;
    } catch (error) {
      console.error('Failed to fetch capabilities:', error);
      return null;
    }
  }, []);

  // Tool 실행
  const executeTool = useCallback(
    async (serverId: string, toolName: string, args?: Record<string, unknown>) => {
      const response = await fetch('/api/mcp/execute/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, toolName, arguments: args }),
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Tool execution failed');
      }
      return data.result;
    },
    []
  );

  // Prompt 조회
  const getPrompt = useCallback(
    async (serverId: string, promptName: string, args?: Record<string, string>) => {
      const response = await fetch('/api/mcp/execute/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, promptName, arguments: args }),
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Prompt retrieval failed');
      }
      return data.result;
    },
    []
  );

  // Resource 읽기
  const readResource = useCallback(async (serverId: string, uri: string) => {
    const response = await fetch('/api/mcp/execute/resource', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId, uri }),
    });

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Resource read failed');
    }
    return data.result;
  }, []);

  // 설정 내보내기
  const exportServers = useCallback(() => {
    return exportConfig();
  }, []);

  // 설정 가져오기
  const importServers = useCallback((config: ExportedConfig, merge: boolean = false) => {
    const updatedServers = importConfig(config, merge);
    setServers(
      updatedServers.map((cfg) => ({
        config: cfg,
        connectionState: { serverId: cfg.id, status: 'disconnected' as ConnectionStatus },
      }))
    );
  }, []);

  // 연결된 서버 수
  const connectedCount = servers.filter(
    (s) => s.connectionState.status === 'connected'
  ).length;

  const value: MCPContextValue = {
    servers,
    loading,
    addServer,
    updateServer,
    removeServer,
    connect,
    disconnect,
    refreshStatus,
    fetchCapabilities,
    executeTool,
    getPrompt,
    readResource,
    exportServers,
    importServers,
    connectedCount,
  };

  return <MCPContext.Provider value={value}>{children}</MCPContext.Provider>;
}

export function useMCP() {
  const context = useContext(MCPContext);
  if (!context) {
    throw new Error('useMCP must be used within MCPProvider');
  }
  return context;
}

