import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import { courses, courseMembers, enablers } from '@/db/migrations/schemas/schema';

// GET courses for a trainee with active enablers
// query: traineeId
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const traineeId = searchParams.get('traineeId');
    if (!traineeId) return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    const memberships = await db
      .select()
      .from(courseMembers)
      .where(eq(courseMembers.userId, traineeId as any));
    const courseIds = memberships.map((m) => m.courseId);
    if (!courseIds.length) return NextResponse.json({ courses: [] });

    const rows = await db.select().from(courses).where(inArray(courses.id, courseIds as any));
    const enablerRows = await db
      .select()
      .from(enablers)
      .where(and(inArray(enablers.courseId, courseIds as any), eq(enablers.isActive, true)))
      .orderBy(enablers.orderIndex);

    const result = rows.map((c) => ({
      id: c.id,
      title: c.title,
      year: c.year,
      chapter: c.chapter,
      enablers: enablerRows.filter((e) => String(e.courseId) === String(c.id)).map((e) => ({ id: e.id, title: e.title })),
    }));

    return NextResponse.json({ courses: result });
  } catch (e) {
    console.error('Trainee courses GET error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
