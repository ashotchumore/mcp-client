// MCP 서버 설정 타입
export type TransportType = 'stdio' | 'streamable-http' | 'sse';

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: TransportType;
  // STDIO transport
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // HTTP/SSE transport
  url?: string;
}

// 연결 상태
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ServerConnectionState {
  serverId: string;
  status: ConnectionStatus;
  error?: string;
  connectedAt?: number;
}

// MCP 기능 타입
export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface MCPResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

// 서버 기능 목록
export interface ServerCapabilities {
  tools: MCPTool[];
  prompts: MCPPrompt[];
  resources: MCPResource[];
}

// API 요청/응답 타입
export interface ConnectRequest {
  config: MCPServerConfig;
}

export interface ConnectResponse {
  success: boolean;
  serverId: string;
  error?: string;
}

export interface DisconnectRequest {
  serverId: string;
}

export interface DisconnectResponse {
  success: boolean;
  error?: string;
}

export interface ExecuteToolRequest {
  serverId: string;
  toolName: string;
  arguments?: Record<string, unknown>;
}

export interface ExecuteToolResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface GetPromptRequest {
  serverId: string;
  promptName: string;
  arguments?: Record<string, string>;
}

export interface GetPromptResponse {
  success: boolean;
  messages?: Array<{
    role: string;
    content: { type: string; text?: string };
  }>;
  error?: string;
}

export interface ReadResourceRequest {
  serverId: string;
  uri: string;
}

export interface ReadResourceResponse {
  success: boolean;
  contents?: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  }>;
  error?: string;
}

// 설정 내보내기/가져오기
export interface ExportedConfig {
  version: string;
  servers: MCPServerConfig[];
  exportedAt: string;
}

// 채팅 도구 호출 관련 타입
export type ToolCallStatus = 'pending' | 'executing' | 'completed' | 'error';

export interface ToolCallInfo {
  id: string;
  serverId: string;
  serverName: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
  images?: Array<{ url: string; mimeType: string }>;
  status: ToolCallStatus;
  startedAt?: number;
  completedAt?: number;
}

// SSE 이벤트 타입
export type ChatSSEEventType = 'text' | 'tool_call_start' | 'tool_call_result' | 'image' | 'error' | 'done';

export interface ChatSSEEvent {
  type: ChatSSEEventType;
  data: unknown;
}

export interface TextEvent {
  content: string;
}

export interface ToolCallStartEvent {
  id: string;
  serverId: string;
  serverName: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResultEvent {
  id: string;
  result?: unknown;
  error?: string;
  images?: Array<{ url: string; mimeType: string }>;
}

// 이미지 이벤트 (도구 호출 결과의 이미지)
export interface ImageEvent {
  toolCallId: string;
  url: string;
  mimeType: string;
}

// 확장된 채팅 메시지 타입
export interface ChatMessagePart {
  type: 'text' | 'tool_call';
  content?: string;
  toolCall?: ToolCallInfo;
}

