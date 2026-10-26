import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { progress } from '@/db/migrations/schemas/schema';
import { isErrorResponse, requireUser } from '@/lib/auth/session';

// Marks a sub lesson as done or open for the session user. A userId in the body
// (sent by older clients) is ignored.
export async function POST(req: NextRequest) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;
  const userId = session.id;

  try {
    const body = await req.json();
    const { subLessonId, completed } = body as {
      subLessonId?: string;
      completed?: boolean;
    };
    if (!subLessonId || typeof completed !== 'boolean') {
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
        await db.insert(progress).values({ user_id: userId, sub_lesson_id: subLessonId });
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
