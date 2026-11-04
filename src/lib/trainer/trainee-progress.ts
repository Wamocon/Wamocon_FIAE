/**
 * The ONE progress figure of a trainee on every trainer page (dashboard,
 * trainee list, trainee detail, PDF export, trend chart).
 *
 * Before, every page had its own formula: the dashboard counted the enablers of
 * the courses of the TRAINER, the lists counted rows of enabler_completions
 * (a table the quiz based completion does not write to, so everybody had 0 %)
 * and the detail page used the progression of the trainee. The numbers of one
 * trainee differed from page to page, and the trend chart plotted the number of
 * activities as if it were a percentage (3000 %).
 *
 * The definition is the one of the trainee area (src/lib/catalog/progression.ts):
 * an enabler is completed when every required lesson quiz is passed. The
 * enablers counted are the active enablers of the active courses the trainee is
 * a member of (an inactive course counts nowhere, like on the pages of the
 * trainee), inside the catalog scope of the request (the chosen tab), so a
 * trainee in two trainings has one figure per training.
 *
 * The computation is pure (summarizeTraineeProgress), the loader only feeds it.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { NextResponse } from 'next/server';
import db from '@/db';
import {
  courseMembers,
  courses,
  enablerQuizLinks,
  enablers,
  quizSubmissions,
  quizzes,
} from '@/db/migrations/schemas/schema';
import {
  bestScoresOf,
  isEnablerCompleted,
  isQuizRequired,
  PASS_THRESHOLD,
  type ProgressionQuizLink,
} from '@/lib/catalog/progression';
import { loadGradableQuizIds } from '@/lib/catalog/progression-db';
import {
  catalogCondition,
  requestedCatalogCode,
  requireCatalogScope,
  type CatalogRequestLike,
  type CatalogScope,
  type CatalogSubject,
} from '@/lib/catalog/scope';

export interface ProgressCourse {
  id: string;
  title: string;
  chapter: number | null;
  code: string | null;
}

export interface ProgressAttempt {
  quizId: string;
  score: number | null;
  submittedAt: Date | string | null;
}

export interface TraineeProgress {
  completed: number;
  total: number;
  /** 0 to 100, rounded, 0 without an enabler. */
  pct: number;
  /** Per course of the trainee (inside the scope): completed and total. */
  courses: Map<string, { completed: number; total: number }>;
  /**
   * When the enablers with a required quiz were completed: the moment the last
   * of their required quizzes was passed for the first time.
   */
  completionDates: Date[];
  /** Completed enablers without a required quiz (no date, always counted). */
  undated: number;
}

export interface ProgressInput {
  courseIds: ReadonlyArray<string>;
  enablers: ReadonlyArray<{ id: string; courseId: string; isActive: boolean }>;
  links: ReadonlyArray<ProgressionQuizLink>;
  attempts: ReadonlyArray<ProgressAttempt>;
}

export function percentOf(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Progress of ONE trainee from the data of the courses in scope. Pure: no
 * database, so the formula is the same wherever it is called and is tested on
 * its own.
 */
export function summarizeTraineeProgress(
  input: ProgressInput
): TraineeProgress {
  const inScope = new Set(input.courseIds.map(String));
  const bestScores = bestScoresOf(input.attempts);
  const linksOf = new Map<string, ProgressionQuizLink[]>();
  for (const link of input.links) {
    const key = String(link.enablerId);
    const list = linksOf.get(key);
    if (list) list.push(link);
    else linksOf.set(key, [link]);
  }
  // The first moment each quiz was passed (an attempt at or above the passing
  // score): the date a quiz counts from
  const firstPassed = new Map<string, Date>();
  for (const attempt of input.attempts) {
    if ((attempt.score ?? 0) < PASS_THRESHOLD) continue;
    const at = asDate(attempt.submittedAt);
    if (!at) continue;
    const key = String(attempt.quizId);
    const known = firstPassed.get(key);
    if (!known || at.getTime() < known.getTime()) firstPassed.set(key, at);
  }

  const perCourse = new Map<string, { completed: number; total: number }>();
  for (const id of inScope) perCourse.set(id, { completed: 0, total: 0 });
  const completionDates: Date[] = [];
  let undated = 0;
  let completed = 0;
  let total = 0;

  for (const enabler of input.enablers) {
    const courseId = String(enabler.courseId);
    if (!enabler.isActive || !inScope.has(courseId)) continue;
    const links = linksOf.get(String(enabler.id)) ?? [];
    const row = perCourse.get(courseId)!;
    row.total += 1;
    total += 1;
    if (!isEnablerCompleted(links, bestScores)) continue;
    row.completed += 1;
    completed += 1;
    const required = links.filter(isQuizRequired);
    if (required.length === 0) {
      undated += 1;
      continue;
    }
    const dates = required.map(l => firstPassed.get(String(l.quizId)));
    if (dates.every((d): d is Date => !!d)) {
      completionDates.push(new Date(Math.max(...dates.map(d => d.getTime()))));
    } else {
      // passed, but no date known: counts as of the beginning
      undated += 1;
    }
  }

  return {
    completed,
    total,
    pct: percentOf(completed, total),
    courses: perCourse,
    completionDates,
    undated,
  };
}

/** The progress of a trainee at a point in time (percent, 0 to 100). */
export function progressPercentAt(progress: TraineeProgress, at: Date): number {
  const dated = progress.completionDates.filter(
    d => d.getTime() <= at.getTime()
  ).length;
  return percentOf(progress.undated + dated, progress.total);
}

/**
 * The average progress of a group of trainees at the end of each of the last
 * `weeks` weeks (oldest first, the last point is now). 0 to 100 for every
 * point, 0 for a group without trainees.
 */
export function progressTrendOf(
  progresses: ReadonlyArray<TraineeProgress>,
  now: Date,
  weeks = 6
): { week: string; progress: number }[] {
  const points: { week: string; progress: number }[] = [];
  for (let i = 0; i < weeks; i++) {
    const end = new Date(now.getTime() - (weeks - 1 - i) * 7 * 86_400_000);
    const sum = progresses.reduce(
      (acc, p) => acc + progressPercentAt(p, end),
      0
    );
    points.push({
      week: `W${i + 1}`,
      progress: progresses.length ? Math.round(sum / progresses.length) : 0,
    });
  }
  return points;
}

export interface LoadedProgress {
  byTrainee: Map<string, TraineeProgress>;
  /** The courses in scope that at least one of the trainees is a member of. */
  courses: Map<string, ProgressCourse>;
}

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

/**
 * The occupation a request counts the progress in: null without a chosen
 * occupation (nothing is filtered and nothing is asked, as for the trainee
 * lists: a trainer with a single occupation sees what he always saw), the scope
 * for a valid choice, or the ready-made error response (403 for a foreign
 * occupation, 503 fail closed).
 */
export async function requireProgressScope(
  session: CatalogSubject,
  request: CatalogRequestLike
): Promise<CatalogScope | null | NextResponse> {
  if (!requestedCatalogCode(request)) return null;
  return requireCatalogScope(session, request);
}

/**
 * Loads the progress of many trainees at once (a fixed number of queries,
 * whatever the number of trainees). A trainee without a course in scope has
 * 0 of 0.
 */
export async function loadTraineeProgress(
  traineeIds: string[],
  scope: CatalogScope | null
): Promise<LoadedProgress> {
  const ids = unique(traineeIds.map(String));
  const byTrainee = new Map<string, TraineeProgress>();
  const courseMap = new Map<string, ProgressCourse>();
  const empty = (): TraineeProgress => ({
    completed: 0,
    total: 0,
    pct: 0,
    courses: new Map(),
    completionDates: [],
    undated: 0,
  });
  if (ids.length === 0) return { byTrainee, courses: courseMap };

  const memberRows = await db
    .select({
      userId: courseMembers.userId,
      courseId: courses.id,
      title: courses.title,
      chapter: courses.chapter,
      code: courses.code,
    })
    .from(courseMembers)
    .innerJoin(courses, eq(courseMembers.courseId, courses.id))
    .where(
      and(
        inArray(courseMembers.userId, ids as any),
        eq(courseMembers.role, 'TRAINEE'),
        // an inactive course counts nowhere: the course list of the trainee
        // leaves it out, so the figure of a trainee must be the same here
        eq(courses.isActive, true),
        scope ? catalogCondition(courses.trainingCatalogId, scope) : undefined
      )
    );

  const coursesOf = new Map<string, string[]>();
  for (const row of memberRows) {
    const userId = String(row.userId);
    const courseId = String(row.courseId);
    const list = coursesOf.get(userId) ?? [];
    if (!list.includes(courseId)) list.push(courseId);
    coursesOf.set(userId, list);
    courseMap.set(courseId, {
      id: courseId,
      title: String(row.title ?? ''),
      chapter: row.chapter ?? null,
      code: row.code ?? null,
    });
  }

  const courseIds = Array.from(courseMap.keys());
  const enablerRows = courseIds.length
    ? await db
        .select({
          id: enablers.id,
          courseId: enablers.courseId,
          isActive: enablers.isActive,
        })
        .from(enablers)
        .where(inArray(enablers.courseId, courseIds as any))
    : [];
  const enablerIds = enablerRows.map(e => String(e.id));
  const linkRows = enablerIds.length
    ? await db
        .select({
          enablerId: enablerQuizLinks.enablerId,
          quizId: enablerQuizLinks.quizId,
        })
        .from(enablerQuizLinks)
        .where(inArray(enablerQuizLinks.enablerId, enablerIds as any))
    : [];
  const quizIds = unique(linkRows.map(l => String(l.quizId)));
  const [quizRows, gradable, attemptRows] = await Promise.all([
    quizIds.length
      ? db
          .select({ id: quizzes.id, isActive: quizzes.isActive })
          .from(quizzes)
          .where(inArray(quizzes.id, quizIds as any))
      : Promise.resolve([]),
    loadGradableQuizIds(quizIds),
    quizIds.length
      ? db
          .select({
            traineeId: quizSubmissions.traineeId,
            quizId: quizSubmissions.quizId,
            score: quizSubmissions.score,
            submittedAt: quizSubmissions.submittedAt,
          })
          .from(quizSubmissions)
          .where(
            and(
              inArray(quizSubmissions.traineeId, ids as any),
              inArray(quizSubmissions.quizId, quizIds as any)
            )
          )
      : Promise.resolve([]),
  ]);

  const quizActive = new Map(quizRows.map(q => [String(q.id), !!q.isActive]));
  const links: ProgressionQuizLink[] = linkRows.map(l => ({
    enablerId: String(l.enablerId),
    quizId: String(l.quizId),
    difficulty: null,
    quizIsActive: quizActive.get(String(l.quizId)) ?? false,
    gradable: gradable.has(String(l.quizId)),
  }));
  const enablersOf = enablerRows.map(e => ({
    id: String(e.id),
    courseId: String(e.courseId),
    isActive: !!e.isActive,
  }));
  const attemptsOf = new Map<string, ProgressAttempt[]>();
  for (const row of attemptRows) {
    const key = String(row.traineeId);
    const list = attemptsOf.get(key) ?? [];
    list.push({
      quizId: String(row.quizId),
      score: row.score ?? null,
      submittedAt: row.submittedAt ?? null,
    });
    attemptsOf.set(key, list);
  }

  for (const id of ids) {
    const own = coursesOf.get(id);
    byTrainee.set(
      id,
      own && own.length
        ? summarizeTraineeProgress({
            courseIds: own,
            enablers: enablersOf,
            links,
            attempts: attemptsOf.get(id) ?? [],
          })
        : empty()
    );
  }
  return { byTrainee, courses: courseMap };
}
