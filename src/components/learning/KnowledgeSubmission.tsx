'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  Send,
  CheckCircle,
  AlertCircle,
  BookOpen,
  Clock,
  Award,
} from 'lucide-react';
import Link from 'next/link';

export function KnowledgeSubmission() {
  const { user, profile } = useAuth();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [oneDriveLink, setOneDriveLink] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState<
    'idle' | 'success' | 'error'
  >('idle');
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<Array<{ id: string; title: string; content: string; createdAt: string; oneDriveLink?: string | null }>>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (!profile?.id) throw new Error('No profile');
      const res = await fetch('/api/trainee/knowledge-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trainee_id: profile.id, title, content, one_drive_link: oneDriveLink || null }),
      });
      if (!res.ok) throw new Error('Failed to submit note');
      setSubmissionStatus('success');
      setTitle('');
      setContent('');
      setOneDriveLink('');
      // refresh
      await loadNotes();
    } catch (error) {
      setSubmissionStatus('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const loadNotes = async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/trainee/knowledge-notes?traineeId=${profile.id}`);
      if (!res.ok) throw new Error('Failed to load notes');
      const data = await res.json();
      setNotes((data?.notes || []).map((n: any) => ({ id: n.id, title: n.title, content: n.content, createdAt: n.createdAt, oneDriveLink: n.oneDriveLink })));
    } catch (e) {
      console.error(e);
      setNotes([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  if (!user) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="border-accent mx-auto h-12 w-12 animate-spin rounded-full border-b-2"></div>
          <p className="text-muted mt-4">Lade...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background min-h-full p-6">
      <div className="mx-auto max-w-4xl space-y-8">
        {/* Header */}
        <div className="glass-effect border-accent/30 rounded-3xl border p-8 text-center shadow-lg">
          <h1 className="text-foreground mb-4 text-4xl font-bold">
            Wissenseinreichung
          </h1>
          <p className="text-muted text-lg">
            Teilen Sie Ihr Wissen und Ihre Erfahrungen mit der Community
          </p>
        </div>

        {/* Submission Form */}
        <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
          <h2 className="text-foreground mb-6 text-2xl font-bold">
            Neue Einreichung
          </h2>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="title"
                className="text-muted mb-2 block text-sm font-medium"
              >
                Titel der Einreichung
              </label>
              <input
                id="title"
                type="text"
                required
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="bg-background/50 border-accent/30 focus:ring-accent text-foreground placeholder-muted w-full resize-none rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
                placeholder="Geben Sie einen aussagekräftigen Titel ein..."
              />
            </div>

            <div>
              <label
                htmlFor="content"
                className="text-muted mb-2 block text-sm font-medium"
              >
                Inhalt
              </label>
              <textarea
                id="content"
                required
                rows={8}
                value={content}
                onChange={e => setContent(e.target.value)}
                className="bg-background/50 border-accent/30 focus:ring-accent text-foreground placeholder-muted w-full resize-none rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
                placeholder="Beschreiben Sie Ihr Wissen, Ihre Erfahrungen oder Erkenntnisse..."
              />
            </div>

            <div>
              <label htmlFor="onedrive" className="text-muted mb-2 block text-sm font-medium">
                Dokument-Link (OneDrive) – optional
              </label>
              <input
                id="onedrive"
                type="url"
                value={oneDriveLink}
                onChange={e => setOneDriveLink(e.target.value)}
                className="bg-background/50 border-accent/30 focus:ring-accent text-foreground placeholder-muted w-full rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
                placeholder="https://1drv.ms/... oder vollständige OneDrive-URL"
              />
              <p className="text-muted mt-2 text-xs">
                Hinweis: Fügen Sie hier den OneDrive-Link Ihres Dokuments ein. Wir speichern den Link zu Ihrer Einreichung.
              </p>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="text-foreground bg-accent hover:bg-accent/90 disabled:bg-accent/50 focus:ring-offset-background focus:ring-accent flex w-full items-center justify-center gap-2 rounded-2xl py-4 font-semibold transition-colors duration-300 focus:ring-2 focus:ring-offset-2 focus:outline-none"
            >
              {isSubmitting ? (
                <>
                  <div className="border-foreground h-5 w-5 animate-spin rounded-full border-b-2"></div>
                  Wird eingereicht...
                </>
              ) : (
                <>
                  <Send className="h-5 w-5" />
                  Einreichung senden
                </>
              )}
            </button>
          </form>

          {/* Submission Status */}
          {submissionStatus === 'success' && (
            <div className="mt-6 rounded-2xl border border-green-700 bg-green-900/20 p-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="h-6 w-6 text-green-400" />
                <div>
                  <p className="font-medium text-green-400">
                    Einreichung erfolgreich!
                  </p>
                  <p className="text-sm text-green-300">
                    Ihre Wissenseinreichung wurde erfolgreich gesendet und wird
                    von unserem Team geprüft.
                  </p>
                </div>
              </div>
            </div>
          )}

          {submissionStatus === 'error' && (
            <div className="mt-6 rounded-2xl border border-red-700 bg-red-900/20 p-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-6 w-6 text-red-400" />
                <div>
                  <p className="font-medium text-red-400">
                    Fehler bei der Einreichung
                  </p>
                  <p className="text-sm text-red-300">
                    Es gab ein Problem beim Senden Ihrer Einreichung. Bitte
                    versuchen Sie es erneut.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Submitted Notes List */}
        <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
          <h2 className="text-foreground mb-6 text-2xl font-bold">Meine Beiträge</h2>
          {loading ? (
            <div className="text-center text-muted">Lade...</div>
          ) : notes.length === 0 ? (
            <div className="text-muted">Noch keine Einreichungen vorhanden.</div>
          ) : (
            <div className="space-y-3">
              {notes.map((n) => (
                  <div key={n.id} className="bg-background/50 border-accent/30 hover:border-accent/60 rounded-xl border p-4 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link href={`/trainee/knowledge-submission/${n.id}`}>
                        <div className="text-foreground font-semibold">{n.title}</div>
                        <div className="text-muted text-xs">{new Date(n.createdAt).toLocaleString()}</div>
                        </Link>
                      </div>
                    </div>
                    <p className="text-muted mt-2 line-clamp-3 whitespace-pre-wrap">{n.content}</p>
                    {n.oneDriveLink && (
                      <div className="mt-2 text-xs">
                        <span className="text-muted">Link: </span>
                        <a
                          href={n.oneDriveLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent underline break-all"
                        >
                          {n.oneDriveLink}
                        </a>
                      </div>
                    )}
                  </div>
               
              ))}
            </div>
          )}
          <div className="text-muted mt-4 text-xs">Hinweis: Verwenden Sie den OneDrive-Link, um Dokumente zu referenzieren.</div>
        </div>

        {/* Guidelines */}
        <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
          <h2 className="text-foreground mb-6 text-2xl font-bold">
            Richtlinien für Wissenseinreichungen
          </h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="text-center">
              <BookOpen className="text-accent mx-auto mb-4 h-12 w-12" />
              <h3 className="text-foreground mb-2 text-lg font-semibold">
                Relevanz
              </h3>
              <p className="text-muted text-sm">
                Stellen Sie sicher, dass Ihr Beitrag für die Ausbildung relevant
                ist.
              </p>
            </div>
            <div className="text-center">
              <Clock className="text-accent mx-auto mb-4 h-12 w-12" />
              <h3 className="text-foreground mb-2 text-lg font-semibold">
                Aktualität
              </h3>
              <p className="text-muted text-sm">
                Teilen Sie aktuelle Erkenntnisse und moderne Praktiken.
              </p>
            </div>
            <div className="text-center">
              <Award className="text-accent mx-auto mb-4 h-12 w-12" />
              <h3 className="text-foreground mb-2 text-lg font-semibold">
                Qualität
              </h3>
              <p className="text-muted text-sm">
                Bieten Sie detaillierte und nützliche Informationen.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
