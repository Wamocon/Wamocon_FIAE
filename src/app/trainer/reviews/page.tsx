'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { CheckCircle2, Circle, BookOpen, FileText, HelpCircle, MessageSquare, Scale } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

type EnablerReviewItem = { id: string; enablerId: string; enablerTitle: string; traineeId: string; traineeName: string; solutionText?: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED'; submittedAt: string; attemptNumber?: number|null };
type UseCaseReviewItem = { id: string; useCaseId: string; useCaseTitle: string; traineeId: string; traineeName: string; submissionText?: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED'; submittedAt: string; attemptNumber?: number|null };
type GesetzReviewItem = { id: string; gesetzesprozessId: string; gesetzesprozessTitle: string; traineeId: string; traineeName: string; submissionText?: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED'; submittedAt: string; attemptNumber?: number|null };
type ReflectionItem = { id: string; traineeId: string; traineeName: string; strengths: string | null; weaknesses: string | null; mesMore: string | null; mesEqual: string | null; isReviewed: boolean; createdAt: string };
type QuizSubmissionItem = { id: string; traineeId: string; traineeName: string; quizId: string; quizTitle: string; quizType?: 'LESSON' | 'GLOBAL'; score: number | null; isReviewed: boolean; submittedAt: string; attemptNumber?: number|null; difficulty?: 'LOW'|'MEDIUM'|'HIGH'|null; enablerTitle?: string|null };

export default function TrainerReviewsPage() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('view'); // 'enablers' | 'usecases' | 'quizzes' | 'reflections'
  const onlyPendingParam = searchParams.get('onlyPending'); // 'true' | 'false'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'enablers' | 'Geschäftsprozesse' | 'usecases' | 'quizzes' | 'reflections'>('enablers');

  // Enabler/UseCase state
  const [enablerSubs, setEnablerSubs] = useState<EnablerReviewItem[]>([]);
  const [useCaseSubs, setUseCaseSubs] = useState<UseCaseReviewItem[]>([]);
  const [gesetzSubs, setGesetzSubs] = useState<GesetzReviewItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [feedbackMap, setFeedbackMap] = useState<Record<string, string>>({});

  // Quiz/Reflection state
  const [reflections, setReflections] = useState<ReflectionItem[]>([]);
  const [quizzes, setQuizzes] = useState<QuizSubmissionItem[]>([]);
  const [pendingFilter, setPendingFilter] = useState<'pending' | 'all'>('pending');
  const [quizTypeFilter, setQuizTypeFilter] = useState<'all' | 'LESSON' | 'GLOBAL'>('all');

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
  const allowed = ['enablers', 'Geschäftsprozesse', 'usecases', 'quizzes', 'reflections'] as const;
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

  // load Enablers/UseCases/Geschäftsprozesse
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
  setEnablerSubs((data.enablerSubmissions || []).map((x: any) => ({ ...x, status: x.status, attemptNumber: x.attemptNumber })));
  setUseCaseSubs((data.useCaseSubmissions || []).map((x: any) => ({ ...x, status: x.status, attemptNumber: x.attemptNumber })));
        setGesetzSubs((data.gesetzesprozessSubmissions || []).map((x: any) => ({ ...x, status: x.status, attemptNumber: x.attemptNumber })));
      } catch (e: any) {
        setError(e?.message || 'Unbekannter Fehler');
      } finally {
        setLoading(false);
      }
    };
    if (activeTab === 'enablers' || activeTab === 'usecases' || activeTab === 'Geschäftsprozesse') loadEU();
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
          setQuizzes((data.submissions || []).map((x: any)=> ({ ...x, attemptNumber: x.attemptNumber, difficulty: x.difficulty || null, enablerTitle: x.enablerTitle || null })));
        }
      } catch (e: any) {
        setError(e.message || 'Unbekannter Fehler');
      } finally {
        setLoading(false);
      }
    };
    if (activeTab === 'reflections' || activeTab === 'quizzes') loadQR();
  }, [profile?.id, activeTab, pendingFilter]);

  const reviewItem = async (kind: 'enabler' | 'gesetzesprozess' | 'usecase', id: string, status: 'APPROVED' | 'REJECTED') => {
    if (!profile?.id) return;
    const feedback = feedbackMap[id] || '';
    const url = kind === 'enabler'
      ? `/api/trainer/reviews/enablers/${id}?trainerId=${profile.id}`
      : kind === 'usecase'
        ? `/api/trainer/reviews/use-cases/${id}?trainerId=${profile.id}`
        : `/api/trainer/reviews/Geschäftsprozesse/${id}?trainerId=${profile.id}`;
    const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, trainerFeedback: feedback }) });
    if (!r.ok) {
      alert('Konnte Review nicht speichern');
      return;
    }
    // Refresh the list with same filter
    const onlyPending = statusFilter === 'pending';
    const rr = await fetch(`/api/trainer/reviews?trainerId=${profile.id}&onlyPending=${onlyPending ? 'true' : 'false'}`, { cache: 'no-store' });
    const data = await rr.json();
  setEnablerSubs((data.enablerSubmissions || []).map((x: any) => ({ ...x, status: x.status, attemptNumber: x.attemptNumber })));
  setUseCaseSubs((data.useCaseSubmissions || []).map((x: any) => ({ ...x, status: x.status, attemptNumber: x.attemptNumber })));
    setGesetzSubs((data.gesetzesprozessSubmissions || []).map((x: any) => ({ ...x, status: x.status, attemptNumber: x.attemptNumber })));
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

  const forcedView = viewParam === 'enablers' || viewParam === 'Geschäftsprozesse' || viewParam === 'usecases' || viewParam === 'quizzes' || viewParam === 'reflections';

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="glass-effect rounded-3xl border border-accent/30 bg-black/40 p-5 shadow-lg">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h1 className="text-foreground text-xl font-bold">Offen Review</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {!forcedView ? (
          <>
            <button className={`rounded-xl border px-3 py-1.5 text-sm transition-colors ${activeTab==='enablers'?'bg-primary text-primary-foreground':'border-accent/30 bg-background/60 hover:bg-background/80'}`} onClick={() => setActiveTab('enablers')}>Enabler</button>
            <button className={`rounded-xl border px-3 py-1.5 text-sm transition-colors ${activeTab==='Geschäftsprozesse'?'bg-primary text-primary-foreground':'border-accent/30 bg-background/60 hover:bg-background/80'}`} onClick={() => setActiveTab('Geschäftsprozesse')}>Geschäftsprozesse</button>
            <button className={`rounded-xl border px-3 py-1.5 text-sm transition-colors ${activeTab==='usecases'?'bg-primary text-primary-foreground':'border-accent/30 bg-background/60 hover:bg-background/80'}`} onClick={() => setActiveTab('usecases')}>Use Cases</button>
            <button className={`rounded-xl border px-3 py-1.5 text-sm transition-colors ${activeTab==='quizzes'?'bg-primary text-primary-foreground':'border-accent/30 bg-background/60 hover:bg-background/80'}`} onClick={() => setActiveTab('quizzes')}>Quizzes</button>
            <button className={`rounded-xl border px-3 py-1.5 text-sm transition-colors ${activeTab==='reflections'?'bg-primary text-primary-foreground':'border-accent/30 bg-background/60 hover:bg-background/80'}`} onClick={() => setActiveTab('reflections')}>Reflections</button>
          </>
        ) : (
          <div className="rounded-xl border border-accent/30 bg-black/30 px-3 py-1.5 text-sm">
            {activeTab === 'enablers' ? 'Enabler' : activeTab === 'Geschäftsprozesse' ? 'Geschäftsprozesse' : activeTab === 'usecases' ? 'Use Cases' : activeTab === 'quizzes' ? 'Quizzes' : 'Reflections'}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2 text-sm">
          {activeTab === 'enablers' || activeTab === 'Geschäftsprozesse' || activeTab === 'usecases' ? (
            <>
              <span>Filter:</span>
              <select value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value as any)} className="rounded-xl border border-accent/30 bg-black/30 px-2 py-1">
                <option value="all">Alle</option>
                <option value="pending">Offen</option>
                <option value="approved">Genehmigt</option>
                <option value="rejected">Abgelehnt</option>
              </select>
            </>
          ) : (
            <>
              <span>Filter:</span>
              <select value={pendingFilter} onChange={(e)=>setPendingFilter(e.target.value as any)} className="rounded-xl border border-accent/30 bg-black/30 px-2 py-1">
                <option value="pending">Offen</option>
                <option value="all">Alle</option>
              </select>
              {activeTab==='quizzes' && (
                <>
                  <span>Type:</span>
                  <select value={quizTypeFilter} onChange={(e)=>setQuizTypeFilter(e.target.value as any)} className="rounded-xl border border-accent/30 bg-black/30 px-2 py-1">
                    <option value="all">Alle</option>
                    <option value="LESSON">Lesson</option>
                    <option value="GLOBAL">Global</option>
                  </select>
                </>
              )}
            </>
          )}
        </div>
        </div>
      </div>

      {loading && <div>Lade…</div>}
      {error && <div className="text-red-500">{error}</div>}

      {!loading && activeTab==='enablers' && (
        <div className="space-y-4">
          {filteredEnablers.length === 0 && <div className="text-sm text-muted-foreground">Keine Einreichungen</div>}
          {filteredEnablers.map(it => (
            <div key={it.id} className="group rounded-3xl border border-accent/30 bg-black/30 p-5 transition-all hover:border-accent/40 hover:shadow-md">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="from-accent to-primary flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white">
                    <BookOpen className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold">{it.enablerTitle}</div>
                    <div className="text-xs text-muted-foreground">{it.traineeName} • {new Date(it.submittedAt).toLocaleString()} {it.attemptNumber ? `• Versuch ${it.attemptNumber}` : ''}</div>
                  </div>
                </div>
                <div className={`text-xs rounded-full px-2.5 py-1 ${it.status==='PENDING'?'bg-yellow-100 text-yellow-800':'bg-green-100 text-green-800'} ${it.status==='REJECTED'?'bg-red-100 text-red-800':''}`}>{it.status}</div>
              </div>
              {it.solutionText && (
                <div className="mt-3 rounded-xl border border-accent/20 bg-black/20 p-3">
                  <div className="text-sm font-medium">Lösung</div>
                  <p className="whitespace-pre-line text-sm text-foreground/90">{it.solutionText}</p>
                </div>
              )}
              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium">Feedback</label>
                <textarea className="w-full rounded-xl border border-accent/30 bg-black/30 px-3 py-2" rows={3} value={feedbackMap[it.id] || ''} onChange={e => setFeedbackMap(prev => ({ ...prev, [it.id]: e.target.value }))} />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button className="rounded-md border border-accent/30 px-3 py-2" onClick={()=>reviewItem('enabler', it.id, 'REJECTED')}>Ablehnen</button>
                <button className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2" onClick={()=>reviewItem('enabler', it.id, 'APPROVED')}>Genehmigen</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && activeTab==='Geschäftsprozesse' && (
        <div className="space-y-4">
          {gesetzSubs.length === 0 && <div className="text-sm text-muted-foreground">Keine Einreichungen</div>}
          {gesetzSubs.map(it => (
            <div key={it.id} className="group rounded-3xl border border-accent/30 bg-black/30 p-5 transition-all hover:border-accent/40 hover:shadow-md">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="from-accent to-primary flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white">
                    <Scale className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold">{it.gesetzesprozessTitle}</div>
                    <div className="text-xs text-muted-foreground">{it.traineeName} • {new Date(it.submittedAt).toLocaleString()} {it.attemptNumber ? `• Versuch ${it.attemptNumber}` : ''}</div>
                  </div>
                </div>
                <div className={`text-xs rounded-full px-2.5 py-1 ${it.status==='PENDING'?'bg-yellow-100 text-yellow-800':'bg-green-100 text-green-800'} ${it.status==='REJECTED'?'bg-red-100 text-red-800':''}`}>{it.status}</div>
              </div>
              {it.submissionText && (
                <div className="mt-3 rounded-xl border border-accent/20 bg-black/20 p-3">
                  <div className="text-sm font-medium">Lösung</div>
                  <p className="whitespace-pre-line text-sm text-foreground/90">{it.submissionText}</p>
                </div>
              )}
              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium">Feedback</label>
                <textarea className="w-full rounded-xl border border-accent/30 bg-black/30 px-3 py-2" rows={3} value={feedbackMap[it.id] || ''} onChange={e => setFeedbackMap(prev => ({ ...prev, [it.id]: e.target.value }))} />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button className="rounded-md border border-accent/30 px-3 py-2" onClick={()=>reviewItem('gesetzesprozess', it.id, 'REJECTED')}>Ablehnen</button>
                <button className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2" onClick={()=>reviewItem('gesetzesprozess', it.id, 'APPROVED')}>Genehmigen</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && activeTab==='usecases' && (
        <div className="space-y-4">
          {filteredUseCases.length === 0 && <div className="text-sm text-muted-foreground">Keine Einreichungen</div>}
          {filteredUseCases.map(it => (
            <div key={it.id} className="group rounded-3xl border border-accent/30 bg-black/30 p-5 transition-all hover:border-accent/40 hover:shadow-md">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="from-accent to-primary flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold">{it.useCaseTitle}</div>
                    <div className="text-xs text-muted-foreground">{it.traineeName} • {new Date(it.submittedAt).toLocaleString()} {it.attemptNumber ? `• Versuch ${it.attemptNumber}` : ''}</div>
                  </div>
                </div>
                <div className={`text-xs rounded-full px-2.5 py-1 ${it.status==='PENDING'?'bg-yellow-100 text-yellow-800':'bg-green-100 text-green-800'} ${it.status==='REJECTED'?'bg-red-100 text-red-800':''}`}>{it.status}</div>
              </div>
              {it.submissionText && (
                <div className="mt-3 rounded-xl border border-accent/20 bg-black/20 p-3">
                  <div className="text-sm font-medium">Lösung</div>
                  <p className="whitespace-pre-line text-sm text-foreground/90">{it.submissionText}</p>
                </div>
              )}
              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium">Feedback</label>
                <textarea className="w-full rounded-xl border border-accent/30 bg-black/30 px-3 py-2" rows={3} value={feedbackMap[it.id] || ''} onChange={e => setFeedbackMap(prev => ({ ...prev, [it.id]: e.target.value }))} />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button className="rounded-md border border-accent/30 px-3 py-2" onClick={()=>reviewItem('usecase', it.id, 'REJECTED')}>Ablehnen</button>
                <button className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2" onClick={()=>reviewItem('usecase', it.id, 'APPROVED')}>Genehmigen</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && activeTab==='quizzes' && (
        <div className="space-y-4">
          {quizzesFiltered.length === 0 && <div className="text-sm text-muted-foreground">Keine Quiz-Einreichungen.</div>}
          {quizzesFiltered.map(s => (
            <div key={s.id} className="group rounded-3xl border border-accent/30 bg-black/30 p-5 transition-all hover:border-accent/40 hover:shadow-md">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="from-accent to-primary flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white">
                    <HelpCircle className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold">{s.quizTitle}</div>
                    <div className="text-xs text-muted-foreground">{s.traineeName} • {new Date(s.submittedAt).toLocaleString()} {s.attemptNumber ? `• Versuch ${s.attemptNumber}` : ''}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">{s.quizType || '-'}</span>
                  {s.quizType === 'LESSON' && s.difficulty && (
                    <span className={`text-xs rounded-full px-2.5 py-1 ${s.difficulty==='LOW'?'bg-green-100 text-green-800': s.difficulty==='MEDIUM'?'bg-yellow-100 text-yellow-800':'bg-red-100 text-red-800'}`}>{s.difficulty}</span>
                  )}
                  <a href={`/trainer/reviews/quizzes/${s.id}`} className="rounded-md border border-accent/30 px-3 py-2 text-sm hover:bg-background/60">Details</a>
                  <button onClick={() => toggleSubmissionReviewed(s.id, s.isReviewed)} className={`rounded-md px-3 py-2 text-sm transition-colors ${s.isReviewed ? 'border border-green-600/40 text-green-600' : 'border border-accent/30 hover:bg-background/60'}`}>
                    {s.isReviewed ? (<span className="inline-flex items-center gap-1"><CheckCircle2 className="h-4 w-4"/> Bewertet</span>) : (<span className="inline-flex items-center gap-1"><Circle className="h-4 w-4"/> Als bewertet markieren</span>)}
                  </button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-5">
                <div>
                  <div className="text-xs text-muted-foreground">Teilnehmer</div>
                  <div className="text-sm">{s.traineeName}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Score</div>
                  <div className="text-sm">{s.score ?? 0}%</div>
                </div>
                {s.quizType==='LESSON' && (
                  <div>
                    <div className="text-xs text-muted-foreground">Enabler</div>
                    <div className="text-sm">{s.enablerTitle || '-'}</div>
                  </div>
                )}
                <div className="md:col-span-2">
                  <div className="text-xs text-muted-foreground">Fortschritt</div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-black/30">
                    <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, s.score ?? 0))}%` }} ></div>
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium">Feedback</label>
                <textarea
                  className="w-full rounded-xl border border-accent/30 bg-black/30 px-3 py-2"
                  rows={3}
                  value={feedbackMap[s.id] || ''}
                  onChange={(e) => setFeedbackMap(prev => ({ ...prev, [s.id]: e.target.value }))}
                  placeholder="Feedback an den Trainee"
                />
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={async () => {
                      const feedback = feedbackMap[s.id] || '';
                      await fetch(`/api/trainer/quiz-submissions/${s.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ trainer_feedback: feedback, reviewer_id: profile?.id }),
                      });
                      // Optionally refresh list
                      const res = await fetch(`/api/trainer/quiz-submissions?trainerProfileId=${profile?.id}&onlyPending=${pendingFilter === 'pending'}`);
                      const data = await res.json();
                      setQuizzes(data.submissions || []);
                    }}
                    className="rounded-md border border-accent/30 px-3 py-2 text-sm hover:bg-background/60"
                  >
                    Feedback speichern
                  </button>
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
            <div key={r.id} className="group rounded-3xl border border-accent/30 bg-black/30 p-5 transition-all hover:border-accent/40 hover:shadow-md">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="from-accent to-primary flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white">
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold">Reflexion von {r.traineeName}</div>
                    <div className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</div>
                  </div>
                </div>
                <button onClick={() => toggleReflectionReviewed(r.id, r.isReviewed)} className={`rounded-md px-3 py-2 text-sm transition-colors ${r.isReviewed ? 'border border-green-600/40 text-green-600' : 'border border-accent/30 hover:bg-background/60'}`}>
                  {r.isReviewed ? (<span className="inline-flex items-center gap-1"><CheckCircle2 className="h-4 w-4"/> Gelesen</span>) : (<span className="inline-flex items-center gap-1"><Circle className="h-4 w-4"/> Als gelesen markieren</span>)}
                </button>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <div className="text-xs text-muted-foreground">Stärken</div>
                  <div className="text-sm whitespace-pre-wrap rounded-lg border border-accent/20 bg-black/20 p-3">{r.strengths || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Schwächen</div>
                  <div className="text-sm whitespace-pre-wrap rounded-lg border border-accent/20 bg-black/20 p-3">{r.weaknesses || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Mehr davon</div>
                  <div className="text-sm whitespace-pre-wrap rounded-lg border border-accent/20 bg-black/20 p-3">{r.mesMore || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Gleich lassen</div>
                  <div className="text-sm whitespace-pre-wrap rounded-lg border border-accent/20 bg-black/20 p-3">{r.mesEqual || '-'}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
 
