'use client';

/**
 * H AI Session List
 * 
 * Sidebar showing chat history with session management.
 * Styled for transparency and integration into the glass UI.
 */

import React, { useState } from 'react';
import { useHai, HaiSession } from './HaiProvider';
import { MessageSquare, Trash2, Brain, Book, HelpCircle, GraduationCap, Pencil } from 'lucide-react';

interface HaiSessionListProps {
    className?: string;
}

export function HaiSessionList({ className = '' }: HaiSessionListProps) {
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
            { label: 'Heute', sessions: [] },
            { label: 'Gestern', sessions: [] },
            { label: 'Letzte 7 Tage', sessions: [] },
            { label: 'Älter', sessions: [] },
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
            'enabler': 'Enabler-Frage',
            'course': 'Kurs-Frage',
            'quiz': 'Quiz',
            'general': 'Allgemein',
        };

        return contextLabels[session.contextType || 'general'] || 'Neue Unterhaltung';
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
                        <p>Keine Historie vorhanden</p>
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
                                                title="Umbenennen"
                                            >
                                                <Pencil className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (confirm('Löschen?')) {
                                                        deleteSession(session.id);
                                                    }
                                                }}
                                                className="p-1.5 rounded-md hover:bg-red-500/10 hover:text-red-500 transition-colors"
                                                title="Löschen"
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
