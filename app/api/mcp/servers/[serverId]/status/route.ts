import { NextRequest, NextResponse } from 'next/server';
import { mcpClientManager } from '@/lib/mcp/client-manager';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ serverId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { serverId } = await params;

    if (!serverId) {
      return NextResponse.json(
        { error: 'Server ID is required' },
        { status: 400 }
      );
    }

    const state = mcpClientManager.getConnectionState(serverId);

    return NextResponse.json({
      serverId: state.serverId,
      status: state.status,
      error: state.error,
      connectedAt: state.connectedAt,
    });
  } catch (error) {
    console.error('MCP status error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

