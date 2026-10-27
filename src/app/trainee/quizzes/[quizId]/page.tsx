'use client';

import { useParams } from 'next/navigation';
import Quiz, { type QuizView } from '@/components/learning/Quiz';
import { useLanguage } from '@/contexts/LanguageContext';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

// The global quiz of a trainee. The page reads no database: the questions come
// from GET /api/trainee/quizzes/[quizId], which checks the session, the
// assignment and the occupation of the trainee and sends texts only. The
// quiz component hands the answers to POST .../submit and shows the result of
// that route.
export default function QuizPage() {
  const { t } = useLanguage();
  const params = useParams();
  const quizId = params?.quizId as string | undefined;

  const { data, isLoading, error } = useApiQuery<{ quiz?: QuizView | null }>(
    quizId ? `/api/trainee/quizzes/${encodeURIComponent(quizId)}` : null
  );

  const note = (text: string) => (
    <div className="bg-background flex min-h-full items-center justify-center p-6">
      <p className="text-muted-foreground text-center">{text}</p>
    </div>
  );

  if (isLoading) return note(t('traineeQuiz.loading'));
  if (error) {
    // The route answers 404 for a quiz that is not assigned, not active or
    // of another occupation: the same text for all of them
    return note(
      /^API 404/.test(error.message)
        ? t('traineeQuiz.notFound')
        : t('traineeQuiz.loadError')
    );
  }
  if (!data?.quiz) return note(t('traineeQuiz.notFound'));

  // A new key per quiz, so a quiz never starts with the answers of another
  return <Quiz key={data.quiz.id} quiz={data.quiz} />;
}
