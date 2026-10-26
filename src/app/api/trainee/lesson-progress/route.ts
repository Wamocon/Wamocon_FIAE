import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import { lessons, progress, subLessons } from '@/db/migrations/schemas/schema';
import { isErrorResponse, requireUser } from '@/lib/auth/session';

// The progress of the session user, a userId in the query is ignored.
export async function GET(req: NextRequest) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;
  const userId = session.id;

  try {
    const { searchParams } = new URL(req.url);
    const lessonId = searchParams.get('lessonId');
    if (!lessonId) {
      return NextResponse.json({ error: 'Missing lessonId' }, { status: 400 });
    }

    const subs = await db
      .select({ id: subLessons.id })
      .from(subLessons)
      .where(eq(subLessons.lesson_id, lessonId));
    const subIds = subs.map(s => s.id);
    if (subIds.length === 0) return NextResponse.json({ completedIds: [] });

    const rows = await db
      .select({ sub_lesson_id: progress.sub_lesson_id })
      .from(progress)
      .where(and(eq(progress.user_id, userId), inArray(progress.sub_lesson_id, subIds)));
    const completedIds = rows.map(r => r.sub_lesson_id);
    return NextResponse.json({ completedIds });
  } catch (e) {
    console.error('Lesson-progress API error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
