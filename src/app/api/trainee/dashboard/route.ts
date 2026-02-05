import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import {
  courseMembers,
  courses,
  enablers,
  enablerCompletions,
  enablerQuizLinks,
  traineeAchievedSkills,
  skills,
  courseSkills,
  quizzes,
  quizSubmissions,
  enablerSubmissions,
  useCases,
  useCaseSubmissions,
} from '@/db/migrations/schemas/schema';

// Passing score threshold for quizzes (50%)
const PASS_THRESHOLD = 50;

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

    // Calculate module progress with STRICT criteria
    const modules: Array<{ id: string; title: string; progress: number }> = [];
    if (courseIds.length > 0) {
      // Get all enablers for these courses
      const allEnablers = await db
        .select({ id: enablers.id, courseId: enablers.courseId, scenarios: enablers.scenarios })
        .from(enablers)
        .where(and(inArray(enablers.courseId, courseIds as any), eq(enablers.isActive, true)));
      const allEnablerIds = allEnablers.map(e => e.id);

      // Get all quiz submissions WITH scores
      const userQuizSubs = await db
        .select({ quizId: quizSubmissions.quizId, score: quizSubmissions.score })
        .from(quizSubmissions)
        .where(eq(quizSubmissions.traineeId, userId as any));

      // Map quizId -> highest score
      const quizBestScores = new Map<string, number>();
      for (const s of userQuizSubs) {
        const qid = String(s.quizId);
        const currentBest = quizBestScores.get(qid) || 0;
        if ((s.score || 0) > currentBest) {
          quizBestScores.set(qid, s.score || 0);
        }
      }

      // Get enabler-quiz links
      const quizLinks = allEnablerIds.length > 0 ? await db
        .select({ enablerId: enablerQuizLinks.enablerId, quizId: enablerQuizLinks.quizId })
        .from(enablerQuizLinks)
        .where(inArray(enablerQuizLinks.enablerId, allEnablerIds as any)) : [];

      // Get APPROVED scenario submissions
      const enablerSubRows = allEnablerIds.length > 0 ? await db
        .select({ enablerId: enablerSubmissions.enablerId })
        .from(enablerSubmissions)
        .where(and(
          eq(enablerSubmissions.traineeId, userId as any),
          inArray(enablerSubmissions.enablerId, allEnablerIds as any),
          eq(enablerSubmissions.status, 'APPROVED')
        )) : [];
      const approvedEnablerSubs = new Set(enablerSubRows.map(r => String(r.enablerId)));

      // Get use cases and their approved submissions
      const useCaseRows = await db
        .select({ id: useCases.id, courseId: useCases.courseId })
        .from(useCases)
        .where(and(inArray(useCases.courseId, courseIds as any), eq(useCases.isActive, true)));

      const useCaseIds = useCaseRows.map(u => u.id);
      const useCaseSubRows = useCaseIds.length > 0 ? await db
        .select({ useCaseId: useCaseSubmissions.useCaseId })
        .from(useCaseSubmissions)
        .where(and(
          eq(useCaseSubmissions.traineeId, userId as any),
          inArray(useCaseSubmissions.useCaseId, useCaseIds as any),
          eq(useCaseSubmissions.status, 'APPROVED')
        )) : [];
      const approvedUseCases = new Set(useCaseSubRows.map(r => String(r.useCaseId)));

      // Calculate progress per course with STRICT logic
      for (const c of memberCourses) {
        const courseEnablers = allEnablers.filter(e => String(e.courseId) === String(c.id));
        const totalEnablers = courseEnablers.length;

        const courseUseCases = useCaseRows.filter(u => String(u.courseId) === String(c.id));
        const totalUseCases = courseUseCases.length;
        const approvedUseCaseCount = courseUseCases.filter(u => approvedUseCases.has(String(u.id))).length;

        // Count completed enablers with STRICT logic
        let completedCount = 0;
        for (const enabler of courseEnablers) {
          const enablerId = String(enabler.id);

          // Check ALL quizzes must be passed
          const enablerQuizzes = quizLinks.filter(l => String(l.enablerId) === enablerId);
          let allQuizzesPassed = true;

          if (enablerQuizzes.length > 0) {
            for (const link of enablerQuizzes) {
              const score = quizBestScores.get(String(link.quizId)) || 0;
              if (score < PASS_THRESHOLD) {
                allQuizzesPassed = false;
                break;
              }
            }
          }

          // Check scenarios - must be approved
          const hasScenarios = enabler.scenarios && Array.isArray(enabler.scenarios) && enabler.scenarios.length > 0;
          let scenariosApproved = true;
          if (hasScenarios) {
            scenariosApproved = approvedEnablerSubs.has(enablerId);
          }

          // Enabler complete ONLY if ALL quizzes passed AND ALL scenarios approved
          if (allQuizzesPassed && scenariosApproved) {
            completedCount++;
          }
        }

        // Calculate weighted progress
        const enablerProgress = totalEnablers > 0 ? (completedCount / totalEnablers) : 1;
        const useCaseProgress = totalUseCases > 0 ? (approvedUseCaseCount / totalUseCases) : 1;

        let pct: number;
        if (totalEnablers > 0 && totalUseCases > 0) {
          pct = Math.round((enablerProgress * 0.7 + useCaseProgress * 0.3) * 100);
        } else if (totalEnablers > 0) {
          pct = Math.round(enablerProgress * 100);
        } else if (totalUseCases > 0) {
          pct = Math.round(useCaseProgress * 100);
        } else {
          pct = 0;
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
            lessonId: e.id,
            lessonTitle: e.title,
            moduleTitle: e.courseTitle,
            estimatedTime: dur,
          };
          break;
        }
      }
    }

    // Weekly progress: count quiz submissions + enabler completions over last 6 weeks
    const compRows = await db
      .select({ at: enablerCompletions.completedAt })
      .from(enablerCompletions)
      .where(eq(enablerCompletions.traineeId, userId as any))
      .orderBy(desc(enablerCompletions.completedAt));

    const quizSubRows = await db
      .select({ at: quizSubmissions.submittedAt })
      .from(quizSubmissions)
      .where(eq(quizSubmissions.traineeId, userId as any))
      .orderBy(desc(quizSubmissions.submittedAt));

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

    for (const r of quizSubRows) {
      const dt = r.at ? new Date(r.at as any) : null;
      if (!dt) continue;
      const diffDays = Math.floor((now.getTime() - dt.getTime()) / (1000 * 60 * 60 * 24));
      const bucketIndex = Math.floor(diffDays / 7);
      if (bucketIndex >= 0 && bucketIndex < weeks) {
        const idx = weeks - 1 - bucketIndex;
        weeklyBuckets[idx].progress += 1;
      }
    }

    const weeklyProgress = weeklyBuckets;

    // Skills radar
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

    // Achievements
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

    const deadlines: any[] = [];

    // Skill radar fallback
    if (skillRadar.length === 0 && modules.length > 0) {
      skillRadar = modules.slice(0, 6).map((m) => ({ skill: m.title, value: m.progress }));
    }

    return NextResponse.json({ modules, nextItem, weeklyProgress, skillRadar, achievements, deadlines });
  } catch (e) {
    console.error('Dashboard API error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
