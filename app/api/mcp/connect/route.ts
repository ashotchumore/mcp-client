import { NextRequest, NextResponse } from 'next/server';
import { mcpClientManager } from '@/lib/mcp/client-manager';
import { ConnectRequest, ConnectResponse } from '@/lib/mcp/types';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body: ConnectRequest = await request.json();
    const { config } = body;

    if (!config || !config.id || !config.transport) {
      return NextResponse.json<ConnectResponse>(
        { success: false, serverId: '', error: 'Invalid server configuration' },
        { status: 400 }
      );
    }

    const state = await mcpClientManager.connect(config);

    if (state.status === 'connected') {
      return NextResponse.json<ConnectResponse>({
        success: true,
        serverId: config.id,
      });
    } else {
      return NextResponse.json<ConnectResponse>(
        {
          success: false,
          serverId: config.id,
          error: state.error || 'Connection failed',
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('MCP connect error:', error);
    return NextResponse.json<ConnectResponse>(
      {
        success: false,
        serverId: '',
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

