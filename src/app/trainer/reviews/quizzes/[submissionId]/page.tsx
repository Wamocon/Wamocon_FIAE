'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { authFetch } from '@/lib/authFetch';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { peekReviewListSearch } from '@/lib/trainer/review-list-state';
import {
  questionResult,
  summarizeQuizReview,
  type QuestionResult,
} from '@/lib/trainer/quiz-review';

// The review of one quiz submission with the answer key. The data comes from
// /api/trainer/quiz-submissions/[submissionId], which answers a trainer of the
// organization of the trainee only. This page used to read the tables on the
// server, where it ran for every visitor.
//
// Per question it shows the answer of the trainee next to the right one and
// marks a wrong answer (WMCNL-3006), and it says how many questions were right
// so the percentage can be followed (WMCNL-3007). A submission can hold a score
// without any stored answer (older or seeded data): the page then says so.

type ReviewQuestion = {
  id: string;
  text: string;
  questionType: string;
  expectedAnswer: string | null;
  options: Array<{ id: string; optionText: string; isCorrect: boolean }>;
  selectedOptionId: string | null;
  textAnswer: string | null;
};

type Review = {
  submission: {
    id: string;
    traineeId: string;
    quizId: string;
    score: number | null;
    isReviewed: boolean | null;
  };
  quiz: { title: string; quizType: string } | null;
  trainee: { fullName: string | null; email: string | null } | null;
  lesson: { difficulty: string; enablerTitle: string | null } | null;
  questions: ReviewQuestion[];
};

type LoadState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; review: Review };

const RESULT_STYLE: Record<QuestionResult, string> = {
  correct: 'bg-green-600 text-primary-foreground dark:text-white',
  wrong: 'bg-red-600 text-primary-foreground dark:text-white',
  unanswered: 'bg-muted text-muted-foreground',
  ungraded: 'bg-muted text-muted-foreground',
};

export default function QuizSubmissionReviewPage() {
  const { t } = useLanguage();
  const params = useParams();
  const submissionId = params?.submissionId as string | undefined;
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // The list the trainer came from, with its filter, for the way back
  const [listSearch, setListSearch] = useState<string | null>(null);

  useEffect(() => {
    setListSearch(peekReviewListSearch());
  }, []);

  useEffect(() => {
    if (!submissionId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await authFetch(
          `/api/trainer/quiz-submissions/${submissionId}`,
          { cache: 'no-store' }
        );
        if (cancelled) return;
        if (res.status === 404) return setState({ status: 'missing' });
        if (!res.ok) return setState({ status: 'error' });
        setState({ status: 'ready', review: (await res.json()) as Review });
      } catch (e) {
        console.error('Load quiz submission review error', e);
        if (!cancelled) setState({ status: 'error' });
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

  const questions = state.status === 'ready' ? state.review.questions : [];
  const summary = useMemo(() => summarizeQuizReview(questions), [questions]);

  const backHref = `/trainer/reviews?${listSearch || 'view=quizzes'}`;

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div
          role="alert"
          className="rounded-3xl border border-red-500/40 bg-red-500/10 p-6 text-red-500"
        >
          {t('trainerQuizPages.loadError')}
        </div>
      </div>
    );
  }

  if (state.status === 'missing') {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="border-accent/30 bg-card rounded-3xl border p-6">
          <h1 className="text-foreground text-lg font-semibold">
            {t('trainer.reviews.submissionNotFound')}
          </h1>
          <Link href={backHref} className="text-primary underline">
            {t('trainer.reviews.backToReviews')}
          </Link>
        </div>
      </div>
    );
  }

  const { review } = state;
  const { submission: sub, quiz, trainee, lesson } = review;
  const grouped = review.questions;
  const hasStoredAnswers = summary.answeredCount > 0;
  const scoreDiffers =
    hasStoredAnswers &&
    sub.score !== null &&
    summary.computedScore !== null &&
    summary.computedScore !== sub.score;

  const resultLabel = (result: QuestionResult) =>
    t(`trainer.reviews.quizDetail.result.${result}`);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="border-accent/30 bg-card rounded-3xl border p-6">
        <div className="text-muted-foreground mb-2 text-xs">
          <Link href={backHref} className="underline">
            {t('breadcrumb.reviews')}
          </Link>
          <span> / </span>
          <span>{t('trainer.reviews.quizSubmission')}</span>
        </div>
        <h1 className="text-foreground text-2xl font-bold">
          {quiz?.title ?? t('trainer.reviews.quizFallbackTitle')}
        </h1>
        <div className="text-muted-foreground mt-1 text-sm">
          {t('trainer.reviews.trainee')}:{' '}
          {trainee?.fullName ?? trainee?.email ?? sub.traineeId} •{' '}
          {t('trainer.reviews.scoreLabel')}:{' '}
          {sub.score === null
            ? t('quizGrading.trainerNotGraded')
            : `${sub.score}%`}
          {hasStoredAnswers && summary.gradableCount > 0 && (
            <>
              {' '}
              •{' '}
              <span data-testid="quiz-correct-count">
                {t(
                  summary.gradableCount < summary.questionCount
                    ? 'trainer.reviews.quizDetail.correctOfGraded'
                    : 'trainer.reviews.quizDetail.correctOf'
                )
                  .replace('{correct}', String(summary.correctCount))
                  .replace('{total}', String(summary.gradableCount))}
              </span>
            </>
          )}
          {quiz?.quizType === 'LESSON' && lesson?.difficulty && (
            <>
              {' '}
              • {t('trainer.reviews.difficulty')}:{' '}
              <span className="bg-muted inline-flex items-center rounded px-2 py-0.5 text-xs">
                {t(`trainer.reviews.difficulty.${lesson.difficulty}`)}
              </span>
            </>
          )}
          {lesson?.enablerTitle && (
            <>
              {' '}
              • {t('trainer.reviews.theme')}: {lesson.enablerTitle}
            </>
          )}
        </div>
        {grouped.length > 0 && !hasStoredAnswers && (
          <p
            role="status"
            className="text-muted-foreground mt-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm"
          >
            {t('trainer.reviews.quizDetail.noStoredAnswers').replace(
              '{score}',
              sub.score === null ? '-' : String(sub.score)
            )}
          </p>
        )}
        {scoreDiffers && (
          <p
            role="status"
            className="text-muted-foreground mt-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm"
          >
            {t('trainer.reviews.quizDetail.scoreDiffers')
              .replace('{stored}', String(sub.score))
              .replace('{computed}', String(summary.computedScore))}
          </p>
        )}
        {hasStoredAnswers && summary.gradableCount < summary.questionCount && (
          <p className="text-muted-foreground mt-2 text-xs">
            {t('trainer.reviews.quizDetail.ungradedNote').replace(
              '{count}',
              String(summary.questionCount - summary.gradableCount)
            )}
          </p>
        )}
      </div>

      <div className="space-y-4">
        {grouped.map((q, i) => {
          const isText = q.questionType === 'TEXT';
          const result = questionResult(q);
          return (
            <div
              key={q.id}
              className="border-accent/30 bg-card rounded-2xl border p-5"
            >
              <div className="text-foreground mb-3 flex flex-wrap items-start justify-between gap-2 font-medium">
                <div>
                  {i + 1}. {q.text}{' '}
                  {isText && (
                    <span className="ml-2 rounded bg-blue-600/50 px-2 py-0.5 text-xs">
                      {t('trainer.reviews.questionType.text')}
                    </span>
                  )}
                </div>
                {hasStoredAnswers && (
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-normal ${RESULT_STYLE[result]}`}
                    data-testid="question-result"
                  >
                    {resultLabel(result)}
                  </span>
                )}
              </div>
              {isText ? (
                <div className="space-y-2 text-sm">
                  <div className="border-accent/30 bg-muted/50 rounded-lg border p-3">
                    <div className="text-muted-foreground mb-1 text-xs uppercase">
                      {t('trainer.reviews.quizDetail.traineeChose')}
                    </div>
                    <div className="whitespace-pre-wrap">
                      {q.textAnswer || (
                        <span className="text-muted-foreground italic">
                          {t('trainer.reviews.noAnswer')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="border-accent/30 bg-muted/20 rounded-lg border p-3">
                    <div className="text-muted-foreground mb-1 text-xs uppercase">
                      {t('trainer.reviews.expectedAnswer')}
                    </div>
                    <div className="whitespace-pre-wrap">
                      {q.expectedAnswer || (
                        <span className="text-muted-foreground italic">
                          {t('trainer.reviews.notSet')}
                        </span>
                      )}
                    </div>
                  </div>
                  {q.expectedAnswer && q.textAnswer && (
                    <div className="mt-1 text-xs">
                      {result === 'correct' ? (
                        <span className="text-primary-foreground rounded bg-green-600 px-2 py-0.5 dark:text-white">
                          {t('trainer.reviews.autoCorrect')}
                        </span>
                      ) : (
                        <span className="text-primary-foreground rounded bg-red-600 px-2 py-0.5 dark:text-white">
                          {t('trainer.reviews.notExactMatch')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {q.options.map(opt => {
                      const isSelected = q.selectedOptionId === opt.id;
                      const isCorrect = !!opt.isCorrect;
                      const className = isSelected
                        ? isCorrect
                          ? 'border-green-500/40 bg-green-500/10'
                          : 'border-red-500/40 bg-red-500/10'
                        : isCorrect
                          ? 'border-green-500/40 bg-green-500/10'
                          : 'border-accent/20 bg-transparent';
                      return (
                        <div
                          key={opt.id}
                          className={`rounded-lg border p-3 text-sm ${className}`}
                        >
                          {opt.optionText}
                          {isCorrect && (
                            <span className="text-primary-foreground ml-2 rounded bg-green-600 px-1.5 py-0.5 text-xs dark:text-white">
                              {t('trainer.reviews.quizDetail.correctAnswer')}
                            </span>
                          )}
                          {isSelected && (
                            <span
                              className={`text-primary-foreground ml-2 rounded px-1.5 py-0.5 text-xs dark:text-white ${isCorrect ? 'bg-green-700' : 'bg-red-600'}`}
                            >
                              {t('trainer.reviews.quizDetail.traineeChose')}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {hasStoredAnswers && result === 'unanswered' && (
                    <p className="text-muted-foreground mt-2 text-xs italic">
                      {t('trainer.reviews.quizDetail.noAnswerStored')}
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })}
        {grouped.length === 0 && (
          <div className="border-accent/30 bg-muted/50 text-muted-foreground rounded-2xl border p-5 text-sm">
            {t('trainer.reviews.noQuestions')}
          </div>
        )}
      </div>
    </div>
  );
}
