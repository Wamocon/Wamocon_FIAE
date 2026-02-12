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

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
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

export function HaiProvider({ children, userId, initialContext }: HaiProviderProps) {
    const { t } = useLanguage();

    // UI State
    const [viewMode, setViewModeState] = useState<ViewMode>('hidden');
    const [isLoading, setIsLoading] = useState(false);

    // Session State
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [sessions, setSessions] = useState<HaiSession[]>([]);
    const [messages, setMessages] = useState<HaiMessage[]>([]);

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
            const response = await fetch(`/api/hai/session?userId=${userId}&includeArchived=true&limit=50`);
            if (response.ok) {
                const data = await response.json();
                setSessions(data.sessions || []);
            }
        } catch (error) {
            console.error('Failed to fetch sessions:', error);
        }
    }, [userId]);

    const searchSessions = useCallback(async (query: string): Promise<HaiSession[]> => {
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
    }, [userId]);

    const loadSession = useCallback(async (sessionId: string) => {
        setIsLoading(true);
        try {
            const response = await fetch(`/api/hai/session?userId=${userId}&sessionId=${sessionId}`);
            if (response.ok) {
                const data = await response.json();
                setCurrentSessionId(sessionId);
                setMessages(data.messages || []);

                // Update context from session if available
                if (data.session?.contextId) {
                    setContextState(prev => ({
                        ...prev,
                        enablerId: data.session.contextType === 'enabler' ? data.session.contextId : prev.enablerId,
                        courseId: data.session.contextType === 'course' ? data.session.contextId : prev.courseId,
                    }));
                }
            }
        } catch (error) {
            console.error('Failed to load session:', error);
        } finally {
            setIsLoading(false);
        }
    }, [userId]);

    const newSession = useCallback(() => {
        setCurrentSessionId(null);
        setMessages([]);
    }, []);

    const deleteSession = useCallback(async (sessionId: string) => {
        try {
            const response = await fetch(`/api/hai/session?userId=${userId}&sessionId=${sessionId}`, {
                method: 'DELETE',
            });
            if (response.ok) {
                setSessions(prev => prev.filter(s => s.id !== sessionId));
                if (currentSessionId === sessionId) {
                    newSession();
                }
            }
        } catch (error) {
            console.error('Failed to delete session:', error);
        }
    }, [userId, currentSessionId, newSession]);

    const renameSession = useCallback(async (sessionId: string, newTitle: string) => {
        try {
            // Optimistic update
            setSessions(prev => prev.map(s =>
                s.id === sessionId ? { ...s, title: newTitle } : s
            ));

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
    }, [userId, refreshSessions]);

    // ========================================================================
    // CHAT ACTIONS
    // ========================================================================

    const sendMessage = useCallback(async (message: string) => {
        if (!message.trim()) return;

        setIsLoading(true);

        // Add user message immediately (optimistic update)
        const userMessage: HaiMessage = {
            id: `temp-${Date.now()}`,
            role: 'user',
            content: message,
            createdAt: new Date().toISOString(),
        };
        setMessages(prev => [...prev, userMessage]);

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
                    stream: false,
                }),
            });

            if (response.ok) {
                const data = await response.json();

                // Update session ID if new
                if (data.sessionId && data.sessionId !== currentSessionId) {
                    setCurrentSessionId(data.sessionId);
                }

                // Add assistant message
                const assistantMessage: HaiMessage = {
                    id: `msg-${Date.now()}`,
                    role: 'assistant',
                    content: data.response,
                    citations: data.citations,
                    createdAt: new Date().toISOString(),
                };
                setMessages(prev => [...prev, assistantMessage]);

                // Refresh sessions list
                await refreshSessions();
            } else {
                // Handle error
                const assistantMessage: HaiMessage = {
                    id: `error-${Date.now()}`,
                    role: 'assistant',
                    content: t('hai.error.somethingWrong'),
                    createdAt: new Date().toISOString(),
                };
                setMessages(prev => [...prev, assistantMessage]);
            }
        } catch (error) {
            console.error('Failed to send message:', error);
            const assistantMessage: HaiMessage = {
                id: `error-${Date.now()}`,
                role: 'assistant',
                content: t('hai.error.connectionError'),
                createdAt: new Date().toISOString(),
            };
            setMessages(prev => [...prev, assistantMessage]);
        } finally {
            setIsLoading(false);
        }
    }, [userId, currentSessionId, context, refreshSessions, t]);

    // ========================================================================
    // EFFECTS
    // ========================================================================

    // Load sessions on mount
    useEffect(() => {
        if (userId) {
            refreshSessions();
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
        currentSessionId,
        sessions,
        messages,
        context,
        setViewMode,
        toggleChat,
        setContext,
        clearContext,
        sendMessage,
        loadSession,
        newSession,
        deleteSession,
        renameSession,
        refreshSessions,
        searchSessions,
    };

    return (
        <HaiContext.Provider value={value}>
            {children}
        </HaiContext.Provider>
    );
}

export default HaiProvider;
