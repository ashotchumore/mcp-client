'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Send, Plus, MessageSquare, Trash2, Menu, X, Server, Circle, ImagePlus, Loader2 } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { useSessions, useMessages, UISession, UIMessage } from '@/lib/hooks/useChat';
import { migrateLocalStorageToSupabase } from '@/lib/migration';
import { useMCP } from '@/lib/mcp/mcp-context';
import { ToolCallsList } from '@/components/chat/tool-call-card';
import type { ToolCallInfo, ToolCallStartEvent, ToolCallResultEvent } from '@/lib/mcp/types';

// 이미지 업로드 API 호출
async function uploadImageToStorage(
  base64Data: string,
  sessionId: string,
  messageId: string,
  options?: { filename?: string; mimeType?: string }
): Promise<{ publicUrl: string } | null> {
  try {
    const response = await fetch('/api/upload/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base64Data,
        sessionId,
        messageId,
        filename: options?.filename,
        mimeType: options?.mimeType,
      }),
    });

    if (!response.ok) {
      console.error('Upload failed:', response.statusText);
      return null;
    }

    const result = await response.json();
    if (result.success) {
      return { publicUrl: result.publicUrl };
    }
    return null;
  } catch (error) {
    console.error('Upload error:', error);
    return null;
  }
}

// 업로드 대기 중인 이미지
interface PendingImage {
  file: File;
  previewUrl: string;
  base64: string;
  mimeType: string;
}

function generateSessionTitle(firstMessage: string): string {
  const maxLength = 50;
  const trimmed = firstMessage.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength) + '...';
}

interface GroupedSessions {
  label: string;
  sessions: UISession[];
  order: number;
}

function groupSessionsByDate(sessions: UISession[]): GroupedSessions[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const thisWeek = new Date(today);
  thisWeek.setDate(thisWeek.getDate() - 7);
  const thisMonth = new Date(today);
  thisMonth.setMonth(thisMonth.getMonth() - 1);

  const groups: { [key: string]: UISession[] } = {
    today: [],
    yesterday: [],
    thisWeek: [],
    thisMonth: [],
    older: [],
  };

  sessions.forEach((session) => {
    const sessionDate = new Date(session.updatedAt);
    const sessionDateOnly = new Date(sessionDate.getFullYear(), sessionDate.getMonth(), sessionDate.getDate());

    if (sessionDateOnly.getTime() === today.getTime()) {
      groups.today.push(session);
    } else if (sessionDateOnly.getTime() === yesterday.getTime()) {
      groups.yesterday.push(session);
    } else if (sessionDate >= thisWeek) {
      groups.thisWeek.push(session);
    } else if (sessionDate >= thisMonth) {
      groups.thisMonth.push(session);
    } else {
      groups.older.push(session);
    }
  });

  // Sort sessions within each group by updatedAt (newest first)
  Object.keys(groups).forEach((key) => {
    groups[key].sort((a, b) => b.updatedAt - a.updatedAt);
  });

  const result: GroupedSessions[] = [];
  
  if (groups.today.length > 0) {
    result.push({ label: '오늘', sessions: groups.today, order: 0 });
  }
  if (groups.yesterday.length > 0) {
    result.push({ label: '어제', sessions: groups.yesterday, order: 1 });
  }
  if (groups.thisWeek.length > 0) {
    result.push({ label: '이번 주', sessions: groups.thisWeek, order: 2 });
  }
  if (groups.thisMonth.length > 0) {
    result.push({ label: '이번 달', sessions: groups.thisMonth, order: 3 });
  }
  if (groups.older.length > 0) {
    result.push({ label: '이전', sessions: groups.older, order: 4 });
  }

  return result;
}

// 현재 응답에 대한 도구 호출 상태
interface CurrentResponseState {
  toolCalls: ToolCallInfo[];
  textContent: string;
}

export default function Home() {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [migrationDone, setMigrationDone] = useState(false);
  const [currentResponse, setCurrentResponse] = useState<CurrentResponseState>({
    toolCalls: [],
    textContent: '',
  });
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [imageUploading, setImageUploading] = useState(false);
  // 세션 중 보낸 메시지의 이미지를 추적 (메시지 인덱스 -> 이미지 URL 배열)
  const [sentMessageImages, setSentMessageImages] = useState<Map<number, string[]>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { connectedCount } = useMCP();

  const {
    sessions,
    loading: sessionsLoading,
    createSession,
    updateSessionTitle,
    updateSessionTimestamp,
    deleteSession: deleteSessionFromDB,
    fetchSessions,
  } = useSessions();

  const {
    messages,
    loading: messagesLoading,
    addMessage,
    updateLastMessage,
    saveLastMessage,
    clearMessages,
  } = useMessages(currentSessionId);

  // Run migration on first load
  useEffect(() => {
    async function runMigration() {
      const result = await migrateLocalStorageToSupabase();
      if (result.migrated) {
        console.log(`Migration complete: ${result.sessionsCount} sessions, ${result.messagesCount} messages`);
        fetchSessions();
      }
      setMigrationDone(true);
    }
    runMigration();
  }, [fetchSessions]);

  // Set current session to most recent when sessions load
  useEffect(() => {
    if (migrationDone && !sessionsLoading && sessions.length > 0 && !currentSessionId) {
      const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
      setCurrentSessionId(sorted[0].id);
    }
  }, [sessions, sessionsLoading, currentSessionId, migrationDone]);

  // Update ref when session changes
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  // Scroll to bottom when messages or current response change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentResponse]);

  const handleCreateNewSession = async () => {
    const newSession = await createSession('새 대화');
    if (newSession) {
      setCurrentSessionId(newSession.id);
      setInput('');
      setSidebarOpen(false);
      setSentMessageImages(new Map()); // 새 세션 시 이미지 추적 초기화
      setPendingImages([]); // 대기 중인 이미지도 초기화
    }
  };

  const switchSession = (sessionId: string) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
    setCurrentSessionId(sessionId);
    setSidebarOpen(false);
    setCurrentResponse({ toolCalls: [], textContent: '' });
    setSentMessageImages(new Map()); // 세션 변경 시 이미지 추적 초기화
    setPendingImages([]); // 대기 중인 이미지도 초기화
  };

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('이 대화를 삭제하시겠습니까?')) return;

    await deleteSessionFromDB(sessionId);

    if (currentSessionId === sessionId) {
      const remaining = sessions.filter((s) => s.id !== sessionId);
      if (remaining.length > 0) {
        const sorted = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt);
        setCurrentSessionId(sorted[0].id);
      } else {
        setCurrentSessionId(null);
      }
    }
  };

  // SSE 이벤트 파싱
  const parseSSEEvent = useCallback((line: string): { event: string; data: unknown } | null => {
    if (!line.startsWith('event:')) return null;
    
    const eventMatch = line.match(/^event:\s*(\w+)/);
    const dataMatch = line.match(/data:\s*(.+)$/m);
    
    if (eventMatch && dataMatch) {
      try {
        return {
          event: eventMatch[1],
          data: JSON.parse(dataMatch[1]),
        };
      } catch {
        return null;
      }
    }
    return null;
  }, []);

  // 이미지 파일 선택 핸들러
  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setImageUploading(true);
    
    const newImages: PendingImage[] = [];
    
    for (const file of Array.from(files)) {
      // 이미지 파일만 허용
      if (!file.type.startsWith('image/')) continue;
      
      // 10MB 제한
      if (file.size > 10 * 1024 * 1024) {
        alert(`파일 "${file.name}"이(가) 너무 큽니다. 10MB 이하만 지원됩니다.`);
        continue;
      }

      try {
        // Base64로 변환
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        newImages.push({
          file,
          previewUrl: URL.createObjectURL(file),
          base64,
          mimeType: file.type,
        });
      } catch (error) {
        console.error('Failed to read file:', error);
      }
    }

    setPendingImages((prev) => [...prev, ...newImages]);
    setImageUploading(false);
    
    // 파일 입력 초기화
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // 대기 중인 이미지 제거
  const removePendingImage = useCallback((index: number) => {
    setPendingImages((prev) => {
      const newImages = [...prev];
      // 미리보기 URL 해제
      URL.revokeObjectURL(newImages[index].previewUrl);
      newImages.splice(index, 1);
      return newImages;
    });
  }, []);

  // 이미지 업로드 버튼 클릭
  const handleImageButtonClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // 텍스트나 이미지 중 하나라도 있어야 전송 가능
    if ((!input.trim() && pendingImages.length === 0) || isLoading) return;

    let sessionId = currentSessionId;
    const userInput = input.trim();
    const imagesToSend = [...pendingImages];

    // Create new session if none exists
    if (!sessionId) {
      const title = userInput || (imagesToSend.length > 0 ? '이미지 분석' : '새 대화');
      const newSession = await createSession(generateSessionTitle(title));
      if (!newSession) return;
      sessionId = newSession.id;
      setCurrentSessionId(sessionId);
    } else if (messages.length === 0 && userInput) {
      // Update title from first message
      await updateSessionTitle(sessionId, generateSessionTitle(userInput));
    }

    // Add user message to DB (이미지 정보는 별도 저장)
    const userMessage = await addMessage('user', userInput || '[이미지]');
    if (!userMessage) return;
    
    const userMessageId = userMessage.id;

    // 입력 초기화
    setInput('');
    setPendingImages([]);
    setIsLoading(true);
    setCurrentResponse({ toolCalls: [], textContent: '' });

    // 미리보기 URL 해제
    imagesToSend.forEach(img => URL.revokeObjectURL(img.previewUrl));

    // Create abort controller for cancellation
    abortControllerRef.current = new AbortController();

    // 이미지를 Supabase Storage에 업로드
    const uploadedImageUrls: string[] = [];
    if (imagesToSend.length > 0 && userMessageId) {
      for (let i = 0; i < imagesToSend.length; i++) {
        const img = imagesToSend[i];
        try {
          const result = await uploadImageToStorage(
            img.base64,
            sessionId,
            userMessageId,
            {
              filename: `user_image_${i}_${Date.now()}.${img.mimeType.split('/')[1] || 'png'}`,
              mimeType: img.mimeType,
            }
          );
          if (result) {
            uploadedImageUrls.push(result.publicUrl);
          }
        } catch (error) {
          console.error('Failed to upload image:', error);
          // 업로드 실패해도 Base64로 전송은 계속 진행
        }
      }
    }

    // 보낸 이미지를 추적 (UI 표시용 - Storage URL 사용)
    if (imagesToSend.length > 0) {
      const messageIndex = messages.length; // 새 사용자 메시지 인덱스
      setSentMessageImages(prev => {
        const newMap = new Map(prev);
        // Storage URL이 있으면 사용, 없으면 Base64 사용
        const imageUrls = uploadedImageUrls.length > 0 
          ? uploadedImageUrls 
          : imagesToSend.map(img => img.base64);
        newMap.set(messageIndex, imageUrls);
        return newMap;
      });
    }

    try {
      // Build message history with images for the last message
      const newMessages: UIMessage[] = [
        ...messages, 
        { 
          role: 'user', 
          content: userInput,
          images: imagesToSend.map(img => ({ url: img.base64, mimeType: img.mimeType })),
        }
      ];
      
      // Pre-insert empty model message and get its ID for image storage
      const modelMessage = await addMessage('model', '');
      const modelMessageId = modelMessage?.id;
      
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          messages: newMessages,
          sessionId,          // 이미지 저장을 위한 세션 ID
          messageId: modelMessageId,  // 이미지와 메시지 연결을 위한 메시지 ID
        }),
        signal: abortControllerRef.current.signal,
      });

      // Ensure we're still on the same session
      if (sessionId !== currentSessionIdRef.current) return;

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedText = '';
      const toolCallsMap = new Map<string, ToolCallInfo>();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Check if session changed during streaming
        if (sessionId !== currentSessionIdRef.current) {
          reader.cancel();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        
        // SSE 이벤트 파싱
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || ''; // 마지막 불완전한 청크 보관

        for (const chunk of lines) {
          if (!chunk.trim()) continue;

          const eventLine = chunk.split('\n').find(l => l.startsWith('event:'));
          const dataLine = chunk.split('\n').find(l => l.startsWith('data:'));

          if (eventLine && dataLine) {
            const event = eventLine.replace('event:', '').trim();
            let data: unknown;
            try {
              data = JSON.parse(dataLine.replace('data:', '').trim());
            } catch {
              continue;
            }

            switch (event) {
              case 'text': {
                const textData = data as { content: string };
                accumulatedText = textData.content;
                updateLastMessage(accumulatedText);
                setCurrentResponse(prev => ({ ...prev, textContent: accumulatedText }));
                break;
              }
              case 'tool_call_start': {
                const startData = data as ToolCallStartEvent;
                const toolCall: ToolCallInfo = {
                  id: startData.id,
                  serverId: startData.serverId,
                  serverName: startData.serverName,
                  name: startData.name,
                  arguments: startData.arguments,
                  status: 'executing',
                  startedAt: Date.now(),
                };
                toolCallsMap.set(startData.id, toolCall);
                setCurrentResponse(prev => ({
                  ...prev,
                  toolCalls: Array.from(toolCallsMap.values()),
                }));
                break;
              }
              case 'tool_call_result': {
                const resultData = data as ToolCallResultEvent;
                const existingCall = toolCallsMap.get(resultData.id);
                if (existingCall) {
                  existingCall.status = resultData.error ? 'error' : 'completed';
                  existingCall.result = resultData.result;
                  existingCall.error = resultData.error;
                  existingCall.images = resultData.images;  // 이미지 URL 추가
                  existingCall.completedAt = Date.now();
                  toolCallsMap.set(resultData.id, existingCall);
                  setCurrentResponse(prev => ({
                    ...prev,
                    toolCalls: Array.from(toolCallsMap.values()),
                  }));
                }
                break;
              }
              case 'error': {
                const errorData = data as { message: string };
                throw new Error(errorData.message);
              }
              case 'done':
                break;
            }
          }
        }
      }

      // Save the final message content to DB
      await saveLastMessage(accumulatedText);
      await updateSessionTimestamp(sessionId);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // User cancelled - handled by abort
      } else {
        // Show error message
        const errorContent = `Error: ${error instanceof Error ? error.message : 'Failed to get response'}`;
        updateLastMessage(errorContent);
        await saveLastMessage(errorContent);
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      // 도구 호출 상태는 유지 (표시용)
    }
  };

  const handleClear = async () => {
    if (!currentSessionId) return;
    if (confirm('이 대화의 모든 메시지를 삭제하시겠습니까?')) {
      await clearMessages();
      setCurrentResponse({ toolCalls: [], textContent: '' });
    }
  };

  const groupedSessions = groupSessionsByDate(sessions);
  const currentSession = sessions.find((s) => s.id === currentSessionId);

  // Show loading state during initial load
  if (!migrationDone || (sessionsLoading && sessions.length === 0)) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-500 dark:text-gray-400">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800 flex flex-col transition-transform duration-200`}
      >
        <div className="p-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              대화 목록
            </h2>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <button
            onClick={handleCreateNewSession}
            className="w-full flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>새 대화</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {groupedSessions.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 text-sm mt-8">
              대화가 없습니다
            </div>
          ) : (
            <div className="space-y-4">
              {groupedSessions.map((group) => (
                <div key={group.label} className="space-y-1">
                  <div className="px-2 py-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    {group.label}
                  </div>
                  {group.sessions.map((session) => (
                    <div
                      key={session.id}
                      onClick={() => switchSession(session.id)}
                      className={`group flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-colors ${
                        session.id === currentSessionId
                          ? 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      <MessageSquare className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {session.title}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {new Date(session.updatedAt).toLocaleDateString('ko-KR', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleDeleteSession(session.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-opacity"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Sidebar overlay for mobile */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
              >
                <Menu className="w-5 h-5" />
              </button>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {currentSession?.title || 'AI Chat'}
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <Link
                href="/mcp"
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <Server className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                <span className="text-gray-700 dark:text-gray-300">MCP</span>
                <div className="flex items-center gap-1">
                  <Circle
                    className={`w-2 h-2 ${
                      connectedCount > 0 ? 'text-emerald-500 fill-emerald-500' : 'text-gray-400 fill-gray-400'
                    }`}
                  />
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {connectedCount}
                  </span>
                </div>
              </Link>
              {messages.length > 0 && (
                <button
                  onClick={handleClear}
                  className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                >
                  채팅 삭제
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-4xl mx-auto space-y-4">
          {messagesLoading ? (
            <div className="text-center text-gray-500 dark:text-gray-400 mt-12">
              메시지 로딩 중...
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 mt-12">
              <p>메시지를 입력하여 대화를 시작하세요.</p>
              {connectedCount > 0 && (
                <p className="text-sm mt-2 text-emerald-600 dark:text-emerald-400">
                  {connectedCount}개의 MCP 서버가 연결되어 도구를 사용할 수 있습니다.
                </p>
              )}
            </div>
          ) : (
            <>
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${
                    message.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-2 ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    {message.role === 'user' ? (
                      <div className="space-y-2">
                        {/* 사용자가 보낸 이미지 표시 (DB에서 로드 또는 현재 세션에서 전송) */}
                        {(message.images && message.images.length > 0) || sentMessageImages.get(index) ? (
                          <div className="flex flex-wrap gap-2">
                            {/* DB에서 로드된 이미지 */}
                            {message.images?.map((img, imgIndex) => (
                              <img
                                key={`db-${imgIndex}`}
                                src={img.url}
                                alt={`Image ${imgIndex + 1}`}
                                className="max-w-[200px] max-h-[200px] rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => window.open(img.url, '_blank')}
                              />
                            ))}
                            {/* 현재 세션에서 전송된 이미지 (DB에 아직 없는 경우) */}
                            {!message.images && sentMessageImages.get(index)?.map((imgUrl, imgIndex) => (
                              <img
                                key={`sent-${imgIndex}`}
                                src={imgUrl}
                                alt={`Sent image ${imgIndex + 1}`}
                                className="max-w-[200px] max-h-[200px] rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => window.open(imgUrl, '_blank')}
                              />
                            ))}
                          </div>
                        ) : null}
                        {/* 텍스트 내용 */}
                        {message.content && message.content !== '[이미지]' && (
                          <div className="whitespace-pre-wrap break-words">
                            {message.content}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="break-words">
                        {/* 마지막 어시스턴트 메시지인 경우 도구 호출 표시 */}
                        {index === messages.length - 1 && currentResponse.toolCalls.length > 0 && (
                          <ToolCallsList toolCalls={currentResponse.toolCalls} />
                        )}
                        {message.content ? (
                          <div className="[&_*]:text-inherit">
                            <Streamdown parseIncompleteMarkdown={isLoading && index === messages.length - 1}>
                              {message.content}
                            </Streamdown>
                          </div>
                        ) : isLoading && index === messages.length - 1 ? (
                          currentResponse.toolCalls.length === 0 && (
                            <span className="text-gray-500">...</span>
                          )
                        ) : (
                          <span className="text-gray-500">...</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Form */}
        <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-4 py-4">
          <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
            {/* 이미지 미리보기 */}
            {pendingImages.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3 p-2 bg-gray-100 dark:bg-gray-800 rounded-lg">
                {pendingImages.map((img, index) => (
                  <div key={index} className="relative group">
                    <img
                      src={img.previewUrl}
                      alt={`Preview ${index + 1}`}
                      className="w-20 h-20 object-cover rounded-lg border border-gray-300 dark:border-gray-600"
                    />
                    <button
                      type="button"
                      onClick={() => removePendingImage(index)}
                      className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="flex gap-2">
              {/* 숨겨진 파일 입력 */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                onChange={handleImageSelect}
                className="hidden"
              />
              
              {/* 이미지 업로드 버튼 */}
              <button
                type="button"
                onClick={handleImageButtonClick}
                disabled={isLoading || imageUploading}
                className="px-3 py-2 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="이미지 업로드"
              >
                <ImagePlus className="w-5 h-5" />
              </button>
              
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                placeholder={
                  connectedCount > 0
                    ? `메시지를 입력하세요... (${connectedCount}개 MCP 서버 연결됨)`
                    : '메시지를 입력하세요... (Shift+Enter로 줄바꿈)'
                }
                rows={1}
                className="flex-1 resize-none rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={(!input.trim() && pendingImages.length === 0) || isLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
