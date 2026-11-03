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
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { authFetch } from '@/lib/authFetch';
import { markServerDone, markServerTiming } from '@/lib/hai/voice/client/trace';
import {
  isOpenConfirmation,
  isOpenDecline,
} from '@/lib/hai/navigation/confirm';
import {
  toNavigationOffer,
  type NavigationOffer,
} from '@/lib/hai/navigation/offer';
import { isAllowedNavigationPath } from '@/lib/hai/navigation/targets';
import { chatFailureKey } from '@/lib/hai/denial';
import { toQuizStartScope } from '@/lib/hai/quizMode/session';
import { decideMemory } from '@/lib/hai/memory/client';
import { useHaiQuizMode } from './HaiQuizMode';
import { currentPageContext } from '@/lib/hai/pageContext/collect';

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
  /** A write HAI proposes, shown as a confirmation card */
  pendingAction?: HaiPendingAction;
  /** A page HAI offers, shown as a card with the button "Open" (never a write) */
  navigationOffer?: HaiNavigationOffer;
  /** A question of the memory (yes, no, change), shown as a card */
  memoryProposal?: HaiMemoryProposal;
  /**
   * What HAI does right now while no text has come yet (stage events of the
   * server, opt-in). Shown as a small line below "thinking", gone with the
   * first piece of text.
   */
  stage?: HaiStage;
  /**
   * The turn failed in a way a second try may fix: the model is busy, the
   * network is gone, or something else went wrong once. The message shows the
   * button "Try again".
   */
  failure?: HaiFailure;
}

/**
 * The question of the HAI memory: "Soll ich mir das merken?" with the buttons
 * yes, no and change. The entry exists on the server as a proposal and acts only
 * after the person said yes (PATCH /api/hai/memory/[id]).
 */
export interface HaiMemoryProposal {
  id: string;
  kind: 'preference' | 'learning_style' | 'learning_state' | 'weakness';
  content: string;
  status: 'open' | 'running' | 'saved' | 'rejected' | 'error';
  /** Suffix of the i18n key hai.memory.card.error.<key> */
  errorKey?: string;
}

const MEMORY_KINDS = [
  'preference',
  'learning_style',
  'learning_state',
  'weakness',
] as const;

/** The proposal of the server as card state, or undefined if it is malformed. */
export function toMemoryProposal(raw: unknown): HaiMemoryProposal | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { id, kind, content } = raw as Record<string, unknown>;
  if (
    typeof id !== 'string' ||
    typeof content !== 'string' ||
    !(MEMORY_KINDS as readonly unknown[]).includes(kind)
  ) {
    return undefined;
  }
  return {
    id,
    kind: kind as HaiMemoryProposal['kind'],
    content,
    status: 'open',
  };
}

/** The stages the server reports while it works (SSE `{"stage": ...}`). */
export type HaiStage = 'search' | 'answer' | 'busy';

/** Why a turn failed, for the text and the button "Try again". */
export type HaiFailure = 'busy' | 'network' | 'generic';

/** The client waits this long for the first byte of the answer (the server's limit is up to 150 s). */
const CHAT_RESPONSE_TIMEOUT_MS = 180_000;

/** The stage of a server event, or undefined for anything else. */
function toStage(raw: unknown): HaiStage | undefined {
  return raw === 'search' || raw === 'answer' || raw === 'busy'
    ? raw
    : undefined;
}

/** "busy" stays: a later "answer" must not hide that the model is slow. */
function nextStage(current: HaiStage | undefined, incoming: HaiStage) {
  return current === 'busy' ? 'busy' : incoming;
}

/** The text of a failed turn, on the message and on its active version. */
function withFailure(
  message: HaiMessage,
  text: string,
  failure?: HaiFailure
): HaiMessage {
  return {
    ...message,
    content: text,
    stage: undefined,
    failure,
    versions: message.versions
      ? message.versions.map((v, idx) =>
          idx === (message.activeVersionIndex ?? 0)
            ? { ...v, content: text }
            : v
        )
      : message.versions,
  };
}

/**
 * Only a failed fetch without any answer is a problem of the person's network
 * ("Failed to fetch", "Load failed", "NetworkError ..."). Everything else, also
 * a broken stream after the answer began (the server may have been cut off),
 * is not blamed on the connection.
 */
function isNetworkFailure(error: unknown, gotResponse: boolean): boolean {
  if (gotResponse || !(error instanceof TypeError)) return false;
  return /failed to fetch|load failed|network ?error|network request failed|fetch failed/i.test(
    error.message
  );
}

/**
 * A page HAI offers. The text chat never changes the page by itself: the card
 * waits for the tap on "Open". Only a spoken "yes" to the question of the voice
 * assistant opens it (`spoken`). The path is checked against the allow list
 * once more before it is opened.
 */
export interface HaiNavigationOffer extends NavigationOffer {
  status: 'open' | 'opened' | 'dismissed';
  /** The question was spoken and HAI asked "Soll ich sie öffnen?" */
  spoken: boolean;
}

/**
 * A proposed write. HAI never executes it by itself: the card below the answer
 * asks the person, and only the click on "Confirm" calls /api/hai/action. The
 * server checks everything again, the proposal is a display only.
 */
export interface HaiPendingAction {
  type: string;
  parameters: Record<string, unknown>;
  /** Readable description of what happens on confirmation */
  description: string;
  status: 'pending' | 'running' | 'done' | 'cancelled' | 'error';
  /** Message of the server after a successful execution */
  resultMessage?: string;
  /** Suffix of the i18n key hai.action.card.error.<key> */
  errorKey?: string;
}

/** The proposal of the server as card state, or undefined if it is malformed. */
export function toPendingAction(raw: unknown): HaiPendingAction | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { type, parameters, description } = raw as Record<string, unknown>;
  if (typeof type !== 'string' || typeof description !== 'string') {
    return undefined;
  }
  const params =
    typeof parameters === 'object' && parameters !== null
      ? (parameters as Record<string, unknown>)
      : {};
  return { type, parameters: params, description, status: 'pending' };
}

/**
 * Suffix of the i18n key hai.action.card.error.<key> for a failed action. The
 * route sends the coarse reason of an access failure (`denial`, denial.ts) and
 * the stable code of the plan (PRO_REQUIRED) or the release
 * (AWAITING_ACTIVATION), so the card names the reason instead of "forbidden".
 * A technical failure (503, 500) is never shown as a missing right.
 */
export function actionErrorKey(
  status: number,
  body?: { denial?: unknown; code?: unknown } | null
): string {
  if (status === 403 && body?.code === 'PRO_REQUIRED') return 'plan';
  if (status === 403 && body?.code === 'AWAITING_ACTIVATION') {
    return 'awaitingActivation';
  }
  if (status === 403 || status === 404) {
    if (body?.denial === 'ROLLE') return 'role';
    if (body?.denial === 'BERUF') return 'occupation';
    if (body?.denial === 'GESPERRT') return 'locked';
    if (body?.denial === 'ZUSTAENDIGKEIT') return 'notResponsible';
  }
  if (status === 400) return 'invalid';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 409) return 'conflict';
  if (status === 503) return 'unavailable';
  return 'generic';
}

/**
 * The interface text for a failed call of the chat route: the reason in plain
 * words (plan, release, switch of the organization, too many requests) instead
 * of a general error. An unreadable body falls back to the status alone.
 */
async function chatFailureText(
  response: Response,
  t: (key: string) => string
): Promise<{ text: string; failure?: HaiFailure }> {
  let code: unknown;
  try {
    // a copy, so a caller that reads the body too is not affected
    const source =
      typeof response.clone === 'function' ? response.clone() : response;
    const body: unknown = await source.json();
    if (typeof body === 'object' && body !== null) {
      code = (body as { code?: unknown }).code;
    }
  } catch {
    code = undefined;
  }
  // a busy model may answer on the second try: the message gets the button
  return {
    text: t(chatFailureKey(response.status, code)),
    ...(response.status === 503 && code === 'MODEL_BUSY'
      ? { failure: 'busy' as const }
      : {}),
  };
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

  /** `voice`: the question was spoken and the answer is read aloud (voice assistant). */
  sendMessage: (
    message: string,
    options?: { voice?: boolean }
  ) => Promise<void>;
  stopGeneration: () => void;
  /**
   * Ask the same question again after a failed turn (button "Try again" of the
   * error message). Only the last message can be retried.
   */
  retryMessage: (assistantMessageId: string) => Promise<void>;
  updateMessage: (messageId: string, newContent: string) => Promise<void>;
  regenerateFromEdit: (messageId: string, newContent: string) => Promise<void>;
  confirmPendingAction: (messageId: string) => Promise<void>;
  cancelPendingAction: (messageId: string) => void;
  /**
   * The answer to the question of the memory: yes (with a changed text, the
   * "change" of the card) or no. Only the click calls the server.
   */
  answerMemoryProposal: (
    messageId: string,
    decision: 'confirm' | 'reject',
    content?: string
  ) => Promise<void>;
  /** Open the page of a navigation offer (tap on "Open" of the card) */
  openNavigation: (messageId: string) => void;
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
  const { t, language } = useLanguage();
  const router = useRouter();

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
      const response = await authFetch(
        `/api/hai/session?includeArchived=true&limit=50`,
        { cache: 'no-store' }
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
        const response = await authFetch(
          `/api/hai/session?search=${encodeURIComponent(query.trim())}&limit=20`,
          { cache: 'no-store' }
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
        const response = await authFetch(
          `/api/hai/session?sessionId=${sessionId}`,
          { cache: 'no-store' }
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
        const response = await authFetch(
          `/api/hai/session?sessionId=${sessionId}`,
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

        const response = await authFetch('/api/hai/session', {
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
        const response = await authFetch('/api/hai/chat', {
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

  // ========================================================================
  // PENDING ACTIONS (confirmation card)
  // ========================================================================

  // The chat answered a request to be quizzed: open the quiz card (the signal
  // comes from the server pipeline, see lib/hai/quizMode/start.ts)
  const { start: startQuiz } = useHaiQuizMode();
  const startQuizFromSignal = useCallback(
    (raw: unknown) => {
      const scope = toQuizStartScope(raw);
      if (scope) startQuiz(scope);
    },
    [startQuiz]
  );

  const attachPendingAction = useCallback((messageId: string, raw: unknown) => {
    const pending = toPendingAction(raw);
    if (!pending) return;
    setMessages(prev =>
      prev.map(m => (m.id === messageId ? { ...m, pendingAction: pending } : m))
    );
  }, []);

  const patchPendingAction = useCallback(
    (messageId: string, patch: Partial<HaiPendingAction>) => {
      setMessages(prev =>
        prev.map(m =>
          m.id === messageId && m.pendingAction
            ? { ...m, pendingAction: { ...m.pendingAction, ...patch } }
            : m
        )
      );
    },
    []
  );

  const confirmingRef = React.useRef<Set<string>>(new Set());

  const confirmPendingAction = useCallback(
    async (messageId: string) => {
      const pending = messagesRef.current.find(
        m => m.id === messageId
      )?.pendingAction;
      if (!pending || pending.status !== 'pending') return;
      // One click, one call
      if (confirmingRef.current.has(messageId)) return;
      confirmingRef.current.add(messageId);

      patchPendingAction(messageId, { status: 'running' });
      try {
        const response = await authFetch('/api/hai/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actionType: pending.type,
            parameters: pending.parameters,
            confirmed: true,
          }),
        });
        const data = await response.json().catch(() => null);
        if (response.ok && data?.success) {
          patchPendingAction(messageId, {
            status: 'done',
            resultMessage:
              typeof data.message === 'string' ? data.message : undefined,
          });
        } else {
          patchPendingAction(messageId, {
            status: 'error',
            errorKey: actionErrorKey(response.status, data),
          });
        }
      } catch {
        patchPendingAction(messageId, {
          status: 'error',
          errorKey: 'generic',
        });
      } finally {
        confirmingRef.current.delete(messageId);
      }
    },
    [patchPendingAction]
  );

  const attachMemoryProposal = useCallback((messageId: string, raw: unknown) => {
    const proposal = toMemoryProposal(raw);
    if (!proposal) return;
    setMessages(prev =>
      prev.map(m =>
        m.id === messageId ? { ...m, memoryProposal: proposal } : m
      )
    );
  }, []);

  const patchMemoryProposal = useCallback(
    (messageId: string, patch: Partial<HaiMemoryProposal>) => {
      setMessages(prev =>
        prev.map(m =>
          m.id === messageId && m.memoryProposal
            ? { ...m, memoryProposal: { ...m.memoryProposal, ...patch } }
            : m
        )
      );
    },
    []
  );

  const answeringMemoryRef = React.useRef<Set<string>>(new Set());

  const answerMemoryProposal = useCallback(
    async (
      messageId: string,
      decision: 'confirm' | 'reject',
      content?: string
    ) => {
      const proposal = messagesRef.current.find(
        m => m.id === messageId
      )?.memoryProposal;
      if (
        !proposal ||
        (proposal.status !== 'open' && proposal.status !== 'error')
      ) {
        return;
      }
      // One click, one call
      if (answeringMemoryRef.current.has(messageId)) return;
      answeringMemoryRef.current.add(messageId);
      patchMemoryProposal(messageId, {
        status: 'running',
        errorKey: undefined,
      });
      try {
        const result = await decideMemory(proposal.id, decision, content);
        if (result.ok) {
          patchMemoryProposal(messageId, {
            status: decision === 'confirm' ? 'saved' : 'rejected',
            content:
              decision === 'confirm' && result.data?.entry?.content
                ? result.data.entry.content
                : proposal.content,
          });
        } else {
          patchMemoryProposal(messageId, {
            status: 'error',
            errorKey:
              result.status === 422
                ? 'content'
                : result.status === 404 || result.status === 409
                  ? 'gone'
                  : 'generic',
          });
        }
      } finally {
        answeringMemoryRef.current.delete(messageId);
      }
    },
    [patchMemoryProposal]
  );

  const cancelPendingAction = useCallback(
    (messageId: string) => {
      const pending = messagesRef.current.find(
        m => m.id === messageId
      )?.pendingAction;
      if (pending?.status !== 'pending') return;
      patchPendingAction(messageId, { status: 'cancelled' });
    },
    [patchPendingAction]
  );

  // ========================================================================
  // NAVIGATION OFFERS (card "Open", spoken "yes")
  // ========================================================================

  /** Go to the page. The open chat panel must not hide it. */
  const goToOffer = useCallback(
    (offer: HaiNavigationOffer) => {
      if (!isAllowedNavigationPath(offer.path)) return false;
      setViewModeState(prev => (prev === 'full' ? 'widget' : prev));
      router.push(offer.path);
      return true;
    },
    [router]
  );

  const attachNavigationOffer = useCallback(
    (messageId: string, raw: unknown, spoken: boolean) => {
      // the path must be on the allow list, otherwise there is no card
      const offer = toNavigationOffer(raw);
      if (!offer) return;
      // A clear command ("Öffne ...", "Bring mich zu ...") is carried out right
      // away, typed and spoken: the card only reports it. A spoken
      // conversation goes on (the voice mode keeps listening). The server
      // decides this from the command, the path is checked once more here.
      const opened =
        offer.auto === true && goToOffer({ ...offer, status: 'open', spoken });
      setMessages(prev =>
        prev.map(m =>
          m.id === messageId
            ? {
                ...m,
                navigationOffer: {
                  ...offer,
                  status: opened ? 'opened' : 'open',
                  spoken,
                },
              }
            : m
        )
      );
    },
    [goToOffer]
  );

  const patchNavigationOffer = useCallback(
    (messageId: string, status: HaiNavigationOffer['status']) => {
      setMessages(prev =>
        prev.map(m =>
          m.id === messageId && m.navigationOffer
            ? { ...m, navigationOffer: { ...m.navigationOffer, status } }
            : m
        )
      );
    },
    []
  );

  const openNavigation = useCallback(
    (messageId: string) => {
      const offer = messagesRef.current.find(
        m => m.id === messageId
      )?.navigationOffer;
      if (!offer || offer.status === 'dismissed') return;
      if (goToOffer(offer)) patchNavigationOffer(messageId, 'opened');
    },
    [goToOffer, patchNavigationOffer]
  );

  /**
   * The spoken reply to the question "Soll ich sie öffnen?": "ja" or "öffnen"
   * opens the page, "nein" drops the offer, both are answered here without a
   * call to the server. Only the reply to a spoken, still open offer counts, a
   * typed chat never changes the page by itself. Returns true when the reply
   * was handled, false when the message goes on as a normal question (the
   * offer is dropped then, so a later "ja" opens nothing).
   */
  const answerSpokenNavigation = useCallback(
    (text: string): boolean => {
      const last = [...messagesRef.current]
        .reverse()
        .find(m => m.role === 'assistant');
      const offer = last?.navigationOffer;
      if (!last || !offer || offer.status !== 'open' || !offer.spoken) {
        return false;
      }
      const open = isOpenConfirmation(text);
      if (!open && !isOpenDecline(text)) {
        patchNavigationOffer(last.id, 'dismissed');
        return false;
      }
      if (open && !goToOffer(offer)) return false;

      const now = new Date().toISOString();
      const stamp = Date.now();
      const userId = `temp-${stamp}`;
      setMessages(prev => [
        ...prev,
        { id: userId, role: 'user', content: text, createdAt: now },
        {
          id: `msg-${stamp}`,
          role: 'assistant',
          content: open
            ? `Ich öffne die Seite ${offer.label}.`
            : 'In Ordnung, ich bleibe hier.',
          createdAt: now,
          baseUserMessageId: userId,
        },
      ]);
      patchNavigationOffer(last.id, open ? 'opened' : 'dismissed');
      return true;
    },
    [goToOffer, patchNavigationOffer]
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
            pendingAction: undefined,
            navigationOffer: undefined,
            memoryProposal: undefined,
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

      // Time limit until the answer starts (see sendMessage)
      let timedOut = false;
      let gotResponse = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        abortController.abort('TIMEOUT');
      }, CHAT_RESPONSE_TIMEOUT_MS);

      try {
        const response = await authFetch('/api/hai/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-language': language,
          },
          body: JSON.stringify({
            message: newContent.trim(),
            sessionId: currentSessionId,
            editMessageId: messageId,
            context: {
              enablerId: context.enablerId,
              courseId: context.courseId,
              scenarioText: context.scenarioText,
              // the page of the user (data only, the server validates it)
              page: currentPageContext(),
            },
            stream: true,
          }),
          signal: abortController.signal,
        });

        // Clear timeout once response headers arrive
        gotResponse = true;
        clearTimeout(timeoutId);

        if (response.ok && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let fullText = '';
          let hasReceivedFirstChunk = false;

          // Thinking message if it takes more than 3 seconds to get first chunk
          const thinkingTimeoutId = setTimeout(() => {
            if (
              !hasReceivedFirstChunk &&
              activeStreamSessionRef.current === streamSessionId
            ) {
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId && m.content === ''
                    ? {
                        ...m,
                        content: t('hai.loading.thinking') || 'Thinking...',
                      }
                    : m
                )
              );
            }
          }, 3000);

          while (true) {
            if (activeStreamSessionRef.current !== streamSessionId) {
              reader.cancel();
              clearTimeout(thinkingTimeoutId);
              break;
            }

            const { done, value } = await reader.read();
            if (done) {
              clearTimeout(thinkingTimeoutId);
              break;
            }

            // A stage event is no text: the first byte does not end "thinking",
            // only the first piece of text does (handled with the event below)
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;

              const jsonStr = trimmed.slice(6);
              try {
                const event = JSON.parse(jsonStr);

                // What HAI does while no text has come (search, answer, busy)
                const stage = toStage(event.stage);
                if (stage && !hasReceivedFirstChunk) {
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId
                        ? { ...m, stage: nextStage(m.stage, stage) }
                        : m
                    )
                  );
                }

                if (event.chunk) {
                  if (!hasReceivedFirstChunk) {
                    hasReceivedFirstChunk = true;
                    clearTimeout(thinkingTimeoutId);
                  }
                  fullText += event.chunk;
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId
                        ? {
                            ...m,
                            content: fullText,
                            stage: undefined,
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
                  attachPendingAction(assistantId, event.pendingAction);
                  attachMemoryProposal(assistantId, event.memoryProposal);
                  attachNavigationOffer(
                    assistantId,
                    event.navigationOffer,
                    false
                  );
                  startQuizFromSignal(event.quizMode);
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
                  // MODEL_BUSY: the model is slow or overloaded, a second try
                  // may work (the message gets the button "Try again")
                  const busy = event.code === 'MODEL_BUSY';
                  const errorMsg = busy
                    ? t('hai.error.modelBusy')
                    : t(event.error) || event.error;
                  clearTimeout(thinkingTimeoutId);
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId
                        ? busy
                          ? withFailure(m, errorMsg, 'busy')
                          : { ...m, content: errorMsg, stage: undefined }
                        : m
                    )
                  );
                  setStreamingMessageId(null);
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }

          await refreshSessions();
        } else if (response.ok) {
          const data = await response.json();
          attachNavigationOffer(assistantId, data.navigationOffer, false);
          attachMemoryProposal(assistantId, data.memoryProposal);
          startQuizFromSignal(data.quizMode);

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
                    pendingAction: toPendingAction(data.pendingAction),
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
          // the reason in plain words (plan, release, switch), not "error"
          const { text: failureText, failure } = await chatFailureText(
            response,
            t
          );
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId ? withFailure(m, failureText, failure) : m
            )
          );
          setStreamingMessageId(null);
        }
      } catch (error: any) {
        // A timeout aborts with the reason 'TIMEOUT', a plain string: the flag
        // tells it, `error.name` and `error.message` are empty then (that is
        // how it used to end up as "connection error").
        if (timedOut || error?.name === 'AbortError') {
          console.log('HAI.ai: Stream aborted or timed out');
          if (
            timedOut ||
            (abortController.signal.aborted && !activeStreamSessionRef.current)
          ) {
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantId
                  ? withFailure(m, t('hai.error.timeout'), 'generic')
                  : m
              )
            );
            setStreamingMessageId(null);
          }
          return;
        }

        console.error('Failed to regenerate message:', error);
        // Only a fetch that got no answer at all is the person's network. Every
        // other failure is not blamed on the connection.
        const network = isNetworkFailure(error, gotResponse);
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? withFailure(
                  m,
                  t(
                    network ? 'hai.error.connectionError' : 'hai.error.generic'
                  ),
                  network ? 'network' : 'generic'
                )
              : m
          )
        );
        setStreamingMessageId(null);
      } finally {
        clearTimeout(timeoutId);
        if (activeStreamSessionRef.current === streamSessionId) {
          setIsLoading(false);
        }
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }
    },
    [
      currentSessionId,
      userId,
      context,
      refreshSessions,
      t,
      attachPendingAction,
      attachNavigationOffer,
      startQuizFromSignal,
    ]
  );

  const sendMessage = useCallback(
    async (message: string, options?: { voice?: boolean }) => {
      if (!message.trim()) return;

      // The spoken "yes" to "Soll ich sie öffnen?" opens the page, no call
      if (options?.voice === true && answerSpokenNavigation(message)) return;

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

      // Time limit until the answer starts. The model server can need more than
      // a minute under load and the server waits up to 90 seconds (150 at most)
      // for the first character, so the client must not give up before it.
      let timedOut = false;
      // no answer at all (fetch failed) is the only case of a network failure
      let gotResponse = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        abortController.abort('TIMEOUT');
      }, CHAT_RESPONSE_TIMEOUT_MS);

      try {
        const response = await authFetch('/api/hai/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-language': language,
          },
          body: JSON.stringify({
            message,
            sessionId: currentSessionId,
            context: {
              enablerId: context.enablerId,
              courseId: context.courseId,
              scenarioText: context.scenarioText,
              // the page of the user (data only, the server validates it)
              page: currentPageContext(),
            },
            stream: true,
            // only the voice assistant sends it; the server checks the organization
            ...(options?.voice === true
              ? { voice: true }
              : // the text chat shows what HAI does while it waits (search,
                // answer, busy); the voice assistant never gets these events
                { stageEvents: true }),
          }),
          signal: abortController.signal,
        });
        gotResponse = true;
        // The answer has started. The limit above only guards the wait for it:
        // it used to run on and cut every answer that took longer than a minute
        // in total (shown as a connection error).
        clearTimeout(timeoutId);
        // measuring point of the voice assistant (numbers only, off by default)
        if (options?.voice === true) {
          markServerTiming(response.headers?.get?.('server-timing'));
        }

        if (response.ok && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let fullText = '';
          let hasReceivedFirstChunk = false;

          // Thinking message if it takes more than 3 seconds to get first chunk
          const thinkingTimeoutId = setTimeout(() => {
            if (
              !hasReceivedFirstChunk &&
              activeStreamSessionRef.current === streamSessionId
            ) {
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId && m.content === ''
                    ? {
                        ...m,
                        content: t('hai.loading.thinking') || 'Thinking...',
                      }
                    : m
                )
              );
            }
          }, 3000);

          while (true) {
            // Guard: if session changed mid-stream, stop processing
            if (activeStreamSessionRef.current !== streamSessionId) {
              reader.cancel();
              clearTimeout(thinkingTimeoutId);
              break;
            }

            const { done, value } = await reader.read();
            if (done) {
              clearTimeout(thinkingTimeoutId);
              break;
            }

            // A stage event is no text: the first byte does not end "thinking",
            // only the first piece of text does (handled with the event below)
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

                // What HAI does while no text has come (search, answer, busy)
                const stage = toStage(event.stage);
                if (stage && !hasReceivedFirstChunk) {
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId
                        ? { ...m, stage: nextStage(m.stage, stage) }
                        : m
                    )
                  );
                }

                if (event.chunk) {
                  if (!hasReceivedFirstChunk) {
                    hasReceivedFirstChunk = true;
                    clearTimeout(thinkingTimeoutId);
                  }
                  fullText += event.chunk;
                  // Update message content incrementally
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId
                        ? {
                            ...m,
                            content: fullText,
                            stage: undefined,
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
                  if (options?.voice === true) markServerDone(event.timing);
                  attachPendingAction(assistantId, event.pendingAction);
                  attachMemoryProposal(assistantId, event.memoryProposal);
                  attachNavigationOffer(
                    assistantId,
                    event.navigationOffer,
                    options?.voice === true
                  );
                  startQuizFromSignal(event.quizMode);
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
                  // MODEL_BUSY: the model is slow or overloaded, a second try
                  // may work (the message gets the button "Try again")
                  const busy = event.code === 'MODEL_BUSY';
                  const errorMsg = busy
                    ? t('hai.error.modelBusy')
                    : t(event.error) || event.error;
                  clearTimeout(thinkingTimeoutId);
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId
                        ? busy
                          ? withFailure(m, errorMsg, 'busy')
                          : { ...m, content: errorMsg, stage: undefined }
                        : m
                    )
                  );
                  setStreamingMessageId(null);
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
          attachNavigationOffer(
            assistantId,
            data.navigationOffer,
            options?.voice === true
          );
          startQuizFromSignal(data.quizMode);
          attachMemoryProposal(assistantId, data.memoryProposal);

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
                    pendingAction: toPendingAction(data.pendingAction),
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
          // Error response: the reason in plain words (plan, release, switch)
          const { text: failureText, failure } = await chatFailureText(
            response,
            t
          );
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId ? withFailure(m, failureText, failure) : m
            )
          );
          setStreamingMessageId(null);
        }
      } catch (error: any) {
        // Handle stop/abort or timeout
        // A timeout aborts with the reason 'TIMEOUT', a plain string: the flag
        // tells it, `error.name` and `error.message` are empty then (that is
        // how it used to end up as "connection error").
        if (timedOut || error?.name === 'AbortError') {
          console.log('HAI.ai: Stream aborted or timed out');
          if (
            timedOut ||
            (abortController.signal.aborted && !activeStreamSessionRef.current)
          ) {
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantId
                  ? withFailure(m, t('hai.error.timeout'), 'generic')
                  : m
              )
            );
            setStreamingMessageId(null);
          }
          return;
        }

        console.error('Failed to send message:', error);
        // Only a fetch that got no answer at all is the person's network. Every
        // other failure is not blamed on the connection.
        const network = isNetworkFailure(error, gotResponse);
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? withFailure(
                  m,
                  t(
                    network ? 'hai.error.connectionError' : 'hai.error.generic'
                  ),
                  network ? 'network' : 'generic'
                )
              : m
          )
        );
        setStreamingMessageId(null);
      } finally {
        clearTimeout(timeoutId);
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
    [
      userId,
      currentSessionId,
      context,
      refreshSessions,
      t,
      attachPendingAction,
      attachNavigationOffer,
      answerSpokenNavigation,
      startQuizFromSignal,
    ]
  );

  /**
   * Ask the same question again after a failed turn (button "Try again" of the
   * error message): the failed answer and its question leave the list and the
   * question is sent as a new one. regenerateFromEdit is for edits and needs the
   * stored id of the question (a fresh question only has a temporary one), so
   * the retry goes the normal way. Only the last message of the chat can be
   * retried, and only while nothing else is running.
   */
  const retryMessage = useCallback(
    async (assistantMessageId: string) => {
      const list = messagesRef.current;
      const index = list.findIndex(
        m => m.id === assistantMessageId && m.role === 'assistant'
      );
      if (index < 0 || index !== list.length - 1) return;
      if (!list[index].failure || abortControllerRef.current) return;
      const question = [...list.slice(0, index)]
        .reverse()
        .find(m => m.role === 'user');
      if (!question?.content.trim()) return;

      setMessages(prev =>
        prev.filter(m => m.id !== assistantMessageId && m.id !== question.id)
      );
      await sendMessage(question.content);
    },
    [sendMessage]
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
    retryMessage,
    updateMessage,
    regenerateFromEdit,
    confirmPendingAction,
    cancelPendingAction,
    answerMemoryProposal,
    openNavigation,
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
