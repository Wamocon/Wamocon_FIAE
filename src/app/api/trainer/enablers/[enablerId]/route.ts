import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { enablers, courseMembers, courses } from '@/db/migrations/schemas/schema';

export async function GET(_req: NextRequest, { params }: { params: { enablerId: string } }) {
  try {
    const { enablerId } = params;
    const [row] = await db.select().from(enablers).where(eq(enablers.id, enablerId as any));
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ enabler: row });
  } catch (e) {
    console.error('Get enabler error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { enablerId: string } }) {
  try {
    const { enablerId } = params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');
    if (!trainerId) return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });

    const [row0] = await db.select().from(enablers).where(eq(enablers.id, enablerId as any));
    if (!row0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const member = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, row0.courseId as any), eq(courseMembers.userId, trainerId as any), eq(courseMembers.role, 'TRAINER' as any)));
    const [courseRow] = await db.select().from(courses).where(eq(courses.id, row0.courseId as any));
    const isCreator = courseRow ? String(courseRow.createdById) === String(trainerId) : false;
    if (!member.length && !isCreator) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const body = await req.json();
    const updates: any = {};
    for (const key of [
      'title',
      'orderIndex',
      'durationValue',
      'durationUnit',
      'pptUrl',
      'videoUrl',
      'scenarioText',
      'scenarioImageUrl',
      'isActive',
    ]) {
      if (typeof body?.[key] !== 'undefined') updates[key] = body[key];
    }
    const [row] = await db.update(enablers).set(updates).where(eq(enablers.id, enablerId as any)).returning();
    return NextResponse.json({ enabler: row });
  } catch (e) {
    console.error('Update enabler error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { enablerId: string } }) {
  try {
    const { enablerId } = params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');
    if (!trainerId) return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
  const [row0] = await db.select().from(enablers).where(eq(enablers.id, enablerId as any));
    if (!row0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const member = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, row0.courseId as any), eq(courseMembers.userId, trainerId as any), eq(courseMembers.role, 'TRAINER' as any)));
    const [courseRow] = await db.select().from(courses).where(eq(courses.id, row0.courseId as any));
    const isCreator = courseRow ? String(courseRow.createdById) === String(trainerId) : false;
    if (!member.length && !isCreator) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    await db.delete(enablers).where(eq(enablers.id, enablerId as any));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Delete enabler error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
