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
import { apiCache, ApiCache, cacheHeaders } from '@/lib/api-cache';

// Passing score threshold for quizzes (50%)
const PASS_THRESHOLD = 50;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  try {
    // Use cached data if available
    const cacheKey = `trainee_dashboard_${userId}`;
    const cached = await apiCache.getOrFetch(
      cacheKey,
      async () => {
        return await fetchDashboardData(userId);
      },
      ApiCache.TTL.MEDIUM // 5 minutes cache
    );

    return NextResponse.json(cached, {
      headers: cacheHeaders.medium,
    });
  } catch (e) {
    console.error('Trainee dashboard error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

async function fetchDashboardData(userId: string) {
  try {
    // ── Phase 1a: Core user data (4 queries max) ──
    const [memberCourses, userQuizSubs, allCompletionsRaw, achievedSkillsRaw] =
      await Promise.all([
        db
          .select({
            id: courses.id,
            title: courses.title,
            year: courses.year,
          })
          .from(courseMembers)
          .innerJoin(courses, eq(courseMembers.courseId, courses.id))
          .where(
            and(
              eq(courseMembers.userId, userId as any),
              eq(courseMembers.role, 'TRAINEE' as any)
            )
          ),
        db
          .select({
            quizId: quizSubmissions.quizId,
            score: quizSubmissions.score,
          })
          .from(quizSubmissions)
          .where(eq(quizSubmissions.traineeId, userId as any)),
        // Single query for completions – reused for nextItem + weekly progress + streak
        db
          .select({
            enablerId: enablerCompletions.enablerId,
            completedAt: enablerCompletions.completedAt,
          })
          .from(enablerCompletions)
          .where(eq(enablerCompletions.traineeId, userId as any))
          .orderBy(desc(enablerCompletions.completedAt)),
        db
          .select({ skillId: traineeAchievedSkills.skillId })
          .from(traineeAchievedSkills)
          .where(eq(traineeAchievedSkills.traineeId, userId as any)),
      ]);

    // ── Phase 1b: Achievement + quiz timeline (3 queries max) ──
    const [recentQuizWithTitle, recentEnWithTitle, quizSubRows] =
      await Promise.all([
        db
          .select({
            score: quizSubmissions.score,
            submittedAt: quizSubmissions.submittedAt,
            quizTitle: quizzes.title,
          })
          .from(quizSubmissions)
          .innerJoin(quizzes, eq(quizSubmissions.quizId, quizzes.id))
          .where(eq(quizSubmissions.traineeId, userId as any))
          .orderBy(desc(quizSubmissions.submittedAt))
          .limit(1),
        db
          .select({
            completedAt: enablerCompletions.completedAt,
            enablerTitle: enablers.title,
          })
          .from(enablerCompletions)
          .innerJoin(enablers, eq(enablerCompletions.enablerId, enablers.id))
          .where(eq(enablerCompletions.traineeId, userId as any))
          .orderBy(desc(enablerCompletions.completedAt))
          .limit(1),
        db
          .select({ at: quizSubmissions.submittedAt })
          .from(quizSubmissions)
          .where(eq(quizSubmissions.traineeId, userId as any))
          .orderBy(desc(quizSubmissions.submittedAt)),
      ]);

    const courseIds = memberCourses.map(c => c.id);
    const completedSet = new Set(
      allCompletionsRaw.map(c => String(c.enablerId))
    );
    const achievedSet = new Set(achievedSkillsRaw.map(a => String(a.skillId)));

    // Build quiz best-scores map
    const quizBestScores = new Map<string, number>();
    for (const s of userQuizSubs) {
      const qid = String(s.quizId);
      const currentBest = quizBestScores.get(qid) || 0;
      if ((s.score || 0) > currentBest) {
        quizBestScores.set(qid, s.score || 0);
      }
    }

    // ── Phase 2: courseId-dependent queries in PARALLEL ──
    const modules: Array<{ id: string; title: string; progress: number }> = [];
    let nextItem: any = null;
    let skillRadar: Array<{ skill: string; value: number }> = [];

    if (courseIds.length > 0) {
      const [allEnablers, useCaseRows, allEns, courseSkillRows] =
        await Promise.all([
          // All enablers for these courses
          db
            .select({
              id: enablers.id,
              courseId: enablers.courseId,
              scenarios: enablers.scenarios,
            })
            .from(enablers)
            .where(
              and(
                inArray(enablers.courseId, courseIds as any),
                eq(enablers.isActive, true)
              )
            ),
          // Use cases for these courses
          db
            .select({ id: useCases.id, courseId: useCases.courseId })
            .from(useCases)
            .where(
              and(
                inArray(useCases.courseId, courseIds as any),
                eq(useCases.isActive, true)
              )
            ),
          // All enablers ordered (for nextItem)
          db
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
            .orderBy(asc(courses.year), asc(enablers.orderIndex)),
          // Course skills (for radar)
          db
            .select({ skillId: courseSkills.skillId, name: skills.name })
            .from(courseSkills)
            .innerJoin(skills, eq(courseSkills.skillId, skills.id))
            .where(inArray(courseSkills.courseId, courseIds as any)),
        ]);

      const allEnablerIds = allEnablers.map(e => e.id);
      const useCaseIds = useCaseRows.map(u => u.id);

      // ── Phase 3: enablerIds/useCaseIds-dependent queries in PARALLEL ──
      const [quizLinks, enablerSubRows, useCaseSubRows] = await Promise.all([
        allEnablerIds.length > 0
          ? db
              .select({
                enablerId: enablerQuizLinks.enablerId,
                quizId: enablerQuizLinks.quizId,
              })
              .from(enablerQuizLinks)
              .where(inArray(enablerQuizLinks.enablerId, allEnablerIds as any))
          : Promise.resolve([]),
        allEnablerIds.length > 0
          ? db
              .select({ enablerId: enablerSubmissions.enablerId })
              .from(enablerSubmissions)
              .where(
                and(
                  eq(enablerSubmissions.traineeId, userId as any),
                  inArray(enablerSubmissions.enablerId, allEnablerIds as any),
                  eq(enablerSubmissions.status, 'APPROVED')
                )
              )
          : Promise.resolve([]),
        useCaseIds.length > 0
          ? db
              .select({ useCaseId: useCaseSubmissions.useCaseId })
              .from(useCaseSubmissions)
              .where(
                and(
                  eq(useCaseSubmissions.traineeId, userId as any),
                  inArray(useCaseSubmissions.useCaseId, useCaseIds as any),
                  eq(useCaseSubmissions.status, 'APPROVED')
                )
              )
          : Promise.resolve([]),
      ]);

      const approvedEnablerSubs = new Set(
        enablerSubRows.map(r => String(r.enablerId))
      );
      const approvedUseCases = new Set(
        useCaseSubRows.map(r => String(r.useCaseId))
      );

      // Calculate progress per course with STRICT logic
      for (const c of memberCourses) {
        const courseEnablers = allEnablers.filter(
          e => String(e.courseId) === String(c.id)
        );
        const totalEnablers = courseEnablers.length;

        const courseUseCases = useCaseRows.filter(
          u => String(u.courseId) === String(c.id)
        );
        const totalUseCases = courseUseCases.length;
        const approvedUseCaseCount = courseUseCases.filter(u =>
          approvedUseCases.has(String(u.id))
        ).length;

        // Count completed enablers with STRICT logic
        let completedCount = 0;
        for (const enabler of courseEnablers) {
          const enablerId = String(enabler.id);

          // Check ALL quizzes must be passed
          const enablerQuizzes = quizLinks.filter(
            l => String(l.enablerId) === enablerId
          );
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

          // Check scenarios – must be approved
          const hasScenarios =
            enabler.scenarios &&
            Array.isArray(enabler.scenarios) &&
            enabler.scenarios.length > 0;
          let scenariosApproved = true;
          if (hasScenarios) {
            scenariosApproved = approvedEnablerSubs.has(enablerId);
          }

          if (allQuizzesPassed && scenariosApproved) {
            completedCount++;
          }
        }

        // Calculate weighted progress
        const enablerProgress =
          totalEnablers > 0 ? completedCount / totalEnablers : 1;
        const useCaseProgress =
          totalUseCases > 0 ? approvedUseCaseCount / totalUseCases : 1;

        let pct: number;
        if (totalEnablers > 0 && totalUseCases > 0) {
          pct = Math.round(
            (enablerProgress * 0.7 + useCaseProgress * 0.3) * 100
          );
        } else if (totalEnablers > 0) {
          pct = Math.round(enablerProgress * 100);
        } else if (totalUseCases > 0) {
          pct = Math.round(useCaseProgress * 100);
        } else {
          pct = 0;
        }

        modules.push({ id: String(c.id), title: c.title, progress: pct });
      }

      // Next item: next uncompleted enabler
      for (const e of allEns) {
        if (!completedSet.has(String(e.id))) {
          const dur = e.durationValue
            ? `${e.durationValue} ${e.durationUnit?.toLowerCase()}`
            : '';
          nextItem = {
            lessonId: e.id,
            lessonTitle: e.title,
            moduleTitle: e.courseTitle,
            estimatedTime: dur,
          };
          break;
        }
      }

      // Skills radar
      const uniqueSkills = new Map<string, string>();
      courseSkillRows.forEach(row =>
        uniqueSkills.set(String(row.skillId), row.name || '')
      );
      skillRadar = Array.from(uniqueSkills.entries())
        .slice(0, 6)
        .map(([id, name]) => ({
          skill: name,
          value: achievedSet.has(id) ? 100 : 30,
        }));
    }

    // ── Compute weekly progress from Phase 1 results (no DB) ──
    const weeks = 6;
    const now = new Date();
    const weeklyBuckets: Array<{ week: string; progress: number }> = [];
    for (let i = weeks - 1; i >= 0; i--) {
      weeklyBuckets.push({ week: `W${weeks - i}`, progress: 0 });
    }
    const addToBucket = (dt: Date | null) => {
      if (!dt) return;
      const diffDays = Math.floor(
        (now.getTime() - dt.getTime()) / (1000 * 60 * 60 * 24)
      );
      const bucketIndex = Math.floor(diffDays / 7);
      if (bucketIndex >= 0 && bucketIndex < weeks) {
        weeklyBuckets[weeks - 1 - bucketIndex].progress += 1;
      }
    };
    // Reuse allCompletionsRaw (has completedAt) – no separate compRows query needed
    allCompletionsRaw.forEach(r =>
      addToBucket(r.completedAt ? new Date(r.completedAt as any) : null)
    );
    quizSubRows.forEach(r => addToBucket(r.at ? new Date(r.at as any) : null));

    // ── Achievements from Phase 1 results (no DB) ──
    const achievements: Array<{
      kind: 'quiz' | 'module' | 'streak';
      text: string;
      at?: string | null;
    }> = [];

    if (recentQuizWithTitle.length > 0) {
      const sub = recentQuizWithTitle[0];
      achievements.push({
        kind: 'quiz',
        text: `${Math.round(sub.score ?? 0)}% im Quiz "${sub.quizTitle || 'Quiz'}"`,
        at: sub.submittedAt?.toISOString?.() || null,
      });
    }

    if (recentEnWithTitle.length > 0) {
      const en = recentEnWithTitle[0];
      achievements.push({
        kind: 'module',
        text: `Enabler "${en.enablerTitle || 'Modul'}" abgeschlossen`,
        at: (en.completedAt as any)?.toISOString?.() || null,
      });
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
      const rows = allCompletionsRaw.filter(r => {
        if (!r.completedAt) return false;
        const d = new Date(r.completedAt as any);
        return d >= dayStart && d < dayEnd;
      });
      if (rows.length > 0) streak += 1;
      else break;
    }
    if (streak >= 3) {
      achievements.push({
        kind: 'streak',
        text: `${streak} Tage in Folge gelernt`,
        at: new Date().toISOString(),
      });
    }

    const deadlines: any[] = [];

    // Skill radar fallback
    if (skillRadar.length === 0 && modules.length > 0) {
      skillRadar = modules
        .slice(0, 6)
        .map(m => ({ skill: m.title, value: m.progress }));
    }

    return {
      modules,
      nextItem,
      weeklyProgress: weeklyBuckets,
      skillRadar,
      achievements,
      deadlines,
    };
  } catch (e) {
    console.error('Dashboard API data fetch error', e);
    throw e;
  }
}
