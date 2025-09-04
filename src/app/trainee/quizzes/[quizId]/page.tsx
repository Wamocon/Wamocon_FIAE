'use client';

import Quiz from '@/components/learning/Quiz';

export default async function QuizPage({
  params,
}: {
  params: Promise<{ quizId: string }>;
}) {
  const { quizId } = await params;
  return <Quiz quizId={quizId} />;
}
