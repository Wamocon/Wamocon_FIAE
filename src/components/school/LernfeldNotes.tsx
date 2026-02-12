'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import {
    BookOpen,
    ChevronDown,
    ChevronRight,
    Plus,
    Send,
    X,
    FileText,
    Layers,
    ExternalLink,
    CheckCircle,
    AlertCircle,
    FolderOpen,
    Trash2,
} from 'lucide-react';

interface Lernfeld {
    id: string;
    code: string;
    name: string;
    trainingYear: number;
    hoursBudget: number | null;
    isCommon: boolean;
    description: string | null;
    orderIndex: number;
}

interface Note {
    id: string;
    title: string;
    content: string;
    createdAt: string;
    oneDriveLink: string | null;
    lernfeldCode: string | null;
}

// Special code for "Sonstiges" (Other) notes
const SONSTIGES_CODE = 'SONSTIGES';

export function LernfeldNotes() {
    const { profile } = useAuth();
    const { t } = useLanguage();
    const [lernfelder, setLernfelder] = useState<Lernfeld[]>([]);
    const [notes, setNotes] = useState<Note[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Expanded state for accordion
    const [expandedLernfelder, setExpandedLernfelder] = useState<Set<string>>(new Set());

    // Add note modal
    const [showAddModal, setShowAddModal] = useState(false);
    const [selectedLernfeld, setSelectedLernfeld] = useState<Lernfeld | { code: string; name: string } | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');

    // Load Lernfelder and notes
    useEffect(() => {
        if (!profile?.id) return;

        const loadData = async () => {
            setLoading(true);
            setError(null);
            try {
                const [lfRes, notesRes] = await Promise.all([
                    fetch('/api/trainee/school/lernfelder'),
                    fetch(`/api/trainee/knowledge-notes?traineeId=${profile.id}`)
                ]);

                if (!lfRes.ok) throw new Error(t('notes.error.loadFields'));
                const lfData = await lfRes.json();
                // Flatten all lernfelder into a single list
                setLernfelder(lfData.lernfelder || []);

                if (notesRes.ok) {
                    const notesData = await notesRes.json();
                    setNotes(notesData.notes || []);
                }
            } catch (e: any) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };

        loadData();
    }, [profile?.id]);

    // Get notes for a specific Lernfeld or Sonstiges
    const getNotesForLernfeld = (code: string) => {
        if (code === SONSTIGES_CODE) {
            return notes.filter(n => !n.lernfeldCode || n.lernfeldCode === SONSTIGES_CODE);
        }
        return notes.filter(n => n.lernfeldCode === code);
    };

    // Count notes per Lernfeld
    const noteCountByLernfeld = useMemo(() => {
        const counts: Record<string, number> = {};
        let sonstigesCount = 0;
        notes.forEach(n => {
            if (n.lernfeldCode && n.lernfeldCode !== SONSTIGES_CODE) {
                counts[n.lernfeldCode] = (counts[n.lernfeldCode] || 0) + 1;
            } else {
                sonstigesCount++;
            }
        });
        counts[SONSTIGES_CODE] = sonstigesCount;
        return counts;
    }, [notes]);

    // Handle delete note
    const handleDeleteNote = async (noteId: string) => {
        if (!profile?.id) return;
        try {
            const res = await fetch(`/api/trainee/knowledge-notes/${noteId}?traineeId=${profile.id}`, {
                method: 'DELETE',
            });
            if (res.ok) {
                setNotes(prev => prev.filter(n => n.id !== noteId));
            }
        } catch (e) {
            console.error('Error deleting note:', e);
        }
    };

    // Toggle Lernfeld expansion
    const toggleLernfeld = (code: string) => {
        const newSet = new Set(expandedLernfelder);
        if (newSet.has(code)) {
            newSet.delete(code);
        } else {
            newSet.add(code);
        }
        setExpandedLernfelder(newSet);
    };

    // Handle add note
    const handleAddNote = async (data: { title: string; content: string; oneDriveLink: string }) => {
        if (!profile?.id || !selectedLernfeld) return;

        setSubmitting(true);
        try {
            const res = await fetch('/api/trainee/knowledge-notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trainee_id: profile.id,
                    title: data.title,
                    content: data.content,
                    one_drive_link: data.oneDriveLink || null,
                    lernfeld_code: selectedLernfeld.code,
                }),
            });

            if (!res.ok) throw new Error(t('notes.error.save'));

            const result = await res.json();
            setNotes(prev => [...prev, {
                id: result.id || result.note?.id,
                title: data.title,
                content: data.content,
                createdAt: new Date().toISOString(),
                oneDriveLink: data.oneDriveLink || null,
                lernfeldCode: selectedLernfeld.code,
            }]);
            setSubmitStatus('success');
            setTimeout(() => {
                setShowAddModal(false);
                setSelectedLernfeld(null);
                setSubmitStatus('idle');
            }, 1500);
        } catch (e) {
            setSubmitStatus('error');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent/30 border-t-accent" />
                <p className="text-muted-foreground text-sm">{t('notes.loading')}</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
                <p className="text-sm text-destructive">{error}</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-foreground">{t('notes.title')}</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        {t('notes.organize')}
                    </p>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted">
                        <FileText className="h-4 w-4" />
                        <span>{notes.length} {t('notes.count')}</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted">
                        <Layers className="h-4 w-4" />
                        <span>{lernfelder.length} {t('notes.lernfelderCount')}</span>
                    </div>
                </div>
            </div>

            {/* Lernfelder List */}
            <div className="rounded-2xl glass-effect border border-border overflow-hidden">
                {lernfelder.map((lf, index) => (
                    <div key={lf.id} className={index > 0 ? 'border-t border-border' : ''}>
                        {/* Lernfeld Header */}
                        <div
                            onClick={() => toggleLernfeld(lf.code)}
                            className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors cursor-pointer"
                        >
                            <div className="flex items-center gap-3">
                                {expandedLernfelder.has(lf.code) ? (
                                    <ChevronDown className="h-4 w-4 text-accent flex-shrink-0" />
                                ) : (
                                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                )}
                                <div className="text-left">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-accent/10 text-accent">
                                            {lf.code}
                                        </span>
                                        {lf.hoursBudget && (
                                            <span className="text-xs text-muted-foreground">
                                                {lf.hoursBudget} {t('notes.hours')}
                                            </span>
                                        )}
                                        {lf.isCommon && (
                                            <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px]">
                                                {t('notes.crossDisciplinary')}
                                            </span>
                                        )}
                                    </div>
                                    {lf.description ? (
                                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                                            {lf.description}
                                        </p>
                                    ) : (
                                        <span className="font-medium text-foreground text-sm">
                                            {lf.name}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {noteCountByLernfeld[lf.code] ? (
                                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-accent/20 text-accent">
                                        {noteCountByLernfeld[lf.code]}
                                    </span>
                                ) : null}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedLernfeld(lf);
                                        setShowAddModal(true);
                                    }}
                                    className="p-1.5 rounded-lg hover:bg-accent/10 text-muted-foreground hover:text-accent transition-colors"
                                >
                                    <Plus className="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        {/* Notes for this Lernfeld */}
                        {expandedLernfelder.has(lf.code) && (
                            <div className="px-4 pb-4 pl-12 space-y-2">
                                {getNotesForLernfeld(lf.code).length === 0 ? (
                                    <p className="text-sm text-muted-foreground italic py-2">
                                        {t('notes.noneForField')}
                                    </p>
                                ) : (
                                    getNotesForLernfeld(lf.code).map(note => (
                                        <NoteCard key={note.id} note={note} onDelete={handleDeleteNote} />
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                ))}

                {/* Sonstiges Section */}
                <div className="border-t border-border">
                    <div
                        onClick={() => toggleLernfeld(SONSTIGES_CODE)}
                        className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors cursor-pointer"
                    >
                        <div className="flex items-center gap-3">
                            {expandedLernfelder.has(SONSTIGES_CODE) ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            )}
                            <div className="text-left">
                                <div className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 rounded text-xs font-bold bg-slate-500/10 text-slate-600 dark:text-slate-400">
                                        <FolderOpen className="h-3 w-3 inline mr-1" />
                                        {t('notes.other')}
                                    </span>
                                    <span className="font-medium text-foreground text-sm">
                                        {t('notes.general')}
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {t('notes.noFieldAssignment')}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {noteCountByLernfeld[SONSTIGES_CODE] ? (
                                <span className="px-2 py-1 rounded-full text-xs font-medium bg-slate-500/20 text-slate-600 dark:text-slate-400">
                                    {noteCountByLernfeld[SONSTIGES_CODE]}
                                </span>
                            ) : null}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedLernfeld({ code: SONSTIGES_CODE, name: t('notes.other') });
                                    setShowAddModal(true);
                                }}
                                className="p-1.5 rounded-lg hover:bg-slate-500/10 text-muted-foreground hover:text-slate-600 dark:hover:text-slate-400 transition-colors"
                            >
                                <Plus className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    {/* Sonstiges Notes */}
                    {expandedLernfelder.has(SONSTIGES_CODE) && (
                        <div className="px-4 pb-4 pl-12 space-y-2">
                            {getNotesForLernfeld(SONSTIGES_CODE).length === 0 ? (
                                <p className="text-sm text-muted-foreground italic py-2">
                                    {t('notes.noneOther')}
                                </p>
                            ) : (
                                getNotesForLernfeld(SONSTIGES_CODE).map(note => (
                                    <NoteCard key={note.id} note={note} onDelete={handleDeleteNote} />
                                ))
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Add Note Modal */}
            {showAddModal && selectedLernfeld && (
                <AddNoteModal
                    lernfeld={selectedLernfeld}
                    onClose={() => {
                        setShowAddModal(false);
                        setSelectedLernfeld(null);
                        setSubmitStatus('idle');
                    }}
                    onSubmit={handleAddNote}
                    submitting={submitting}
                    status={submitStatus}
                />
            )}
        </div>
    );
}

// Note Card Component
function NoteCard({ note, onDelete }: { note: Note; onDelete: (id: string) => void }) {
    const [deleting, setDeleting] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const handleDelete = async () => {
        setDeleting(true);
        await onDelete(note.id);
        setDeleting(false);
    };

    return (
        <div className="p-3 rounded-xl bg-muted/50 border border-border/50">
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-foreground text-sm">
                        {note.title}
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {note.content}
                    </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                    {note.oneDriveLink && (
                        <a
                            href={note.oneDriveLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg hover:bg-accent/10 text-muted-foreground hover:text-accent transition-colors"
                        >
                            <ExternalLink className="h-4 w-4" />
                        </a>
                    )}
                    {showConfirm ? (
                        <div className="flex items-center gap-1">
                            <button
                                onClick={handleDelete}
                                disabled={deleting}
                                className="p-1.5 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                            >
                                {deleting ? (
                                    <div className="h-4 w-4 border-2 border-destructive/30 border-t-destructive rounded-full animate-spin" />
                                ) : (
                                    <CheckCircle className="h-4 w-4" />
                                )}
                            </button>
                            <button
                                onClick={() => setShowConfirm(false)}
                                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => setShowConfirm(true)}
                            className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        >
                            <Trash2 className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
                {new Date(note.createdAt).toLocaleDateString('de-DE')}
            </p>
        </div>
    );
}

// Add Note Modal Component
function AddNoteModal({
    lernfeld,
    onClose,
    onSubmit,
    submitting,
    status,
}: {
    lernfeld: { code: string; name: string };
    onClose: () => void;
    onSubmit: (data: { title: string; content: string; oneDriveLink: string }) => void;
    submitting: boolean;
    status: 'idle' | 'success' | 'error';
}) {
    const { t } = useLanguage();
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [oneDriveLink, setOneDriveLink] = useState('');
    const isSonstiges = lernfeld.code === SONSTIGES_CODE;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit({ title, content, oneDriveLink });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl overflow-hidden">
                <div className="p-6 border-b border-border">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-bold text-foreground">{t('notes.add')}</h3>
                            <p className="text-sm text-muted-foreground mt-1">
                                <span className={`px-2 py-0.5 rounded text-xs font-bold mr-2 ${isSonstiges
                                    ? 'bg-slate-500/10 text-slate-600 dark:text-slate-400'
                                    : 'bg-accent/10 text-accent'
                                    }`}>
                                    {isSonstiges ? t('notes.other') : lernfeld.code}
                                </span>
                                {isSonstiges ? t('notes.generalNote') : lernfeld.name}
                            </p>
                        </div>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition text-foreground">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    <div>
                        <label className="block text-sm font-medium text-foreground mb-2">{t('notes.titleLabel')}</label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl bg-muted border border-border text-foreground placeholder:text-muted-foreground"
                            placeholder={t('notes.titlePlaceholder')}
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-foreground mb-2">{t('notes.content')}</label>
                        <textarea
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            rows={4}
                            className="w-full px-4 py-3 rounded-xl bg-muted border border-border text-foreground placeholder:text-muted-foreground resize-none"
                            placeholder={t('notes.contentPlaceholder')}
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                            {t('notes.oneDriveLink')}
                        </label>
                        <input
                            type="url"
                            value={oneDriveLink}
                            onChange={(e) => setOneDriveLink(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl bg-muted border border-border text-foreground placeholder:text-muted-foreground"
                            placeholder="https://1drv.ms/..."
                        />
                    </div>

                    {status === 'success' && (
                        <div className="flex items-center gap-2 p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400">
                            <CheckCircle className="h-5 w-5" />
                            <span className="text-sm font-medium">{t('notes.saved')}</span>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive">
                            <AlertCircle className="h-5 w-5" />
                            <span className="text-sm font-medium">{t('notes.error.save')}</span>
                        </div>
                    )}

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-3 rounded-xl glass-effect text-foreground font-medium transition"
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            type="submit"
                            disabled={submitting || status === 'success'}
                            className="btn-accent flex-1 px-4 py-3 rounded-xl font-medium transition flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {submitting ? (
                                <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <Send className="h-4 w-4" />
                            )}
                            {t('common.save')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
