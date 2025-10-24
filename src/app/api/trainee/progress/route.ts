import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { progress } from '@/db/migrations/schemas/schema';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, subLessonId, completed } = body as {
      userId?: string;
      subLessonId?: string;
      completed?: boolean;
    };
    if (!userId || !subLessonId || typeof completed !== 'boolean') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    if (completed) {
      // Insert if not exists
      const existing = await db
        .select({ user_id: progress.user_id })
        .from(progress)
        .where(and(eq(progress.user_id, userId), eq(progress.sub_lesson_id, subLessonId)))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(progress).values({ user_id: userId, sub_lesson_id: subLessonId, completed_at: new Date() });
      }
    } else {
      // Delete if exists
      await db
        .delete(progress)
        .where(and(eq(progress.user_id, userId), eq(progress.sub_lesson_id, subLessonId)));
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Progress toggle error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
