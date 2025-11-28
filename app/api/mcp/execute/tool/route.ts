import { NextRequest, NextResponse } from 'next/server';
import { mcpClientManager } from '@/lib/mcp/client-manager';
import { ExecuteToolRequest, ExecuteToolResponse } from '@/lib/mcp/types';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body: ExecuteToolRequest = await request.json();
    const { serverId, toolName, arguments: args } = body;

    if (!serverId || !toolName) {
      return NextResponse.json<ExecuteToolResponse>(
        { success: false, error: 'Server ID and tool name are required' },
        { status: 400 }
      );
    }

    const result = await mcpClientManager.callTool(serverId, toolName, args);

    return NextResponse.json<ExecuteToolResponse>({
      success: true,
      result: result.raw,  // 원본 MCP 결과 반환
    });
  } catch (error) {
    console.error('MCP execute tool error:', error);
    return NextResponse.json<ExecuteToolResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

