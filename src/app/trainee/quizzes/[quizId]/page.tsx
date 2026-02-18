import Quiz from '@/components/learning/Quiz';
import db from '@/db';
import { eq, inArray } from 'drizzle-orm';
import { options, questions, quizzes } from '@/db/migrations/schemas/schema';

export default async function QuizPage({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;

  // Load quiz with questions/options from new schema
  const [qz] = await db.select().from(quizzes).where(eq(quizzes.id, quizId as any)).limit(1);
  if (!qz) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Quiz nicht gefunden...</p>
        </div>
      </div>
    );
  }

  const qRows = await db.select().from(questions).where(eq(questions.quizId, quizId as any));
  const qIds = qRows.map((q) => q.id);
  const optRows = qIds.length
    ? await db.select().from(options).where(inArray(options.questionId, qIds as any))
    : [];

  const outQuestions = qRows
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
    .map((qr) => {
      const opts = optRows
        .filter((o) => String(o.questionId) === String(qr.id))
        .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
      return {
        id: qr.id,
        question: qr.questionText,
        options: opts.map((o) => ({ id: o.id, text: o.optionText })),
        order_index: qr.orderIndex ?? 0,
      };
    });

  const quiz = {
    id: qz.id,
    title: qz.title,
    description: qz.quizType === 'GLOBAL' ? 'Global Quiz' : 'Enabler Quiz',
    totalQuestions: outQuestions.length,
    timeLimitMinutes: 30,
    questions: outQuestions,
  };

  return <Quiz quiz={quiz} />;
}
