'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { CheckCircle2, Circle, BookOpen, FileText, HelpCircle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

type EnablerReviewItem = { id: string; enablerId: string; enablerTitle: string; traineeId: string; traineeName: string; solutionText?: string | null; solutions?: Array<{ scenarioIndex: number; text: string }> | null; trainerFeedback?: string | null; feedbacks?: Array<{ scenarioIndex: number; feedback: string }> | null; status: 'PENDING' | 'APPROVED' | 'REJECTED'; submittedAt: string; attemptNumber?: number | null };
type UseCaseReviewItem = { id: string; useCaseId: string; useCaseTitle: string; traineeId: string; traineeName: string; submissionText?: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED'; submittedAt: string; attemptNumber?: number | null };
type QuizSubmissionItem = { id: string; traineeId: string; traineeName: string; quizId: string; quizTitle: string; quizType?: 'LESSON' | 'GLOBAL'; score: number | null; isReviewed: boolean; submittedAt: string; attemptNumber?: number | null; difficulty?: 'LOW' | 'MEDIUM' | 'HIGH' | null; enablerTitle?: string | null };

export default function TrainerReviewsPage() {
  const { profile } = useAuth();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('view'); // 'enablers' | 'usecases' | 'quizzes'
  const onlyPendingParam = searchParams.get('onlyPending'); // 'true' | 'false'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'enablers' | 'usecases' | 'quizzes'>('enablers');

  // Enabler/UseCase state
  const [enablerSubs, setEnablerSubs] = useState<EnablerReviewItem[]>([]);
  const [useCaseSubs, setUseCaseSubs] = useState<UseCaseReviewItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [feedbackMap, setFeedbackMap] = useState<Record<string, string>>({});
  const [feedbacksMap, setFeedbacksMap] = useState<Record<string, Array<{ scenarioIndex: number; feedback: string }>>>({});
  const [solutionIndexMap, setSolutionIndexMap] = useState<Record<string, number>>({});

  // Quiz state
  const [quizzes, setQuizzes] = useState<QuizSubmissionItem[]>([]);
  const [pendingFilter, setPendingFilter] = useState<'pending' | 'all'>('pending');
  const [quizTypeFilter, setQuizTypeFilter] = useState<'all' | 'LESSON' | 'GLOBAL'>('all');

  const filteredEnablers = useMemo(() => enablerSubs.filter(s => statusFilter === 'all' ? true : s.status.toLowerCase() === statusFilter), [enablerSubs, statusFilter]);
  const filteredUseCases = useMemo(() => useCaseSubs.filter(s => statusFilter === 'all' ? true : s.status.toLowerCase() === statusFilter), [useCaseSubs, statusFilter]);
  const quizzesFiltered = useMemo(() => quizzes.filter(q => {
    const pendingOk = pendingFilter === 'pending' ? !q.isReviewed : true;
    const typeOk = quizTypeFilter === 'all' ? true : q.quizType === quizTypeFilter;
    return pendingOk && typeOk;
  }), [quizzes, pendingFilter, quizTypeFilter]);

  // Sync state from URL params (deep-linking from dashboard)
  useEffect(() => {
    const allowed = ['enablers', 'usecases', 'quizzes'] as const;
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
        if (!r.ok) throw new Error(t('trainer.reviews.loadError'));
        const data = await r.json();
        setEnablerSubs((data.enablerSubmissions || []).map((x: any) => ({ ...x, status: x.status, attemptNumber: x.attemptNumber })));
        setUseCaseSubs((data.useCaseSubmissions || []).map((x: any) => ({ ...x, status: x.status, attemptNumber: x.attemptNumber })));
      } catch (e: any) {
        setError(e?.message || t('trainer.reviews.unknownError'));
      } finally {
        setLoading(false);
      }
    };
    if (activeTab === 'enablers' || activeTab === 'usecases') loadEU();
  }, [profile?.id, statusFilter, activeTab]);

  // load Quizzes
  useEffect(() => {
    const loadQR = async () => {
      if (!profile?.id) return;
      setLoading(true);
      setError(null);
      try {
        if (activeTab === 'quizzes') {
          const res = await fetch(`/api/trainer/quiz-submissions?trainerProfileId=${profile.id}&onlyPending=${pendingFilter === 'pending'}`);
          if (!res.ok) throw new Error(t('trainer.reviews.quizLoadError'));
          const data = await res.json();
          setQuizzes((data.submissions || []).map((x: any) => ({ ...x, attemptNumber: x.attemptNumber, difficulty: x.difficulty || null, enablerTitle: x.enablerTitle || null })));
        }
      } catch (e: any) {
        setError(e.message || t('trainer.reviews.unknownError'));
      } finally {
        setLoading(false);
      }
    };
    if (activeTab === 'quizzes') loadQR();
  }, [profile?.id, activeTab, pendingFilter]);

  const reviewItem = async (kind: 'enabler' | 'usecase', id: string, status: 'APPROVED' | 'REJECTED') => {
    if (!profile?.id) return;
    const feedback = feedbackMap[id] || '';
    const feedbacks = feedbacksMap[id] || [];
    const url = kind === 'enabler'
      ? `/api/trainer/reviews/enablers/${id}?trainerId=${profile.id}`
      : `/api/trainer/reviews/use-cases/${id}?trainerId=${profile.id}`;
    const body = kind === 'enabler' && feedbacks.length > 0
      ? { status, feedbacks: feedbacks.filter(f => f.feedback.trim().length > 0) }
      : { status, trainerFeedback: feedback };
    const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) {
      alert(t('trainer.reviews.saveError'));
      return;
    }
    // Refresh the list with same filter
    const onlyPending = statusFilter === 'pending';
    const rr = await fetch(`/api/trainer/reviews?trainerId=${profile.id}&onlyPending=${onlyPending ? 'true' : 'false'}`, { cache: 'no-store' });
    const data = await rr.json();
    setEnablerSubs((data.enablerSubmissions || []).map((x: any) => ({ ...x, status: x.status, attemptNumber: x.attemptNumber })));
    setUseCaseSubs((data.useCaseSubmissions || []).map((x: any) => ({ ...x, status: x.status, attemptNumber: x.attemptNumber })));
    setFeedbackMap(prev => ({ ...prev, [id]: '' }));
    setFeedbacksMap(prev => ({ ...prev, [id]: [] }));
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

  const forcedView = viewParam === 'enablers' || viewParam === 'usecases' || viewParam === 'quizzes';

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="glass-effect rounded-3xl border border-accent/30 bg-card/90 p-5 shadow-lg">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h1 className="text-foreground text-xl font-bold">{t('trainer.reviews.title')}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!forcedView ? (
            <>
              <button className={`rounded-xl border px-3 py-1.5 text-sm transition-colors ${activeTab === 'enablers' ? 'bg-primary text-primary-foreground' : 'border-accent/30 bg-background/60 hover:bg-background/80'}`} onClick={() => setActiveTab('enablers')}>{t('trainer.reviews.lesson')}</button>
              <button className={`rounded-xl border px-3 py-1.5 text-sm transition-colors ${activeTab === 'usecases' ? 'bg-primary text-primary-foreground' : 'border-accent/30 bg-background/60 hover:bg-background/80'}`} onClick={() => setActiveTab('usecases')}>{t('trainer.reviews.useCases')}</button>
              <button className={`rounded-xl border px-3 py-1.5 text-sm transition-colors ${activeTab === 'quizzes' ? 'bg-primary text-primary-foreground' : 'border-accent/30 bg-background/60 hover:bg-background/80'}`} onClick={() => setActiveTab('quizzes')}>{t('trainer.reviews.quizzes')}</button>
            </>
          ) : (
            <div className="rounded-xl border border-accent/30 bg-muted px-3 py-1.5 text-sm">
              {activeTab === 'enablers' ? t('trainer.reviews.lesson') : activeTab === 'usecases' ? t('trainer.reviews.useCases') : t('trainer.reviews.quizzes')}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2 text-sm">
            {activeTab === 'enablers' || activeTab === 'usecases' ? (
              <>
                <span>{t('trainer.reviews.filter')}</span>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="rounded-xl border border-accent/30 bg-background/50 px-2 py-1">
                  <option value="all">{t('trainer.reviews.all')}</option>
                  <option value="pending">{t('trainer.reviews.pending')}</option>
                  <option value="approved">{t('trainer.reviews.approved')}</option>
                  <option value="rejected">{t('trainer.reviews.rejected')}</option>
                </select>
              </>
            ) : (
              <>
                <span>{t('trainer.reviews.filter')}</span>
                <select value={pendingFilter} onChange={(e) => setPendingFilter(e.target.value as any)} className="rounded-xl border border-accent/30 bg-background/50 px-2 py-1">
                  <option value="pending">{t('trainer.reviews.pending')}</option>
                  <option value="all">{t('trainer.reviews.all')}</option>
                </select>
                {activeTab === 'quizzes' && (
                  <>
                    <span>{t('trainer.reviews.type')}</span>
                    <select value={quizTypeFilter} onChange={(e) => setQuizTypeFilter(e.target.value as any)} className="rounded-xl border border-accent/30 bg-background/50 px-2 py-1">
                      <option value="all">{t('trainer.reviews.all')}</option>
                      <option value="LESSON">{t('trainer.reviews.lesson')}</option>
                      <option value="GLOBAL">{t('trainer.reviews.global')}</option>
                    </select>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {loading && <div>{t('trainer.reviews.loading')}</div>}
      {error && <div className="text-red-500">{error}</div>}

      {!loading && activeTab === 'enablers' && (
        <div className="space-y-4">
          {filteredEnablers.length === 0 && <div className="text-sm text-muted-foreground">{t('trainer.reviews.noSubmissions')}</div>}
          {filteredEnablers.map(it => (
            <div key={it.id} className="group rounded-3xl border border-accent/30 bg-card p-5 transition-all hover:border-accent/40 hover:shadow-md">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="from-accent to-primary flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-foreground">
                    <BookOpen className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold">{it.enablerTitle}</div>
                    <div className="text-xs text-muted-foreground">{it.traineeName} • {new Date(it.submittedAt).toLocaleString()} {it.attemptNumber ? `• ${t('trainer.reviews.attempt').replace('{number}', String(it.attemptNumber))}` : ''}</div>
                  </div>
                </div>
                <div className={`text-xs rounded-full px-2.5 py-1 ${it.status === 'PENDING' ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' : 'bg-green-500/10 text-green-600 dark:text-green-400'} ${it.status === 'REJECTED' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : ''}`}>{it.status}</div>
              </div>
              {(it.solutions || it.solutionText) && (
                <div className="mt-3">
                  {it.solutions && it.solutions.length > 0 ? (
                    <div className="space-y-3">
                      {/* Counter */}
                      {it.solutions.length > 1 && (
                        <div className="text-center">
                          <span className="text-sm font-medium text-foreground">
                            {t('trainer.reviews.scenario').replace('{current}', String((solutionIndexMap[it.id] || 0) + 1)).replace('{total}', String(it.solutions.length))}
                          </span>
                        </div>
                      )}

                      {/* Solution and Feedback Slider */}
                      <div className="relative overflow-hidden">
                        <div
                          className="flex transition-transform duration-300 ease-in-out"
                          style={{ transform: `translateX(-${(solutionIndexMap[it.id] || 0) * 100}%)` }}
                        >
                          {it.solutions.map((sol, idx) => (
                            <div key={idx} className="w-full flex-shrink-0 px-2 space-y-3">
                              {/* Solution Box */}
                              <div className="rounded-xl border border-accent/20 bg-muted/30 p-4">
                                <div className="text-sm font-medium mb-2">{t('trainer.reviews.solutionFor').replace('{index}', String(sol.scenarioIndex + 1))}</div>
                                <p className="whitespace-pre-line text-sm text-foreground/90">{sol.text}</p>
                              </div>

                              {/* Feedback Box for this scenario */}
                              <div>
                                <label className="mb-1 block text-sm font-medium">{t('trainer.reviews.feedbackFor').replace('{index}', String(sol.scenarioIndex + 1))}</label>
                                <textarea
                                  className="w-full rounded-xl border border-accent/30 bg-muted/50 px-3 py-2"
                                  rows={3}
                                  value={feedbacksMap[it.id]?.find(f => f.scenarioIndex === sol.scenarioIndex)?.feedback || ''}
                                  onChange={e => {
                                    const newFeedbacks = [...(feedbacksMap[it.id] || [])];
                                    const existingIdx = newFeedbacks.findIndex(f => f.scenarioIndex === sol.scenarioIndex);
                                    if (existingIdx >= 0) {
                                      newFeedbacks[existingIdx] = { scenarioIndex: sol.scenarioIndex, feedback: e.target.value };
                                    } else {
                                      newFeedbacks.push({ scenarioIndex: sol.scenarioIndex, feedback: e.target.value });
                                    }
                                    setFeedbacksMap(prev => ({ ...prev, [it.id]: newFeedbacks }));
                                  }}
                                  placeholder={t('trainer.reviews.feedbackFor').replace('{index}', String(sol.scenarioIndex + 1))}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Navigation */}
                      {it.solutions.length > 1 && (
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            disabled={(solutionIndexMap[it.id] || 0) === 0}
                            onClick={() => setSolutionIndexMap(prev => ({ ...prev, [it.id]: Math.max(0, (prev[it.id] || 0) - 1) }))}
                            className="rounded-md border border-accent/30 px-3 py-1 text-xs hover:bg-accent/10 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {t('trainer.reviews.back')}
                          </button>

                          <div className="flex items-center gap-2">
                            {it.solutions.map((_, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => setSolutionIndexMap(prev => ({ ...prev, [it.id]: idx }))}
                                className={`h-2 rounded-full transition-all ${idx === (solutionIndexMap[it.id] || 0)
                                  ? 'w-6 bg-primary'
                                  : 'w-2 bg-accent/30 hover:bg-accent/50'
                                  }`}
                                aria-label={`Go to solution ${idx + 1}`}
                              />
                            ))}
                          </div>

                          <button
                            type="button"
                            disabled={(solutionIndexMap[it.id] || 0) === it.solutions.length - 1}
                            onClick={() => setSolutionIndexMap(prev => ({ ...prev, [it.id]: Math.min(it.solutions!.length - 1, (prev[it.id] || 0) + 1) }))}
                            className="rounded-md border border-accent/30 px-3 py-1 text-xs hover:bg-accent/10 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {t('trainer.reviews.next')}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : it.solutionText ? (
                    <>
                      <div className="rounded-xl border border-accent/20 bg-muted/30 p-3">
                        <div className="text-sm font-medium">{t('trainer.reviews.solution')}</div>
                        <p className="whitespace-pre-line text-sm text-foreground/90">{it.solutionText}</p>
                      </div>
                      <div className="mt-3">
                        <label className="mb-1 block text-sm font-medium">{t('trainer.reviews.feedback')}</label>
                        <textarea className="w-full rounded-xl border border-accent/30 bg-muted/50 px-3 py-2" rows={3} value={feedbackMap[it.id] || ''} onChange={e => setFeedbackMap(prev => ({ ...prev, [it.id]: e.target.value }))} />
                      </div>
                    </>
                  ) : null}
                </div>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <button className="rounded-md border border-accent/30 px-3 py-2" onClick={() => reviewItem('enabler', it.id, 'REJECTED')}>{t('trainer.reviews.reject')}</button>
                <button className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2" onClick={() => reviewItem('enabler', it.id, 'APPROVED')}>{t('trainer.reviews.approve')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && activeTab === 'usecases' && (
        <div className="space-y-4">
          {filteredUseCases.length === 0 && <div className="text-sm text-muted-foreground">{t('trainer.reviews.noSubmissions')}</div>}
          {filteredUseCases.map(it => (
            <div key={it.id} className="group rounded-3xl border border-accent/30 bg-card p-5 transition-all hover:border-accent/40 hover:shadow-md">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="from-accent to-primary flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-foreground">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold">{it.useCaseTitle}</div>
                    <div className="text-xs text-muted-foreground">{it.traineeName} • {new Date(it.submittedAt).toLocaleString()} {it.attemptNumber ? `• ${t('trainer.reviews.attempt').replace('{number}', String(it.attemptNumber))}` : ''}</div>
                  </div>
                </div>
                <div className={`text-xs rounded-full px-2.5 py-1 ${it.status === 'PENDING' ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' : 'bg-green-500/10 text-green-600 dark:text-green-400'} ${it.status === 'REJECTED' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : ''}`}>{it.status}</div>
              </div>
              {it.submissionText && (
                <div className="mt-3 rounded-xl border border-accent/20 bg-muted p-3">
                  <div className="text-sm font-medium">{t('trainer.reviews.solution')}</div>
                  <p className="whitespace-pre-line text-sm text-foreground/90">{it.submissionText}</p>
                </div>
              )}
              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium">{t('trainer.reviews.feedback')}</label>
                <textarea className="w-full rounded-xl border border-accent/30 bg-muted/50 px-3 py-2" rows={3} value={feedbackMap[it.id] || ''} onChange={e => setFeedbackMap(prev => ({ ...prev, [it.id]: e.target.value }))} />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button className="rounded-md border border-accent/30 px-3 py-2" onClick={() => reviewItem('usecase', it.id, 'REJECTED')}>{t('trainer.reviews.reject')}</button>
                <button className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2" onClick={() => reviewItem('usecase', it.id, 'APPROVED')}>{t('trainer.reviews.approve')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && activeTab === 'quizzes' && (
        <div className="space-y-4">
          {quizzesFiltered.length === 0 && <div className="text-sm text-muted-foreground">{t('trainer.reviews.noQuizSubmissions')}</div>}
          {quizzesFiltered.map(s => (
            <div key={s.id} className="group rounded-3xl border border-accent/30 bg-card p-5 transition-all hover:border-accent/40 hover:shadow-md">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="from-accent to-primary flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-foreground">
                    <HelpCircle className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold">{s.quizTitle}</div>
                    <div className="text-xs text-muted-foreground">{s.traineeName} • {new Date(s.submittedAt).toLocaleString()} {s.attemptNumber ? `• ${t('trainer.reviews.attempt').replace('{number}', String(s.attemptNumber))}` : ''}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs rounded-full bg-muted px-2.5 py-1 text-muted-foreground">{s.quizType || '-'}</span>
                  {s.quizType === 'LESSON' && s.difficulty && (
                    <span className={`text-xs rounded-full px-2.5 py-1 ${s.difficulty === 'LOW' ? 'bg-green-500/20 text-green-600 dark:text-green-400' : s.difficulty === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' : 'bg-red-500/20 text-red-600 dark:text-red-400'}`}>{s.difficulty}</span>
                  )}
                  <a href={`/trainer/reviews/quizzes/${s.id}`} className="rounded-md border border-accent/30 px-3 py-2 text-sm hover:bg-background/60">{t('trainer.reviews.details')}</a>
                  <button onClick={() => toggleSubmissionReviewed(s.id, s.isReviewed)} className={`rounded-md px-3 py-2 text-sm transition-colors ${s.isReviewed ? 'border border-green-600/40 text-green-600' : 'border border-accent/30 hover:bg-background/60'}`}>
                    {s.isReviewed ? (<span className="inline-flex items-center gap-1"><CheckCircle2 className="h-4 w-4" /> {t('trainer.reviews.reviewed')}</span>) : (<span className="inline-flex items-center gap-1"><Circle className="h-4 w-4" /> {t('trainer.reviews.markAsReviewed')}</span>)}
                  </button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-5">
                <div>
                  <div className="text-xs text-muted-foreground">{t('trainer.reviews.participant')}</div>
                  <div className="text-sm">{s.traineeName}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t('trainer.reviews.score')}</div>
                  <div className="text-sm">{s.score ?? 0}%</div>
                </div>
                {s.quizType === 'LESSON' && (
                  <div>
                    <div className="text-xs text-muted-foreground">{t('trainer.reviews.lesson')}</div>
                    <div className="text-sm">{s.enablerTitle || '-'}</div>
                  </div>
                )}
                <div className="md:col-span-2">
                  <div className="text-xs text-muted-foreground">{t('trainer.reviews.progress')}</div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                    <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, s.score ?? 0))}%` }} ></div>
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium">{t('trainer.reviews.feedback')}</label>
                <textarea
                  className="w-full rounded-xl border border-accent/30 bg-muted/50 px-3 py-2"
                  rows={3}
                  value={feedbackMap[s.id] || ''}
                  onChange={(e) => setFeedbackMap(prev => ({ ...prev, [s.id]: e.target.value }))}
                  placeholder={t('trainer.reviews.feedbackPlaceholder')}
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
                    {t('trainer.reviews.saveFeedback')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

