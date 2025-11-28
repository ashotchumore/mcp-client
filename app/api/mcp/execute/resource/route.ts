import { NextRequest, NextResponse } from 'next/server';
import { mcpClientManager } from '@/lib/mcp/client-manager';
import { ReadResourceRequest, ReadResourceResponse } from '@/lib/mcp/types';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body: ReadResourceRequest = await request.json();
    const { serverId, uri } = body;

    if (!serverId || !uri) {
      return NextResponse.json<ReadResourceResponse>(
        { success: false, error: 'Server ID and resource URI are required' },
        { status: 400 }
      );
    }

      const result = await mcpClientManager.readResource(serverId, uri);

      return NextResponse.json({
        success: true,
        result,
      });
  } catch (error) {
    console.error('MCP read resource error:', error);
    return NextResponse.json<ReadResourceResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

