"use client";

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { CheckCircle2, Circle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

interface ReflectionItem {
  id: string;
  traineeId: string;
  traineeName: string;
  strengths: string | null;
  weaknesses: string | null;
  mesMore: string | null;
  mesEqual: string | null;
  isReviewed: boolean;
  createdAt: string;
}

interface SubmissionItem {
  id: string;
  traineeId: string;
  traineeName: string;
  quizId: string;
  quizTitle: string;
  score: number | null;
  isReviewed: boolean;
  submittedAt: string;
}

export default function ReviewCenterPage() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('view'); // 'quizzes' | 'reflections' | null
  const onlyPendingParam = searchParams.get('onlyPending'); // 'true' | 'false' | null
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reflections, setReflections] = useState<ReflectionItem[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([]);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');

  // Sync filter with URL param when it changes
  useEffect(() => {
    if (onlyPendingParam === 'false') setFilter('all');
    else if (onlyPendingParam === 'true') setFilter('pending');
  }, [onlyPendingParam]);

  const reflectionsFiltered = useMemo(
    () => reflections.filter(r => (filter === 'pending' ? !r.isReviewed : true)),
    [reflections, filter],
  );
  const submissionsFiltered = useMemo(
    () => submissions.filter(s => (filter === 'pending' ? !s.isReviewed : true)),
    [submissions, filter],
  );

  const load = async () => {
    if (!profile?.id) return;
    setLoading(true);
    setError(null);
    try {
      const fetchReflections = async () => {
        const res = await fetch(`/api/trainer/reflections?trainerProfileId=${profile.id}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Fehler beim Laden der Reflektionen');
        const data = await res.json();
        setReflections(data.reflections || []);
      };
      const fetchSubmissions = async () => {
        const res = await fetch(`/api/trainer/quiz-submissions?trainerProfileId=${profile.id}&onlyPending=${filter === 'pending'}`);
        if (!res.ok) throw new Error('Fehler beim Laden der Einsendungen');
        const data = await res.json();
        setSubmissions(data.submissions || []);
      };
      // If URL says view=quizzes, don't fetch reflections
      if (viewParam === 'quizzes') {
        await fetchSubmissions();
      } else if (viewParam === 'reflections') {
        await fetchReflections();
      } else {
        await Promise.all([fetchReflections(), fetchSubmissions()]);
      }
    } catch (e: any) {
      setError(e.message || 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, filter]);

  const toggleReflectionReviewed = async (id: string, current: boolean) => {
    await fetch(`/api/trainer/reflections/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_reviewed: !current, reviewer_id: profile?.id }),
    });
    await load();
  };

  const toggleSubmissionReviewed = async (id: string, current: boolean) => {
    await fetch(`/api/trainer/quiz-submissions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_reviewed: !current }),
    });
    await load();
  };

  return (
    <div className="bg-background min-h-screen p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="glass-effect rounded-3xl border border-accent/30 p-6 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-foreground text-2xl font-bold">Review-Center</h1>
              <div className="text-muted text-sm">
                Reflektionen: {reflections.filter(r => !r.isReviewed).length} offen · Quizzes: {submissions.filter(s => !s.isReviewed).length} offen
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setFilter('pending')} className={`rounded-xl px-4 py-2 text-sm ${filter === 'pending' ? 'bg-accent text-foreground' : 'border border-accent/30 text-foreground'}`}>Offen</button>
              <button onClick={() => setFilter('all')} className={`rounded-xl px-4 py-2 text-sm ${filter === 'all' ? 'bg-accent text-foreground' : 'border border-accent/30 text-foreground'}`}>Alle</button>
            </div>
          </div>
        </div>

        {/* Reflections Section */}
        {viewParam !== 'quizzes' && (
        <div className="glass-effect rounded-3xl border border-accent/30 p-6 shadow-lg">
          <h2 className="text-foreground mb-4 text-xl font-semibold">Reflektionen</h2>
          {loading ? (
            <div className="text-center text-muted">Lade…</div>
          ) : error ? (
            <div className="rounded-xl border border-red-700 bg-red-900/20 p-4 text-red-300">{error}</div>
          ) : reflectionsFiltered.length === 0 ? (
            <div className="text-muted">Keine Reflektionen.</div>
          ) : (
            <ul className="space-y-4">
              {reflectionsFiltered.map((r) => (
                <li key={r.id} className="rounded-2xl border border-accent/20 bg-background/40 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-foreground font-semibold">{r.traineeName}</div>
                      <div className="text-muted text-xs">{new Date(r.createdAt).toLocaleString()}</div>
                    </div>
                    <button
                      onClick={() => toggleReflectionReviewed(r.id, r.isReviewed)}
                      className={`rounded-xl px-3 py-2 text-sm ${r.isReviewed ? 'border border-green-600/40 text-green-300 hover:bg-green-900/20' : 'border border-accent/30 text-foreground hover:bg-background/50'}`}
                    >
                      {r.isReviewed ? (
                        <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Gelesen</span>
                      ) : (
                        <span className="inline-flex items-center gap-2"><Circle className="h-4 w-4" /> Als gelesen markieren</span>
                      )}
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <div className="text-muted mb-1 text-xs">Stärken</div>
                      <div className="text-foreground whitespace-pre-wrap rounded-xl border border-accent/10 bg-background/50 p-3 text-sm">{r.strengths || '-'}</div>
                    </div>
                    <div>
                      <div className="text-muted mb-1 text-xs">Schwächen</div>
                      <div className="text-foreground whitespace-pre-wrap rounded-xl border border-accent/10 bg-background/50 p-3 text-sm">{r.weaknesses || '-'}</div>
                    </div>
                    <div>
                      <div className="text-muted mb-1 text-xs">Mehr davon</div>
                      <div className="text-foreground whitespace-pre-wrap rounded-xl border border-accent/10 bg-background/50 p-3 text-sm">{r.mesMore || '-'}</div>
                    </div>
                    <div>
                      <div className="text-muted mb-1 text-xs">Gleich lassen</div>
                      <div className="text-foreground whitespace-pre-wrap rounded-xl border border-accent/10 bg-background/50 p-3 text-sm">{r.mesEqual || '-'}</div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        )}

        {/* Quiz Submissions Section */}
        {viewParam !== 'reflections' && (
        <div className="glass-effect rounded-3xl border border-accent/30 p-6 shadow-lg">
          <h2 className="text-foreground mb-4 text-xl font-semibold">Quiz-Einreichungen</h2>
          {loading ? (
            <div className="text-center text-muted">Lade…</div>
          ) : error ? (
            <div className="rounded-xl border border-red-700 bg-red-900/20 p-4 text-red-300">{error}</div>
          ) : submissionsFiltered.length === 0 ? (
            <div className="text-muted">Keine Quiz-Einreichungen.</div>
          ) : (
            <ul className="space-y-4">
              {submissionsFiltered.map((s) => (
                <li key={s.id} className="rounded-2xl border border-accent/20 bg-background/40 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-foreground font-semibold">{s.traineeName}</div>
                      <div className="text-muted text-xs">{new Date(s.submittedAt).toLocaleString()}</div>
                    </div>
                    <button
                      onClick={() => toggleSubmissionReviewed(s.id, s.isReviewed)}
                      className={`rounded-xl px-3 py-2 text-sm ${s.isReviewed ? 'border border-green-600/40 text-green-300 hover:bg-green-900/20' : 'border border-accent/30 text-foreground hover:bg-background/50'}`}
                    >
                      {s.isReviewed ? (
                        <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Bewertet</span>
                      ) : (
                        <span className="inline-flex items-center gap-2"><Circle className="h-4 w-4" /> Als bewertet markieren</span>
                      )}
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div>
                      <div className="text-muted mb-1 text-xs">Quiz</div>
                      <div className="text-foreground rounded-xl border border-accent/10 bg-background/50 p-3 text-sm">{s.quizTitle}</div>
                    </div>
                    <div>
                      <div className="text-muted mb-1 text-xs">Score</div>
                      <div className="text-foreground rounded-xl border border-accent/10 bg-background/50 p-3 text-sm">{s.score ?? 0}%</div>
                    </div>
                    <div>
                      <div className="text-muted mb-1 text-xs">Status</div>
                      <div className="text-foreground rounded-xl border border-accent/10 bg-background/50 p-3 text-sm">{s.isReviewed ? 'Bewertet' : 'Offen'}</div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
