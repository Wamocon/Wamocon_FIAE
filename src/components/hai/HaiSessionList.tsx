'use client';

/**
 * H AI Session List
 * 
 * Sidebar showing chat history with session management.
 * Styled for transparency and integration into the glass UI.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useHai, HaiSession } from './HaiProvider';
import { MessageSquare, Trash2, Brain, Book, HelpCircle, GraduationCap, Pencil, Search, X } from 'lucide-react';

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
        searchSessions,
        isLoading
    } = useHai();

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<HaiSession[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Debounced search
    const handleSearchChange = useCallback((value: string) => {
        setSearchQuery(value);

        if (searchTimerRef.current) {
            clearTimeout(searchTimerRef.current);
        }

        if (!value.trim() || value.trim().length < 2) {
            setSearchResults([]);
            setIsSearching(false);
            return;
        }

        setIsSearching(true);
        searchTimerRef.current = setTimeout(async () => {
            const results = await searchSessions(value);
            setSearchResults(results);
            setIsSearching(false);
        }, 300);
    }, [searchSessions]);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        };
    }, []);

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

    const isSearchActive = searchQuery.trim().length >= 2;
    const displaySessions = isSearchActive ? searchResults : null;

    return (
        <div className={`flex flex-col h-full overflow-hidden ${className}`}>
            {/* Search Bar */}
            <div className="px-2 pt-2 pb-1">
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                    <input
                        type="text"
                        placeholder="Suchen..."
                        value={searchQuery}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-8 py-1.5 text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => { setSearchQuery(''); setSearchResults([]); }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-gray-300"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {/* Scrollable Area */}
            <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                {/* Search Results */}
                {isSearchActive ? (
                    isSearching ? (
                        <div className="text-center py-4 text-gray-500 text-xs">
                            <p>Suche...</p>
                        </div>
                    ) : searchResults.length === 0 ? (
                        <div className="text-center py-4 text-gray-500 text-xs">
                            <p>Keine Ergebnisse</p>
                        </div>
                    ) : (
                        <div className="space-y-0.5">
                            <p className="px-3 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider">
                                {searchResults.length} Ergebnis{searchResults.length !== 1 ? 'se' : ''}
                            </p>
                            {searchResults.map(session => (
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
                                    onClick={() => {
                                        loadSession(session.id);
                                        setSearchQuery('');
                                        setSearchResults([]);
                                    }}
                                >
                                    <span className="opacity-70 [&_svg]:w-5 [&_svg]:h-5">
                                        {getContextIcon(session.contextType)}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-base truncate font-medium">
                                            {getSessionTitle(session)}
                                        </p>
                                        {(session as any).snippet && (
                                            <p className="text-xs text-gray-500 truncate mt-0.5">
                                                {(session as any).snippet}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )
                ) : groupedSessions.length === 0 ? (
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
