'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { MessageSquare, Award } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useState, useMemo } from 'react';

type EnablerResult = {
  id: string;
  enablerId: string;
  enablerTitle: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  trainerFeedback?: string | null;
  feedbacks?: Array<{ scenarioIndex: number; feedback: string }> | null;
  solutionText?: string | null;
  solutions?: Array<{ scenarioIndex: number; text: string }> | null;
  submittedAt: string;
  reviewedAt?: string | null;
  attemptNumber?: number | null;
};
type UseCaseResult = {
  id: string;
  useCaseId: string;
  useCaseTitle: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  trainerFeedback?: string | null;
  submittedAt: string;
  reviewedAt?: string | null;
  attemptNumber?: number | null;
};
type EnablerQuizResult = {
  id: string;
  enablerId: string;
  enablerTitle: string;
  quizId: string;
  quizTitle: string;
  score: number | null;
  submittedAt: string;
  trainerFeedback?: string | null;
  attemptNumber?: number | null;
};
type GlobalQuizResult = {
  id: string;
  quizId: string;
  quizTitle: string;
  score: number | null;
  submittedAt: string;
  trainerFeedback?: string | null;
  attemptNumber?: number | null;
};

export default function TraineeFeedbackPage() {
  const { profile, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const [solutionIndexMap, setSolutionIndexMap] = useState<
    Record<string, number>
  >({});

  type FeedbackResponse = {
    enablerResults: EnablerResult[];
    useCaseResults: UseCaseResult[];
    enablerQuizResults: EnablerQuizResult[];
    globalQuizResults: GlobalQuizResult[];
  };

  const { data, isLoading: dataLoading } = useApiQuery<FeedbackResponse>(
    profile?.id ? `/api/trainee/feedback?traineeId=${profile.id}` : null
  );

  const enablers = data?.enablerResults || [];
  const useCases = data?.useCaseResults || [];
  const quizzes = useMemo(
    () =>
      (data?.enablerQuizResults || []).map(q => ({
        ...q,
        trainerFeedback: (q as any).trainerFeedback ?? null,
        attemptNumber: (q as any).attemptNumber ?? null,
      })),
    [data?.enablerQuizResults]
  );
  const globalQuizzes = useMemo(
    () =>
      (data?.globalQuizResults || []).map(g => ({
        ...g,
        trainerFeedback: (g as any).trainerFeedback ?? null,
        attemptNumber: (g as any).attemptNumber ?? null,
      })),
    [data?.globalQuizResults]
  );

  const loading = authLoading || dataLoading;

  if (loading) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4">
            <LoadingSpinner size="md" />
          </div>
          <p className="text-muted-foreground">{t('quiz.userNotFound')}</p>
        </div>
      </div>
    );
  }

  if (profile.role !== 'trainee') {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4">
            <LoadingSpinner size="md" />
          </div>
          <p className="text-muted-foreground">{t('quiz.accessDenied')}</p>
        </div>
      </div>
    );
  }

  const statusPill = (s: 'PENDING' | 'APPROVED' | 'REJECTED') => (
    <span
      className={`rounded-full border px-2 py-1 text-xs ${s === 'PENDING' ? 'border-yellow-500 text-yellow-600' : s === 'APPROVED' ? 'border-green-500 text-green-600' : 'border-red-500 text-red-600'}`}
    >
      {s}
    </span>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-6">
          <div className="from-accent to-primary flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br">
            <MessageSquare className="text-foreground h-8 w-8" />
          </div>
          <div>
            <h1 className="text-foreground mb-2 text-3xl font-bold">
              {t('feedback.title')}
            </h1>
            <p className="text-muted">{t('feedback.description')}</p>
          </div>
        </div>
      </div>

      {/* Lesson submissions */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
        <h2 className="text-foreground mb-4 text-xl font-semibold">
          {t('feedback.lessonSubmissions')}
        </h2>
        {enablers.length === 0 ? (
          <div className="text-muted-foreground">
            {t('feedback.noSubmissions')}
          </div>
        ) : (
          <ul className="space-y-4">
            {enablers.map(e => (
              <li
                key={e.id}
                className="border-accent/20 bg-background/40 rounded-2xl border p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold">
                    {e.enablerTitle}
                    {e.attemptNumber ? (
                      <span className="border-accent/30 ml-2 rounded-full border px-2 py-0.5 text-xs">
                        {t('feedback.attempt').replace(
                          '{number}',
                          String(e.attemptNumber)
                        )}
                      </span>
                    ) : null}
                  </div>
                  {statusPill(e.status)}
                </div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {t('feedback.submittedOn').replace(
                    '{date}',
                    new Date(e.submittedAt).toLocaleString()
                  )}
                </div>

                {/* Show submitted solutions */}
                {(e.solutions || e.solutionText) && (
                  <div className="mt-3">
                    <div className="text-muted-foreground mb-2 text-xs font-medium">
                      {e.solutions && e.solutions.length > 1
                        ? t('feedback.yourSolutions')
                        : t('feedback.yourSolution')}
                    </div>
                    {e.solutions && e.solutions.length > 0 ? (
                      <div className="space-y-3">
                        {/* Counter */}
                        {e.solutions.length > 1 && (
                          <div className="text-center">
                            <span className="text-foreground text-sm font-medium">
                              {t('feedback.scenario')
                                .replace(
                                  '{index}',
                                  String((solutionIndexMap[e.id] || 0) + 1)
                                )
                                .replace('{total}', String(e.solutions.length))}
                            </span>
                          </div>
                        )}

                        {/* Solution and Feedback Slider */}
                        <div className="relative overflow-hidden">
                          <div
                            className="flex transition-transform duration-300 ease-in-out"
                            style={{
                              transform: `translateX(-${(solutionIndexMap[e.id] || 0) * 100}%)`,
                            }}
                          >
                            {e.solutions.map((sol, idx) => (
                              <div
                                key={idx}
                                className="w-full flex-shrink-0 space-y-3 px-2"
                              >
                                {/* Solution Box */}
                                <div className="border-accent/20 bg-background/30 rounded-xl border p-3">
                                  <div className="mb-1 text-xs font-medium">
                                    {t('feedback.solutionFor').replace(
                                      '{index}',
                                      String(sol.scenarioIndex + 1)
                                    )}
                                  </div>
                                  <p className="text-sm whitespace-pre-wrap">
                                    {sol.text}
                                  </p>
                                </div>

                                {/* Feedback Box for this scenario */}
                                <div className="border-accent/20 bg-background/30 rounded-xl border p-3">
                                  <div className="text-muted-foreground text-xs font-medium">
                                    {t('feedback.trainerFeedbackFor').replace(
                                      '{index}',
                                      String(sol.scenarioIndex + 1)
                                    )}
                                  </div>
                                  {e.feedbacks &&
                                  e.feedbacks.find(
                                    f => f.scenarioIndex === sol.scenarioIndex
                                  )?.feedback ? (
                                    <div className="text-sm whitespace-pre-wrap">
                                      {
                                        e.feedbacks.find(
                                          f =>
                                            f.scenarioIndex ===
                                            sol.scenarioIndex
                                        )!.feedback
                                      }
                                    </div>
                                  ) : (
                                    <div className="text-muted-foreground text-xs italic">
                                      {e.status === 'PENDING'
                                        ? t('feedback.underReview')
                                        : t('feedback.noFeedback')}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Navigation */}
                        {e.solutions.length > 1 && (
                          <div className="flex items-center justify-between">
                            <button
                              type="button"
                              disabled={(solutionIndexMap[e.id] || 0) === 0}
                              onClick={() =>
                                setSolutionIndexMap(prev => ({
                                  ...prev,
                                  [e.id]: Math.max(0, (prev[e.id] || 0) - 1),
                                }))
                              }
                              className="border-accent/30 hover:bg-accent/10 rounded-md border px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {t('feedback.back')}
                            </button>

                            <div className="flex items-center gap-2">
                              {e.solutions.map((_, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() =>
                                    setSolutionIndexMap(prev => ({
                                      ...prev,
                                      [e.id]: idx,
                                    }))
                                  }
                                  className={`h-2 rounded-full transition-all ${
                                    idx === (solutionIndexMap[e.id] || 0)
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
                                (solutionIndexMap[e.id] || 0) ===
                                e.solutions.length - 1
                              }
                              onClick={() =>
                                setSolutionIndexMap(prev => ({
                                  ...prev,
                                  [e.id]: Math.min(
                                    e.solutions!.length - 1,
                                    (prev[e.id] || 0) + 1
                                  ),
                                }))
                              }
                              className="border-accent/30 hover:bg-accent/10 rounded-md border px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {t('feedback.next')}
                            </button>
                          </div>
                        )}
                      </div>
                    ) : e.solutionText ? (
                      <>
                        <div className="border-accent/20 bg-background/30 rounded-xl border p-3">
                          <p className="text-sm whitespace-pre-wrap">
                            {e.solutionText}
                          </p>
                        </div>
                        <div className="border-accent/20 bg-background/30 mt-3 rounded-xl border p-3">
                          <div className="text-muted-foreground text-xs font-medium">
                            {t('feedback.trainerFeedback')}
                          </div>
                          {e.trainerFeedback ? (
                            <div className="text-sm whitespace-pre-wrap">
                              {e.trainerFeedback}
                            </div>
                          ) : (
                            <div className="text-muted-foreground text-xs italic">
                              {e.status === 'PENDING'
                                ? t('feedback.underReview')
                                : t('feedback.noFeedback')}
                            </div>
                          )}
                        </div>
                      </>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Use case submissions */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
        <h2 className="text-foreground mb-4 text-xl font-semibold">
          {t('feedback.useCaseSubmissions')}
        </h2>
        {useCases.length === 0 ? (
          <div className="text-muted-foreground">
            {t('feedback.noSubmissions')}
          </div>
        ) : (
          <ul className="space-y-4">
            {useCases.map(u => (
              <li
                key={u.id}
                className="border-accent/20 bg-background/40 rounded-2xl border p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold">
                    {u.useCaseTitle}
                    {u.attemptNumber ? (
                      <span className="border-accent/30 ml-2 rounded-full border px-2 py-0.5 text-xs">
                        {t('feedback.attempt').replace(
                          '{number}',
                          String(u.attemptNumber)
                        )}
                      </span>
                    ) : null}
                  </div>
                  {statusPill(u.status)}
                </div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {t('feedback.submittedOn').replace(
                    '{date}',
                    new Date(u.submittedAt).toLocaleString()
                  )}
                </div>
                <div className="border-accent/20 bg-background/30 mt-2 rounded-xl border p-3">
                  <div className="text-muted-foreground text-xs font-medium">
                    {t('feedback.feedback')}
                  </div>
                  {u.trainerFeedback ? (
                    <div className="text-sm whitespace-pre-wrap">
                      {u.trainerFeedback}
                    </div>
                  ) : (
                    <div className="text-muted-foreground text-xs italic">
                      {u.status === 'PENDING'
                        ? t('feedback.underReview')
                        : t('feedback.noFeedback')}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Lesson quiz results */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
        <h2 className="text-foreground mb-4 text-xl font-semibold">
          {t('feedback.lessonQuizResults')}
        </h2>
        {quizzes.length === 0 ? (
          <div className="text-muted-foreground">{t('feedback.noResults')}</div>
        ) : (
          <ul className="space-y-4">
            {quizzes.map(q => (
              <li
                key={q.id}
                className="border-accent/20 bg-background/40 rounded-2xl border p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold">
                    {q.enablerTitle}
                    {q.attemptNumber ? (
                      <span className="border-accent/30 ml-2 rounded-full border px-2 py-0.5 text-xs">
                        {t('feedback.attempt').replace(
                          '{number}',
                          String(q.attemptNumber)
                        )}
                      </span>
                    ) : null}
                  </div>
                  <div className="inline-flex items-center gap-2 text-sm">
                    <Award className="h-4 w-4" /> {q.score ?? 0}%
                  </div>
                </div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {t('feedback.submittedAt').replace(
                    '{date}',
                    new Date(q.submittedAt).toLocaleString()
                  )}
                </div>
                <div className="text-muted-foreground text-xs">
                  {t('feedback.quiz').replace('{title}', q.quizTitle)}
                </div>
                <div className="border-accent/20 bg-background/30 mt-2 rounded-xl border p-3">
                  <div className="text-muted-foreground text-xs font-medium">
                    {t('feedback.feedback')}
                  </div>
                  {q.trainerFeedback ? (
                    <div className="text-sm whitespace-pre-wrap">
                      {q.trainerFeedback}
                    </div>
                  ) : (
                    <div className="text-muted-foreground text-xs italic">
                      {t('feedback.underReview')}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Global quiz results */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
        <h2 className="text-foreground mb-4 text-xl font-semibold">
          {t('feedback.globalQuizResults')}
        </h2>
        {globalQuizzes.length === 0 ? (
          <div className="text-muted-foreground">{t('feedback.noResults')}</div>
        ) : (
          <ul className="space-y-4">
            {globalQuizzes.map(q => (
              <li
                key={q.id}
                className="border-accent/20 bg-background/40 rounded-2xl border p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold">
                    {q.quizTitle}
                    {q.attemptNumber ? (
                      <span className="border-accent/30 ml-2 rounded-full border px-2 py-0.5 text-xs">
                        {t('feedback.attempt').replace(
                          '{number}',
                          String(q.attemptNumber)
                        )}
                      </span>
                    ) : null}
                  </div>
                  <div className="inline-flex items-center gap-2 text-sm">
                    <Award className="h-4 w-4" /> {q.score ?? 0}%
                  </div>
                </div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {t('feedback.submittedAt').replace(
                    '{date}',
                    new Date(q.submittedAt).toLocaleString()
                  )}
                </div>
                <div className="border-accent/20 bg-background/30 mt-2 rounded-xl border p-3">
                  <div className="text-muted-foreground text-xs font-medium">
                    {t('feedback.feedback')}
                  </div>
                  {q.trainerFeedback ? (
                    <div className="text-sm whitespace-pre-wrap">
                      {q.trainerFeedback}
                    </div>
                  ) : (
                    <div className="text-muted-foreground text-xs italic">
                      {t('feedback.underReview')}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
