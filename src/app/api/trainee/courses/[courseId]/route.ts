import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import {
  courses,
  courseMembers,
  enablers,
  useCases,
  enablerSubmissions,
  useCaseSubmissions,
} from '@/db/migrations/schemas/schema';

// GET course details for a trainee: includes active enablers and use-cases with progress status
// query: traineeId
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ courseId: string }> }
) {
  try {
    const { searchParams } = new URL(req.url);
    const traineeId = searchParams.get('traineeId');
    const { courseId } = await context.params;
    if (!traineeId)
      return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    const [member] = await db
      .select()
      .from(courseMembers)
      .where(
        and(
          eq(courseMembers.courseId, courseId),
          eq(courseMembers.userId, traineeId)
        )
      );
    if (!member)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const [c] = await db
      .select({
        id: courses.id,
        title: courses.title,
        year: courses.year,
        chapter: courses.chapter,
      })
      .from(courses)
      .where(eq(courses.id, courseId));
    if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const ens = await db
      .select({ id: enablers.id, title: enablers.title })
      .from(enablers)
      .where(and(eq(enablers.courseId, courseId), eq(enablers.isActive, true)))
      .orderBy(enablers.orderIndex);
    const ucs = await db
      .select({ id: useCases.id, title: useCases.title })
      .from(useCases)
      .where(and(eq(useCases.courseId, courseId), eq(useCases.isActive, true)))
      .orderBy(useCases.orderIndex);

    // Latest attempts for this trainee per enabler/use-case including status
    // Gracefully handle RLS errors by returning empty data
    type EnablerAttempt = {
      id: string;
      enablerId: string | null;
      attemptNumber: number | null;
      submittedAt: Date | null;
      status: string | null;
    };
    type UseCaseAttempt = {
      id: string;
      useCaseId: string | null;
      attemptNumber: number | null;
      submittedAt: Date | null;
      status: string | null;
    };
    let enAttempts: EnablerAttempt[] = [];
    let ucAttempts: UseCaseAttempt[] = [];

    try {
      enAttempts = await db
        .select({
          id: enablerSubmissions.id,
          enablerId: enablerSubmissions.enablerId,
          attemptNumber: enablerSubmissions.attemptNumber,
          submittedAt: enablerSubmissions.submittedAt,
          status: enablerSubmissions.status,
        })
        .from(enablerSubmissions)
        .where(eq(enablerSubmissions.traineeId, traineeId as any));
    } catch (err: any) {
      console.warn(
        'Could not fetch enabler submissions (RLS or permission issue):',
        err?.message
      );
      // Continue with empty enAttempts
    }

    try {
      ucAttempts = await db
        .select({
          id: useCaseSubmissions.id,
          useCaseId: useCaseSubmissions.useCaseId,
          attemptNumber: useCaseSubmissions.attemptNumber,
          submittedAt: useCaseSubmissions.submittedAt,
          status: useCaseSubmissions.status,
        })
        .from(useCaseSubmissions)
        .where(eq(useCaseSubmissions.traineeId, traineeId as any));
    } catch (err: any) {
      console.warn(
        'Could not fetch use case submissions (RLS or permission issue):',
        err?.message
      );
      // Continue with empty ucAttempts
    }

    // Reduce to latest by submittedAt, including status
    const latestEn: Record<
      string,
      {
        attemptNumber: number | null;
        status: string | null;
        submittedAt: Date | null;
      }
    > = {};
    for (const row of enAttempts) {
      const key = String(row.enablerId);
      const rowTime = row.submittedAt
        ? new Date(row.submittedAt as any).getTime()
        : 0;
      const existingTime = latestEn[key]?.submittedAt
        ? new Date(latestEn[key].submittedAt as any).getTime()
        : 0;
      if (!latestEn[key] || rowTime > existingTime) {
        latestEn[key] = {
          attemptNumber: row.attemptNumber ?? null,
          status: row.status ?? null,
          submittedAt: row.submittedAt as Date | null,
        };
      }
    }

    const latestUc: Record<
      string,
      {
        attemptNumber: number | null;
        status: string | null;
        submittedAt: Date | null;
      }
    > = {};
    for (const row of ucAttempts) {
      const key = String(row.useCaseId);
      const rowTime = row.submittedAt
        ? new Date(row.submittedAt as any).getTime()
        : 0;
      const existingTime = latestUc[key]?.submittedAt
        ? new Date(latestUc[key].submittedAt as any).getTime()
        : 0;
      if (!latestUc[key] || rowTime > existingTime) {
        latestUc[key] = {
          attemptNumber: row.attemptNumber ?? null,
          status: row.status ?? null,
          submittedAt: row.submittedAt as Date | null,
        };
      }
    }

    return NextResponse.json({
      course: { id: c.id, title: c.title, year: c.year, chapter: c.chapter },
      enablers: ens.map(e => ({
        id: e.id,
        title: e.title,
        attemptNumber: latestEn[String(e.id)]?.attemptNumber ?? null,
        status: latestEn[String(e.id)]?.status ?? null, // PENDING, APPROVED, REJECTED
      })),
      useCases: ucs.map(u => ({
        id: u.id,
        title: u.title,
        attemptNumber: latestUc[String(u.id)]?.attemptNumber ?? null,
        status: latestUc[String(u.id)]?.status ?? null, // PENDING, APPROVED, REJECTED
      })),
    });
  } catch (e) {
    console.error('Trainee course detail GET error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
