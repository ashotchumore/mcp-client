import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  MCPServerConfig,
  ConnectionStatus,
  ServerConnectionState,
  MCPTool,
  MCPPrompt,
  MCPResource,
} from './types';

interface ClientInstance {
  client: Client;
  transport: Transport;
  config: MCPServerConfig;
  state: ServerConnectionState;
}

/**
 * MCP Client Manager - 싱글톤 패턴
 * 서버별 MCP Client 인스턴스를 관리
 */
class MCPClientManager {
  private static instance: MCPClientManager;
  private clients: Map<string, ClientInstance> = new Map();

  private constructor() {}

  static getInstance(): MCPClientManager {
    if (!MCPClientManager.instance) {
      MCPClientManager.instance = new MCPClientManager();
    }
    return MCPClientManager.instance;
  }

  /**
   * Transport 생성
   */
  private createTransport(config: MCPServerConfig): Transport {
    switch (config.transport) {
      case 'stdio':
        if (!config.command) {
          throw new Error('STDIO transport requires a command');
        }
        return new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env: config.env,
        });

      case 'streamable-http':
        if (!config.url) {
          throw new Error('Streamable HTTP transport requires a URL');
        }
        return new StreamableHTTPClientTransport(new URL(config.url));

      case 'sse':
        if (!config.url) {
          throw new Error('SSE transport requires a URL');
        }
        return new SSEClientTransport(new URL(config.url));

      default:
        throw new Error(`Unsupported transport type: ${config.transport}`);
    }
  }

  /**
   * 서버에 연결
   */
  async connect(config: MCPServerConfig): Promise<ServerConnectionState> {
    const existingClient = this.clients.get(config.id);
    if (existingClient && existingClient.state.status === 'connected') {
      return existingClient.state;
    }

    // 기존 연결이 있으면 정리
    if (existingClient) {
      await this.disconnect(config.id);
    }

    const state: ServerConnectionState = {
      serverId: config.id,
      status: 'connecting',
    };

    try {
      const transport = this.createTransport(config);
      const client = new Client({
        name: `mcp-client-${config.id}`,
        version: '1.0.0',
      });

      await client.connect(transport);

      state.status = 'connected';
      state.connectedAt = Date.now();

      this.clients.set(config.id, {
        client,
        transport,
        config,
        state,
      });

      return state;
    } catch (error) {
      state.status = 'error';
      state.error = error instanceof Error ? error.message : 'Connection failed';
      return state;
    }
  }

  /**
   * 서버 연결 해제
   */
  async disconnect(serverId: string): Promise<void> {
    const instance = this.clients.get(serverId);
    if (!instance) return;

    try {
      await instance.client.close();
    } catch (error) {
      console.error(`Error closing client ${serverId}:`, error);
    } finally {
      this.clients.delete(serverId);
    }
  }

  /**
   * 연결 상태 조회
   */
  getConnectionState(serverId: string): ServerConnectionState {
    const instance = this.clients.get(serverId);
    if (!instance) {
      return { serverId, status: 'disconnected' };
    }
    return instance.state;
  }

  /**
   * 연결된 클라이언트 가져오기
   */
  getClient(serverId: string): Client | null {
    const instance = this.clients.get(serverId);
    if (!instance || instance.state.status !== 'connected') {
      return null;
    }
    return instance.client;
  }

  /**
   * Tools 목록 조회
   */
  async listTools(serverId: string): Promise<MCPTool[]> {
    const client = this.getClient(serverId);
    if (!client) {
      throw new Error(`Server ${serverId} is not connected`);
    }

    const result = await client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
    }));
  }

  /**
   * Prompts 목록 조회
   */
  async listPrompts(serverId: string): Promise<MCPPrompt[]> {
    const client = this.getClient(serverId);
    if (!client) {
      throw new Error(`Server ${serverId} is not connected`);
    }

    const result = await client.listPrompts();
    return result.prompts.map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments,
    }));
  }

  /**
   * Resources 목록 조회
   */
  async listResources(serverId: string): Promise<MCPResource[]> {
    const client = this.getClient(serverId);
    if (!client) {
      throw new Error(`Server ${serverId} is not connected`);
    }

    const result = await client.listResources();
    return result.resources.map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType,
    }));
  }

  /**
   * Tool 실행
   * MCP CallToolResult를 파싱하여 content, 이미지, 원본 결과를 반환
   */
  async callTool(
    serverId: string,
    toolName: string,
    args?: Record<string, unknown>
  ): Promise<{
    content: string;
    images: Array<{ data: string; mimeType: string }>;
    raw: unknown;
  }> {
    const client = this.getClient(serverId);
    if (!client) {
      throw new Error(`Server ${serverId} is not connected`);
    }

    const result = await client.callTool({
      name: toolName,
      arguments: args || {},
    });

    // content 배열에서 텍스트 추출
    let textContent = '';
    const images: Array<{ data: string; mimeType: string }> = [];
    
    if (result.content && Array.isArray(result.content)) {
      for (const item of result.content) {
        if (item.type === 'text') {
          textContent += (textContent ? '\n' : '') + (item as { type: 'text'; text: string }).text;
        } else if (item.type === 'image') {
          // 이미지 타입 처리
          const imageItem = item as { type: 'image'; data: string; mimeType: string };
          images.push({
            data: imageItem.data,
            mimeType: imageItem.mimeType || 'image/png',
          });
        }
      }
    }

    return {
      content: textContent,  // Gemini에 전달할 텍스트
      images,                // Base64 이미지 배열
      raw: result,           // UI에 표시할 원본 결과
    };
  }

  /**
   * Prompt 가져오기
   */
  async getPrompt(
    serverId: string,
    promptName: string,
    args?: Record<string, string>
  ): Promise<unknown> {
    const client = this.getClient(serverId);
    if (!client) {
      throw new Error(`Server ${serverId} is not connected`);
    }

    const result = await client.getPrompt({
      name: promptName,
      arguments: args,
    });

    return result;
  }

  /**
   * Resource 읽기
   */
  async readResource(serverId: string, uri: string): Promise<unknown> {
    const client = this.getClient(serverId);
    if (!client) {
      throw new Error(`Server ${serverId} is not connected`);
    }

    const result = await client.readResource({ uri });
    return result;
  }

  /**
   * 모든 연결된 서버 ID 조회
   */
  getConnectedServerIds(): string[] {
    return Array.from(this.clients.entries())
      .filter(([, instance]) => instance.state.status === 'connected')
      .map(([id]) => id);
  }

  /**
   * 모든 연결 해제
   */
  async disconnectAll(): Promise<void> {
    const serverIds = Array.from(this.clients.keys());
    await Promise.all(serverIds.map((id) => this.disconnect(id)));
  }
}

// 싱글톤 인스턴스 export
export const mcpClientManager = MCPClientManager.getInstance();
export type { ConnectionStatus };

