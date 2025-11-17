import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  profiles,
  courseMembers,
  courses,
  enablers,
  enablerCompletions,
  useCases,
  useCaseSubmissions,
  geschäftsprozesseSubmissions,
  Geschäftsprozesse,
  quizzes,
  quizAssignments,
  quizSubmissions,
  enablerQuizLinks,
  traineeEnablerOverrides,
  traineeUseCaseOverrides,
  traineeGeschaeftsprozesseOverrides,
} from '@/db/migrations/schemas/schema';

export async function GET(_req: NextRequest, { params }: { params: { traineeId: string } }) {
  try {
    const { traineeId } = params;

    // Basic trainee info
    const [p] = await db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        avatarUrl: profiles.avatarUrl,
        startOfTrainingDate: profiles.startOfTrainingDate,
      })
      .from(profiles)
      .where(eq(profiles.id, traineeId as any))
      .limit(1);
    if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Courses trainee belongs to
    const memberCourseRows = await db
      .select({ courseId: courseMembers.courseId })
      .from(courseMembers)
      .where(and(eq(courseMembers.userId, traineeId as any), eq(courseMembers.role, 'TRAINEE')));
    const courseIds = memberCourseRows.map((r) => r.courseId);

    // Enablers for those courses
    const enablerRows = courseIds.length
      ? await db
          .select({ id: enablers.id, title: enablers.title, courseId: enablers.courseId, isActive: enablers.isActive, orderIndex: enablers.orderIndex })
          .from(enablers)
          .where(inArray(enablers.courseId, courseIds as any))
      : [];
    const enablerIds = enablerRows.map((e) => e.id);

    // Enabler completions for this trainee
    const completionRows = enablerIds.length
      ? await db
          .select({ enablerId: enablerCompletions.enablerId })
          .from(enablerCompletions)
          .where(and(eq(enablerCompletions.traineeId, traineeId as any), inArray(enablerCompletions.enablerId, enablerIds as any)))
      : [];
    const completedSet = new Set(completionRows.map((r) => String(r.enablerId)));
    const completedEnablers = completedSet.size;
    const totalEnablers = enablerIds.length;
    const progressPct = totalEnablers > 0 ? Math.round((completedEnablers / totalEnablers) * 100) : 0;

    // Use cases and their latest submission for this trainee
    const useCaseRows = courseIds.length
      ? await db
          .select({ id: useCases.id, title: useCases.title, isActive: useCases.isActive, courseId: useCases.courseId, orderIndex: useCases.orderIndex })
          .from(useCases)
          .where(inArray(useCases.courseId, courseIds as any))
      : [];
    const useCaseIds = useCaseRows.map((u) => u.id);
    const latestUseCaseSubmissions = useCaseIds.length
      ? await db
          .select({
            id: useCaseSubmissions.id,
            useCaseId: useCaseSubmissions.useCaseId,
            status: useCaseSubmissions.status,
            attemptNumber: useCaseSubmissions.attemptNumber,
            submittedAt: useCaseSubmissions.submittedAt,
          })
          .from(useCaseSubmissions)
          .where(and(eq(useCaseSubmissions.traineeId, traineeId as any), inArray(useCaseSubmissions.useCaseId, useCaseIds as any)))
          .orderBy(desc(useCaseSubmissions.submittedAt))
      : [];
    const latestUseCaseById = new Map<string, typeof latestUseCaseSubmissions[number]>();
    for (const sub of latestUseCaseSubmissions) {
      const key = String(sub.useCaseId);
      if (!latestUseCaseById.has(key)) latestUseCaseById.set(key, sub);
    }

    // Geschäftsprozesse and latest submission
    const gpRows = courseIds.length
      ? await db
          .select({ id: Geschäftsprozesse.id, title: Geschäftsprozesse.title, isActive: Geschäftsprozesse.isActive, courseId: Geschäftsprozesse.courseId, orderIndex: Geschäftsprozesse.orderIndex })
          .from(Geschäftsprozesse)
          .where(inArray(Geschäftsprozesse.courseId, courseIds as any))
      : [];
    const gpIds = gpRows.map((g) => g.id);
    const latestGpSubmissions = gpIds.length
      ? await db
          .select({
            id: geschäftsprozesseSubmissions.id,
            gpId: geschäftsprozesseSubmissions.geschäftsprozesseId,
            status: geschäftsprozesseSubmissions.status,
            attemptNumber: geschäftsprozesseSubmissions.attemptNumber,
            submittedAt: geschäftsprozesseSubmissions.submittedAt,
          })
          .from(geschäftsprozesseSubmissions)
          .where(and(eq(geschäftsprozesseSubmissions.traineeId, traineeId as any), inArray(geschäftsprozesseSubmissions.geschäftsprozesseId, gpIds as any)))
          .orderBy(desc(geschäftsprozesseSubmissions.submittedAt))
      : [];
    const latestGpById = new Map<string, typeof latestGpSubmissions[number]>();
    for (const sub of latestGpSubmissions) {
      const key = String(sub.gpId);
      if (!latestGpById.has(key)) latestGpById.set(key, sub);
    }

    // Enabler-level quizzes: by difficulty per enabler
    const enablerQuizRows = enablerIds.length
      ? await db
          .select({ id: enablerQuizLinks.id, enablerId: enablerQuizLinks.enablerId, quizId: enablerQuizLinks.quizId, difficulty: enablerQuizLinks.difficulty })
          .from(enablerQuizLinks)
          .where(inArray(enablerQuizLinks.enablerId, enablerIds as any))
      : [];
    const enablerQuizIds = enablerQuizRows.map((r) => r.quizId);
    const enablerQuizSubmissions = enablerQuizIds.length
      ? await db
          .select({
            id: quizSubmissions.id,
            quizId: quizSubmissions.quizId,
            score: quizSubmissions.score,
            isReviewed: quizSubmissions.isReviewed,
            attemptNumber: quizSubmissions.attemptNumber,
            submittedAt: quizSubmissions.submittedAt,
          })
          .from(quizSubmissions)
          .where(and(eq(quizSubmissions.traineeId, traineeId as any), inArray(quizSubmissions.quizId, enablerQuizIds as any)))
          .orderBy(desc(quizSubmissions.submittedAt))
      : [];
    const latestQuizSubByQuizId = new Map<string, typeof enablerQuizSubmissions[number]>();
    for (const s of enablerQuizSubmissions) {
      const key = String(s.quizId);
      if (!latestQuizSubByQuizId.has(key)) latestQuizSubByQuizId.set(key, s);
    }

    // Global quizzes assigned to this trainee
    const assignedGlobalRows = await db
      .select({ quizId: quizAssignments.quizId })
      .from(quizAssignments)
      .where(eq(quizAssignments.traineeId, traineeId as any));
    const assignedQuizIds = assignedGlobalRows.map((r) => r.quizId);
    const assignedQuizzes = assignedQuizIds.length
      ? await db
          .select({ id: quizzes.id, title: quizzes.title, isActive: quizzes.isActive })
          .from(quizzes)
          .where(inArray(quizzes.id, assignedQuizIds as any))
      : [];
    const globalQuizSubs = assignedQuizIds.length
      ? await db
          .select({
            id: quizSubmissions.id,
            quizId: quizSubmissions.quizId,
            score: quizSubmissions.score,
            isReviewed: quizSubmissions.isReviewed,
            attemptNumber: quizSubmissions.attemptNumber,
            submittedAt: quizSubmissions.submittedAt,
          })
          .from(quizSubmissions)
          .where(and(eq(quizSubmissions.traineeId, traineeId as any), inArray(quizSubmissions.quizId, assignedQuizIds as any)))
          .orderBy(desc(quizSubmissions.submittedAt))
      : [];
    const latestGlobalQuizById = new Map<string, typeof globalQuizSubs[number]>();
    for (const s of globalQuizSubs) {
      const key = String(s.quizId);
      if (!latestGlobalQuizById.has(key)) latestGlobalQuizById.set(key, s);
    }

    // Pending counts
    const pendingUseCases = Array.from(latestUseCaseById.values()).filter((s) => s.status === 'PENDING').length;
    const pendingGeschProz = Array.from(latestGpById.values()).filter((s) => s.status === 'PENDING').length;
    const pendingQuizReviews = Array.from(latestQuizSubByQuizId.values()).concat(Array.from(latestGlobalQuizById.values())).filter((s) => s && !s.isReviewed).length;

    return NextResponse.json({
      trainee: {
        id: p.id,
        full_name: p.fullName,
        avatar_url: p.avatarUrl,
        training_start_date: p.startOfTrainingDate,
      },
      stats: {
        progressPct,
        completedEnablers,
        totalEnablers,
        pending: {
          quizzes: pendingQuizReviews,
          useCases: pendingUseCases,
          geschaeftsprozesse: pendingGeschProz,
        },
      },
      enablers: await (async () => {
        // apply overrides for active state
        const oRows = enablerIds.length
          ? await db
              .select({ enablerId: traineeEnablerOverrides.enablerId, isActive: traineeEnablerOverrides.isActive })
              .from(traineeEnablerOverrides)
              .where(and(eq(traineeEnablerOverrides.traineeId, traineeId as any), inArray(traineeEnablerOverrides.enablerId, enablerIds as any)))
          : [];
        const oMap = new Map<string, boolean | null>();
        oRows.forEach((r) => oMap.set(String(r.enablerId), r.isActive === null ? null : Boolean(r.isActive)));
        return enablerRows.map((e) => {
          const override = oMap.get(String(e.id));
          const effectiveActive = typeof override === 'boolean' ? override : Boolean(e.isActive);
          return {
            id: e.id,
            title: e.title,
            courseId: e.courseId,
            isActive: effectiveActive,
            orderIndex: e.orderIndex,
            completed: completedSet.has(String(e.id)),
            link: `/trainee/enablers/${e.id}`,
          };
        });
      })(),
      useCases: await (async () => {
        const oRows = useCaseIds.length
          ? await db
              .select({ useCaseId: traineeUseCaseOverrides.useCaseId, isActive: traineeUseCaseOverrides.isActive })
              .from(traineeUseCaseOverrides)
              .where(and(eq(traineeUseCaseOverrides.traineeId, traineeId as any), inArray(traineeUseCaseOverrides.useCaseId, useCaseIds as any)))
          : [];
        const oMap = new Map<string, boolean | null>();
        oRows.forEach((r) => oMap.set(String(r.useCaseId), r.isActive === null ? null : Boolean(r.isActive)));
        return useCaseRows.map((u) => {
        const latest = latestUseCaseById.get(String(u.id));
          const override = oMap.get(String(u.id));
          const effectiveActive = typeof override === 'boolean' ? override : Boolean(u.isActive);
          return {
            id: u.id,
            title: u.title,
            isActive: effectiveActive,
            status: latest?.status || null,
            attemptNumber: latest?.attemptNumber || null,
            submittedAt: latest?.submittedAt || null,
            link: `/trainee/use-cases/${u.id}`,
          };
        });
      })(),
      geschaeftsprozesse: await (async () => {
        const oRows = gpIds.length
          ? await db
              .select({ gpId: traineeGeschaeftsprozesseOverrides.geschaeftsprozesseId, isActive: traineeGeschaeftsprozesseOverrides.isActive })
              .from(traineeGeschaeftsprozesseOverrides)
              .where(and(eq(traineeGeschaeftsprozesseOverrides.traineeId, traineeId as any), inArray(traineeGeschaeftsprozesseOverrides.geschaeftsprozesseId, gpIds as any)))
          : [];
        const oMap = new Map<string, boolean | null>();
        oRows.forEach((r) => oMap.set(String(r.gpId), r.isActive === null ? null : Boolean(r.isActive)));
        return gpRows.map((g) => {
        const latest = latestGpById.get(String(g.id));
          const override = oMap.get(String(g.id));
          const effectiveActive = typeof override === 'boolean' ? override : Boolean(g.isActive);
          return {
            id: g.id,
            title: g.title,
            isActive: effectiveActive,
            status: latest?.status || null,
            attemptNumber: latest?.attemptNumber || null,
            submittedAt: latest?.submittedAt || null,
            link: `/trainee/gesetzesprozesse/${g.id}`,
          };
        });
      })(),
      enablerQuizzes: enablerQuizRows.map((r) => {
        const latest = latestQuizSubByQuizId.get(String(r.quizId));
        return {
          enablerId: r.enablerId,
          quizId: r.quizId,
          difficulty: r.difficulty,
          lastScore: latest?.score ?? null,
          attemptNumber: latest?.attemptNumber ?? null,
          isReviewed: latest?.isReviewed ?? null,
          link: `/trainee/enablers/${r.enablerId}/quiz`,
        };
      }),
      globalQuizzes: assignedQuizzes.map((q) => {
        const latest = latestGlobalQuizById.get(String(q.id));
        return {
          quizId: q.id,
          title: q.title,
          isActive: q.isActive,
          lastScore: latest?.score ?? null,
          attemptNumber: latest?.attemptNumber ?? null,
          isReviewed: latest?.isReviewed ?? null,
          link: `/trainee/quizzes/${q.id}`,
        };
      }),
    });
  } catch (e) {
    console.error('Trainee overview error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
