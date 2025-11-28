import { NextRequest, NextResponse } from 'next/server';
import { mcpClientManager } from '@/lib/mcp/client-manager';
import { DisconnectRequest, DisconnectResponse } from '@/lib/mcp/types';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body: DisconnectRequest = await request.json();
    const { serverId } = body;

    if (!serverId) {
      return NextResponse.json<DisconnectResponse>(
        { success: false, error: 'Server ID is required' },
        { status: 400 }
      );
    }

    await mcpClientManager.disconnect(serverId);

    return NextResponse.json<DisconnectResponse>({
      success: true,
    });
  } catch (error) {
    console.error('MCP disconnect error:', error);
    return NextResponse.json<DisconnectResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

