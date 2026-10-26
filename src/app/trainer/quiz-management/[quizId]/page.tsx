'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { authFetch } from '@/lib/authFetch';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

// The detail of a quiz with the marker of the correct option. The data comes
// from /api/trainer/quizzes/[quizId], which answers a trainer only. This page
// used to read the tables on the server, where it ran for every visitor.

type QuizDetail = {
  id: string;
  title: string;
  quiz_type: 'mini' | 'big';
  questions: Array<{
    id: string;
    question_text: string;
    options: string[];
    correct_index: number;
  }>;
};

type LoadState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; quiz: QuizDetail };

export default function TrainerQuizDetailPage() {
  const { t } = useLanguage();
  const params = useParams();
  const quizId = params?.quizId as string | undefined;
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (!quizId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await authFetch(`/api/trainer/quizzes/${quizId}`, {
          cache: 'no-store',
        });
        if (cancelled) return;
        if (res.status === 404) return setState({ status: 'missing' });
        if (!res.ok) return setState({ status: 'error' });
        setState({ status: 'ready', quiz: (await res.json()) as QuizDetail });
      } catch (e) {
        console.error('Load quiz detail error', e);
        if (!cancelled) setState({ status: 'error' });
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [quizId]);

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
        <div className="border-accent/30 rounded-3xl border bg-black/30 p-6">
          <h1 className="text-foreground text-lg font-semibold">
            Quiz not found
          </h1>
          <Link
            href="/trainer/quiz-management"
            className="text-primary underline"
          >
            Back to Quiz Management
          </Link>
        </div>
      </div>
    );
  }

  const { quiz } = state;
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="border-accent/30 rounded-3xl border bg-black/30 p-6">
        <div className="text-muted-foreground mb-2 text-xs">
          <Link href="/trainer/quiz-management" className="underline">
            Quiz Management
          </Link>
          <span> / </span>
          <span>Quiz Details</span>
        </div>
        <h1 className="text-foreground text-2xl font-bold">{quiz.title}</h1>
        <div className="text-muted-foreground mt-1 text-sm">
          Type: {quiz.quiz_type === 'mini' ? 'LESSON' : 'GLOBAL'}
        </div>
      </div>

      <div className="space-y-4">
        {quiz.questions.map((q, i) => (
          <div
            key={q.id}
            className="border-accent/30 rounded-2xl border bg-black/30 p-5"
          >
            <div className="text-foreground mb-3 font-medium">
              {i + 1}. {q.question_text}
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {q.options.map((optionText, oi) => {
                const isCorrect = oi === q.correct_index;
                return (
                  <div
                    key={oi}
                    className={`rounded-lg border p-3 text-sm ${isCorrect ? 'border-green-500/40 bg-green-500/10' : 'border-accent/20 bg-transparent'}`}
                  >
                    {optionText}
                    {isCorrect && (
                      <span className="text-foreground ml-2 rounded bg-green-600 px-1.5 py-0.5 text-xs">
                        Correct
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {quiz.questions.length === 0 && (
          <div className="border-accent/30 text-muted-foreground rounded-2xl border bg-black/20 p-5 text-sm">
            No questions.
          </div>
        )}
      </div>
    </div>
  );
}
