import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';

export async function GET(_req: NextRequest, { params }: { params: { useCaseId: string } }) {
  try {
    const { useCases } = await import('@/db/migrations/schemas/schema');
    const { useCaseId } = params;
    const [row] = await db.select().from(useCases).where(eq(useCases.id, useCaseId as any));
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ useCase: row });
  } catch (e) {
    console.error('Get use-case error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { useCaseId: string } }) {
  try {
  const { useCases, courseMembers, courses } = await import('@/db/migrations/schemas/schema');
    const { useCaseId } = params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');
    if (!trainerId) return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    const [row0] = await db.select().from(useCases).where(eq(useCases.id, useCaseId as any));
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
    const [row] = await db.update(useCases).set(updates).where(eq(useCases.id, useCaseId as any)).returning();
    return NextResponse.json({ useCase: row });
  } catch (e) {
    console.error('Update use-case error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { useCaseId: string } }) {
  try {
  const { useCases, courseMembers, courses } = await import('@/db/migrations/schemas/schema');
    const { useCaseId } = params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');
    if (!trainerId) return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    const [row0] = await db.select().from(useCases).where(eq(useCases.id, useCaseId as any));
    if (!row0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const member = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, row0.courseId as any), eq(courseMembers.userId, trainerId as any), eq(courseMembers.role, 'TRAINER' as any)));
    const [courseRow] = await db.select().from(courses).where(eq(courses.id, row0.courseId as any));
    const isCreator = courseRow ? String(courseRow.createdById) === String(trainerId) : false;
    if (!member.length && !isCreator) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    await db.delete(useCases).where(eq(useCases.id, useCaseId as any));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Delete use-case error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
