import { GoogleGenAI, Type } from '@google/genai';
import { NextRequest } from 'next/server';
import { mcpClientManager } from '@/lib/mcp/client-manager';
import { uploadAndSaveImage } from '@/lib/image-storage';
import type { ToolCallStartEvent, ToolCallResultEvent } from '@/lib/mcp/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface MessageImage {
  url: string;  // Base64 data URL 또는 공개 URL
  mimeType: string;
}

interface ChatMessage {
  role: string;
  content: string;
  images?: MessageImage[];  // 사용자가 업로드한 이미지
}

interface ChatRequestBody {
  messages: ChatMessage[];
  sessionId?: string;
  messageId?: string;
}

// MCP 도구를 Gemini FunctionDeclaration으로 변환
function convertMCPToolToGemini(tool: { name: string; description?: string; inputSchema?: Record<string, unknown> }) {
  // inputSchema가 있으면 parametersJsonSchema로 변환
  const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  
  return {
    name: tool.name,
    description: tool.description || `Tool: ${tool.name}`,
    parametersJsonSchema: schema ? {
      type: 'object' as const,
      properties: schema.properties || {},
      required: schema.required || [],
    } : {
      type: 'object' as const,
      properties: {},
    },
  };
}

// SSE 이벤트 전송 헬퍼
function sendSSE(controller: ReadableStreamDefaultController, event: string, data: unknown) {
  const encoder = new TextEncoder();
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(encoder.encode(message));
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequestBody = await request.json();
    const { messages, sessionId, messageId } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Messages array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY is not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    // 연결된 MCP 서버에서 도구 수집
    const connectedServerIds = mcpClientManager.getConnectedServerIds();
    const allTools: Array<{
      serverId: string;
      serverName: string;
      tool: { name: string; description?: string; inputSchema?: Record<string, unknown> };
    }> = [];
    
    // 서버별 도구 이름 매핑 (도구 이름 -> 서버 정보)
    const toolServerMap = new Map<string, { serverId: string; serverName: string }>();

    for (const serverId of connectedServerIds) {
      try {
        const tools = await mcpClientManager.listTools(serverId);
        const state = mcpClientManager.getConnectionState(serverId);
        
        for (const tool of tools) {
          // 도구 이름 충돌 방지를 위해 서버ID 접두사 추가
          const prefixedName = `${serverId}__${tool.name}`;
          allTools.push({
            serverId,
            serverName: serverId, // 실제 서버 이름이 필요하면 별도 저장 필요
            tool: { ...tool, name: prefixedName },
          });
          toolServerMap.set(prefixedName, { serverId, serverName: state.serverId });
        }
      } catch (error) {
        console.error(`Failed to get tools from server ${serverId}:`, error);
      }
    }

    // Gemini용 함수 선언 생성
    const functionDeclarations = allTools.map(({ tool }) => convertMCPToolToGemini(tool));

    // 메시지 히스토리 변환 (이미지 포함)
    const history = messages.slice(0, -1).map((msg: ChatMessage) => {
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
      
      // 텍스트 내용 추가
      if (msg.content) {
        parts.push({ text: msg.content });
      }
      
      // 이미지 추가 (Base64 데이터인 경우)
      if (msg.images && msg.images.length > 0) {
        for (const img of msg.images) {
          // data:image/png;base64,... 형식에서 Base64 데이터 추출
          const base64Match = img.url.match(/^data:([^;]+);base64,(.+)$/);
          if (base64Match) {
            parts.push({
              inlineData: {
                mimeType: base64Match[1],
                data: base64Match[2],
              },
            });
          }
        }
      }
      
      return {
        role: msg.role === 'user' ? 'user' : 'model',
        parts: parts.length > 0 ? parts : [{ text: '' }],
      };
    });

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'user') {
      return new Response(
        JSON.stringify({ error: 'Last message must be from user' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // 마지막 메시지의 파트 구성 (텍스트 + 이미지)
    const lastMessageParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
    
    if (lastMessage.content) {
      lastMessageParts.push({ text: lastMessage.content });
    }
    
    if (lastMessage.images && lastMessage.images.length > 0) {
      for (const img of lastMessage.images) {
        const base64Match = img.url.match(/^data:([^;]+);base64,(.+)$/);
        if (base64Match) {
          lastMessageParts.push({
            inlineData: {
              mimeType: base64Match[1],
              data: base64Match[2],
            },
          });
        }
      }
    }
    
    // 텍스트도 이미지도 없는 경우 빈 텍스트 추가
    if (lastMessageParts.length === 0) {
      lastMessageParts.push({ text: '' });
    }

    // SSE 스트림 생성
    const readable = new ReadableStream({
      async start(controller) {
        try {
          // 도구가 있는 경우 도구와 함께 호출
          const config = functionDeclarations.length > 0 ? {
            tools: [{ functionDeclarations }],
          } : undefined;

          // 대화 생성
          const chat = ai.chats.create({
            model: 'gemini-2.0-flash-001',
            history: history.length > 0 ? history : undefined,
            config,
          });

          let continueLoop = true;
          let isFirstMessage = true;
          let pendingFunctionResults = '';
          const conversationParts: Array<{ role: string; parts: unknown[] }> = [];

          while (continueLoop) {
            // 메시지 전송
            let response;
            if (isFirstMessage) {
              // 첫 메시지: 이미지가 있으면 parts 배열로 전송
              if (lastMessage.images && lastMessage.images.length > 0) {
                response = await chat.sendMessage({ message: lastMessageParts as unknown as string });
              } else {
                response = await chat.sendMessage({ message: lastMessage.content || '' });
              }
              isFirstMessage = false;
            } else {
              // 후속 메시지 (함수 결과 후)
              response = await chat.sendMessage({ message: pendingFunctionResults || '' });
            }

            // 함수 호출 확인
            const functionCalls = response.functionCalls;

            if (functionCalls && functionCalls.length > 0) {
              // 도구 호출 처리
              const functionResults: Array<{ name: string; response: unknown }> = [];

              for (const call of functionCalls) {
                const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const prefixedName = call.name || '';
                const serverInfo = toolServerMap.get(prefixedName);
                
                if (!serverInfo) {
                  // 서버 정보를 찾을 수 없음
                  sendSSE(controller, 'tool_call_start', {
                    id: callId,
                    serverId: 'unknown',
                    serverName: 'Unknown',
                    name: prefixedName,
                    arguments: call.args || {},
                  } as ToolCallStartEvent);

                  sendSSE(controller, 'tool_call_result', {
                    id: callId,
                    error: 'Server not found for tool',
                  } as ToolCallResultEvent);

                  functionResults.push({
                    name: prefixedName,
                    response: { error: 'Server not found for tool' },
                  });
                  continue;
                }

                // 실제 도구 이름 추출 (접두사 제거)
                const actualToolName = prefixedName.replace(`${serverInfo.serverId}__`, '');

                // 도구 호출 시작 이벤트
                sendSSE(controller, 'tool_call_start', {
                  id: callId,
                  serverId: serverInfo.serverId,
                  serverName: serverInfo.serverName,
                  name: actualToolName,
                  arguments: call.args || {},
                } as ToolCallStartEvent);

                try {
                  // MCP 도구 실행
                  const result = await mcpClientManager.callTool(
                    serverInfo.serverId,
                    actualToolName,
                    call.args as Record<string, unknown> | undefined
                  );

                  // 이미지가 있으면 Storage에 업로드
                  const uploadedImages: Array<{ url: string; mimeType: string }> = [];
                  
                  if (result.images && result.images.length > 0 && sessionId && messageId) {
                    for (let i = 0; i < result.images.length; i++) {
                      const img = result.images[i];
                      const uploadResult = await uploadAndSaveImage(
                        img.data,
                        sessionId,
                        messageId,
                        {
                          filename: `tool_${actualToolName}_${i}_${Date.now()}.${img.mimeType.split('/')[1] || 'png'}`,
                          mimeType: img.mimeType,
                        }
                      );
                      
                      if (uploadResult) {
                        uploadedImages.push({
                          url: uploadResult.publicUrl,
                          mimeType: img.mimeType,
                        });
                      }
                    }
                  }

                  // 도구 호출 결과 이벤트 (UI에는 원본 결과 + 이미지 URL 표시)
                  sendSSE(controller, 'tool_call_result', {
                    id: callId,
                    result: result.raw,
                    images: uploadedImages.length > 0 ? uploadedImages : undefined,
                  } as ToolCallResultEvent);

                  // Gemini에는 텍스트 내용만 전달 (이미지 URL 포함)
                  let responseContent = result.content || '';
                  if (uploadedImages.length > 0) {
                    responseContent += '\n\n[Images generated: ' + uploadedImages.map(img => img.url).join(', ') + ']';
                  }
                  
                  functionResults.push({
                    name: prefixedName,
                    response: responseContent || result.raw,
                  });
                } catch (error) {
                  const errorMessage = error instanceof Error ? error.message : 'Tool execution failed';
                  
                  sendSSE(controller, 'tool_call_result', {
                    id: callId,
                    error: errorMessage,
                  } as ToolCallResultEvent);

                  functionResults.push({
                    name: prefixedName,
                    response: { error: errorMessage },
                  });
                }
              }

              // 함수 결과를 Gemini에 전달
              conversationParts.push({
                role: 'model',
                parts: functionCalls.map(fc => ({ functionCall: fc })),
              });
              
              conversationParts.push({
                role: 'user',
                parts: functionResults.map(fr => ({
                  functionResponse: {
                    name: fr.name,
                    response: fr.response,
                  },
                })),
              });

              // 함수 결과를 다음 메시지로 전송
              // 빈 문자열로 sendMessage를 호출하면 Gemini가 함수 결과를 기반으로 응답
              pendingFunctionResults = '';
            } else {
              // 텍스트 응답
              const text = response.text || '';
              if (text) {
                sendSSE(controller, 'text', { content: text });
              }
              continueLoop = false;
            }
          }

          sendSSE(controller, 'done', {});
          controller.close();
        } catch (error) {
          console.error('Chat API error:', error);
          sendSSE(controller, 'error', {
            message: error instanceof Error ? error.message : 'Internal server error',
          });
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
