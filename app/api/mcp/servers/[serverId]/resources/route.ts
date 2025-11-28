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

    const resources = await mcpClientManager.listResources(serverId);

    return NextResponse.json({ resources });
  } catch (error) {
    console.error('MCP list resources error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

