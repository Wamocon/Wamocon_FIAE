import { getQuizWithQuestions } from '@/db/queries';
import Quiz from '@/components/learning/Quiz';

export default async function QuizPage({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  const quiz = await getQuizWithQuestions(quizId);
  if (!quiz) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Quiz nicht gefunden...</p>
        </div>
      </div>
    );
  }
  return <Quiz quiz={quiz} />;
}
