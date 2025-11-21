import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { courses, courseMembers, enablers, useCases, enablerSubmissions, useCaseSubmissions } from '@/db/migrations/schemas/schema';

// GET course details for a trainee: includes active enablers and use-cases
// query: traineeId
export async function GET(
  req: NextRequest,
  context: { params: { courseId: string } }
) {
  try {
    const { searchParams } = new URL(req.url);
    const traineeId = searchParams.get('traineeId');
    const { courseId } = await context.params;
    if (!traineeId) return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    const [member] = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, courseId), eq(courseMembers.userId, traineeId)));
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const [c] = await db.select().from(courses).where(eq(courses.id, courseId));
    if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const ens = await db
      .select()
      .from(enablers)
      .where(and(eq(enablers.courseId, courseId), eq(enablers.isActive, true)))
      .orderBy(enablers.orderIndex);
    const ucs = await db
      .select()
      .from(useCases)
      .where(and(eq(useCases.courseId, courseId), eq(useCases.isActive, true)))
      .orderBy(useCases.orderIndex);
    // Geschäftsprozesse removed

    // Latest attempts for this trainee per enabler/use-case
    const enIds = ens.map((e) => String(e.id));
    const ucIds = ucs.map((u) => String(u.id));

    const enAttempts = enIds.length
      ? await db
          .select({ id: enablerSubmissions.id, enablerId: enablerSubmissions.enablerId, attemptNumber: enablerSubmissions.attemptNumber, submittedAt: enablerSubmissions.submittedAt })
          .from(enablerSubmissions)
          .where(and(eq(enablerSubmissions.traineeId, traineeId as any)))
      : [];
    const ucAttempts = ucIds.length
      ? await db
          .select({ id: useCaseSubmissions.id, useCaseId: useCaseSubmissions.useCaseId, attemptNumber: useCaseSubmissions.attemptNumber, submittedAt: useCaseSubmissions.submittedAt })
          .from(useCaseSubmissions)
          .where(and(eq(useCaseSubmissions.traineeId, traineeId as any)))
      : [];
    // Removed geschäftsprozesse attempts

    // Reduce to latest by submittedAt
    const latestEn: Record<string, { attemptNumber: number | null }> = {};
    for (const row of enAttempts) {
      const key = String(row.enablerId);
      if (!latestEn[key] || new Date(latestEn[key] as any).getTime() < new Date(row.submittedAt as any).getTime()) {
        latestEn[key] = { attemptNumber: row.attemptNumber ?? null };
      }
    }
    const latestUc: Record<string, { attemptNumber: number | null }> = {};
    for (const row of ucAttempts) {
      const key = String(row.useCaseId);
      if (!latestUc[key] || new Date(latestUc[key] as any).getTime() < new Date(row.submittedAt as any).getTime()) {
        latestUc[key] = { attemptNumber: row.attemptNumber ?? null };
      }
    }
    // Removed geschäftsprozesse latest attempts aggregation

    return NextResponse.json({
      course: { id: c.id, title: c.title, year: c.year, chapter: c.chapter },
      enablers: ens.map((e) => ({ id: e.id, title: e.title, attemptNumber: latestEn[String(e.id)]?.attemptNumber ?? null })),
      useCases: ucs.map((u) => ({ id: u.id, title: u.title, attemptNumber: latestUc[String(u.id)]?.attemptNumber ?? null })),
      // Geschäftsprozesse removed from response
    });
  } catch (e) {
    console.error('Trainee course detail GET error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
