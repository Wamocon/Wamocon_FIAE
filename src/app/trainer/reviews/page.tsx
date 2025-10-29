'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { CheckCircle2, Circle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

type EnablerReviewItem = { id: string; enablerId: string; enablerTitle: string; traineeId: string; traineeName: string; solutionText?: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED'; submittedAt: string };
type UseCaseReviewItem = { id: string; useCaseId: string; useCaseTitle: string; traineeId: string; traineeName: string; submissionText?: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED'; submittedAt: string };
type ReflectionItem = { id: string; traineeId: string; traineeName: string; strengths: string | null; weaknesses: string | null; mesMore: string | null; mesEqual: string | null; isReviewed: boolean; createdAt: string };
type QuizSubmissionItem = { id: string; traineeId: string; traineeName: string; quizId: string; quizTitle: string; quizType?: 'ENABLER' | 'GLOBAL'; score: number | null; isReviewed: boolean; submittedAt: string };

export default function TrainerReviewsPage() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('view'); // 'enablers' | 'usecases' | 'quizzes' | 'reflections'
  const onlyPendingParam = searchParams.get('onlyPending'); // 'true' | 'false'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'enablers' | 'usecases' | 'quizzes' | 'reflections'>('enablers');

  // Enabler/UseCase state
  const [enablerSubs, setEnablerSubs] = useState<EnablerReviewItem[]>([]);
  const [useCaseSubs, setUseCaseSubs] = useState<UseCaseReviewItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [feedbackMap, setFeedbackMap] = useState<Record<string, string>>({});

  // Quiz/Reflection state
  const [reflections, setReflections] = useState<ReflectionItem[]>([]);
  const [quizzes, setQuizzes] = useState<QuizSubmissionItem[]>([]);
  const [pendingFilter, setPendingFilter] = useState<'pending' | 'all'>('pending');
  const [quizTypeFilter, setQuizTypeFilter] = useState<'all' | 'ENABLER' | 'GLOBAL'>('all');

  const filteredEnablers = useMemo(() => enablerSubs.filter(s => statusFilter === 'all' ? true : s.status.toLowerCase() === statusFilter), [enablerSubs, statusFilter]);
  const filteredUseCases = useMemo(() => useCaseSubs.filter(s => statusFilter === 'all' ? true : s.status.toLowerCase() === statusFilter), [useCaseSubs, statusFilter]);
  const reflectionsFiltered = useMemo(() => reflections.filter(r => pendingFilter === 'pending' ? !r.isReviewed : true), [reflections, pendingFilter]);
  const quizzesFiltered = useMemo(() => quizzes.filter(q => {
    const pendingOk = pendingFilter === 'pending' ? !q.isReviewed : true;
    const typeOk = quizTypeFilter === 'all' ? true : q.quizType === quizTypeFilter;
    return pendingOk && typeOk;
  }), [quizzes, pendingFilter, quizTypeFilter]);

  // Sync state from URL params (deep-linking from dashboard)
  useEffect(() => {
    const allowed = ['enablers', 'usecases', 'quizzes', 'reflections'] as const;
    if (viewParam && (allowed as readonly string[]).includes(viewParam)) {
      setActiveTab(viewParam as any);
    }
    if (onlyPendingParam === 'true') {
      setStatusFilter('pending');
      setPendingFilter('pending');
    } else if (onlyPendingParam === 'false') {
      setStatusFilter('all');
      setPendingFilter('all');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewParam, onlyPendingParam]);

  // load Enablers/UseCases
  useEffect(() => {
    const loadEU = async () => {
      if (!profile?.id) return;
      setLoading(true);
      setError(null);
      try {
        const onlyPending = statusFilter === 'pending';
        const r = await fetch(`/api/trainer/reviews?trainerId=${profile.id}&onlyPending=${onlyPending ? 'true' : 'false'}`, { cache: 'no-store' });
        if (!r.ok) throw new Error('Konnte Reviews nicht laden');
        const data = await r.json();
        setEnablerSubs((data.enablerSubmissions || []).map((x: any) => ({ ...x, status: x.status })));
        setUseCaseSubs((data.useCaseSubmissions || []).map((x: any) => ({ ...x, status: x.status })));
      } catch (e: any) {
        setError(e?.message || 'Unbekannter Fehler');
      } finally {
        setLoading(false);
      }
    };
    if (activeTab === 'enablers' || activeTab === 'usecases') loadEU();
  }, [profile?.id, statusFilter, activeTab]);

  // load Quizzes/Reflections
  useEffect(() => {
    const loadQR = async () => {
      if (!profile?.id) return;
      setLoading(true);
      setError(null);
      try {
        if (activeTab === 'reflections') {
          const res = await fetch(`/api/trainer/reflections?trainerProfileId=${profile.id}`, { cache: 'no-store' });
          if (!res.ok) throw new Error('Fehler beim Laden der Reflektionen');
          const data = await res.json();
          setReflections(data.reflections || []);
        } else if (activeTab === 'quizzes') {
          const res = await fetch(`/api/trainer/quiz-submissions?trainerProfileId=${profile.id}&onlyPending=${pendingFilter === 'pending'}`);
          if (!res.ok) throw new Error('Fehler beim Laden der Einreichungen');
          const data = await res.json();
          setQuizzes(data.submissions || []);
        }
      } catch (e: any) {
        setError(e.message || 'Unbekannter Fehler');
      } finally {
        setLoading(false);
      }
    };
    if (activeTab === 'reflections' || activeTab === 'quizzes') loadQR();
  }, [profile?.id, activeTab, pendingFilter]);

  const reviewItem = async (kind: 'enabler' | 'usecase', id: string, status: 'APPROVED' | 'REJECTED') => {
    if (!profile?.id) return;
    const feedback = feedbackMap[id] || '';
    const url = kind === 'enabler'
      ? `/api/trainer/reviews/enablers/${id}?trainerId=${profile.id}`
      : `/api/trainer/reviews/use-cases/${id}?trainerId=${profile.id}`;
    const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, trainerFeedback: feedback }) });
    if (!r.ok) {
      alert('Konnte Review nicht speichern');
      return;
    }
    // Refresh the list with same filter
    const onlyPending = statusFilter === 'pending';
    const rr = await fetch(`/api/trainer/reviews?trainerId=${profile.id}&onlyPending=${onlyPending ? 'true' : 'false'}`, { cache: 'no-store' });
    const data = await rr.json();
    setEnablerSubs((data.enablerSubmissions || []).map((x: any) => ({ ...x, status: x.status })));
    setUseCaseSubs((data.useCaseSubmissions || []).map((x: any) => ({ ...x, status: x.status })));
    setFeedbackMap(prev => ({ ...prev, [id]: '' }));
  };

  const toggleReflectionReviewed = async (id: string, current: boolean) => {
    await fetch(`/api/trainer/reflections/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_reviewed: !current, reviewer_id: profile?.id }),
    });
    // reload
    const res = await fetch(`/api/trainer/reflections?trainerProfileId=${profile?.id}`, { cache: 'no-store' });
    const data = await res.json();
    setReflections(data.reflections || []);
  };

  const toggleSubmissionReviewed = async (id: string, current: boolean) => {
    await fetch(`/api/trainer/quiz-submissions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_reviewed: !current }),
    });
    // reload
    const res = await fetch(`/api/trainer/quiz-submissions?trainerProfileId=${profile?.id}&onlyPending=${pendingFilter === 'pending'}`);
    const data = await res.json();
    setQuizzes(data.submissions || []);
  };

  const forcedView = viewParam === 'enablers' || viewParam === 'usecases' || viewParam === 'quizzes' || viewParam === 'reflections';

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <h1 className="text-2xl font-bold">Offen Review</h1>
      <div className="flex flex-wrap items-center gap-2">
        {!forcedView ? (
          <>
            <button className={`rounded-md border px-3 py-1 text-sm ${activeTab==='enablers'?'bg-primary text-white':'bg-background'}`} onClick={() => setActiveTab('enablers')}>Enabler</button>
            <button className={`rounded-md border px-3 py-1 text-sm ${activeTab==='usecases'?'bg-primary text-white':'bg-background'}`} onClick={() => setActiveTab('usecases')}>Use Cases</button>
            <button className={`rounded-md border px-3 py-1 text-sm ${activeTab==='quizzes'?'bg-primary text-white':'bg-background'}`} onClick={() => setActiveTab('quizzes')}>Quizzes</button>
            <button className={`rounded-md border px-3 py-1 text-sm ${activeTab==='reflections'?'bg-primary text-white':'bg-background'}`} onClick={() => setActiveTab('reflections')}>Reflections</button>
          </>
        ) : (
          <div className="rounded-md border px-3 py-1 text-sm bg-background">
            {activeTab === 'enablers' ? 'Enabler' : activeTab === 'usecases' ? 'Use Cases' : activeTab === 'quizzes' ? 'Quizzes' : 'Reflections'}
          </div>
        )}

        {activeTab === 'enablers' || activeTab === 'usecases' ? (
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span>Filter:</span>
            <select value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value as any)} className="rounded-md border px-2 py-1">
              <option value="all">Alle</option>
              <option value="pending">Offen</option>
              <option value="approved">Genehmigt</option>
              <option value="rejected">Abgelehnt</option>
            </select>
          </div>
        ) : (
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span>Filter:</span>
            <select value={pendingFilter} onChange={(e)=>setPendingFilter(e.target.value as any)} className="rounded-md border px-2 py-1">
              <option value="pending">Offen</option>
              <option value="all">Alle</option>
            </select>
            {activeTab==='quizzes' && (
              <>
                <span>Typ:</span>
                <select value={quizTypeFilter} onChange={(e)=>setQuizTypeFilter(e.target.value as any)} className="rounded-md border px-2 py-1">
                  <option value="all">Alle</option>
                  <option value="ENABLER">Enabler</option>
                  <option value="GLOBAL">Global</option>
                </select>
              </>
            )}
          </div>
        )}
      </div>

      {loading && <div>Lade…</div>}
      {error && <div className="text-red-500">{error}</div>}

      {!loading && activeTab==='enablers' && (
        <div className="space-y-4">
          {filteredEnablers.length === 0 && <div className="text-sm text-muted-foreground">Keine Einreichungen</div>}
          {filteredEnablers.map(it => (
            <div key={it.id} className="rounded-md border p-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{it.enablerTitle}</div>
                <div className={`text-xs rounded-full px-2 py-1 border ${it.status==='PENDING'?'border-yellow-500 text-yellow-600': it.status==='APPROVED'?'border-green-500 text-green-600':'border-red-500 text-red-600'}`}>{it.status}</div>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{it.traineeName} • Eingereicht am {new Date(it.submittedAt).toLocaleString()}</div>
              {it.solutionText && (
                <div className="mt-3">
                  <div className="text-sm font-medium">Lösung</div>
                  <p className="whitespace-pre-line text-sm">{it.solutionText}</p>
                </div>
              )}
              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium">Feedback</label>
                <textarea className="w-full rounded-md border px-3 py-2" rows={3} value={feedbackMap[it.id] || ''} onChange={e => setFeedbackMap(prev => ({ ...prev, [it.id]: e.target.value }))} />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button className="rounded-md border px-3 py-2" onClick={()=>reviewItem('enabler', it.id, 'REJECTED')}>Ablehnen</button>
                <button className="rounded-md bg-primary text-white px-3 py-2" onClick={()=>reviewItem('enabler', it.id, 'APPROVED')}>Genehmigen</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && activeTab==='usecases' && (
        <div className="space-y-4">
          {filteredUseCases.length === 0 && <div className="text-sm text-muted-foreground">Keine Einreichungen</div>}
          {filteredUseCases.map(it => (
            <div key={it.id} className="rounded-md border p-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{it.useCaseTitle}</div>
                <div className={`text-xs rounded-full px-2 py-1 border ${it.status==='PENDING'?'border-yellow-500 text-yellow-600': it.status==='APPROVED'?'border-green-500 text-green-600':'border-red-500 text-red-600'}`}>{it.status}</div>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{it.traineeName} • Eingereicht am {new Date(it.submittedAt).toLocaleString()}</div>
              {it.submissionText && (
                <div className="mt-3">
                  <div className="text-sm font-medium">Lösung</div>
                  <p className="whitespace-pre-line text-sm">{it.submissionText}</p>
                </div>
              )}
              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium">Feedback</label>
                <textarea className="w-full rounded-md border px-3 py-2" rows={3} value={feedbackMap[it.id] || ''} onChange={e => setFeedbackMap(prev => ({ ...prev, [it.id]: e.target.value }))} />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button className="rounded-md border px-3 py-2" onClick={()=>reviewItem('usecase', it.id, 'REJECTED')}>Ablehnen</button>
                <button className="rounded-md bg-primary text-white px-3 py-2" onClick={()=>reviewItem('usecase', it.id, 'APPROVED')}>Genehmigen</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && activeTab==='quizzes' && (
        <div className="space-y-4">
          {quizzesFiltered.length === 0 && <div className="text-sm text-muted-foreground">Keine Quiz-Einreichungen.</div>}
          {quizzesFiltered.map(s => (
            <div key={s.id} className="rounded-md border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">{s.traineeName}</div>
                  <div className="text-xs text-muted-foreground">{new Date(s.submittedAt).toLocaleString()}</div>
                </div>
                <button onClick={() => toggleSubmissionReviewed(s.id, s.isReviewed)} className={`rounded-md px-3 py-2 text-sm ${s.isReviewed ? 'border border-green-600/40 text-green-600' : 'border border-gray-300'}`}>
                  {s.isReviewed ? (<span className="inline-flex items-center gap-1"><CheckCircle2 className="h-4 w-4"/> Bewertet</span>) : (<span className="inline-flex items-center gap-1"><Circle className="h-4 w-4"/> Als bewertet markieren</span>)}
                </button>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
                <div>
                  <div className="text-xs text-muted-foreground">Quiz</div>
                  <div className="text-sm">{s.quizTitle}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Typ</div>
                  <div className="text-sm">{s.quizType || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Score</div>
                  <div className="text-sm">{s.score ?? 0}%</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Status</div>
                  <div className="text-sm">{s.isReviewed ? 'Bewertet' : 'Offen'}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && activeTab==='reflections' && (
        <div className="space-y-4">
          {reflectionsFiltered.length === 0 && <div className="text-sm text-muted-foreground">Keine Reflektionen.</div>}
          {reflectionsFiltered.map(r => (
            <div key={r.id} className="rounded-md border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">{r.traineeName}</div>
                  <div className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</div>
                </div>
                <button onClick={() => toggleReflectionReviewed(r.id, r.isReviewed)} className={`rounded-md px-3 py-2 text-sm ${r.isReviewed ? 'border border-green-600/40 text-green-600' : 'border border-gray-300'}`}>
                  {r.isReviewed ? (<span className="inline-flex items-center gap-1"><CheckCircle2 className="h-4 w-4"/> Gelesen</span>) : (<span className="inline-flex items-center gap-1"><Circle className="h-4 w-4"/> Als gelesen markieren</span>)}
                </button>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <div className="text-xs text-muted-foreground">Stärken</div>
                  <div className="text-sm whitespace-pre-wrap">{r.strengths || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Schwächen</div>
                  <div className="text-sm whitespace-pre-wrap">{r.weaknesses || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Mehr davon</div>
                  <div className="text-sm whitespace-pre-wrap">{r.mesMore || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Gleich lassen</div>
                  <div className="text-sm whitespace-pre-wrap">{r.mesEqual || '-'}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
 
