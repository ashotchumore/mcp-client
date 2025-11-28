'use client';

import { useState, useEffect, useRef } from 'react';
import { Send, Plus, MessageSquare, Trash2, Menu, X } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { useSessions, useMessages, UISession, UIMessage } from '@/lib/hooks/useChat';
import { migrateLocalStorageToSupabase } from '@/lib/migration';

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

export default function Home() {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [migrationDone, setMigrationDone] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);

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
    setMessages,
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

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleCreateNewSession = async () => {
    const newSession = await createSession('새 대화');
    if (newSession) {
      setCurrentSessionId(newSession.id);
      setInput('');
      setSidebarOpen(false);
    }
  };

  const switchSession = (sessionId: string) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
    setCurrentSessionId(sessionId);
    setSidebarOpen(false);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    let sessionId = currentSessionId;
    const userInput = input.trim();

    // Create new session if none exists
    if (!sessionId) {
      const newSession = await createSession(generateSessionTitle(userInput));
      if (!newSession) return;
      sessionId = newSession.id;
      setCurrentSessionId(sessionId);
    } else if (messages.length === 0) {
      // Update title from first message
      await updateSessionTitle(sessionId, generateSessionTitle(userInput));
    }

    // Add user message to DB
    const userMessage = await addMessage('user', userInput);
    if (!userMessage) return;

    setInput('');
    setIsLoading(true);

    // Create abort controller for cancellation
    abortControllerRef.current = new AbortController();

    try {
      // Add empty assistant message for streaming
      const newMessages: UIMessage[] = [...messages, { role: 'user', content: userInput }];
      
      // Pre-insert empty model message
      await addMessage('model', '');
      
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
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
      let accumulatedText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Check if session changed during streaming
        if (sessionId !== currentSessionIdRef.current) {
          reader.cancel();
          return;
        }

        const chunk = decoder.decode(value, { stream: true });
        accumulatedText += chunk;

        // Update the last assistant message with accumulated text
        updateLastMessage(accumulatedText);
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
    }
  };

  const handleClear = async () => {
    if (!currentSessionId) return;
    if (confirm('이 대화의 모든 메시지를 삭제하시겠습니까?')) {
      await clearMessages();
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
            {messages.length > 0 && (
              <button
                onClick={handleClear}
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
              >
                채팅 삭제
              </button>
            )}
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
              메시지를 입력하여 대화를 시작하세요.
            </div>
          ) : (
            messages.map((message, index) => (
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
                    <div className="whitespace-pre-wrap break-words">
                      {message.content}
                    </div>
                  ) : (
                    <div className="break-words [&_*]:text-inherit">
                      {message.content ? (
                        <Streamdown parseIncompleteMarkdown={isLoading && index === messages.length - 1}>
                          {message.content}
                        </Streamdown>
                      ) : (
                        <span className="text-gray-500">...</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Form */}
        <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-4 py-4">
          <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                placeholder="메시지를 입력하세요... (Shift+Enter로 줄바꿈)"
                rows={1}
                className="flex-1 resize-none rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
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
