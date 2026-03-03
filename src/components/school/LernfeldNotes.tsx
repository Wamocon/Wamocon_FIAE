'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
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
  const [expandedLernfelder, setExpandedLernfelder] = useState<Set<string>>(
    new Set()
  );

  // Add note modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedLernfeld, setSelectedLernfeld] = useState<
    Lernfeld | { code: string; name: string } | null
  >(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<
    'idle' | 'success' | 'error'
  >('idle');

  // Load Lernfelder and notes
  useEffect(() => {
    if (!profile?.id) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [lfRes, notesRes] = await Promise.all([
          fetch('/api/trainee/school/lernfelder', { cache: 'no-store' }),
          fetch(`/api/trainee/knowledge-notes?traineeId=${profile.id}`, {
            cache: 'no-store',
          }),
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
      return notes.filter(
        n => !n.lernfeldCode || n.lernfeldCode === SONSTIGES_CODE
      );
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
      const res = await fetch(
        `/api/trainee/knowledge-notes/${noteId}?traineeId=${profile.id}`,
        {
          method: 'DELETE',
        }
      );
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
  const handleAddNote = async (data: {
    title: string;
    content: string;
    oneDriveLink: string;
  }) => {
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
      setNotes(prev => [
        ...prev,
        {
          id: result.id || result.note?.id,
          title: data.title,
          content: data.content,
          createdAt: new Date().toISOString(),
          oneDriveLink: data.oneDriveLink || null,
          lernfeldCode: selectedLernfeld.code,
        },
      ]);
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
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-destructive/10 border-destructive/20 flex items-center gap-3 rounded-xl border p-4">
        <AlertCircle className="text-destructive h-5 w-5 flex-shrink-0" />
        <p className="text-destructive text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-foreground text-xl font-bold">
            {t('notes.title')}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('notes.organize')}
          </p>
        </div>
        <div className="text-muted-foreground flex items-center gap-3 text-sm">
          <div className="bg-muted flex items-center gap-1.5 rounded-lg px-3 py-1.5">
            <FileText className="h-4 w-4" />
            <span>
              {notes.length} {t('notes.count')}
            </span>
          </div>
          <div className="bg-muted flex items-center gap-1.5 rounded-lg px-3 py-1.5">
            <Layers className="h-4 w-4" />
            <span>
              {lernfelder.length} {t('notes.lernfelderCount')}
            </span>
          </div>
        </div>
      </div>

      {/* Lernfelder List */}
      <div className="glass-effect border-border overflow-hidden rounded-2xl border">
        {lernfelder.map((lf, index) => (
          <div
            key={lf.id}
            className={index > 0 ? 'border-border border-t' : ''}
          >
            {/* Lernfeld Header */}
            <div
              onClick={() => toggleLernfeld(lf.code)}
              className="hover:bg-muted/30 flex w-full cursor-pointer items-center justify-between p-4 transition-colors"
            >
              <div className="flex items-center gap-3">
                {expandedLernfelder.has(lf.code) ? (
                  <ChevronDown className="text-accent h-4 w-4 flex-shrink-0" />
                ) : (
                  <ChevronRight className="text-muted-foreground h-4 w-4 flex-shrink-0" />
                )}
                <div className="text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="bg-accent/10 text-accent rounded px-2 py-0.5 text-xs font-bold">
                      {lf.code}
                    </span>
                    {lf.hoursBudget && (
                      <span className="text-muted-foreground text-xs">
                        {lf.hoursBudget} {t('notes.hours')}
                      </span>
                    )}
                    {lf.isCommon && (
                      <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600 dark:text-blue-400">
                        {t('notes.crossDisciplinary')}
                      </span>
                    )}
                  </div>
                  {lf.description ? (
                    <p className="text-muted-foreground mt-1 line-clamp-1 text-xs">
                      {lf.description}
                    </p>
                  ) : (
                    <span className="text-foreground text-sm font-medium">
                      {lf.name}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {noteCountByLernfeld[lf.code] ? (
                  <span className="bg-accent/20 text-accent rounded-full px-2 py-1 text-xs font-medium">
                    {noteCountByLernfeld[lf.code]}
                  </span>
                ) : null}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    setSelectedLernfeld(lf);
                    setShowAddModal(true);
                  }}
                  className="hover:bg-accent/10 text-muted-foreground hover:text-accent rounded-lg p-1.5 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Notes for this Lernfeld */}
            {expandedLernfelder.has(lf.code) && (
              <div className="space-y-2 px-4 pb-4 pl-12">
                {getNotesForLernfeld(lf.code).length === 0 ? (
                  <p className="text-muted-foreground py-2 text-sm italic">
                    {t('notes.noneForField')}
                  </p>
                ) : (
                  getNotesForLernfeld(lf.code).map(note => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      onDelete={handleDeleteNote}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        ))}

        {/* Sonstiges Section */}
        <div className="border-border border-t">
          <div
            onClick={() => toggleLernfeld(SONSTIGES_CODE)}
            className="hover:bg-muted/30 flex w-full cursor-pointer items-center justify-between p-4 transition-colors"
          >
            <div className="flex items-center gap-3">
              {expandedLernfelder.has(SONSTIGES_CODE) ? (
                <ChevronDown className="text-muted-foreground h-4 w-4 flex-shrink-0" />
              ) : (
                <ChevronRight className="text-muted-foreground h-4 w-4 flex-shrink-0" />
              )}
              <div className="text-left">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-slate-500/10 px-2 py-0.5 text-xs font-bold text-slate-600 dark:text-slate-400">
                    <FolderOpen className="mr-1 inline h-3 w-3" />
                    {t('notes.other')}
                  </span>
                  <span className="text-foreground text-sm font-medium">
                    {t('notes.general')}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  {t('notes.noFieldAssignment')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {noteCountByLernfeld[SONSTIGES_CODE] ? (
                <span className="rounded-full bg-slate-500/20 px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-400">
                  {noteCountByLernfeld[SONSTIGES_CODE]}
                </span>
              ) : null}
              <button
                onClick={e => {
                  e.stopPropagation();
                  setSelectedLernfeld({
                    code: SONSTIGES_CODE,
                    name: t('notes.other'),
                  });
                  setShowAddModal(true);
                }}
                className="text-muted-foreground rounded-lg p-1.5 transition-colors hover:bg-slate-500/10 hover:text-slate-600 dark:hover:text-slate-400"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Sonstiges Notes */}
          {expandedLernfelder.has(SONSTIGES_CODE) && (
            <div className="space-y-2 px-4 pb-4 pl-12">
              {getNotesForLernfeld(SONSTIGES_CODE).length === 0 ? (
                <p className="text-muted-foreground py-2 text-sm italic">
                  {t('notes.noneOther')}
                </p>
              ) : (
                getNotesForLernfeld(SONSTIGES_CODE).map(note => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    onDelete={handleDeleteNote}
                  />
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
function NoteCard({
  note,
  onDelete,
}: {
  note: Note;
  onDelete: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete(note.id);
    setDeleting(false);
  };

  return (
    <div className="bg-muted/50 border-border/50 rounded-xl border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="text-foreground text-sm font-medium">{note.title}</h4>
          <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
            {note.content}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {note.oneDriveLink && (
            <a
              href={note.oneDriveLink}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:bg-accent/10 text-muted-foreground hover:text-accent rounded-lg p-1.5 transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          {showConfirm ? (
            <div className="flex items-center gap-1">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-lg p-1.5 transition-colors"
              >
                {deleting ? (
                  <div className="border-destructive/30 border-t-destructive h-4 w-4 animate-spin rounded-full border-2" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="hover:bg-muted text-muted-foreground rounded-lg p-1.5 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowConfirm(true)}
              className="hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded-lg p-1.5 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <p className="text-muted-foreground mt-2 text-[10px]">
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
  onSubmit: (data: {
    title: string;
    content: string;
    oneDriveLink: string;
  }) => void;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="bg-card border-border w-full max-w-lg overflow-hidden rounded-2xl border shadow-2xl">
        <div className="border-border border-b p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-foreground text-lg font-bold">
                {t('notes.add')}
              </h3>
              <p className="text-muted-foreground mt-1 text-sm">
                <span
                  className={`mr-2 rounded px-2 py-0.5 text-xs font-bold ${
                    isSonstiges
                      ? 'bg-slate-500/10 text-slate-600 dark:text-slate-400'
                      : 'bg-accent/10 text-accent'
                  }`}
                >
                  {isSonstiges ? t('notes.other') : lernfeld.code}
                </span>
                {isSonstiges ? t('notes.generalNote') : lernfeld.name}
              </p>
            </div>
            <button
              onClick={onClose}
              className="hover:bg-muted text-foreground rounded-lg p-2 transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          <div>
            <label className="text-foreground mb-2 block text-sm font-medium">
              {t('notes.titleLabel')}
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground w-full rounded-xl border px-4 py-3"
              placeholder={t('notes.titlePlaceholder')}
              required
            />
          </div>

          <div>
            <label className="text-foreground mb-2 block text-sm font-medium">
              {t('notes.content')}
            </label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={4}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground w-full resize-none rounded-xl border px-4 py-3"
              placeholder={t('notes.contentPlaceholder')}
              required
            />
          </div>

          <div>
            <label className="text-foreground mb-2 block text-sm font-medium">
              {t('notes.oneDriveLink')}
            </label>
            <input
              type="url"
              value={oneDriveLink}
              onChange={e => setOneDriveLink(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground w-full rounded-xl border px-4 py-3"
              placeholder="https://1drv.ms/..."
            />
          </div>

          {status === 'success' && (
            <div className="flex items-center gap-2 rounded-xl border border-green-500/20 bg-green-500/10 p-3 text-green-600 dark:text-green-400">
              <CheckCircle className="h-5 w-5" />
              <span className="text-sm font-medium">{t('notes.saved')}</span>
            </div>
          )}

          {status === 'error' && (
            <div className="bg-destructive/10 border-destructive/20 text-destructive flex items-center gap-2 rounded-xl border p-3">
              <AlertCircle className="h-5 w-5" />
              <span className="text-sm font-medium">
                {t('notes.error.save')}
              </span>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="glass-effect text-foreground flex-1 rounded-xl px-4 py-3 font-medium transition"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting || status === 'success'}
              className="btn-accent flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 font-medium transition disabled:opacity-50"
            >
              {submitting ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
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
