'use client';

/**
 * H AI Session List
 * 
 * Sidebar showing chat history with session management.
 * Styled for transparency and integration into the glass UI.
 */

import React, { useState } from 'react';
import { useHai, HaiSession } from './HaiProvider';
import { useLanguage } from '@/contexts/LanguageContext';
import { MessageSquare, Trash2, Brain, Book, HelpCircle, GraduationCap, Pencil } from 'lucide-react';

interface HaiSessionListProps {
    className?: string;
}

export function HaiSessionList({ className = '' }: HaiSessionListProps) {
    const { t } = useLanguage();
    const {
        sessions,
        currentSessionId,
        loadSession,
        deleteSession,
        renameSession,
        isLoading
    } = useHai();

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');

    const startEditing = (session: HaiSession) => {
        setEditingId(session.id);
        setEditTitle(getSessionTitle(session));
    };

    const handleRename = async (sessionId: string) => {
        if (!editTitle.trim()) {
            setEditingId(null);
            return;
        }
        if (renameSession) {
            await renameSession(sessionId, editTitle.trim());
        }
        setEditingId(null);
    };

    // Group sessions by date
    const groupedSessions = React.useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        const lastWeek = new Date(today);
        lastWeek.setDate(lastWeek.getDate() - 7);

        const groups: { label: string; sessions: HaiSession[] }[] = [
            { label: t('hai.history.today'), sessions: [] },
            { label: t('hai.history.yesterday'), sessions: [] },
            { label: t('hai.history.last7Days'), sessions: [] },
            { label: t('hai.history.older'), sessions: [] },
        ];

        sessions.forEach(session => {
            const date = new Date(session.lastMessageAt || session.createdAt);
            date.setHours(0, 0, 0, 0);

            if (date >= today) {
                groups[0].sessions.push(session);
            } else if (date >= yesterday) {
                groups[1].sessions.push(session);
            } else if (date >= lastWeek) {
                groups[2].sessions.push(session);
            } else {
                groups[3].sessions.push(session);
            }
        });

        return groups.filter(g => g.sessions.length > 0);
    }, [sessions]);

    const getSessionTitle = (session: HaiSession) => {
        if (session.title) return session.title;

        const contextLabels: Record<string, string> = {
            'enabler': t('hai.context.enabler'),
            'course': t('hai.context.course'),
            'quiz': t('hai.context.quiz'),
            'general': t('hai.context.general'),
        };

        return contextLabels[session.contextType || 'general'] || t('hai.newConversation');
    };

    const getContextIcon = (contextType: string | null) => {
        switch (contextType) {
            case 'enabler': return <Book className="w-3.5 h-3.5" />;
            case 'course': return <GraduationCap className="w-3.5 h-3.5" />;
            case 'quiz': return <Brain className="w-3.5 h-3.5" />;
            default: return <MessageSquare className="w-3.5 h-3.5" />;
        }
    };

    return (
        <div className={`flex flex-col h-full overflow-hidden ${className}`}>
            {/* Scrollable Area */}
            <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                {groupedSessions.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 text-xs">
                        <p>{t('hai.history.noHistory')}</p>
                    </div>
                ) : (
                    groupedSessions.map((group, groupIdx) => (
                        <div key={groupIdx} className="mb-4">
                            <p className="px-3 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider">
                                {group.label}
                            </p>
                            <div className="space-y-0.5">
                                {group.sessions.map(session => (
                                    <div
                                        key={session.id}
                                        className={`
                      group relative rounded-lg cursor-pointer
                      flex items-center gap-3 px-3 py-2.5
                      transition-all duration-200
                      ${session.id === currentSessionId
                                                ? 'bg-cyan-500/10 text-cyan-400'
                                                : 'text-gray-400 hover:bg-white/5 hover:text-gray-100'
                                            }
                    `}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            loadSession(session.id);
                                        }}
                                    >
                                        <span className={`
                      opacity-70 group-hover:opacity-100 transition-opacity
                      ${session.id === currentSessionId ? 'text-cyan-500' : ''}
                      [&_svg]:w-5 [&_svg]:h-5
                    `}>
                                            {getContextIcon(session.contextType)}
                                        </span>

                                        <div className="flex-1 min-w-0">
                                            {editingId === session.id ? (
                                                <input
                                                    type="text"
                                                    value={editTitle}
                                                    onChange={(e) => setEditTitle(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleRename(session.id);
                                                        if (e.key === 'Escape') setEditingId(null);
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                    autoFocus
                                                    onBlur={() => handleRename(session.id)}
                                                    className="w-full bg-[#0d1117] border border-white/10 rounded px-1.5 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                                />
                                            ) : (
                                                <p className="text-base truncate font-medium">
                                                    {getSessionTitle(session)}
                                                </p>
                                            )}
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity gap-1">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    startEditing(session);
                                                }}
                                                className="p-1.5 rounded-md hover:bg-white/10 hover:text-white transition-colors"
                                                title={t('hai.actions.rename')}
                                            >
                                                <Pencil className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (confirm(t('hai.actions.deleteConfirm'))) {
                                                        deleteSession(session.id);
                                                    }
                                                }}
                                                className="p-1.5 rounded-md hover:bg-red-500/10 hover:text-red-500 transition-colors"
                                                title={t('common.delete')}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

export default HaiSessionList;
