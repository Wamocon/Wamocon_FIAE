import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { quizSubmissions } from '@/db/migrations/schemas/schema';

// PATCH /api/trainer/quiz-submissions/[submissionId]
// Body: { is_reviewed: boolean }
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ submissionId: string }> }) {
  try {
    const { submissionId } = await ctx.params;
    if (!submissionId) return NextResponse.json({ error: 'Missing submissionId' }, { status: 400 });
    const body = await req.json();
    const is_reviewed = Boolean(body?.is_reviewed);

    await db.update(quizSubmissions).set({ isReviewed: is_reviewed }).where(eq(quizSubmissions.id, submissionId as any));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Trainer quiz submission PATCH error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
