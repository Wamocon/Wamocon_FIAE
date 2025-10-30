import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { courses, courseMembers, enablers, useCases } from '@/db/migrations/schemas/schema';

// GET course details for a trainee: includes active enablers and use-cases
// query: traineeId
export async function GET(req: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { searchParams } = new URL(req.url);
    const traineeId = searchParams.get('traineeId');
    const { courseId } = await params;
    if (!traineeId) return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    const [member] = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, courseId as any), eq(courseMembers.userId, traineeId as any)));
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const [c] = await db.select().from(courses).where(eq(courses.id, courseId as any));
    if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const ens = await db
      .select()
      .from(enablers)
      .where(and(eq(enablers.courseId, courseId as any), eq(enablers.isActive, true)))
      .orderBy(enablers.orderIndex);
    const ucs = await db
      .select()
      .from(useCases)
      .where(and(eq(useCases.courseId, courseId as any), eq(useCases.isActive, true)))
      .orderBy(useCases.orderIndex);

    return NextResponse.json({
      course: { id: c.id, title: c.title, year: c.year, chapter: c.chapter },
      enablers: ens.map((e) => ({ id: e.id, title: e.title })),
      useCases: ucs.map((u) => ({ id: u.id, title: u.title })),
    });
  } catch (e) {
    console.error('Trainee course detail GET error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
