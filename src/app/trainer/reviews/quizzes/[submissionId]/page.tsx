'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { authFetch } from '@/lib/authFetch';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

// The review of one quiz submission with the answer key. The data comes from
// /api/trainer/quiz-submissions/[submissionId], which answers a trainer of the
// organization of the trainee only. This page used to read the tables on the
// server, where it ran for every visitor.

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

export default function QuizSubmissionReviewPage() {
  const { t } = useLanguage();
  const params = useParams();
  const submissionId = params?.submissionId as string | undefined;
  const [state, setState] = useState<LoadState>({ status: 'loading' });

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
            Submission not found
          </h1>
          <Link
            href="/trainer/reviews?view=quizzes"
            className="text-primary underline"
          >
            Back to Reviews
          </Link>
        </div>
      </div>
    );
  }

  const { review } = state;
  const { submission: sub, quiz, trainee, lesson } = review;
  const grouped = review.questions;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="border-accent/30 bg-card rounded-3xl border p-6">
        <div className="text-muted-foreground mb-2 text-xs">
          <Link href="/trainer/reviews?view=quizzes" className="underline">
            Reviews
          </Link>
          <span> / </span>
          <span>Quiz Submission</span>
        </div>
        <h1 className="text-foreground text-2xl font-bold">
          {quiz?.title ?? 'Quiz'}
        </h1>
        <div className="text-muted-foreground mt-1 text-sm">
          Trainee: {trainee?.fullName ?? trainee?.email ?? sub.traineeId} •
          Score:{' '}
          {sub.score === null
            ? t('quizGrading.trainerNotGraded')
            : `${sub.score}%`}
          {quiz?.quizType === 'LESSON' && lesson?.difficulty && (
            <>
              {' '}
              • Schwierigkeit:{' '}
              <span className="bg-muted inline-flex items-center rounded px-2 py-0.5 text-xs">
                {lesson.difficulty}
              </span>
            </>
          )}
          {lesson?.enablerTitle && <> • Lesson: {lesson.enablerTitle}</>}
        </div>
      </div>

      <div className="space-y-4">
        {grouped.map((q, i) => {
          const isText = q.questionType === 'TEXT';
          return (
            <div
              key={q.id}
              className="border-accent/30 bg-card rounded-2xl border p-5"
            >
              <div className="text-foreground mb-3 font-medium">
                {i + 1}. {q.text}{' '}
                {isText && (
                  <span className="ml-2 rounded bg-blue-600/50 px-2 py-0.5 text-xs">
                    Text
                  </span>
                )}
              </div>
              {isText ? (
                <div className="space-y-2 text-sm">
                  <div className="border-accent/30 bg-muted/50 rounded-lg border p-3">
                    <div className="text-muted-foreground mb-1 text-xs uppercase">
                      Antwort des Trainees
                    </div>
                    <div className="whitespace-pre-wrap">
                      {q.textAnswer || (
                        <span className="text-muted-foreground italic">
                          (keine Antwort)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="border-accent/30 bg-muted/20 rounded-lg border p-3">
                    <div className="text-muted-foreground mb-1 text-xs uppercase">
                      Erwartete Antwort
                    </div>
                    <div className="whitespace-pre-wrap">
                      {q.expectedAnswer || (
                        <span className="text-muted-foreground italic">
                          (nicht festgelegt)
                        </span>
                      )}
                    </div>
                  </div>
                  {q.expectedAnswer && q.textAnswer && (
                    <div className="mt-1 text-xs">
                      {q.textAnswer.trim().toLowerCase() ===
                      q.expectedAnswer.trim().toLowerCase() ? (
                        <span className="text-primary-foreground rounded bg-green-600 px-2 py-0.5 dark:text-white">
                          Automatisch als korrekt bewertet
                        </span>
                      ) : (
                        <span className="text-primary-foreground rounded bg-red-600 px-2 py-0.5 dark:text-white">
                          Nicht exakt übereinstimmend
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
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
                            Correct
                          </span>
                        )}
                        {isSelected && !isCorrect && (
                          <span className="text-primary-foreground ml-2 rounded bg-red-600 px-1.5 py-0.5 text-xs dark:text-white">
                            Selected
                          </span>
                        )}
                        {isSelected && isCorrect && (
                          <span className="text-primary-foreground ml-2 rounded bg-green-700 px-1.5 py-0.5 text-xs dark:text-white">
                            Selected
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {grouped.length === 0 && (
          <div className="border-accent/30 bg-muted/50 text-muted-foreground rounded-2xl border p-5 text-sm">
            No questions.
          </div>
        )}
      </div>
    </div>
  );
}
