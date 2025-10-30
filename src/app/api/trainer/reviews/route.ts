import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import { courses, courseMembers, enablers, enablerSubmissions, profiles, useCases, useCaseSubmissions } from '@/db/migrations/schemas/schema';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');
    const onlyPending = searchParams.get('onlyPending') === 'true';
    const type = searchParams.get('type'); // 'enabler' | 'usecase' | undefined (both)
    if (!trainerId) return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });

    // Determine courses the trainer can review: creator or member (TRAINER)
    const created = await db.select({ id: courses.id }).from(courses).where(eq(courses.createdById, trainerId as any));
    const member = await db.select({ courseId: courseMembers.courseId }).from(courseMembers).where(and(eq(courseMembers.userId, trainerId as any), eq(courseMembers.role, 'TRAINER' as any)));
    const courseIds = Array.from(new Set([...(created.map(c => String(c.id))), ...(member.map(m => String(m.courseId)))]));
    if (!courseIds.length) return NextResponse.json({ enablerSubmissions: [], useCaseSubmissions: [] });

    const statuses = onlyPending ? ['PENDING'] : undefined;

    let enablerRows: any[] = [];
    let useCaseRows: any[] = [];

    if (!type || type === 'enabler') {
      // Get enabler submissions for trainer's courses
      const es = await db
        .select({
          id: enablerSubmissions.id,
          enablerId: enablerSubmissions.enablerId,
          traineeId: enablerSubmissions.traineeId,
          solutionText: enablerSubmissions.solutionText,
          status: enablerSubmissions.status,
          submittedAt: enablerSubmissions.submittedAt,
        })
        .from(enablerSubmissions)
        .leftJoin(enablers, eq(enablers.id, enablerSubmissions.enablerId))
        .where(inArray(enablers.courseId, courseIds as any));
      enablerRows = es.filter((r: any) => (statuses ? statuses.includes(String(r.status)) : true));

      if (enablerRows.length) {
        // Load titles and trainee names
        const enIds = Array.from(new Set(enablerRows.map(r => String(r.enablerId))));
        const trIds = Array.from(new Set(enablerRows.map(r => String(r.traineeId))));
        const enMapArr = await db.select({ id: enablers.id, title: enablers.title }).from(enablers).where(inArray(enablers.id, enIds as any));
        const trMapArr = await db.select({ id: profiles.id, fullName: profiles.fullName }).from(profiles).where(inArray(profiles.id, trIds as any));
        const enMap = Object.fromEntries(enMapArr.map((e) => [String(e.id), e.title]));
        const trMap = Object.fromEntries(trMapArr.map((p) => [String(p.id), p.fullName]));
        enablerRows = enablerRows.map(r => ({ ...r, enablerTitle: enMap[String(r.enablerId)] || 'Enabler', traineeName: trMap[String(r.traineeId)] || 'Unbekannt' }));
      }
    }

    if (!type || type === 'usecase') {
      const us = await db
        .select({
          id: useCaseSubmissions.id,
          useCaseId: useCaseSubmissions.useCaseId,
          traineeId: useCaseSubmissions.traineeId,
          submissionText: useCaseSubmissions.submissionText,
          status: useCaseSubmissions.status,
          submittedAt: useCaseSubmissions.submittedAt,
        })
        .from(useCaseSubmissions)
        .leftJoin(useCases, eq(useCases.id, useCaseSubmissions.useCaseId))
        .where(inArray(useCases.courseId, courseIds as any));
      useCaseRows = us.filter((r: any) => (statuses ? statuses.includes(String(r.status)) : true));

      if (useCaseRows.length) {
        const ucIds = Array.from(new Set(useCaseRows.map(r => String(r.useCaseId))));
        const trIds = Array.from(new Set(useCaseRows.map(r => String(r.traineeId))));
        const ucMapArr = await db.select({ id: useCases.id, title: useCases.title }).from(useCases).where(inArray(useCases.id, ucIds as any));
        const trMapArr = await db.select({ id: profiles.id, fullName: profiles.fullName }).from(profiles).where(inArray(profiles.id, trIds as any));
        const ucMap = Object.fromEntries(ucMapArr.map((e) => [String(e.id), e.title]));
        const trMap = Object.fromEntries(trMapArr.map((p) => [String(p.id), p.fullName]));
        useCaseRows = useCaseRows.map(r => ({ ...r, useCaseTitle: ucMap[String(r.useCaseId)] || 'Use Case', traineeName: trMap[String(r.traineeId)] || 'Unbekannt' }));
      }
    }

    return NextResponse.json({ enablerSubmissions: enablerRows, useCaseSubmissions: useCaseRows });
  } catch (e) {
    console.error('Trainer reviews GET error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
