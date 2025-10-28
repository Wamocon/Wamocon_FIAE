import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import {
  courseMembers,
  courses,
  enablers,
  enablerCompletions,
  traineeAchievedSkills,
  skills,
  courseSkills,
  quizzes,
  quizSubmissions,
  activityLog,
} from '@/db/migrations/schemas/schema';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  try {
    // Courses this trainee is in
    const memberCourses = await db
      .select({ id: courses.id, title: courses.title, year: courses.year })
      .from(courseMembers)
      .innerJoin(courses, eq(courseMembers.courseId, courses.id))
      .where(and(eq(courseMembers.userId, userId as any), eq(courseMembers.role, 'TRAINEE' as any)));
    const courseIds = memberCourses.map((c) => c.id);

    // Enablers per course and completions by this trainee
    let modules: Array<{ id: string; title: string; progress: number }> = [];
    if (courseIds.length > 0) {
      for (const c of memberCourses) {
        const ens = await db.select({ id: enablers.id }).from(enablers).where(eq(enablers.courseId, c.id as any));
        const enablerIds = ens.map((e) => e.id);
        let pct = 0;
        if (enablerIds.length > 0) {
          const [{ cnt = 0 } = { cnt: 0 }] = await db
            .select({ cnt: count() })
            .from(enablerCompletions)
            .where(and(eq(enablerCompletions.traineeId, userId as any), inArray(enablerCompletions.enablerId, enablerIds as any)));
          pct = Math.round((Number(cnt) / enablerIds.length) * 100);
        }
        modules.push({ id: String(c.id), title: c.title, progress: pct });
      }
    }

    // Next item: next uncompleted enabler by course year asc, enabler orderIndex asc
    let nextItem: any = null;
    if (courseIds.length > 0) {
      const allEns = await db
        .select({
          id: enablers.id,
          title: enablers.title,
          orderIndex: enablers.orderIndex,
          durationValue: enablers.durationValue,
          durationUnit: enablers.durationUnit,
          courseId: enablers.courseId,
          courseTitle: courses.title,
          courseYear: courses.year,
        })
        .from(enablers)
        .innerJoin(courses, eq(enablers.courseId, courses.id))
        .where(inArray(enablers.courseId, courseIds as any))
        .orderBy(asc(courses.year), asc(enablers.orderIndex));

      for (const e of allEns) {
        const done = await db
          .select({ t: enablerCompletions.traineeId })
          .from(enablerCompletions)
          .where(and(eq(enablerCompletions.traineeId, userId as any), eq(enablerCompletions.enablerId, e.id as any)))
          .limit(1);
        if (done.length === 0) {
          const dur = e.durationValue ? `${e.durationValue} ${e.durationUnit?.toLowerCase()}` : '';
          nextItem = {
            lessonId: e.id, // reusing field for navigation; maps to an Enabler in new schema
            lessonTitle: e.title,
            moduleTitle: e.courseTitle,
            estimatedTime: dur,
          };
          break;
        }
      }
    }

    // Weekly progress: count enabler completions over last 6 weeks -> normalize 0-100
    const compRows = await db
      .select({ at: enablerCompletions.completedAt })
      .from(enablerCompletions)
      .where(eq(enablerCompletions.traineeId, userId as any))
      .orderBy(desc(enablerCompletions.completedAt));
    const weeks = 6;
    const now = new Date();
    const weeklyBuckets: Array<{ week: string; progress: number }> = [];
    for (let i = weeks - 1; i >= 0; i--) {
      weeklyBuckets.push({ week: `W${weeks - i}`, progress: 0 });
    }
    for (const r of compRows) {
      const dt = r.at ? new Date(r.at as any) : null;
      if (!dt) continue;
      const diffDays = Math.floor((now.getTime() - dt.getTime()) / (1000 * 60 * 60 * 24));
      const bucketIndex = Math.floor(diffDays / 7);
      if (bucketIndex >= 0 && bucketIndex < weeks) {
        const idx = weeks - 1 - bucketIndex;
        weeklyBuckets[idx].progress += 1;
      }
    }
    const maxVal = weeklyBuckets.reduce((m, b) => Math.max(m, b.progress), 0) || 1;
    const weeklyProgress = weeklyBuckets.map((b) => ({ week: b.week, progress: Math.round((b.progress / maxVal) * 100) }));

    // Skills radar: top skills from trainee courses; mark 100 if achieved else 30
    let skillRadar: Array<{ skill: string; value: number }> = [];
    if (courseIds.length > 0) {
      const cs = await db
        .select({ skillId: courseSkills.skillId, name: skills.name })
        .from(courseSkills)
        .innerJoin(skills, eq(courseSkills.skillId, skills.id))
        .where(inArray(courseSkills.courseId, courseIds as any));
      const achieved = await db
        .select({ skillId: traineeAchievedSkills.skillId })
        .from(traineeAchievedSkills)
        .where(eq(traineeAchievedSkills.traineeId, userId as any));
      const achievedSet = new Set(achieved.map((a) => String(a.skillId)));
      const uniqueSkills = new Map<string, string>();
      cs.forEach((row) => uniqueSkills.set(String(row.skillId), row.name || ''));
      skillRadar = Array.from(uniqueSkills.entries())
        .slice(0, 6)
        .map(([id, name]) => ({ skill: name, value: achievedSet.has(id) ? 100 : 30 }));
    }

    // Achievements: recent quiz submission and recent enabler completion; simple streak from completions
    const achievements: Array<{ kind: 'quiz' | 'module' | 'streak'; text: string; at?: string | null }> = [];
    const recentSub = await db
      .select({ quizId: quizSubmissions.quizId, score: quizSubmissions.score, submittedAt: quizSubmissions.submittedAt })
      .from(quizSubmissions)
      .where(eq(quizSubmissions.traineeId, userId as any))
      .orderBy(desc(quizSubmissions.submittedAt))
      .limit(1);
    if (recentSub.length > 0) {
      const sub = recentSub[0];
      const [qz] = await db.select({ title: quizzes.title }).from(quizzes).where(eq(quizzes.id, sub.quizId as any)).limit(1);
      achievements.push({ kind: 'quiz', text: `${Math.round(sub.score ?? 0)}% im Quiz "${qz?.title || 'Quiz'}"`, at: sub.submittedAt?.toISOString?.() || null });
    }
    const recentEn = await db
      .select({ at: enablerCompletions.completedAt, enablerId: enablerCompletions.enablerId })
      .from(enablerCompletions)
      .where(eq(enablerCompletions.traineeId, userId as any))
      .orderBy(desc(enablerCompletions.completedAt))
      .limit(1);
    if (recentEn.length > 0) {
      const en = recentEn[0];
      const [e] = await db.select({ title: enablers.title }).from(enablers).where(eq(enablers.id, en.enablerId as any)).limit(1);
      achievements.push({ kind: 'module', text: `Enabler "${e?.title || 'Modul'}" abgeschlossen`, at: (en.at as any)?.toISOString?.() || null });
    }
    // Streak
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const dayStart = new Date(today);
      dayStart.setHours(0, 0, 0, 0);
      dayStart.setDate(dayStart.getDate() - i);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayStart.getDate() + 1);
      const rows = compRows.filter((r) => {
        if (!r.at) return false;
        const d = new Date(r.at as any);
        return d >= dayStart && d < dayEnd;
      });
      if (rows.length > 0) streak += 1; else break;
    }
    if (streak >= 3) {
      achievements.push({ kind: 'streak', text: `${streak} Tage in Folge gelernt`, at: new Date().toISOString() });
    }

    // Deadlines: not available in new schema; return empty to keep UI clean
    const deadlines: any[] = [];

    // Skill radar fallback if empty
    if (skillRadar.length === 0 && modules.length > 0) {
      skillRadar = modules.slice(0, 6).map((m) => ({ skill: m.title, value: m.progress }));
    }

    return NextResponse.json({ modules, nextItem, weeklyProgress, skillRadar, achievements, deadlines });
  } catch (e) {
    console.error('Dashboard API error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
