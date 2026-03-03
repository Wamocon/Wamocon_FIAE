'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  CheckCircle2,
  Circle,
  BookOpen,
  FileText,
  HelpCircle,
  Eye,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { FlipbookViewer } from '@/components/ui/FlipbookViewer';

type EnablerReviewItem = {
  id: string;
  enablerId: string;
  enablerTitle: string;
  traineeId: string;
  traineeName: string;
  solutionText?: string | null;
  solutions?: Array<{ scenarioIndex: number; text: string }> | null;
  trainerFeedback?: string | null;
  feedbacks?: Array<{ scenarioIndex: number; feedback: string }> | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  submittedAt: string;
  attemptNumber?: number | null;
};
type UseCaseReviewItem = {
  id: string;
  useCaseId: string;
  useCaseTitle: string;
  traineeId: string;
  traineeName: string;
  submissionText?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  submittedAt: string;
  attemptNumber?: number | null;
};
type QuizSubmissionItem = {
  id: string;
  traineeId: string;
  traineeName: string;
  quizId: string;
  quizTitle: string;
  quizType?: 'LESSON' | 'GLOBAL';
  score: number | null;
  isReviewed: boolean;
  submittedAt: string;
  attemptNumber?: number | null;
  difficulty?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  enablerTitle?: string | null;
};
type SolutionDocInfo = { url: string; title: string };

export default function TrainerReviewsPage() {
  const { profile } = useAuth();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('view'); // 'enablers' | 'usecases' | 'quizzes'
  const onlyPendingParam = searchParams.get('onlyPending'); // 'true' | 'false'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    'enablers' | 'usecases' | 'quizzes'
  >('enablers');

  // Enabler/UseCase state
  const [enablerSubs, setEnablerSubs] = useState<EnablerReviewItem[]>([]);
  const [useCaseSubs, setUseCaseSubs] = useState<UseCaseReviewItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'pending' | 'approved' | 'rejected'
  >('pending');
  const [feedbackMap, setFeedbackMap] = useState<Record<string, string>>({});
  const [feedbacksMap, setFeedbacksMap] = useState<
    Record<string, Array<{ scenarioIndex: number; feedback: string }>>
  >({});
  const [solutionIndexMap, setSolutionIndexMap] = useState<
    Record<string, number>
  >({});

  // Quiz state
  const [quizzes, setQuizzes] = useState<QuizSubmissionItem[]>([]);
  const [pendingFilter, setPendingFilter] = useState<'pending' | 'all'>(
    'pending'
  );
  const [quizTypeFilter, setQuizTypeFilter] = useState<
    'all' | 'LESSON' | 'GLOBAL'
  >('all');

  // Double-click protection: track IDs currently being processed
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  // IDs that are fading out after optimistic update (visual transition before removal)
  const [fadingOutIds, setFadingOutIds] = useState<Set<string>>(new Set());
  // Tracks which already-reviewed items are currently being edited
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());

  // Solution document state for use cases (TRAINER_SOLUTION PDFs)
  const [solutionDocsMap, setSolutionDocsMap] = useState<
    Record<string, SolutionDocInfo | null>
  >({});
  const [flipbookState, setFlipbookState] = useState<{
    isOpen: boolean;
    url: string;
    title: string;
  }>({ isOpen: false, url: '', title: '' });
  const [loadingActions, setLoadingActions] = useState<
    Record<string, 'APPROVED' | 'REJECTED' | null>
  >({});

  const filteredEnablers = useMemo(
    () =>
      enablerSubs.filter(s =>
        statusFilter === 'all' ? true : s.status.toLowerCase() === statusFilter
      ),
    [enablerSubs, statusFilter]
  );
  const filteredUseCases = useMemo(
    () =>
      useCaseSubs.filter(s =>
        statusFilter === 'all' ? true : s.status.toLowerCase() === statusFilter
      ),
    [useCaseSubs, statusFilter]
  );
  const quizzesFiltered = useMemo(
    () =>
      quizzes.filter(q => {
        const pendingOk = pendingFilter === 'pending' ? !q.isReviewed : true;
        const typeOk =
          quizTypeFilter === 'all' ? true : q.quizType === quizTypeFilter;
        return pendingOk && typeOk;
      }),
    [quizzes, pendingFilter, quizTypeFilter]
  );

  // Fetch solution document (TRAINER_SOLUTION) for a use case
  // Use a ref to track which IDs are already fetched/loading to avoid re-triggering
  const fetchedDocIdsRef = useRef<Set<string>>(new Set());
  const fetchSolutionDoc = useCallback(async (useCaseId: string) => {
    if (fetchedDocIdsRef.current.has(useCaseId)) return;
    fetchedDocIdsRef.current.add(useCaseId);
    try {
      const res = await fetch(`/api/trainer/use-cases/${useCaseId}/documents`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        setSolutionDocsMap(prev => ({ ...prev, [useCaseId]: null }));
        return;
      }
      const data = await res.json();
      const solutionDoc = (data.documents || []).find(
        (d: any) => d.documentType === 'TRAINER_SOLUTION'
      );
      if (solutionDoc?.storageUrl) {
        setSolutionDocsMap(prev => ({
          ...prev,
          [useCaseId]: {
            url: solutionDoc.storageUrl,
            title: solutionDoc.title || 'Solution PDF',
          },
        }));
      } else {
        setSolutionDocsMap(prev => ({ ...prev, [useCaseId]: null }));
      }
    } catch {
      setSolutionDocsMap(prev => ({ ...prev, [useCaseId]: null }));
    }
  }, []);

  // Load solution documents when use case submissions change
  useEffect(() => {
    if (activeTab !== 'usecases' || useCaseSubs.length === 0) return;
    const uniqueIds = Array.from(new Set(useCaseSubs.map(s => s.useCaseId)));
    uniqueIds.forEach(id => fetchSolutionDoc(id));
  }, [useCaseSubs, activeTab, fetchSolutionDoc]);

  const openFlipbook = (url: string, title: string) =>
    setFlipbookState({ isOpen: true, url, title });
  const closeFlipbook = () =>
    setFlipbookState({ isOpen: false, url: '', title: '' });

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
        const r = await fetch(
          `/api/trainer/reviews?trainerId=${profile.id}&onlyPending=${onlyPending ? 'true' : 'false'}`,
          { cache: 'no-store' }
        );
        if (!r.ok) throw new Error(t('trainer.reviews.loadError'));
        const data = await r.json();
        setEnablerSubs(
          (data.enablerSubmissions || []).map((x: any) => ({
            ...x,
            status: x.status,
            attemptNumber: x.attemptNumber,
          }))
        );
        setUseCaseSubs(
          (data.useCaseSubmissions || []).map((x: any) => ({
            ...x,
            status: x.status,
            attemptNumber: x.attemptNumber,
          }))
        );

        // Pre-fill feedback maps
        const newFeedback: Record<string, string> = {};
        const newFeedbacks: Record<string, any[]> = {};
        [
          ...(data.enablerSubmissions || []),
          ...(data.useCaseSubmissions || []),
        ].forEach(s => {
          if (s.trainerFeedback) newFeedback[s.id] = s.trainerFeedback;
          if (s.feedbacks) newFeedbacks[s.id] = s.feedbacks;
        });
        setFeedbackMap(prev => ({ ...prev, ...newFeedback }));
        setFeedbacksMap(prev => ({ ...prev, ...newFeedbacks }));
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
          const res = await fetch(
            `/api/trainer/quiz-submissions?trainerProfileId=${profile.id}&onlyPending=${pendingFilter === 'pending'}`,
            { cache: 'no-store' }
          );
          if (!res.ok) throw new Error(t('trainer.reviews.quizLoadError'));
          const data = await res.json();
          const subs = (data.submissions || []).map((x: any) => ({
            ...x,
            attemptNumber: x.attemptNumber,
            difficulty: x.difficulty || null,
            enablerTitle: x.enablerTitle || null,
          }));
          setQuizzes(subs);

          // Pre-fill quiz feedback
          const quizFeedback: Record<string, string> = {};
          subs.forEach((s: any) => {
            if (s.trainerFeedback) quizFeedback[s.id] = s.trainerFeedback;
          });
          setFeedbackMap(prev => ({ ...prev, ...quizFeedback }));
        }
      } catch (e: any) {
        setError(e.message || t('trainer.reviews.unknownError'));
      } finally {
        setLoading(false);
      }
    };
    if (activeTab === 'quizzes') loadQR();
  }, [profile?.id, activeTab, pendingFilter]);

  const reviewItem = async (
    kind: 'enabler' | 'usecase',
    id: string,
    status: 'APPROVED' | 'REJECTED'
  ) => {
    if (!profile?.id) return;
    setLoadingActions(prev => ({ ...prev, [id]: status }));

    // Save previous state for rollback
    const prevEnablers = enablerSubs;
    const prevUseCases = useCaseSubs;

    // Optimistic: immediately update status + start fade-out
    if (kind === 'enabler') {
      setEnablerSubs(prev =>
        prev.map(s => (s.id === id ? { ...s, status } : s))
      );
    } else {
      setUseCaseSubs(prev =>
        prev.map(s => (s.id === id ? { ...s, status } : s))
      );
    }
    setFadingOutIds(prev => new Set(prev).add(id));

    try {
      const feedback = feedbackMap[id] || '';
      const feedbacks = feedbacksMap[id] || [];
      const url =
        kind === 'enabler'
          ? `/api/trainer/reviews/enablers/${id}?trainerId=${profile.id}`
          : `/api/trainer/reviews/use-cases/${id}?trainerId=${profile.id}`;
      const body =
        kind === 'enabler' && feedbacks.length > 0
          ? {
              status,
              feedbacks: feedbacks.filter(f => f.feedback.trim().length > 0),
            }
          : { status, trainerFeedback: feedback };
      const r = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        // Rollback on failure
        setEnablerSubs(prevEnablers);
        setUseCaseSubs(prevUseCases);
        setFadingOutIds(prev => {
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
        toast.error(t('trainer.reviews.saveError'));
        return;
      }
      toast.success(
        status === 'APPROVED'
          ? t('trainer.reviews.approved')
          : t('trainer.reviews.rejected')
      );
      // Remove from editing mode on success
      setEditingIds(prev => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });

      // Background refresh (non-blocking) to sync with server
      const onlyPending = statusFilter === 'pending';
      fetch(
        `/api/trainer/reviews?trainerId=${profile.id}&onlyPending=${onlyPending ? 'true' : 'false'}`,
        { cache: 'no-store' }
      )
        .then(rr => rr.json())
        .then(data => {
          setEnablerSubs(
            (data.enablerSubmissions || []).map((x: any) => ({
              ...x,
              status: x.status,
              attemptNumber: x.attemptNumber,
            }))
          );
          setUseCaseSubs(
            (data.useCaseSubmissions || []).map((x: any) => ({
              ...x,
              status: x.status,
              attemptNumber: x.attemptNumber,
            }))
          );
          setFadingOutIds(prev => {
            const n = new Set(prev);
            n.delete(id);
            return n;
          });
        })
        .catch(() => {
          setFadingOutIds(prev => {
            const n = new Set(prev);
            n.delete(id);
            return n;
          });
        });
    } catch {
      // Rollback on network error
      setEnablerSubs(prevEnablers);
      setUseCaseSubs(prevUseCases);
      setFadingOutIds(prev => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      toast.error(t('trainer.reviews.saveError'));
    } finally {
      setLoadingActions(prev => ({ ...prev, [id]: null }));
    }
  };

  const toggleSubmissionReviewed = async (id: string, current: boolean) => {
    if (busyIds.has(id)) return;
    setBusyIds(prev => new Set(prev).add(id));

    // Save previous state for rollback
    const prevQuizzes = quizzes;

    // Optimistic: immediately toggle + fade-out if marking reviewed in pending filter
    setQuizzes(prev =>
      prev.map(q => (q.id === id ? { ...q, isReviewed: !current } : q))
    );
    if (!current && pendingFilter === 'pending') {
      setFadingOutIds(prev => new Set(prev).add(id));
    }

    try {
      const r = await fetch(`/api/trainer/quiz-submissions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_reviewed: !current,
          reviewer_id: profile?.id,
        }),
      });
      if (!r.ok) {
        // Rollback
        setQuizzes(prevQuizzes);
        setFadingOutIds(prev => {
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
        const errData = await r.json().catch(() => ({}));
        toast.error(errData?.error || t('trainer.reviews.saveError'));
        return;
      }
      toast.success(
        !current
          ? t('trainer.reviews.markedReviewed')
          : t('trainer.reviews.unmarkedReviewed')
      );

      // Background refresh (non-blocking)
      fetch(
        `/api/trainer/quiz-submissions?trainerProfileId=${profile?.id}&onlyPending=${pendingFilter === 'pending'}`,
        { cache: 'no-store' }
      )
        .then(res => res.json())
        .then(data => {
          setQuizzes(data.submissions || []);
          setFadingOutIds(prev => {
            const n = new Set(prev);
            n.delete(id);
            return n;
          });
        })
        .catch(() => {
          setFadingOutIds(prev => {
            const n = new Set(prev);
            n.delete(id);
            return n;
          });
        });
    } catch {
      // Rollback
      setQuizzes(prevQuizzes);
      setFadingOutIds(prev => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      toast.error(t('trainer.reviews.saveError'));
    } finally {
      setBusyIds(prev => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="glass-effect border-accent/30 bg-card/90 rounded-3xl border p-5 shadow-lg">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h1 className="text-foreground text-xl font-bold">
            {t('trainer.reviews.title')}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={`rounded-xl border px-3 py-1.5 text-sm transition-colors ${activeTab === 'enablers' ? 'bg-primary text-primary-foreground' : 'border-accent/30 bg-background/60 hover:bg-background/80'}`}
            onClick={() => setActiveTab('enablers')}
          >
            {t('trainer.reviews.lesson')}
          </button>
          <button
            className={`rounded-xl border px-3 py-1.5 text-sm transition-colors ${activeTab === 'usecases' ? 'bg-primary text-primary-foreground' : 'border-accent/30 bg-background/60 hover:bg-background/80'}`}
            onClick={() => setActiveTab('usecases')}
          >
            {t('trainer.reviews.useCases')}
          </button>
          <button
            className={`rounded-xl border px-3 py-1.5 text-sm transition-colors ${activeTab === 'quizzes' ? 'bg-primary text-primary-foreground' : 'border-accent/30 bg-background/60 hover:bg-background/80'}`}
            onClick={() => setActiveTab('quizzes')}
          >
            {t('trainer.reviews.quizzes')}
          </button>
          <div className="ml-auto flex items-center gap-2 text-sm">
            {activeTab === 'enablers' || activeTab === 'usecases' ? (
              <>
                <span>{t('trainer.reviews.filter')}</span>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as any)}
                  className="border-accent/30 bg-background/50 rounded-xl border px-2 py-1"
                >
                  <option value="all">{t('trainer.reviews.all')}</option>
                  <option value="pending">
                    {t('trainer.reviews.pending')}
                  </option>
                  <option value="approved">
                    {t('trainer.reviews.approved')}
                  </option>
                  <option value="rejected">
                    {t('trainer.reviews.rejected')}
                  </option>
                </select>
              </>
            ) : (
              <>
                <span>{t('trainer.reviews.filter')}</span>
                <select
                  value={pendingFilter}
                  onChange={e => setPendingFilter(e.target.value as any)}
                  className="border-accent/30 bg-background/50 rounded-xl border px-2 py-1"
                >
                  <option value="pending">
                    {t('trainer.reviews.pending')}
                  </option>
                  <option value="all">{t('trainer.reviews.all')}</option>
                </select>
                {activeTab === 'quizzes' && (
                  <>
                    <span>{t('trainer.reviews.type')}</span>
                    <select
                      value={quizTypeFilter}
                      onChange={e => setQuizTypeFilter(e.target.value as any)}
                      className="border-accent/30 bg-background/50 rounded-xl border px-2 py-1"
                    >
                      <option value="all">{t('trainer.reviews.all')}</option>
                      <option value="LESSON">
                        {t('trainer.reviews.lesson')}
                      </option>
                      <option value="GLOBAL">
                        {t('trainer.reviews.global')}
                      </option>
                    </select>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-4">
          <LoadingSpinner size="md" />
        </div>
      )}
      {error && <div className="text-red-500">{error}</div>}

      {!loading && activeTab === 'enablers' && (
        <div className="space-y-4">
          {filteredEnablers.length === 0 && (
            <div className="text-muted-foreground text-sm">
              {t('trainer.reviews.noSubmissions')}
            </div>
          )}
          {filteredEnablers.map(it => (
            <div
              key={it.id}
              className={`group border-accent/30 bg-card hover:border-accent/50 hover:shadow-accent/5 rounded-3xl border p-5 transition-all duration-200 hover:scale-[1.005] hover:shadow-lg ${fadingOutIds.has(it.id) ? 'pointer-events-none scale-[0.98] opacity-40' : ''}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="from-accent to-primary text-foreground flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br">
                    <BookOpen className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold">{it.enablerTitle}</div>
                    <div className="text-muted-foreground text-xs">
                      {it.traineeName} •{' '}
                      {new Date(it.submittedAt).toLocaleString()}{' '}
                      {it.attemptNumber
                        ? `• ${t('trainer.reviews.attempt').replace('{number}', String(it.attemptNumber))}`
                        : ''}
                    </div>
                  </div>
                </div>
                <div
                  className={`rounded-full px-2.5 py-1 text-xs ${it.status === 'PENDING' ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' : 'bg-green-500/10 text-green-600 dark:text-green-400'} ${it.status === 'REJECTED' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : ''}`}
                >
                  {it.status}
                </div>
              </div>
              {(it.solutions || it.solutionText) && (
                <div className="mt-3">
                  {it.solutions && it.solutions.length > 0 ? (
                    <div className="space-y-3">
                      {/* Counter */}
                      {it.solutions.length > 1 && (
                        <div className="text-center">
                          <span className="text-foreground text-sm font-medium">
                            {t('trainer.reviews.scenario')
                              .replace(
                                '{current}',
                                String((solutionIndexMap[it.id] || 0) + 1)
                              )
                              .replace('{total}', String(it.solutions.length))}
                          </span>
                        </div>
                      )}

                      {/* Solution and Feedback Slider */}
                      <div className="relative overflow-hidden">
                        <div
                          className="flex transition-transform duration-300 ease-in-out"
                          style={{
                            transform: `translateX(-${(solutionIndexMap[it.id] || 0) * 100}%)`,
                          }}
                        >
                          {it.solutions.map((sol, idx) => (
                            <div
                              key={idx}
                              className="w-full flex-shrink-0 space-y-3 px-2"
                            >
                              {/* Solution Box */}
                              <div className="border-accent/20 bg-muted/30 rounded-xl border p-4">
                                <div className="mb-2 text-sm font-medium">
                                  {(it.solutions?.length || 0) > 1
                                    ? t('trainer.reviews.solutionFor').replace(
                                        '{index}',
                                        String(sol.scenarioIndex + 1)
                                      )
                                    : t('enablerPage.summaryLabel') ||
                                      t('trainer.reviews.solution')}
                                </div>
                                <p className="text-foreground/90 text-sm whitespace-pre-line">
                                  {sol.text}
                                </p>
                              </div>

                              {/* Feedback Box for this scenario */}
                              <div>
                                <label className="mb-1 block text-sm font-medium">
                                  {(it.solutions?.length || 0) > 1
                                    ? t('trainer.reviews.feedbackFor').replace(
                                        '{index}',
                                        String(sol.scenarioIndex + 1)
                                      )
                                    : t('trainer.reviews.feedback')}
                                </label>
                                <textarea
                                  className="border-accent/30 bg-muted/50 w-full rounded-xl border px-3 py-2 disabled:opacity-80"
                                  rows={3}
                                  disabled={
                                    it.status !== 'PENDING' &&
                                    !editingIds.has(it.id)
                                  }
                                  value={
                                    feedbacksMap[it.id]?.find(
                                      f => f.scenarioIndex === sol.scenarioIndex
                                    )?.feedback || ''
                                  }
                                  onChange={e => {
                                    const newFeedbacks = [
                                      ...(feedbacksMap[it.id] || []),
                                    ];
                                    const existingIdx = newFeedbacks.findIndex(
                                      f => f.scenarioIndex === sol.scenarioIndex
                                    );
                                    if (existingIdx >= 0) {
                                      newFeedbacks[existingIdx] = {
                                        scenarioIndex: sol.scenarioIndex,
                                        feedback: e.target.value,
                                      };
                                    } else {
                                      newFeedbacks.push({
                                        scenarioIndex: sol.scenarioIndex,
                                        feedback: e.target.value,
                                      });
                                    }
                                    setFeedbacksMap(prev => ({
                                      ...prev,
                                      [it.id]: newFeedbacks,
                                    }));
                                  }}
                                  placeholder={
                                    (it.solutions?.length || 0) > 1
                                      ? t(
                                          'trainer.reviews.feedbackFor'
                                        ).replace(
                                          '{index}',
                                          String(sol.scenarioIndex + 1)
                                        )
                                      : t('trainer.reviews.feedbackPlaceholder')
                                  }
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
                            onClick={() =>
                              setSolutionIndexMap(prev => ({
                                ...prev,
                                [it.id]: Math.max(0, (prev[it.id] || 0) - 1),
                              }))
                            }
                            className="border-accent/30 hover:bg-accent/10 cursor-pointer rounded-md border px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {t('trainer.reviews.back')}
                          </button>

                          <div className="flex items-center gap-2">
                            {it.solutions.map((_, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() =>
                                  setSolutionIndexMap(prev => ({
                                    ...prev,
                                    [it.id]: idx,
                                  }))
                                }
                                className={`h-2 cursor-pointer rounded-full transition-all ${
                                  idx === (solutionIndexMap[it.id] || 0)
                                    ? 'bg-primary w-6'
                                    : 'bg-accent/30 hover:bg-accent/50 w-2'
                                }`}
                                aria-label={`Go to solution ${idx + 1}`}
                              />
                            ))}
                          </div>

                          <button
                            type="button"
                            disabled={
                              (solutionIndexMap[it.id] || 0) ===
                              it.solutions.length - 1
                            }
                            onClick={() =>
                              setSolutionIndexMap(prev => ({
                                ...prev,
                                [it.id]: Math.min(
                                  it.solutions!.length - 1,
                                  (prev[it.id] || 0) + 1
                                ),
                              }))
                            }
                            className="border-accent/30 hover:bg-accent/10 cursor-pointer rounded-md border px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {t('trainer.reviews.next')}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : it.solutionText ? (
                    <>
                      <div className="border-accent/20 bg-muted/30 rounded-xl border p-3">
                        <div className="text-sm font-medium">
                          {t('trainer.reviews.solution')}
                        </div>
                        <p className="text-foreground/90 text-sm whitespace-pre-line">
                          {it.solutionText}
                        </p>
                      </div>
                      <div className="mt-3">
                        <label className="mb-1 block text-sm font-medium">
                          {t('trainer.reviews.feedback')}
                        </label>
                        <textarea
                          className="border-accent/30 bg-muted/50 w-full rounded-xl border px-3 py-2 disabled:opacity-80"
                          rows={3}
                          disabled={
                            it.status !== 'PENDING' && !editingIds.has(it.id)
                          }
                          value={feedbackMap[it.id] || ''}
                          onChange={e =>
                            setFeedbackMap(prev => ({
                              ...prev,
                              [it.id]: e.target.value,
                            }))
                          }
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              )}
              <div className="mt-3 flex justify-end gap-2">
                {it.status !== 'PENDING' && !editingIds.has(it.id) ? (
                  <button
                    onClick={() =>
                      setEditingIds(prev => new Set(prev).add(it.id))
                    }
                    className="border-accent/30 hover:bg-accent/10 inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium transition-colors"
                  >
                    {t('common.edit') || 'Update Feedback'}
                  </button>
                ) : (
                  <>
                    <button
                      disabled={!!loadingActions[it.id]}
                      className="border-accent/30 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 disabled:opacity-60"
                      onClick={() => reviewItem('enabler', it.id, 'REJECTED')}
                    >
                      {loadingActions[it.id] === 'REJECTED' ? (
                        <div className="border-destructive/30 border-t-destructive h-3.5 w-3.5 animate-spin rounded-full border-2" />
                      ) : null}
                      {t('trainer.reviews.reject')}
                    </button>
                    <button
                      disabled={!!loadingActions[it.id]}
                      className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5 rounded-md px-3 py-2 disabled:opacity-60"
                      onClick={() => reviewItem('enabler', it.id, 'APPROVED')}
                    >
                      {loadingActions[it.id] === 'APPROVED' ? (
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      ) : null}
                      {t('trainer.reviews.approve')}
                    </button>
                    {it.status !== 'PENDING' && (
                      <button
                        onClick={() =>
                          setEditingIds(prev => {
                            const n = new Set(prev);
                            n.delete(it.id);
                            return n;
                          })
                        }
                        className="text-muted-foreground hover:text-foreground px-3 py-2 text-sm"
                      >
                        {t('common.cancel')}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && activeTab === 'usecases' && (
        <div className="space-y-4">
          {filteredUseCases.length === 0 && (
            <div className="text-muted-foreground text-sm">
              {t('trainer.reviews.noSubmissions')}
            </div>
          )}
          {filteredUseCases.map(it => (
            <div
              key={it.id}
              className={`group border-accent/30 bg-card hover:border-accent/50 hover:shadow-accent/5 rounded-3xl border p-5 transition-all duration-200 hover:scale-[1.005] hover:shadow-lg ${fadingOutIds.has(it.id) ? 'pointer-events-none scale-[0.98] opacity-40' : ''}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="from-accent to-primary text-foreground flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold">{it.useCaseTitle}</div>
                    <div className="text-muted-foreground text-xs">
                      {it.traineeName} •{' '}
                      {new Date(it.submittedAt).toLocaleString()}{' '}
                      {it.attemptNumber
                        ? `• ${t('trainer.reviews.attempt').replace('{number}', String(it.attemptNumber))}`
                        : ''}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {solutionDocsMap[it.useCaseId] && (
                    <button
                      onClick={() =>
                        openFlipbook(
                          solutionDocsMap[it.useCaseId]!.url,
                          solutionDocsMap[it.useCaseId]!.title
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-500/20 dark:text-blue-400"
                      title={t('trainer.reviews.viewSolution')}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {t('trainer.reviews.solutionPdf')}
                    </button>
                  )}
                  <div
                    className={`rounded-full px-2.5 py-1 text-xs ${it.status === 'PENDING' ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' : 'bg-green-500/10 text-green-600 dark:text-green-400'} ${it.status === 'REJECTED' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : ''}`}
                  >
                    {it.status}
                  </div>
                </div>
              </div>
              {it.submissionText && (
                <div className="border-accent/20 bg-muted mt-3 rounded-xl border p-3">
                  <div className="text-sm font-medium">
                    {t('trainer.reviews.solution')}
                  </div>
                  <p className="text-foreground/90 text-sm whitespace-pre-line">
                    {it.submissionText}
                  </p>
                </div>
              )}
              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium">
                  {t('trainer.reviews.feedback')}
                </label>
                <textarea
                  className="border-accent/30 bg-muted/50 w-full rounded-xl border px-3 py-2 disabled:opacity-80"
                  rows={3}
                  disabled={it.status !== 'PENDING' && !editingIds.has(it.id)}
                  value={feedbackMap[it.id] || ''}
                  onChange={e =>
                    setFeedbackMap(prev => ({
                      ...prev,
                      [it.id]: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                {it.status !== 'PENDING' && !editingIds.has(it.id) ? (
                  <button
                    onClick={() =>
                      setEditingIds(prev => new Set(prev).add(it.id))
                    }
                    className="border-accent/30 hover:bg-accent/10 inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium transition-colors"
                  >
                    {t('common.edit') || 'Update Feedback'}
                  </button>
                ) : (
                  <>
                    <button
                      disabled={!!loadingActions[it.id]}
                      className="border-accent/30 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 disabled:opacity-60"
                      onClick={() => reviewItem('usecase', it.id, 'REJECTED')}
                    >
                      {loadingActions[it.id] === 'REJECTED' ? (
                        <div className="border-destructive/30 border-t-destructive h-3.5 w-3.5 animate-spin rounded-full border-2" />
                      ) : null}
                      {t('trainer.reviews.reject')}
                    </button>
                    <button
                      disabled={!!loadingActions[it.id]}
                      className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5 rounded-md px-3 py-2 disabled:opacity-60"
                      onClick={() => reviewItem('usecase', it.id, 'APPROVED')}
                    >
                      {loadingActions[it.id] === 'APPROVED' ? (
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      ) : null}
                      {t('trainer.reviews.approve')}
                    </button>
                    {it.status !== 'PENDING' && (
                      <button
                        onClick={() =>
                          setEditingIds(prev => {
                            const n = new Set(prev);
                            n.delete(it.id);
                            return n;
                          })
                        }
                        className="text-muted-foreground hover:text-foreground px-3 py-2 text-sm"
                      >
                        {t('common.cancel')}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && activeTab === 'quizzes' && (
        <div className="space-y-4">
          {quizzesFiltered.length === 0 && (
            <div className="text-muted-foreground text-sm">
              {t('trainer.reviews.noQuizSubmissions')}
            </div>
          )}
          {quizzesFiltered.map(s => (
            <div
              key={s.id}
              className={`group border-accent/30 bg-card hover:border-accent/50 hover:shadow-accent/5 rounded-3xl border p-5 transition-all duration-200 hover:scale-[1.005] hover:shadow-lg ${fadingOutIds.has(s.id) ? 'pointer-events-none scale-[0.98] opacity-40' : ''}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="from-accent to-primary text-foreground flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br">
                    <HelpCircle className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold">{s.quizTitle}</div>
                    <div className="text-muted-foreground text-xs">
                      {s.traineeName} •{' '}
                      {new Date(s.submittedAt).toLocaleString()}{' '}
                      {s.attemptNumber
                        ? `• ${t('trainer.reviews.attempt').replace('{number}', String(s.attemptNumber))}`
                        : ''}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-xs">
                    {s.quizType || '-'}
                  </span>
                  {s.quizType === 'LESSON' && s.difficulty && (
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs ${s.difficulty === 'LOW' ? 'bg-green-500/20 text-green-600 dark:text-green-400' : s.difficulty === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' : 'bg-red-500/20 text-red-600 dark:text-red-400'}`}
                    >
                      {s.difficulty}
                    </span>
                  )}
                  <a
                    href={`/trainer/reviews/quizzes/${s.id}`}
                    className="border-accent/30 hover:border-accent/60 hover:bg-accent/10 hover:text-accent rounded-md border px-3 py-2 text-sm transition-all duration-200"
                  >
                    {t('trainer.reviews.details')}
                  </a>
                  <button
                    disabled={busyIds.has(s.id)}
                    onClick={() => toggleSubmissionReviewed(s.id, s.isReviewed)}
                    className={`rounded-md px-3 py-2 text-sm transition-colors disabled:opacity-50 ${s.isReviewed ? 'border border-green-600/40 text-green-600' : 'border-accent/30 hover:bg-background/60 border'}`}
                  >
                    {s.isReviewed ? (
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-4 w-4" />{' '}
                        {t('trainer.reviews.reviewed')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Circle className="h-4 w-4" />{' '}
                        {t('trainer.reviews.markAsReviewed')}
                      </span>
                    )}
                  </button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-5">
                <div>
                  <div className="text-muted-foreground text-xs">
                    {t('trainer.reviews.participant')}
                  </div>
                  <div className="text-sm">{s.traineeName}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">
                    {t('trainer.reviews.score')}
                  </div>
                  <div className="text-sm">{s.score ?? 0}%</div>
                </div>
                {s.quizType === 'LESSON' && (
                  <div>
                    <div className="text-muted-foreground text-xs">
                      {t('trainer.reviews.lesson')}
                    </div>
                    <div className="text-sm">{s.enablerTitle || '-'}</div>
                  </div>
                )}
                <div className="md:col-span-2">
                  <div className="text-muted-foreground text-xs">
                    {t('trainer.reviews.progress')}
                  </div>
                  <div className="bg-muted mt-1 h-1.5 w-full rounded-full">
                    <div
                      className="bg-primary h-1.5 rounded-full"
                      style={{
                        width: `${Math.max(0, Math.min(100, s.score ?? 0))}%`,
                      }}
                    ></div>
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium">
                  {t('trainer.reviews.feedback')}
                </label>
                <textarea
                  className="border-accent/30 bg-muted/50 w-full rounded-xl border px-3 py-2 disabled:opacity-80"
                  rows={3}
                  disabled={s.isReviewed && !editingIds.has(s.id)}
                  value={feedbackMap[s.id] || ''}
                  onChange={e =>
                    setFeedbackMap(prev => ({
                      ...prev,
                      [s.id]: e.target.value,
                    }))
                  }
                  placeholder={t('trainer.reviews.feedbackPlaceholder')}
                />
                <div className="mt-2 flex justify-end gap-2">
                  {s.isReviewed && !editingIds.has(s.id) ? (
                    <button
                      onClick={() =>
                        setEditingIds(prev => new Set(prev).add(s.id))
                      }
                      className="border-accent/30 hover:bg-accent/10 text-foreground rounded-md border px-4 py-2 text-sm font-medium transition-colors"
                    >
                      {t('common.edit') || 'Update Feedback'}
                    </button>
                  ) : (
                    <>
                      <button
                        disabled={busyIds.has(s.id)}
                        onClick={async () => {
                          if (busyIds.has(s.id)) return;
                          const feedback = feedbackMap[s.id] || '';
                          if (!feedback.trim()) {
                            toast.error(t('trainer.reviews.feedbackEmpty'));
                            return;
                          }
                          setBusyIds(prev => new Set(prev).add(s.id));
                          try {
                            const r = await fetch(
                              `/api/trainer/quiz-submissions/${s.id}`,
                              {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  trainer_feedback: feedback,
                                  reviewer_id: profile?.id,
                                }),
                              }
                            );
                            if (!r.ok) {
                              toast.error(t('trainer.reviews.saveError'));
                              return;
                            }
                            toast.success(t('trainer.reviews.feedbackSaved'));
                            // Remove from editing mode on success
                            setEditingIds(prev => {
                              const n = new Set(prev);
                              n.delete(s.id);
                              return n;
                            });
                            const res = await fetch(
                              `/api/trainer/quiz-submissions?trainerProfileId=${profile?.id}&onlyPending=${pendingFilter === 'pending'}`,
                              { cache: 'no-store' }
                            );
                            const data = await res.json();
                            setQuizzes(data.submissions || []);
                          } catch {
                            toast.error(t('trainer.reviews.saveError'));
                          } finally {
                            setBusyIds(prev => {
                              const n = new Set(prev);
                              n.delete(s.id);
                              return n;
                            });
                          }
                        }}
                        className="border-accent/30 hover:bg-background/60 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                      >
                        {t('trainer.reviews.saveFeedback')}
                      </button>
                      {s.isReviewed && (
                        <button
                          onClick={() =>
                            setEditingIds(prev => {
                              const n = new Set(prev);
                              n.delete(s.id);
                              return n;
                            })
                          }
                          className="text-muted-foreground hover:text-foreground px-3 py-2 text-sm"
                        >
                          {t('common.cancel')}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Solution PDF Flipbook Viewer */}
      <FlipbookViewer
        pdfUrl={flipbookState.url}
        title={flipbookState.title}
        isOpen={flipbookState.isOpen}
        onClose={closeFlipbook}
      />
    </div>
  );
}
