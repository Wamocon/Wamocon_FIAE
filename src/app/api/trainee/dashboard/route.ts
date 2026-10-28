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
  useCases,
  useCaseSubmissions,
  profiles,
} from '@/db/migrations/schemas/schema';
import { apiCache, ApiCache, cacheHeaders } from '@/lib/api-cache';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import {
  catalogCacheKey,
  catalogCondition,
  requireCatalogScopeForUser,
  type CatalogScope,
} from '@/lib/catalog/scope';
import {
  loadEnrollmentTerms,
  loadPhasePlan,
} from '@/lib/catalog/phase-plan-db';
import { loadCourseProgressions } from '@/lib/catalog/progression-db';
import type { EnablerProgression } from '@/lib/catalog/progression';
import {
  getPhaseDeadline,
  getPhaseMonthRange,
  getTrainingPhase,
  normalizeDurationYears,
  type ContentStage,
  type TrainingPhase,
} from '@/lib/ausbildung/duration';

// The dashboard of the session user, a userId in the query is ignored.
export async function GET(req: NextRequest) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;
  const userId = session.id;

  try {
    const scope = await requireCatalogScopeForUser(userId, req);
    if (scope instanceof Response) return scope;

    // Use cached data if available (the catalog scope is part of the key)
    const cacheKey = `trainee_dashboard_${userId}_${catalogCacheKey(scope)}`;
    const cached = await apiCache.getOrFetch(
      cacheKey,
      async () => {
        return await fetchDashboardData(userId, scope);
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

async function fetchDashboardData(userId: string, scope: CatalogScope) {
  try {
    // ── Phase 1: All user data in ONE parallel batch (was 2 sequential phases) ──
    const [
      memberCourses,
      allQuizSubs,
      allCompletionsRaw,
      achievedSkillsRaw,
      recentQuizWithTitle,
      recentEnWithTitle,
    ] = await Promise.all([
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
            eq(courseMembers.role, 'TRAINEE' as any),
            catalogCondition(courses.trainingCatalogId, scope)
          )
        ),
      // Merged: quiz scores + timestamps (was 2 separate queries)
      db
        .select({
          quizId: quizSubmissions.quizId,
          score: quizSubmissions.score,
          submittedAt: quizSubmissions.submittedAt,
        })
        .from(quizSubmissions)
        .where(eq(quizSubmissions.traineeId, userId as any)),
      // Completions – reused for nextItem + weekly progress + streak
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
      // Recent quiz with title (for achievements, LIMIT 1)
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
      // Recent enabler completion with title (for achievements, LIMIT 1)
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
    ]);

    const courseIds = memberCourses.map(c => c.id);
    const achievedSet = new Set(achievedSkillsRaw.map(a => String(a.skillId)));

    // ── Phase 2: courseId-dependent queries in PARALLEL ──
    const modules: Array<{ id: string; title: string; progress: number }> = [];
    let nextItem: any = null;
    let skillRadar: Array<{ skill: string; value: number }> = [];

    if (courseIds.length > 0) {
      // ── Phase 2: courseId-dependent (3 queries, was 4 – merged enabler queries) ──
      const [allEnablerData, useCaseRows, courseSkillRows] = await Promise.all([
        // All enablers with full data (merged: active check + nextItem ordering)
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
            scenarioPdfUrl: enablers.scenarioPdfUrl,
            isActive: enablers.isActive,
          })
          .from(enablers)
          .innerJoin(courses, eq(enablers.courseId, courses.id))
          .where(inArray(enablers.courseId, courseIds as any))
          .orderBy(asc(courses.year), asc(enablers.orderIndex)),
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
        // Course skills (for radar)
        db
          .select({ skillId: courseSkills.skillId, name: skills.name })
          .from(courseSkills)
          .innerJoin(skills, eq(courseSkills.skillId, skills.id))
          .where(inArray(courseSkills.courseId, courseIds as any)),
      ]);

      // Filter to active enablers for the next item
      const allEnablers = allEnablerData.filter(e => e.isActive);
      const useCaseIds = useCaseRows.map(u => u.id);

      // The completion of every enabler, by the one definition (quizzes
      // passed), and the state in the order of work
      const progressions = await loadCourseProgressions(
        userId,
        courseIds.map(String)
      );
      const enablerStates = new Map<string, EnablerProgression>();
      for (const p of progressions.values()) {
        for (const e of p.progression.enablers) {
          enablerStates.set(e.enablerId, e);
        }
      }

      const useCaseSubRows =
        useCaseIds.length > 0
          ? await db
              .select({ useCaseId: useCaseSubmissions.useCaseId })
              .from(useCaseSubmissions)
              .where(
                and(
                  eq(useCaseSubmissions.traineeId, userId as any),
                  inArray(useCaseSubmissions.useCaseId, useCaseIds as any),
                  eq(useCaseSubmissions.status, 'APPROVED')
                )
              )
          : [];
      const approvedUseCases = new Set(
        useCaseSubRows.map(r => String(r.useCaseId))
      );

      type UseCaseType = (typeof useCaseRows)[number];
      const useCasesByCourse = new Map<string, UseCaseType[]>();
      for (const u of useCaseRows) {
        const key = String(u.courseId);
        if (!useCasesByCourse.has(key)) useCasesByCourse.set(key, []);
        useCasesByCourse.get(key)!.push(u);
      }

      // Calculate progress per course
      for (const c of memberCourses) {
        const cId = String(c.id);
        const own = progressions.get(cId)?.progression;
        const totalEnablers = own?.totalCount ?? 0;
        const completedCount = own?.completedCount ?? 0;

        const courseUseCases = useCasesByCourse.get(cId) || [];
        const totalUseCases = courseUseCases.length;

        let approvedUseCaseCount = 0;
        for (const u of courseUseCases) {
          if (approvedUseCases.has(String(u.id))) {
            approvedUseCaseCount++;
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

        modules.push({ id: cId, title: c.title, progress: pct });
      }

      // Next item: the first active enabler that is not completed and that the
      // trainee may work on (not locked)
      for (const e of allEnablers) {
        const state = enablerStates.get(String(e.id));
        if (state && !state.completed && !state.locked) {
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
    allQuizSubs.forEach(r =>
      addToBucket(r.submittedAt ? new Date(r.submittedAt as any) : null)
    );

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

    // Module phase deadlines: the phase plan of the occupation decides (FIAE
    // 18+18 months, intensive plans 12+12, KfBM 15+21). Integrative phase 3
    // runs across the whole plan.
    try {
      const [traineeProfile] = await db
        .select({
          startOfTrainingDate: profiles.startOfTrainingDate,
          ausbildungDurationYears: profiles.ausbildungDurationYears,
        })
        .from(profiles)
        .where(eq(profiles.id, userId as any))
        .limit(1);

      // A trainee in several trainings counts with the start date and duration
      // of the training of the tab: the first enrollment follows the profile, a
      // further one has its own terms. Single training: the profile, as ever.
      // Asked for every trainee: whether an enrollment is a further one depends
      // on all the enrollments, not only on the usable ones of the scope.
      const terms = await loadEnrollmentTerms(userId, scope.activeCatalogId);
      const startDate = terms?.startDate
        ? new Date(terms.startDate)
        : traineeProfile?.startOfTrainingDate;
      if (startDate) {
        const durationYears = normalizeDurationYears(
          terms?.durationYears ?? traineeProfile?.ausbildungDurationYears
        );
        const phasePlan = await loadPhasePlan(
          scope.activeCatalogId,
          durationYears
        );
        const phaseOneMonths = phasePlan.phaseMonths[0];
        const currentStage = getTrainingPhase(
          startDate,
          durationYears,
          new Date(),
          phaseOneMonths
        );
        const stageYears = Array.from(
          new Set(
            memberCourses
              .map(c => c.year)
              .filter((y): y is number => y === 1 || y === 2 || y === 3)
          )
        ).sort((a, b) => a - b);

        const getPhaseLabel = (stage: ContentStage): string => {
          if (stage === 3) {
            return `Integrative Fertigkeiten (1. bis ${durationYears * 12}. Ausbildungsmonat)`;
          }
          const range = getPhaseMonthRange(
            durationYears,
            stage as TrainingPhase,
            phaseOneMonths
          );
          return `Phase ${stage} (${range.startMonth}. bis ${range.endMonth}. Ausbildungsmonat)`;
        };

        for (const year of stageYears) {
          // Only surface the current and upcoming phases as deadlines.
          if (year < currentStage) continue;
          const dueDate = getPhaseDeadline(
            startDate,
            durationYears,
            year as ContentStage,
            phaseOneMonths
          );
          deadlines.push({
            label: getPhaseLabel(year as ContentStage),
            dueDate: dueDate.toISOString(),
            year,
          });
        }
      }
    } catch (deadlineErr) {
      console.error('Dashboard deadlines computation error', deadlineErr);
    }

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
