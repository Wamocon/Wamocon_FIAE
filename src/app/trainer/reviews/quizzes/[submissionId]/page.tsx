import db from '@/db';
import { quizzes, questions, options, quizSubmissions, quizSubmissionAnswers, profiles } from '@/db/migrations/schemas/schema';
import { asc, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';

export default async function QuizSubmissionReviewPage({ params }: { params: { submissionId: string } }) {
  const { submissionId } = params;

  // Load submission with quiz and trainee
  const [sub] = await db
    .select({
      id: quizSubmissions.id,
      traineeId: quizSubmissions.traineeId,
      quizId: quizSubmissions.quizId,
      score: quizSubmissions.score,
      isReviewed: quizSubmissions.isReviewed,
    })
    .from(quizSubmissions)
    .where(eq(quizSubmissions.id, submissionId as any))
    .limit(1);

  if (!sub) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="rounded-3xl border border-accent/30 bg-black/30 p-6">
          <h1 className="text-foreground text-lg font-semibold">Submission not found</h1>
          <Link href="/trainer/reviews?view=quizzes" className="text-primary underline">Back to Reviews</Link>
        </div>
      </div>
    );
  }

  const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, sub.quizId as any)).limit(1);
  const [trainee] = await db.select().from(profiles).where(eq(profiles.id, sub.traineeId as any)).limit(1);

  const qs = await db
    .select()
    .from(questions)
    .where(eq(questions.quizId, sub.quizId as any))
    .orderBy(asc(questions.orderIndex));
  const qIds = qs.map((q) => q.id);
  const allOpts = qIds.length ? await db.select().from(options).where(inArray(options.questionId, qIds as any)) : [];
  const answers = qIds.length ? await db.select().from(quizSubmissionAnswers).where(eq(quizSubmissionAnswers.submissionId, sub.id as any)) : [];

  const answerMap = new Map(answers.map((a) => [a.questionId, a.selectedOptionId] as const));

  const grouped = qs.map((q) => ({
    id: q.id,
    text: q.questionText,
    options: allOpts.filter((o) => o.questionId === q.id),
    selectedOptionId: answerMap.get(q.id) ?? null,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="rounded-3xl border border-accent/30 bg-black/30 p-6">
        <div className="mb-2 text-xs text-muted-foreground">
          <Link href="/trainer/reviews?view=quizzes" className="underline">Reviews</Link>
          <span> / </span>
          <span>Quiz Submission</span>
        </div>
        <h1 className="text-foreground text-2xl font-bold">{quiz?.title ?? 'Quiz'}</h1>
        <div className="mt-1 text-sm text-muted-foreground">
          Trainee: {trainee?.fullName ?? trainee?.email ?? sub.traineeId} • Score: {sub.score ?? 0}%
        </div>
      </div>

      <div className="space-y-4">
        {grouped.map((q, i) => {
          return (
            <div key={q.id} className="rounded-2xl border border-accent/30 bg-black/30 p-5">
              <div className="mb-3 text-foreground font-medium">{i + 1}. {q.text}</div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {q.options.map((opt) => {
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
                    <div key={opt.id} className={`rounded-lg border p-3 text-sm ${className}`}>
                      {opt.optionText}
                      {isCorrect && <span className="ml-2 rounded bg-green-600 px-1.5 py-0.5 text-xs text-white">Correct</span>}
                      {isSelected && !isCorrect && <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-xs text-white">Selected</span>}
                      {isSelected && isCorrect && <span className="ml-2 rounded bg-green-700 px-1.5 py-0.5 text-xs text-white">Selected</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {grouped.length === 0 && (
          <div className="rounded-2xl border border-accent/30 bg-black/20 p-5 text-sm text-muted-foreground">No questions.</div>
        )}
      </div>
    </div>
  );
}
