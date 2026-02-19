'use client';

/**
 * HAI.ai Provider Context
 *
 * Manages global HAI.ai state including:
 * - Chat open/closed state
 * - Current session
 * - User context (enabler, course)
 * - Session history
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

// ============================================================================
// TYPES
// ============================================================================

export interface HaiSession {
  id: string;
  title: string | null;
  contextType: string | null;
  contextId: string | null;
  isActive: boolean;
  lastMessageAt: string | null;
  createdAt: string;
  messageCount?: number;
}

export interface HaiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Array<{
    sourceType: string;
    sourceId: string;
    title: string;
    similarity: number;
    url?: string;
  }>;
  createdAt: string;
  versions?: Array<{
    content: string;
    citations?: Array<{
      sourceType: string;
      sourceId: string;
      title: string;
      similarity: number;
      url?: string;
    }>;
    createdAt: string;
  }>;
  activeVersionIndex?: number;
  baseUserMessageId?: string;
}

export interface HaiContext {
  enablerId?: string;
  courseId?: string;
  enablerTitle?: string;
  scenarioText?: string;
}

export type ViewMode = 'hidden' | 'minimized' | 'widget' | 'full';

interface HaiProviderState {
  // UI State
  viewMode: ViewMode;
  isLoading: boolean;
  streamingMessageId: string | null;

  // Session State
  currentSessionId: string | null;
  sessions: HaiSession[];
  messages: HaiMessage[];

  // Context State
  context: HaiContext;

  // Actions
  setViewMode: (mode: ViewMode) => void;
  toggleChat: () => void;

  setContext: (context: HaiContext) => void;
  clearContext: () => void;

  sendMessage: (message: string) => Promise<void>;
  stopGeneration: () => void;
  updateMessage: (messageId: string, newContent: string) => Promise<void>;
  regenerateFromEdit: (messageId: string, newContent: string) => Promise<void>;
  setActiveVersion: (messageId: string, versionIndex: number) => void;
  loadSession: (sessionId: string) => Promise<void>;
  newSession: () => void;
  deleteSession: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, newTitle: string) => Promise<void>;

  refreshSessions: () => Promise<void>;
  searchSessions: (query: string) => Promise<HaiSession[]>;
}

const HaiContext = createContext<HaiProviderState | null>(null);

// ============================================================================
// HOOK
// ============================================================================

export function useHai() {
  const context = useContext(HaiContext);
  if (!context) {
    throw new Error('useHai must be used within a HaiProvider');
  }
  return context;
}

// ============================================================================
// PROVIDER
// ============================================================================

interface HaiProviderProps {
  children: React.ReactNode;
  userId: string;
  initialContext?: HaiContext;
}

export function HaiProvider({
  children,
  userId,
  initialContext,
}: HaiProviderProps) {
  const { t } = useLanguage();

  // UI State
  const [viewMode, setViewModeState] = useState<ViewMode>('hidden');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(
    null
  );

  // Session State
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<HaiSession[]>([]);
  const [messages, setMessages] = useState<HaiMessage[]>([]);

  // Abort controller for in-flight streams — prevents message bleed across sessions
  const abortControllerRef = React.useRef<AbortController | null>(null);
  // Track which session the current stream belongs to
  const activeStreamSessionRef = React.useRef<string | null>(null);
  // Always-current messages ref (for reading latest state synchronously)
  const messagesRef = React.useRef<HaiMessage[]>([]);
  messagesRef.current = messages;

  // Context State
  const [context, setContextState] = useState<HaiContext>(initialContext || {});

  // ========================================================================
  // UI ACTIONS
  // ========================================================================

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
  }, []);

  const toggleChat = useCallback(() => {
    setViewModeState(prev => {
      if (prev === 'hidden' || prev === 'minimized') return 'widget';
      return 'hidden'; // Or minimized? User expects toggle to open/close
    });
  }, []);

  // ========================================================================
  // CONTEXT ACTIONS
  // ========================================================================

  const setContext = useCallback((newContext: HaiContext) => {
    setContextState(newContext);
  }, []);

  const clearContext = useCallback(() => {
    setContextState({});
  }, []);

  // ========================================================================
  // SESSION ACTIONS
  // ========================================================================

  const refreshSessions = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/hai/session?userId=${userId}&includeArchived=true&limit=50`
      );
      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions || []);
      }
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    }
  }, [userId]);

  const searchSessions = useCallback(
    async (query: string): Promise<HaiSession[]> => {
      if (!query || query.trim().length < 2) return [];
      try {
        const response = await fetch(
          `/api/hai/session?userId=${userId}&search=${encodeURIComponent(query.trim())}&limit=20`
        );
        if (response.ok) {
          const data = await response.json();
          return data.sessions || [];
        }
      } catch (error) {
        console.error('Failed to search sessions:', error);
      }
      return [];
    },
    [userId]
  );

  const loadSession = useCallback(
    async (sessionId: string) => {
      // Abort any in-flight stream to prevent message bleed
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      setIsLoading(true);
      try {
        const response = await fetch(
          `/api/hai/session?userId=${userId}&sessionId=${sessionId}`
        );
        if (response.ok) {
          const data = await response.json();
          setCurrentSessionId(sessionId);

          // Reconstruct version arrays and user↔assistant links from DB metadata
          const rawMessages: Array<{
            id: string;
            role: string;
            content: string;
            citations?: unknown[];
            metadata?: Record<string, unknown>;
            createdAt: string;
          }> = data.messages || [];

          const hydrated: HaiMessage[] = rawMessages.map((m, idx) => {
            const meta =
              m.metadata && typeof m.metadata === 'object'
                ? (m.metadata as Record<string, unknown>)
                : {};

            // Reconstruct versions from metadata if present
            const storedVersions = Array.isArray(meta.versions)
              ? (meta.versions as Array<{
                  content: string;
                  citations?: unknown[];
                  createdAt: string;
                }>)
              : undefined;

            // Determine active version index
            const activeIdx =
              typeof meta.activeVersionIndex === 'number'
                ? (meta.activeVersionIndex as number)
                : storedVersions
                  ? storedVersions.length - 1
                  : 0;

            // Link assistant to the preceding user message
            let baseUserMessageId: string | undefined;
            if (m.role === 'assistant' && idx > 0) {
              // Find the closest preceding user message
              for (let i = idx - 1; i >= 0; i--) {
                if (rawMessages[i].role === 'user') {
                  baseUserMessageId = rawMessages[i].id;
                  break;
                }
              }
            }

            return {
              id: m.id,
              role: m.role as 'user' | 'assistant',
              content: m.content,
              citations: m.citations as HaiMessage['citations'],
              createdAt: m.createdAt,
              versions: storedVersions
                ? storedVersions.map(v => ({
                    content: v.content,
                    citations: v.citations as HaiMessage['citations'],
                    createdAt: v.createdAt,
                  }))
                : undefined,
              activeVersionIndex: storedVersions ? activeIdx : undefined,
              baseUserMessageId,
            };
          });

          setMessages(hydrated);

          // Update context from session if available
          if (data.session?.contextId) {
            setContextState(prev => ({
              ...prev,
              enablerId:
                data.session.contextType === 'enabler'
                  ? data.session.contextId
                  : prev.enablerId,
              courseId:
                data.session.contextType === 'course'
                  ? data.session.contextId
                  : prev.courseId,
            }));
          }
        }
      } catch (error) {
        console.error('Failed to load session:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [userId]
  );

  const newSession = useCallback(() => {
    // Abort any in-flight stream to prevent message bleed
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    activeStreamSessionRef.current = null;
    setCurrentSessionId(null);
    setMessages([]);
    setIsLoading(false);
  }, []);

  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        const response = await fetch(
          `/api/hai/session?userId=${userId}&sessionId=${sessionId}`,
          {
            method: 'DELETE',
          }
        );
        if (response.ok) {
          setSessions(prev => prev.filter(s => s.id !== sessionId));
          if (currentSessionId === sessionId) {
            newSession();
          }
        }
      } catch (error) {
        console.error('Failed to delete session:', error);
      }
    },
    [userId, currentSessionId, newSession]
  );

  const renameSession = useCallback(
    async (sessionId: string, newTitle: string) => {
      try {
        // Optimistic update
        setSessions(prev =>
          prev.map(s => (s.id === sessionId ? { ...s, title: newTitle } : s))
        );

        const response = await fetch(`/api/hai/session?userId=${userId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, title: newTitle }),
        });

        if (!response.ok) {
          // Revert on failure (could implement more robust rollback)
          await refreshSessions();
        }
      } catch (error) {
        console.error('Failed to rename session:', error);
        await refreshSessions();
      }
    },
    [userId, refreshSessions]
  );

  // ========================================================================
  // CHAT ACTIONS
  // ========================================================================

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    activeStreamSessionRef.current = null;
    setStreamingMessageId(null);
    setIsLoading(false);
  }, []);

  const setActiveVersion = useCallback(
    (messageId: string, versionIndex: number) => {
      setMessages(prev => {
        // Find the target message
        const target = prev.find(m => m.id === messageId);
        if (!target || !target.versions) return prev;

        const safeIndex = Math.max(
          0,
          Math.min(versionIndex, target.versions.length - 1)
        );

        // Determine the paired message id for syncing Q&A versions
        let pairedId: string | null = null;
        if (target.role === 'assistant' && target.baseUserMessageId) {
          pairedId = target.baseUserMessageId;
        } else if (target.role === 'user') {
          const paired = prev.find(
            m => m.role === 'assistant' && m.baseUserMessageId === messageId
          );
          // Fallback: next assistant after this user
          if (!paired) {
            const userIdx = prev.findIndex(m => m.id === messageId);
            for (let i = userIdx + 1; i < prev.length; i++) {
              if (prev[i].role === 'assistant') {
                pairedId = prev[i].id;
                break;
              }
              if (prev[i].role === 'user') break;
            }
          } else {
            pairedId = paired.id;
          }
        }

        return prev.map(m => {
          if (m.id === messageId && m.versions) {
            const v = m.versions[safeIndex];
            return {
              ...m,
              activeVersionIndex: safeIndex,
              content: v.content,
              citations: v.citations,
            };
          }
          // Sync paired message to same version index
          if (m.id === pairedId && m.versions) {
            const pSafe = Math.max(
              0,
              Math.min(safeIndex, m.versions.length - 1)
            );
            const pv = m.versions[pSafe];
            return {
              ...m,
              activeVersionIndex: pSafe,
              content: pv.content,
              citations: pv.citations,
            };
          }
          return m;
        });
      });
    },
    []
  );

  const updateMessage = useCallback(
    async (messageId: string, newContent: string) => {
      if (!newContent.trim()) return;

      // Optimistic UI update
      setMessages(prev =>
        prev.map(m =>
          m.id === messageId ? { ...m, content: newContent.trim() } : m
        )
      );

      try {
        const response = await fetch(`/api/hai/chat?userId=${userId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId, content: newContent.trim() }),
        });

        if (!response.ok) {
          await refreshSessions();
        }
      } catch (error) {
        console.error('Failed to update message:', error);
        await refreshSessions();
      }
    },
    [userId, refreshSessions]
  );

  const regenerateFromEdit = useCallback(
    async (messageId: string, newContent: string) => {
      if (!newContent.trim() || !currentSessionId) return;

      // Abort any previous in-flight stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Track which session this stream belongs to
      const streamSessionId = currentSessionId;
      activeStreamSessionRef.current = streamSessionId;

      setIsLoading(true);

      // Compute assistantId synchronously from the ref (React 18 may defer
      // setState updater execution, so we must NOT rely on side-effects
      // inside the setMessages callback to set a local variable).
      const currentMsgs = messagesRef.current;
      const userIdx = currentMsgs.findIndex(m => m.id === messageId);

      // Try finding by baseUserMessageId first
      let assistantIdx = currentMsgs.findIndex(
        m => m.role === 'assistant' && m.baseUserMessageId === messageId
      );

      // Fallback: next assistant message right after the edited user message
      if (assistantIdx < 0 && userIdx >= 0) {
        for (let i = userIdx + 1; i < currentMsgs.length; i++) {
          if (currentMsgs[i].role === 'assistant') {
            assistantIdx = i;
            break;
          }
          if (currentMsgs[i].role === 'user') break;
        }
      }

      let assistantId: string;
      if (assistantIdx >= 0) {
        assistantId = currentMsgs[assistantIdx].id;
      } else {
        assistantId = `msg-${Date.now()}`;
      }

      // Now update messages state with the known assistantId
      // Also add a version to the user message for slider navigation
      setMessages(prev => {
        const updated = [...prev];
        const uIdx = updated.findIndex(m => m.id === messageId);
        const aIdx =
          assistantIdx >= 0 ? updated.findIndex(m => m.id === assistantId) : -1;
        const now = new Date().toISOString();

        // --- Add version to the user (question) message ---
        if (uIdx >= 0) {
          const userMsg = updated[uIdx];
          const userVersions = userMsg.versions
            ? [...userMsg.versions]
            : [
                {
                  content: userMsg.content,
                  citations: userMsg.citations,
                  createdAt: userMsg.createdAt,
                },
              ];
          // Only add a new version if the content actually changed
          const lastUserVersion = userVersions[userVersions.length - 1];
          if (lastUserVersion.content !== newContent.trim()) {
            userVersions.push({
              content: newContent.trim(),
              citations: [],
              createdAt: now,
            });
          }
          const userNewIndex = userVersions.length - 1;
          updated[uIdx] = {
            ...userMsg,
            content: newContent.trim(),
            versions: userVersions,
            activeVersionIndex: userNewIndex,
          };
        }

        // --- Add version to the assistant (answer) message ---
        if (aIdx >= 0) {
          const current = updated[aIdx];
          const versions = current.versions
            ? [...current.versions]
            : [
                {
                  content: current.content,
                  citations: current.citations,
                  createdAt: current.createdAt,
                },
              ];
          versions.push({ content: '', citations: [], createdAt: now });
          const newIndex = versions.length - 1;
          updated[aIdx] = {
            ...current,
            content: '',
            citations: [],
            versions,
            activeVersionIndex: newIndex,
            baseUserMessageId: messageId,
          };
        } else {
          // Create new assistant message after the user message
          const newAssistant: HaiMessage = {
            id: assistantId,
            role: 'assistant',
            content: '',
            citations: [],
            createdAt: now,
            versions: [{ content: '', citations: [], createdAt: now }],
            activeVersionIndex: 0,
            baseUserMessageId: messageId,
          };
          if (uIdx >= 0) {
            updated.splice(uIdx + 1, 0, newAssistant);
          } else {
            updated.push(newAssistant);
          }
        }

        return updated;
      });

      setStreamingMessageId(assistantId);

      try {
        const response = await fetch(`/api/hai/chat?userId=${userId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: newContent.trim(),
            sessionId: currentSessionId,
            editMessageId: messageId,
            context: {
              enablerId: context.enablerId,
              courseId: context.courseId,
              scenarioText: context.scenarioText,
            },
            stream: true,
          }),
          signal: abortController.signal,
        });

        if (response.ok && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let fullText = '';

          while (true) {
            if (activeStreamSessionRef.current !== streamSessionId) {
              reader.cancel();
              break;
            }

            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;

              const jsonStr = trimmed.slice(6);
              try {
                const event = JSON.parse(jsonStr);

                if (event.chunk) {
                  fullText += event.chunk;
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId
                        ? {
                            ...m,
                            content: fullText,
                            versions: m.versions
                              ? m.versions.map((v, idx) =>
                                  idx === (m.activeVersionIndex ?? 0)
                                    ? { ...v, content: fullText }
                                    : v
                                )
                              : m.versions,
                          }
                        : m
                    )
                  );
                }

                if (event.done) {
                  if (event.sessionId && event.sessionId !== currentSessionId) {
                    setCurrentSessionId(event.sessionId);
                  }
                  if (event.citations) {
                    setMessages(prev =>
                      prev.map(m =>
                        m.id === assistantId
                          ? {
                              ...m,
                              citations: event.citations,
                              versions: m.versions
                                ? m.versions.map((v, idx) =>
                                    idx === (m.activeVersionIndex ?? 0)
                                      ? { ...v, citations: event.citations }
                                      : v
                                  )
                                : m.versions,
                            }
                          : m
                      )
                    );
                  }
                  setStreamingMessageId(null);
                }

                if (event.error) {
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId ? { ...m, content: event.error } : m
                    )
                  );
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }

          await refreshSessions();
        } else if (response.ok) {
          const data = await response.json();

          if (data.sessionId && data.sessionId !== currentSessionId) {
            setCurrentSessionId(data.sessionId);
          }

          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId
                ? {
                    ...m,
                    content: data.response,
                    citations: data.citations,
                    versions: m.versions
                      ? m.versions.map((v, idx) =>
                          idx === (m.activeVersionIndex ?? 0)
                            ? {
                                ...v,
                                content: data.response,
                                citations: data.citations,
                              }
                            : v
                        )
                      : m.versions,
                  }
                : m
            )
          );
          setStreamingMessageId(null);

          await refreshSessions();
        } else {
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId
                ? {
                    ...m,
                    content: t('hai.error.somethingWrong'),
                    versions: m.versions
                      ? m.versions.map((v, idx) =>
                          idx === (m.activeVersionIndex ?? 0)
                            ? { ...v, content: t('hai.error.somethingWrong') }
                            : v
                        )
                      : m.versions,
                  }
                : m
            )
          );
          setStreamingMessageId(null);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        console.error('Failed to regenerate message:', error);
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? {
                  ...m,
                  content: t('hai.error.connectionError'),
                  versions: m.versions
                    ? m.versions.map((v, idx) =>
                        idx === (m.activeVersionIndex ?? 0)
                          ? { ...v, content: t('hai.error.connectionError') }
                          : v
                      )
                    : m.versions,
                }
              : m
          )
        );
        setStreamingMessageId(null);
      } finally {
        if (activeStreamSessionRef.current === streamSessionId) {
          setIsLoading(false);
        }
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }
    },
    [currentSessionId, userId, context, refreshSessions, t]
  );

  const sendMessage = useCallback(
    async (message: string) => {
      if (!message.trim()) return;

      // Abort any previous in-flight stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Track which session this stream belongs to
      const streamSessionId = currentSessionId;
      activeStreamSessionRef.current = streamSessionId;

      setIsLoading(true);

      // Add user message immediately (optimistic update)
      const userMessage: HaiMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: message,
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, userMessage]);

      // Create a placeholder assistant message for streaming
      const assistantId = `msg-${Date.now()}`;
      const assistantMessage: HaiMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
        versions: [
          {
            content: '',
            citations: [],
            createdAt: new Date().toISOString(),
          },
        ],
        activeVersionIndex: 0,
        baseUserMessageId: userMessage.id,
      };
      setMessages(prev => [...prev, assistantMessage]);
      setStreamingMessageId(assistantId);

      try {
        const response = await fetch(`/api/hai/chat?userId=${userId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            sessionId: currentSessionId,
            context: {
              enablerId: context.enablerId,
              courseId: context.courseId,
              scenarioText: context.scenarioText,
            },
            stream: true,
          }),
          signal: abortController.signal,
        });

        if (response.ok && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let fullText = '';

          while (true) {
            // Guard: if session changed mid-stream, stop processing
            if (activeStreamSessionRef.current !== streamSessionId) {
              reader.cancel();
              break;
            }

            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process SSE lines
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;

              const jsonStr = trimmed.slice(6);
              try {
                const event = JSON.parse(jsonStr);

                if (event.chunk) {
                  fullText += event.chunk;
                  // Update message content incrementally
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId
                        ? {
                            ...m,
                            content: fullText,
                            versions: m.versions
                              ? m.versions.map((v, idx) =>
                                  idx === (m.activeVersionIndex ?? 0)
                                    ? { ...v, content: fullText }
                                    : v
                                )
                              : m.versions,
                          }
                        : m
                    )
                  );
                }

                if (event.done) {
                  // Final event — update with citations and sessionId
                  if (event.sessionId && event.sessionId !== currentSessionId) {
                    setCurrentSessionId(event.sessionId);
                  }
                  if (event.citations) {
                    setMessages(prev =>
                      prev.map(m =>
                        m.id === assistantId
                          ? {
                              ...m,
                              citations: event.citations,
                              versions: m.versions
                                ? m.versions.map((v, idx) =>
                                    idx === (m.activeVersionIndex ?? 0)
                                      ? { ...v, citations: event.citations }
                                      : v
                                  )
                                : m.versions,
                            }
                          : m
                      )
                    );
                  }
                  setStreamingMessageId(null);
                }

                if (event.error) {
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId ? { ...m, content: event.error } : m
                    )
                  );
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }

          // Refresh sessions list
          await refreshSessions();
        } else if (response.ok) {
          // Fallback: non-streaming response (shouldn't happen but just in case)
          const data = await response.json();

          if (data.sessionId && data.sessionId !== currentSessionId) {
            setCurrentSessionId(data.sessionId);
          }

          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId
                ? {
                    ...m,
                    content: data.response,
                    citations: data.citations,
                    versions: m.versions
                      ? m.versions.map((v, idx) =>
                          idx === (m.activeVersionIndex ?? 0)
                            ? {
                                ...v,
                                content: data.response,
                                citations: data.citations,
                              }
                            : v
                        )
                      : m.versions,
                  }
                : m
            )
          );

          setStreamingMessageId(null);

          await refreshSessions();
        } else {
          // Error response
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId
                ? {
                    ...m,
                    content: t('hai.error.somethingWrong'),
                    versions: m.versions
                      ? m.versions.map((v, idx) =>
                          idx === (m.activeVersionIndex ?? 0)
                            ? { ...v, content: t('hai.error.somethingWrong') }
                            : v
                        )
                      : m.versions,
                  }
                : m
            )
          );
          setStreamingMessageId(null);
        }
      } catch (error) {
        // Ignore abort errors (user switched sessions)
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        console.error('Failed to send message:', error);
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? {
                  ...m,
                  content: t('hai.error.connectionError'),
                  versions: m.versions
                    ? m.versions.map((v, idx) =>
                        idx === (m.activeVersionIndex ?? 0)
                          ? { ...v, content: t('hai.error.connectionError') }
                          : v
                      )
                    : m.versions,
                }
              : m
          )
        );
        setStreamingMessageId(null);
      } finally {
        // Only clear loading if this is still the active stream
        if (activeStreamSessionRef.current === streamSessionId) {
          setIsLoading(false);
        }
        // Clean up abort controller
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }
    },
    [userId, currentSessionId, context, refreshSessions, t]
  );

  // ========================================================================
  // EFFECTS
  // ========================================================================

  // Load sessions DEFERRED – wait 3s after mount so dashboard APIs load first
  useEffect(() => {
    if (userId) {
      const timer = setTimeout(() => {
        refreshSessions();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [userId, refreshSessions]);

  // Update context when initialContext changes
  useEffect(() => {
    if (initialContext) {
      setContextState(initialContext);
    }
  }, [initialContext]);

  // ========================================================================
  // VALUE
  // ========================================================================

  const value: HaiProviderState = {
    viewMode,
    isLoading,
    streamingMessageId,
    currentSessionId,
    sessions,
    messages,
    context,
    setViewMode,
    toggleChat,
    setContext,
    clearContext,
    sendMessage,
    stopGeneration,
    updateMessage,
    regenerateFromEdit,
    setActiveVersion,
    loadSession,
    newSession,
    deleteSession,
    renameSession,
    refreshSessions,
    searchSessions,
  };

  return <HaiContext.Provider value={value}>{children}</HaiContext.Provider>;
}

export default HaiProvider;
