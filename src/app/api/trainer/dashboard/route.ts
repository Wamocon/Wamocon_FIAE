import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, desc, eq, gt, inArray, or } from 'drizzle-orm';
import { profiles, progress, subLessons, knowledgeSubmissions, reflections, modules, lessons } from '@/db/migrations/schemas/schema';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    let trainerAuthId = searchParams.get('trainerAuthId');
    const trainerProfileId = searchParams.get('trainerProfileId');
    if (!trainerAuthId && trainerProfileId) {
      // Resolve auth_id from profile id for robustness
      const row = await db
        .select({ auth_id: profiles.auth_id })
        .from(profiles)
        .where(eq(profiles.id, trainerProfileId as any))
        .limit(1);
      if (row.length > 0) trainerAuthId = String(row[0].auth_id);
    }
    if (!trainerAuthId) {
      return NextResponse.json({ error: 'Missing trainerAuthId' }, { status: 400 });
    }

    // 1) Trainees list (accept both possibilities: column stores trainer auth id OR trainer profile id)
    const traineeRows = await db
      .select({ id: profiles.id, full_name: profiles.full_name, avatar_url: profiles.avatar_url })
      .from(profiles)
      .where(
        and(
          eq(profiles.role, 'trainee' as any),
          or(
            eq(profiles.trainer_auth_id, trainerAuthId as any),
            trainerProfileId ? eq(profiles.trainer_auth_id, trainerProfileId as any) : eq(profiles.trainer_auth_id, '__never__')
          )
        )
      );

    const traineeIds = traineeRows.map(t => t.id);

    // 2) Total sub-lessons to compute progress percentage
    const [{ totalSubs = 0 } = { totalSubs: 0 }] = await db
      .select({ totalSubs: count() })
      .from(subLessons);

    // 3) Completed sub-lessons per trainee (grouped)
    const completedByUser = traineeIds.length
      ? await db
          .select({ user_id: progress.user_id, completed: count() })
          .from(progress)
          .where(inArray(progress.user_id, traineeIds as any))
          .groupBy(progress.user_id)
      : [];
    const completedMap = new Map<string, number>(completedByUser.map(r => [String(r.user_id), Number(r.completed)]));

    const trainees = traineeRows.map(t => {
      const completed = completedMap.get(String(t.id)) || 0;
      const pct = totalSubs > 0 ? Math.round((completed / Number(totalSubs)) * 100) : 0;
      return { id: t.id, full_name: t.full_name, avatar_url: t.avatar_url, progress: pct };
    });

    // 4) Pending reviews (knowledge submissions pending)
    const [{ pending = 0 } = { pending: 0 }] = traineeIds.length
      ? await db
          .select({ pending: count() })
          .from(knowledgeSubmissions)
          .where(and(eq(knowledgeSubmissions.status, 'pending' as any), inArray(knowledgeSubmissions.user_id, traineeIds as any)))
      : [{ pending: 0 }];

    // 5) Recent reflections submitted in last 7 days
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [{ reflectionsCount = 0 } = { reflectionsCount: 0 }] = traineeIds.length
      ? await db
          .select({ reflectionsCount: count() })
          .from(reflections)
          .where(and(gt(reflections.submitted_at, lastWeek as any), inArray(reflections.user_id, traineeIds as any)))
      : [{ reflectionsCount: 0 }];

    // 6) Weekly progress trend across all trainees (last 6 weeks, normalized 0-100)
    const weeks = 6;
    const progRows = traineeIds.length
      ? await db
          .select({ completed_at: progress.completed_at })
          .from(progress)
          .where(inArray(progress.user_id, traineeIds as any))
          .orderBy(desc(progress.completed_at))
      : [];
    const now = new Date();
    const trendBuckets: { week: string; progress: number }[] = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const label = `W${weeks - i}`;
      trendBuckets.push({ week: label, progress: 0 });
    }
    for (const r of progRows) {
      if (!r.completed_at) continue;
      const dt = new Date(r.completed_at as any);
      const diffDays = Math.floor((now.getTime() - dt.getTime()) / (1000 * 60 * 60 * 24));
      const bucketIndex = Math.floor(diffDays / 7);
      if (bucketIndex >= 0 && bucketIndex < weeks) {
        const idx = weeks - 1 - bucketIndex;
        trendBuckets[idx].progress += 1;
      }
    }
    const maxVal = trendBuckets.reduce((m, b) => Math.max(m, b.progress), 0) || 1;
    const progressTrend = trendBuckets.map(b => ({ week: b.week, progress: Math.round((b.progress / maxVal) * 100) }));

    // 7) Module progress distribution (completed / inProgress / notStarted per module across trainees)
    const modList = await db.select({ id: modules.id, title: modules.title }).from(modules).orderBy(modules.order_index);
    const moduleProgress = [] as Array<{ name: string; completed: number; inProgress: number; notStarted: number }>;
    for (const m of modList) {
      const lessonIds = (await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.module_id, m.id))).map(r => r.id);
      if (lessonIds.length === 0) {
        moduleProgress.push({ name: m.title, completed: 0, inProgress: 0, notStarted: trainees.length });
        continue;
      }
      const subIds = (await db.select({ id: subLessons.id }).from(subLessons).where(inArray(subLessons.lesson_id, lessonIds))).map(r => r.id);
      if (subIds.length === 0) {
        moduleProgress.push({ name: m.title, completed: 0, inProgress: 0, notStarted: trainees.length });
        continue;
      }
      const byUser = traineeIds.length
        ? await db
            .select({ user_id: progress.user_id, c: count() })
            .from(progress)
            .where(and(inArray(progress.sub_lesson_id, subIds), inArray(progress.user_id, traineeIds as any)))
            .groupBy(progress.user_id)
        : [];
      const map = new Map<string, number>(byUser.map(r => [String(r.user_id), Number(r.c)]));
      let completedCnt = 0, inProgressCnt = 0, notStartedCnt = 0;
      for (const t of trainees) {
        const c = map.get(String(t.id)) || 0;
        if (c === 0) notStartedCnt++;
        else if (c === subIds.length) completedCnt++;
        else inProgressCnt++;
      }
      moduleProgress.push({ name: m.title, completed: completedCnt, inProgress: inProgressCnt, notStarted: notStartedCnt });
    }

    return NextResponse.json({ trainees, counts: { activeTrainees: trainees.length, pendingReviews: Number(pending) || 0, recentReflections: Number(reflectionsCount) || 0 }, charts: { progressTrend, moduleProgress } });
  } catch (e) {
    console.error('Trainer dashboard API error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
