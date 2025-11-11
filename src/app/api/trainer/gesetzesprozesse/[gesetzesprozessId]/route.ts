import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ gesetzesprozessId: string }> }) {
  try {
    const { gesetzesprozesse } = await import('@/db/migrations/schemas/schema');
    const { gesetzesprozessId } = await params;
    const [row] = await db.select().from(gesetzesprozesse).where(eq(gesetzesprozesse.id, gesetzesprozessId as any));
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ gesetzesprozess: row });
  } catch (e) {
    console.error('Get gesetzesprozess error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ gesetzesprozessId: string }> }) {
  try {
    const { gesetzesprozesse, courseMembers, courses, notifications } = await import('@/db/migrations/schemas/schema');
    const { gesetzesprozessId } = await params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');
    if (!trainerId) return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    const [row0] = await db.select().from(gesetzesprozesse).where(eq(gesetzesprozesse.id, gesetzesprozessId as any));
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
      'descriptionText',
      'isActive',
    ]) {
      if (typeof body?.[key] !== 'undefined') updates[key] = body[key];
    }
    if (typeof body?.isActive === 'boolean' && body.isActive && !row0.isActive && !row0.activatedAt) {
      updates.activatedAt = new Date();
    }
    const [row] = await db.update(gesetzesprozesse).set(updates).where(eq(gesetzesprozesse.id, gesetzesprozessId as any)).returning();

    try {
      if (updates.activatedAt) {
        const traineeMemberRows = await db
          .select({ userId: courseMembers.userId })
          .from(courseMembers)
          .where(and(eq(courseMembers.courseId, row0.courseId as any), eq(courseMembers.role, 'TRAINEE' as any)));
        if (traineeMemberRows.length) {
          const values = traineeMemberRows.map((m) => ({
            userId: String(m.userId),
            actorId: trainerId,
            type: 'USE_CASE_ACTIVATED',
            title: 'Neuer Gesetzesprozess aktiviert',
            message: `Ein Gesetzesprozess wurde aktiviert: ${row0.title}`,
            linkUrl: '/trainee/modules',
            context: { gesetzesprozessId, courseId: row0.courseId },
          }));
          await db.insert(notifications).values(values);
        }
      }
    } catch (notifyErr) {
      console.warn('Failed to notify trainees for gesetzesprozess activation', notifyErr);
    }
    return NextResponse.json({ gesetzesprozess: row });
  } catch (e) {
    console.error('Update gesetzesprozess error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ gesetzesprozessId: string }> }) {
  try {
    const { gesetzesprozesse, courseMembers, courses } = await import('@/db/migrations/schemas/schema');
    const { gesetzesprozessId } = await params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');
    if (!trainerId) return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    const [row0] = await db.select().from(gesetzesprozesse).where(eq(gesetzesprozesse.id, gesetzesprozessId as any));
    if (!row0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const member = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, row0.courseId as any), eq(courseMembers.userId, trainerId as any), eq(courseMembers.role, 'TRAINER' as any)));
    const [courseRow] = await db.select().from(courses).where(eq(courses.id, row0.courseId as any));
    const isCreator = courseRow ? String(courseRow.createdById) === String(trainerId) : false;
    if (!member.length && !isCreator) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    await db.delete(gesetzesprozesse).where(eq(gesetzesprozesse.id, gesetzesprozessId as any));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Delete gesetzesprozess error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
