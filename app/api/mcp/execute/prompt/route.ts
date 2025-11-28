import { NextRequest, NextResponse } from 'next/server';
import { mcpClientManager } from '@/lib/mcp/client-manager';
import { GetPromptRequest, GetPromptResponse } from '@/lib/mcp/types';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body: GetPromptRequest = await request.json();
    const { serverId, promptName, arguments: args } = body;

    if (!serverId || !promptName) {
      return NextResponse.json<GetPromptResponse>(
        { success: false, error: 'Server ID and prompt name are required' },
        { status: 400 }
      );
    }

      const result = await mcpClientManager.getPrompt(serverId, promptName, args);

      return NextResponse.json({
        success: true,
        result,
      });
  } catch (error) {
    console.error('MCP get prompt error:', error);
    return NextResponse.json<GetPromptResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

