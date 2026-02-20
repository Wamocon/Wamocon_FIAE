import db from '@/db';
import {
  quizzes,
  questions,
  options,
  quizSubmissions,
  quizSubmissionAnswers,
  profiles,
  enablerQuizLinks,
  enablers,
} from '@/db/migrations/schemas/schema';
import { asc, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';

export default async function QuizSubmissionReviewPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = await params;

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

  const [quiz] = await db
    .select()
    .from(quizzes)
    .where(eq(quizzes.id, sub.quizId as any))
    .limit(1);
  const [trainee] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, sub.traineeId as any))
    .limit(1);

  // Get lesson context (difficulty and enabler title) if applicable
  const [link] = await db
    .select()
    .from(enablerQuizLinks)
    .where(eq(enablerQuizLinks.quizId, sub.quizId as any))
    .limit(1);
  const enabler = link
    ? (
        await db
          .select({ id: enablers.id, title: enablers.title })
          .from(enablers)
          .where(eq(enablers.id, link.enablerId as any))
          .limit(1)
      )[0]
    : undefined;

  const qs = await db
    .select()
    .from(questions)
    .where(eq(questions.quizId, sub.quizId as any))
    .orderBy(asc(questions.orderIndex));
  const qIds = qs.map(q => q.id);
  const allOpts = qIds.length
    ? await db
        .select()
        .from(options)
        .where(inArray(options.questionId, qIds as any))
    : [];
  const answers = qIds.length
    ? await db
        .select()
        .from(quizSubmissionAnswers)
        .where(eq(quizSubmissionAnswers.submissionId, sub.id as any))
    : [];

  const answerMap = new Map(
    answers.map(a => [a.questionId, a.selectedOptionId] as const)
  );

  // Build grouped question data including text answers
  const answerRows = answers;
  const textAnswerMap = new Map(
    answerRows.map(a => [a.questionId, (a as any).textAnswer])
  );
  const grouped = qs.map(q => ({
    id: q.id,
    text: q.questionText,
    questionType: (q as any).questionType || 'MCQ',
    expectedAnswer: (q as any).expectedAnswer || null,
    options: allOpts.filter(o => o.questionId === q.id),
    selectedOptionId: answerMap.get(q.id) ?? null,
    textAnswer: textAnswerMap.get(q.id) || null,
  }));

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
          Score: {sub.score ?? 0}%
          {quiz?.quizType === 'LESSON' && link?.difficulty && (
            <>
              {' '}
              • Schwierigkeit:{' '}
              <span className="bg-muted inline-flex items-center rounded px-2 py-0.5 text-xs">
                {link.difficulty}
              </span>
            </>
          )}
          {enabler?.title && <> • Lesson: {enabler.title}</>}
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
