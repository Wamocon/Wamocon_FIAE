import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  courses,
  courseMembers,
  enablers,
  enablerSubmissions,
  profiles,
  useCases,
  useCaseSubmissions,
} from '@/db/migrations/schemas/schema';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');
    const onlyPending = searchParams.get('onlyPending') === 'true';
    const type = searchParams.get('type'); // 'enabler' | 'usecase' | undefined (all)
    if (!trainerId)
      return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });

    // Determine courses the trainer can review: creator or member (TRAINER)
    const created = await db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.createdById, trainerId));
    const member = await db
      .select({ courseId: courseMembers.courseId })
      .from(courseMembers)
      .where(
        and(
          eq(courseMembers.userId, trainerId),
          eq(courseMembers.role, 'TRAINER')
        )
      );
    const courseIds = Array.from(
      new Set([
        ...created.map(c => String(c.id)),
        ...member.map(m => String(m.courseId)),
      ])
    );
    if (!courseIds.length)
      return NextResponse.json({
        enablerSubmissions: [],
        useCaseSubmissions: [],
      });

    // Build status filter conditions for SQL WHERE
    const statusFilter = onlyPending
      ? eq(enablerSubmissions.status, 'PENDING')
      : undefined;

    let enablerRows: Array<{
      id: string;
      enablerId: string;
      traineeId: string;
      solutionText: string | null;
      solutions: any;
      trainerFeedback: string | null;
      feedbacks: any;
      status: string | null;
      submittedAt: Date;
      enablerTitle?: string;
      traineeName?: string;
      attemptNumber?: number | null;
    }> = [];
    let useCaseRows: Array<{
      id: string;
      useCaseId: string;
      traineeId: string;
      submissionText: string | null;
      status: string | null;
      submittedAt: Date;
      useCaseTitle?: string;
      traineeName?: string;
      attemptNumber?: number | null;
    }> = [];
    if (!type || type === 'enabler') {
      // Get enabler submissions for trainer's courses
      const esWhere = statusFilter
        ? and(
            inArray(enablers.courseId, courseIds),
            eq(enablerSubmissions.status, 'PENDING')
          )
        : inArray(enablers.courseId, courseIds);
      const es = await db
        .select({
          id: enablerSubmissions.id,
          enablerId: enablerSubmissions.enablerId,
          traineeId: enablerSubmissions.traineeId,
          solutionText: enablerSubmissions.solutionText,
          solutions: enablerSubmissions.solutions,
          trainerFeedback: enablerSubmissions.trainerFeedback,
          feedbacks: enablerSubmissions.feedbacks,
          status: enablerSubmissions.status,
          submittedAt: enablerSubmissions.submittedAt,
          attemptNumber: enablerSubmissions.attemptNumber,
        })
        .from(enablerSubmissions)
        .leftJoin(enablers, eq(enablers.id, enablerSubmissions.enablerId))
        .where(esWhere);
      enablerRows = es;

      if (enablerRows.length) {
        // Load titles and trainee names
        const enIds = Array.from(
          new Set(enablerRows.map(r => String(r.enablerId)))
        );
        const trIds = Array.from(
          new Set(enablerRows.map(r => String(r.traineeId)))
        );
        const enMapArr = await db
          .select({ id: enablers.id, title: enablers.title })
          .from(enablers)
          .where(inArray(enablers.id, enIds));
        const trMapArr = await db
          .select({ id: profiles.id, fullName: profiles.fullName })
          .from(profiles)
          .where(inArray(profiles.id, trIds));
        const enMap = Object.fromEntries(
          enMapArr.map(e => [String(e.id), e.title])
        );
        const trMap = Object.fromEntries(
          trMapArr.map(p => [String(p.id), p.fullName])
        );
        enablerRows = enablerRows.map(r => ({
          ...r,
          enablerTitle: enMap[String(r.enablerId)] || 'Enabler',
          traineeName: trMap[String(r.traineeId)] || 'Unbekannt',
          attemptNumber: (r as any).attemptNumber,
        }));
      }
    }

    if (!type || type === 'usecase') {
      const usWhere = onlyPending
        ? and(
            inArray(useCases.courseId, courseIds),
            eq(useCaseSubmissions.status, 'PENDING')
          )
        : inArray(useCases.courseId, courseIds);
      const us = await db
        .select({
          id: useCaseSubmissions.id,
          useCaseId: useCaseSubmissions.useCaseId,
          traineeId: useCaseSubmissions.traineeId,
          submissionText: useCaseSubmissions.submissionText,
          status: useCaseSubmissions.status,
          submittedAt: useCaseSubmissions.submittedAt,
          attemptNumber: useCaseSubmissions.attemptNumber,
        })
        .from(useCaseSubmissions)
        .leftJoin(useCases, eq(useCases.id, useCaseSubmissions.useCaseId))
        .where(usWhere);
      useCaseRows = us;

      if (useCaseRows.length) {
        const ucIds = Array.from(
          new Set(useCaseRows.map(r => String(r.useCaseId)))
        );
        const trIds = Array.from(
          new Set(useCaseRows.map(r => String(r.traineeId)))
        );
        const ucMapArr = await db
          .select({ id: useCases.id, title: useCases.title })
          .from(useCases)
          .where(inArray(useCases.id, ucIds));
        const trMapArr = await db
          .select({ id: profiles.id, fullName: profiles.fullName })
          .from(profiles)
          .where(inArray(profiles.id, trIds));
        const ucMap = Object.fromEntries(
          ucMapArr.map(e => [String(e.id), e.title])
        );
        const trMap = Object.fromEntries(
          trMapArr.map(p => [String(p.id), p.fullName])
        );
        useCaseRows = useCaseRows.map(r => ({
          ...r,
          useCaseTitle: ucMap[String(r.useCaseId)] || 'Use Case',
          traineeName: trMap[String(r.traineeId)] || 'Unbekannt',
          attemptNumber: (r as any).attemptNumber,
        }));
      }
    }

    return NextResponse.json({
      enablerSubmissions: enablerRows,
      useCaseSubmissions: useCaseRows,
    });
  } catch (e) {
    console.error('Trainer reviews GET error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
