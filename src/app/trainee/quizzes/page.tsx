'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Brain, Lock, Play } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { authFetch } from '@/lib/authFetch';
import { PASS_THRESHOLD } from '@/lib/catalog/progression';
import { capitalizeFirst } from '@/lib/display-text';

// "Quizze & Tests": every quiz of the trainee with status and result. The
// global quizzes (assigned to the trainee) come from /api/trainee/quizzes, the
// quizzes of the Themenkreise (Niedrig, Mittel, Hoch) from
// /api/trainee/lesson-quizzes. Both answer for the occupation that is chosen
// (header x-catalog). Without a quiz the page says so.

type QuizCard = {
  id: string;
  title: string;
  kind: 'GLOBAL' | 'LESSON';
  bestScore: number;
  questionsCount: number;
  attempts: number;
  /** Lesson quiz: the difficulty, the Themenkreis it belongs to, its lock */
  difficulty?: 'LOW' | 'MEDIUM' | 'HIGH';
  enablerId?: string;
  enablerTitle?: string;
  locked?: boolean;
};

type Status = 'locked' | 'notStarted' | 'passed' | 'retry' | 'submitted';

function statusOf(quiz: QuizCard): Status {
  if (quiz.kind === 'LESSON' && quiz.locked) return 'locked';
  if (quiz.attempts === 0) return 'notStarted';
  // A global quiz has no pass mark, the best result is shown
  if (quiz.kind === 'GLOBAL') return 'submitted';
  return quiz.bestScore >= PASS_THRESHOLD ? 'passed' : 'retry';
}

async function readList(url: string): Promise<unknown[]> {
  const res = await authFetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export default function TraineeQuizzesPage() {
  const { profile, loading } = useAuth();
  const { t } = useLanguage();
  const [quizzes, setQuizzes] = useState<QuizCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // Always declare hooks before any conditional return
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!profile?.id) return;
      try {
        const [globals, lessons] = await Promise.all([
          readList('/api/trainee/quizzes'),
          readList('/api/trainee/lesson-quizzes'),
        ]);
        if (cancelled) return;
        setQuizzes([
          ...(globals as Omit<QuizCard, 'kind'>[]).map(q => ({
            ...q,
            kind: 'GLOBAL' as const,
          })),
          ...(lessons as QuizCard[]),
        ]);
        setFailed(false);
      } catch (e) {
        console.error(e);
        if (cancelled) return;
        setQuizzes([]);
        setFailed(true);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

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

  const difficultyLabel = (d?: string) =>
    d === 'LOW'
      ? t('enablerPage.difficultyLow')
      : d === 'MEDIUM'
        ? t('enablerPage.difficultyMedium')
        : d === 'HIGH'
          ? t('enablerPage.difficultyHigh')
          : '';

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-6">
          <div className="from-accent to-primary flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br">
            <Brain className="text-foreground h-8 w-8" />
          </div>
          <div>
            <h1 className="text-foreground mb-2 text-3xl font-bold">
              {t('quiz.title')}
            </h1>
            <p className="text-muted">{t('quiz.description')}</p>
          </div>
        </div>
      </div>

      {!loaded && (
        <div className="flex items-center justify-center p-8">
          <LoadingSpinner size="md" />
        </div>
      )}

      {loaded && failed && (
        <div
          role="alert"
          data-testid="quiz-list-error"
          className="glass-effect rounded-3xl border border-red-500/40 p-8 text-center text-sm text-red-500 shadow-lg"
        >
          {t('quizList.loadError')}
        </div>
      )}

      {loaded && !failed && quizzes.length === 0 && (
        <div
          role="status"
          data-testid="quiz-list-empty"
          className="glass-effect border-accent/30 text-muted-foreground rounded-3xl border p-8 text-center shadow-lg"
        >
          {t('quizList.empty')}
        </div>
      )}

      {/* Quizzes Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {quizzes.map(quiz => {
          const status = statusOf(quiz);
          const href =
            quiz.kind === 'LESSON' && quiz.enablerId
              ? `/trainee/enablers/${quiz.enablerId}`
              : `/trainee/quizzes/${quiz.id}`;
          return (
            <div
              key={`${quiz.kind}-${quiz.id}`}
              data-testid="quiz-card"
              className="glass-effect border-accent/30 hover:border-accent/50 hover:shadow-accent/5 rounded-3xl border p-6 shadow-lg transition-all duration-200 hover:scale-[1.02] hover:shadow-xl"
            >
              <div className="mb-4 flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="from-accent to-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br">
                    <Brain className="text-foreground h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-foreground text-xl font-bold break-words">
                      {capitalizeFirst(quiz.title)}
                    </h3>
                    <span className="bg-accent/20 text-accent rounded-full px-3 py-1 text-sm font-medium">
                      {quiz.kind === 'LESSON'
                        ? `${t('quizList.kind.lesson')} · ${difficultyLabel(quiz.difficulty)}`
                        : t('quizList.kind.global')}
                    </span>
                  </div>
                </div>
              </div>

              {quiz.kind === 'LESSON' && quiz.enablerTitle && (
                <p className="text-muted mb-4 line-clamp-2 text-sm">
                  {capitalizeFirst(quiz.enablerTitle)}
                </p>
              )}

              {/* Status: words and a symbol, never colour alone */}
              <div
                data-testid="quiz-status"
                className="text-foreground border-accent/40 mb-4 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"
              >
                {status === 'locked' && (
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {t(`quizList.status.${status}`)}
              </div>

              {/* Result */}
              <div className="mb-4">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-muted">{t('quiz.bestScore')}</span>
                  <span className="text-foreground font-medium">
                    {quiz.attempts > 0 ? `${quiz.bestScore}%` : '-'}
                  </span>
                </div>
                <div className="bg-muted/30 h-3 w-full rounded-full">
                  <div
                    className="from-accent to-primary h-3 rounded-full bg-gradient-to-r transition-all duration-500"
                    style={{ width: `${quiz.bestScore || 0}%` }}
                  />
                </div>
              </div>

              {/* Stats */}
              <div className="mb-4 grid grid-cols-2 gap-4 text-sm">
                <div className="bg-background/50 rounded-xl p-3 text-center">
                  <div className="text-accent text-lg font-bold">
                    {quiz.questionsCount || 0}
                  </div>
                  <div className="text-muted">{t('quiz.questions')}</div>
                </div>
                <div className="bg-background/50 rounded-xl p-3 text-center">
                  <div className="text-accent text-lg font-bold">
                    {quiz.attempts || 0}
                  </div>
                  <div className="text-muted">{t('quiz.attempts')}</div>
                </div>
              </div>

              {/* Actions */}
              <Link
                href={href}
                prefetch={false}
                className="bg-accent text-accent-foreground hover:bg-accent/90 block rounded-xl px-4 py-2 text-center text-sm font-medium transition-colors"
              >
                <Play className="mr-2 inline h-4 w-4" />
                {quiz.kind === 'LESSON'
                  ? t('quizList.open')
                  : quiz.attempts > 0
                    ? t('quiz.retry')
                    : t('quiz.start')}
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
