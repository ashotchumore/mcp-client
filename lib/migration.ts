import { supabase } from './supabase';

const SESSIONS_STORAGE_KEY = 'chat_sessions';
const LEGACY_STORAGE_KEY = 'chat_messages';
const MIGRATION_DONE_KEY = 'supabase_migration_done';

interface LegacySession {
  id: string;
  title: string;
  updatedAt: number;
}

interface LegacyMessage {
  role: 'user' | 'model';
  content: string;
}

function getMessagesStorageKey(sessionId: string): string {
  return `chat_messages_${sessionId}`;
}

export async function migrateLocalStorageToSupabase(): Promise<{
  migrated: boolean;
  sessionsCount: number;
  messagesCount: number;
  error?: string;
}> {
  // Skip if migration already done
  if (typeof window === 'undefined') {
    return { migrated: false, sessionsCount: 0, messagesCount: 0 };
  }

  if (localStorage.getItem(MIGRATION_DONE_KEY)) {
    return { migrated: false, sessionsCount: 0, messagesCount: 0 };
  }

  let sessionsCount = 0;
  let messagesCount = 0;

  try {
    // Load sessions from localStorage
    const storedSessions = localStorage.getItem(SESSIONS_STORAGE_KEY);
    let sessions: LegacySession[] = [];

    if (storedSessions) {
      try {
        const parsed = JSON.parse(storedSessions);
        if (Array.isArray(parsed)) {
          sessions = parsed;
        }
      } catch {
        console.error('Failed to parse stored sessions');
      }
    }

    // Handle legacy data (single chat_messages key)
    const legacyMessages = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyMessages && sessions.length === 0) {
      try {
        const parsed = JSON.parse(legacyMessages);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const firstUserMessage = parsed.find((m: LegacyMessage) => m.role === 'user');
          const newSession: LegacySession = {
            id: crypto.randomUUID(),
            title: firstUserMessage ? firstUserMessage.content.slice(0, 50) : '이전 대화',
            updatedAt: Date.now(),
          };
          sessions = [newSession];
          localStorage.setItem(getMessagesStorageKey(newSession.id), legacyMessages);
        }
      } catch {
        console.error('Failed to migrate legacy messages');
      }
    }

    // No data to migrate
    if (sessions.length === 0) {
      localStorage.setItem(MIGRATION_DONE_KEY, 'true');
      return { migrated: false, sessionsCount: 0, messagesCount: 0 };
    }

    // Migrate each session and its messages
    for (const session of sessions) {
      // Insert session with specific ID
      const { error: sessionError } = await supabase.from('chat_sessions').insert({
        id: session.id,
        title: session.title,
        updated_at: new Date(session.updatedAt).toISOString(),
      });

      if (sessionError) {
        // Skip if session already exists
        if (!sessionError.message.includes('duplicate')) {
          console.error('Failed to migrate session:', sessionError);
          continue;
        }
      } else {
        sessionsCount++;
      }

      // Load and migrate messages for this session
      const storedMessages = localStorage.getItem(getMessagesStorageKey(session.id));
      if (storedMessages) {
        try {
          const messages: LegacyMessage[] = JSON.parse(storedMessages);
          if (Array.isArray(messages) && messages.length > 0) {
            const messageInserts = messages.map((msg, index) => ({
              session_id: session.id,
              role: msg.role,
              content: msg.content,
              // Add index to created_at to preserve order
              created_at: new Date(session.updatedAt - (messages.length - index) * 1000).toISOString(),
            }));

            const { error: messagesError } = await supabase
              .from('messages')
              .insert(messageInserts);

            if (messagesError) {
              console.error('Failed to migrate messages:', messagesError);
            } else {
              messagesCount += messages.length;
            }
          }
        } catch {
          console.error('Failed to parse messages for session:', session.id);
        }
      }
    }

    // Clean up localStorage after successful migration
    localStorage.removeItem(SESSIONS_STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    sessions.forEach((session) => {
      localStorage.removeItem(getMessagesStorageKey(session.id));
    });
    localStorage.setItem(MIGRATION_DONE_KEY, 'true');

    return { migrated: true, sessionsCount, messagesCount };
  } catch (error) {
    return {
      migrated: false,
      sessionsCount,
      messagesCount,
      error: error instanceof Error ? error.message : 'Migration failed',
    };
  }
}

export function clearMigrationFlag(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(MIGRATION_DONE_KEY);
  }
}


