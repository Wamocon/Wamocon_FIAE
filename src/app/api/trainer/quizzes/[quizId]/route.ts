import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { quizzes, questions, options } from '@/db/migrations/schemas/schema';
import { eq, inArray } from 'drizzle-orm';

export async function DELETE(_req: NextRequest, { params }: { params: { quizId: string } }) {
  try {
    const { quizId } = params;
    // Cascade delete options -> questions -> quiz
    const qRows = await db.select({ id: questions.id }).from(questions).where(eq(questions.quiz_id, quizId));
    const qIds = qRows.map(r => r.id);
    if (qIds.length > 0) {
      await db.delete(options).where(inArray(options.question_id, qIds as any));
      await db.delete(questions).where(eq(questions.quiz_id, quizId));
    }
    await db.delete(quizzes).where(eq(quizzes.id, quizId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Delete quiz error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
