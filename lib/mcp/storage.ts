import { MCPServerConfig, ExportedConfig } from './types';

const STORAGE_KEY = 'mcp_servers';
const CONFIG_VERSION = '1.0';

/**
 * localStorage에서 MCP 서버 설정 목록 조회
 */
export function getServers(): MCPServerConfig[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    return JSON.parse(data) as MCPServerConfig[];
  } catch (error) {
    console.error('Failed to load MCP servers from localStorage:', error);
    return [];
  }
}

/**
 * localStorage에 MCP 서버 설정 목록 저장
 */
export function saveServers(servers: MCPServerConfig[]): void {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
  } catch (error) {
    console.error('Failed to save MCP servers to localStorage:', error);
  }
}

/**
 * 새 MCP 서버 추가
 */
export function addServer(server: MCPServerConfig): MCPServerConfig[] {
  const servers = getServers();
  const exists = servers.some((s) => s.id === server.id);
  
  if (exists) {
    throw new Error(`Server with id "${server.id}" already exists`);
  }
  
  const updated = [...servers, server];
  saveServers(updated);
  return updated;
}

/**
 * MCP 서버 설정 업데이트
 */
export function updateServer(server: MCPServerConfig): MCPServerConfig[] {
  const servers = getServers();
  const index = servers.findIndex((s) => s.id === server.id);
  
  if (index === -1) {
    throw new Error(`Server with id "${server.id}" not found`);
  }
  
  servers[index] = server;
  saveServers(servers);
  return servers;
}

/**
 * MCP 서버 삭제
 */
export function removeServer(serverId: string): MCPServerConfig[] {
  const servers = getServers();
  const updated = servers.filter((s) => s.id !== serverId);
  saveServers(updated);
  return updated;
}

/**
 * ID로 MCP 서버 조회
 */
export function getServerById(serverId: string): MCPServerConfig | undefined {
  const servers = getServers();
  return servers.find((s) => s.id === serverId);
}

/**
 * 서버 설정 내보내기 (JSON)
 */
export function exportConfig(): ExportedConfig {
  const servers = getServers();
  return {
    version: CONFIG_VERSION,
    servers,
    exportedAt: new Date().toISOString(),
  };
}

/**
 * 서버 설정 가져오기 (JSON)
 */
export function importConfig(config: ExportedConfig, merge: boolean = false): MCPServerConfig[] {
  if (!config.version || !Array.isArray(config.servers)) {
    throw new Error('Invalid config format');
  }
  
  const importedServers = config.servers;
  
  if (merge) {
    const existingServers = getServers();
    const existingIds = new Set(existingServers.map((s) => s.id));
    
    // 중복되지 않는 서버만 추가
    const newServers = importedServers.filter((s) => !existingIds.has(s.id));
    const merged = [...existingServers, ...newServers];
    saveServers(merged);
    return merged;
  } else {
    saveServers(importedServers);
    return importedServers;
  }
}

/**
 * 고유 서버 ID 생성
 */
export function generateServerId(): string {
  return `mcp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

