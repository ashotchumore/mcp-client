import { NextResponse } from 'next/server';
import { mcpClientManager } from '@/lib/mcp/client-manager';

export const runtime = 'nodejs';

/**
 * 현재 연결된 MCP 서버 목록 조회
 * 클라이언트 상태와 서버 상태를 동기화하기 위해 사용
 */
export async function GET() {
  try {
    const connectedServerIds = mcpClientManager.getConnectedServerIds();

    return NextResponse.json({
      connectedServerIds,
    });
  } catch (error) {
    console.error('MCP connections error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

