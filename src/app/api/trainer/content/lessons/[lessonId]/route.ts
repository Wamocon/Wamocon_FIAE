import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { lessons, subLessons } from '@/db/migrations/schemas/schema';
import { eq } from 'drizzle-orm';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ lessonId: string }> }) {
  try {
    const { lessonId } = await params;
    const body = await req.json();
    const updates: any = {};
    if (typeof body?.title === 'string') updates.title = body.title;
    if (typeof body?.order_index !== 'undefined') updates.order_index = Number(body.order_index);
    if (typeof body?.duration_weeks !== 'undefined') updates.duration_weeks = Number(body.duration_weeks);
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }
    const [row] = await db.update(lessons).set(updates).where(eq(lessons.id, lessonId)).returning();
    return NextResponse.json({ lesson: row });
  } catch (e) {
    console.error('Update lesson error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ lessonId: string }> }) {
  try {
    const { lessonId } = await params;
    await db.delete(subLessons).where(eq(subLessons.lesson_id, lessonId));
    await db.delete(lessons).where(eq(lessons.id, lessonId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Delete lesson error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
