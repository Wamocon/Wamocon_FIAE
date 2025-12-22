import db from '@/db';
import { quizzes, questions, options } from '@/db/migrations/schemas/schema';
import { asc, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';

export default async function TrainerQuizDetailPage({ params }: { params: { quizId: string } }) {
  const { quizId } = params;

  // Load quiz
  const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, quizId as any)).limit(1);
  if (!quiz) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="rounded-3xl border border-accent/30 bg-black/30 p-6">
          <h1 className="text-foreground text-lg font-semibold">Quiz not found</h1>
          <Link href="/trainer/quiz-management" className="text-primary underline">Back to Quiz Management</Link>
        </div>
      </div>
    );
  }

  // Load questions
  const qs = await db
    .select()
    .from(questions)
    .where(eq(questions.quizId, quiz.id as any))
    .orderBy(asc(questions.orderIndex));
  const qIds = qs.map((q) => q.id);
  const allOpts = qIds.length
    ? await db.select().from(options).where(inArray(options.questionId, qIds as any))
    : [];

  const grouped = qs.map((q) => ({
    id: q.id,
    text: q.questionText,
    options: allOpts.filter((o) => o.questionId === q.id),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="rounded-3xl border border-accent/30 bg-black/30 p-6">
        <div className="mb-2 text-xs text-muted-foreground">
          <Link href="/trainer/quiz-management" className="underline">Quiz Management</Link>
          <span> / </span>
          <span>Quiz Details</span>
        </div>
        <h1 className="text-foreground text-2xl font-bold">{quiz.title}</h1>
        <div className="mt-1 text-sm text-muted-foreground">Type: {quiz.quizType}</div>
      </div>

      <div className="space-y-4">
        {grouped.map((q, i) => (
          <div key={q.id} className="rounded-2xl border border-accent/30 bg-black/30 p-5">
            <div className="mb-3 text-foreground font-medium">{i + 1}. {q.text}</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {q.options.map((opt) => (
                <div
                  key={opt.id}
                  className={`rounded-lg border p-3 text-sm ${opt.isCorrect ? 'border-green-500/40 bg-green-500/10' : 'border-accent/20 bg-transparent'}`}
                >
                  {opt.optionText}
                  {opt.isCorrect && <span className="ml-2 rounded bg-green-600 px-1.5 py-0.5 text-xs text-foreground">Correct</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
        {grouped.length === 0 && (
          <div className="rounded-2xl border border-accent/30 bg-black/20 p-5 text-sm text-muted-foreground">No questions.</div>
        )}
      </div>
    </div>
  );
}
