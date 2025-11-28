'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase, ChatSession, Message } from '../supabase';

// UI에서 사용하는 메시지 타입 (DB 타입과 분리)
export interface UIMessage {
  role: 'user' | 'model';
  content: string;
}

// UI에서 사용하는 세션 타입 (updatedAt을 number로 변환)
export interface UISession {
  id: string;
  title: string;
  updatedAt: number;
}

function toUISession(session: ChatSession): UISession {
  return {
    id: session.id,
    title: session.title,
    updatedAt: new Date(session.updated_at).getTime(),
  };
}

function toUIMessage(message: Message): UIMessage {
  return {
    role: message.role,
    content: message.content,
  };
}

export function useSessions() {
  const [sessions, setSessions] = useState<UISession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('chat_sessions')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setSessions((data || []).map(toUISession));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const createSession = useCallback(async (title: string = '새 대화'): Promise<UISession | null> => {
    try {
      const { data, error } = await supabase
        .from('chat_sessions')
        .insert({ title })
        .select()
        .single();

      if (error) throw error;
      const newSession = toUISession(data);
      setSessions((prev) => [newSession, ...prev]);
      return newSession;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
      return null;
    }
  }, []);

  const updateSessionTitle = useCallback(async (sessionId: string, title: string) => {
    try {
      const { error } = await supabase
        .from('chat_sessions')
        .update({ title, updated_at: new Date().toISOString() })
        .eq('id', sessionId);

      if (error) throw error;
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title, updatedAt: Date.now() } : s))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update session');
    }
  }, []);

  const updateSessionTimestamp = useCallback(async (sessionId: string) => {
    try {
      const { error } = await supabase
        .from('chat_sessions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', sessionId);

      if (error) throw error;
      setSessions((prev) => {
        const updated = prev.map((s) =>
          s.id === sessionId ? { ...s, updatedAt: Date.now() } : s
        );
        return updated.sort((a, b) => b.updatedAt - a.updatedAt);
      });
    } catch (err) {
      console.error('Failed to update session timestamp:', err);
    }
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      const { error } = await supabase
        .from('chat_sessions')
        .delete()
        .eq('id', sessionId);

      if (error) throw error;
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete session');
    }
  }, []);

  return {
    sessions,
    setSessions,
    loading,
    error,
    fetchSessions,
    createSession,
    updateSessionTitle,
    updateSessionTimestamp,
    deleteSession,
  };
}

export function useMessages(sessionId: string | null) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMessages = useCallback(async () => {
    if (!sessionId) {
      setMessages([]);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages((data || []).map(toUIMessage));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch messages');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const addMessage = useCallback(
    async (role: 'user' | 'model', content: string) => {
      if (!sessionId) return null;

      try {
        const { data, error } = await supabase
          .from('messages')
          .insert({ session_id: sessionId, role, content })
          .select()
          .single();

        if (error) throw error;
        const newMessage = toUIMessage(data);
        setMessages((prev) => [...prev, newMessage]);
        return newMessage;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add message');
        return null;
      }
    },
    [sessionId]
  );

  const updateLastMessage = useCallback(
    async (content: string) => {
      if (!sessionId) return;

      // 먼저 UI 업데이트
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content };
        return updated;
      });
    },
    [sessionId]
  );

  const saveLastMessage = useCallback(
    async (content: string) => {
      if (!sessionId) return;

      try {
        // 마지막 메시지의 ID를 가져와서 업데이트
        const { data: lastMessages } = await supabase
          .from('messages')
          .select('id')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: false })
          .limit(1);

        if (lastMessages && lastMessages.length > 0) {
          await supabase
            .from('messages')
            .update({ content })
            .eq('id', lastMessages[0].id);
        }
      } catch (err) {
        console.error('Failed to save last message:', err);
      }
    },
    [sessionId]
  );

  const clearMessages = useCallback(async () => {
    if (!sessionId) return;

    try {
      const { error } = await supabase
        .from('messages')
        .delete()
        .eq('session_id', sessionId);

      if (error) throw error;
      setMessages([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear messages');
    }
  }, [sessionId]);

  return {
    messages,
    setMessages,
    loading,
    error,
    fetchMessages,
    addMessage,
    updateLastMessage,
    saveLastMessage,
    clearMessages,
  };
}


