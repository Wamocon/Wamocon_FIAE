/**
 * The progress figures of one trainee, per course, for the HAI.
 *
 * Nothing is calculated here that the pages do not calculate: the completion of
 * every enabler and its lock come from loadCourseProgressions (the helper of the
 * course list and the dashboard of the trainee: an enabler counts when its
 * required quizzes are passed, the trainer exceptions included), the weighted
 * percentage of a course from courseProgressPercent (enablers 70 %, use cases
 * 30 %, the figure on the course cards). The rows of enabler_completions are NOT
 * a source: the quiz based completion does not write them, so counting them
 * showed 0 % for every trainee.
 *
 * Only the occupations (training catalogs) the caller passes are read, so a
 * course of another occupation never appears here.
 *
 * @module lib/hai/progressFigures
 */

import { and, eq, inArray } from 'drizzle-orm';
import db from '@/db';
import {
  courseMembers,
  courses,
  useCases,
  useCaseSubmissions,
} from '@/db/migrations/schemas/schema';
import { sortCourses } from '@/lib/catalog/course-order';
import { courseProgressPercent } from '@/lib/catalog/course-progress';
import { loadCourseProgressions } from '@/lib/catalog/progression-db';

/** An active enabler of a course with its state in the order of work. */
export interface EnablerFigure {
  id: string;
  title: string;
  completed: boolean;
  locked: boolean;
}

/** One course of the trainee, as the course list of the platform shows it. */
export interface CourseFigure {
  courseId: string;
  title: string;
  catalogId: string;
  enablerTotal: number;
  enablerDone: number;
  useCaseTotal: number;
  useCaseDone: number;
  /** The percentage of the course card (enablers and use cases weighted). */
  percent: number;
  /** The active enablers in course order. */
  enablers: EnablerFigure[];
}

/** The first enabler the trainee may work on: not completed, not locked. */
export function firstOpenEnabler(
  figures: ReadonlyArray<CourseFigure>
): { enabler: EnablerFigure; course: CourseFigure } | null {
  for (const course of figures) {
    const enabler = course.enablers.find(e => !e.completed && !e.locked);
    if (enabler) return { enabler, course };
  }
  return null;
}

/**
 * The courses of the trainee in the given occupations, in the order of the
 * training plan, with the figures of the platform. A course without an active
 * enabler and without a use case is left out (the card shows 0 there and says
 * nothing). Throws when a query fails: the caller decides what a failure means.
 */
export async function loadTraineeCourseFigures(
  userId: string,
  catalogIds: ReadonlyArray<string>
): Promise<CourseFigure[]> {
  const catalogs = [...new Set(catalogIds.map(String))];
  if (catalogs.length === 0) return [];

  const courseRows = await db
    .select({
      id: courses.id,
      title: courses.title,
      chapter: courses.chapter,
      code: courses.code,
      catalogId: courses.trainingCatalogId,
    })
    .from(courseMembers)
    .innerJoin(courses, eq(courseMembers.courseId, courses.id))
    .where(
      and(
        eq(courseMembers.userId, userId as never),
        eq(courses.isActive, true),
        inArray(courses.trainingCatalogId, catalogs)
      )
    );
  if (courseRows.length === 0) return [];

  const ordered = sortCourses(courseRows);
  const courseIds = ordered.map(c => String(c.id));

  // The progressions and the use cases are independent of each other
  const [progressions, useCaseRows, approvedRows] = await Promise.all([
    loadCourseProgressions(userId, courseIds),
    db
      .select({ id: useCases.id, courseId: useCases.courseId })
      .from(useCases)
      .where(
        and(
          inArray(useCases.courseId, courseIds as never[]),
          eq(useCases.isActive, true)
        )
      ),
    db
      .select({
        useCaseId: useCaseSubmissions.useCaseId,
        courseId: useCases.courseId,
      })
      .from(useCaseSubmissions)
      .innerJoin(useCases, eq(useCaseSubmissions.useCaseId, useCases.id))
      .where(
        and(
          eq(useCaseSubmissions.traineeId, userId as never),
          eq(useCaseSubmissions.status, 'APPROVED'),
          eq(useCases.isActive, true),
          inArray(useCases.courseId, courseIds as never[])
        )
      ),
  ]);

  const useCasesOf = new Map<string, number>();
  for (const row of useCaseRows) {
    const key = String(row.courseId);
    useCasesOf.set(key, (useCasesOf.get(key) ?? 0) + 1);
  }
  const approvedOf = new Map<string, Set<string>>();
  for (const row of approvedRows) {
    const key = String(row.courseId);
    const set = approvedOf.get(key) ?? new Set<string>();
    set.add(String(row.useCaseId));
    approvedOf.set(key, set);
  }

  const figures: CourseFigure[] = [];
  for (const course of ordered) {
    const id = String(course.id);
    const loaded = progressions.get(id);
    const enablerTotal = loaded?.progression.totalCount ?? 0;
    const enablerDone = loaded?.progression.completedCount ?? 0;
    const useCaseTotal = useCasesOf.get(id) ?? 0;
    const useCaseDone = approvedOf.get(id)?.size ?? 0;
    if (enablerTotal === 0 && useCaseTotal === 0) continue;

    const titles = new Map(
      (loaded?.enablers ?? []).map(e => [String(e.id), e])
    );
    const enablerFigures: EnablerFigure[] = [];
    for (const state of loaded?.progression.enablers ?? []) {
      const enabler = titles.get(String(state.enablerId));
      if (!enabler) continue;
      enablerFigures.push({
        id: String(state.enablerId),
        title: String(enabler.title),
        completed: state.completed,
        locked: state.locked,
      });
    }

    figures.push({
      courseId: id,
      title: String(course.title ?? ''),
      catalogId: String(course.catalogId),
      enablerTotal,
      enablerDone,
      useCaseTotal,
      useCaseDone,
      percent: courseProgressPercent({
        enablerTotal,
        enablerDone,
        useCaseTotal,
        useCaseDone,
      }),
      enablers: enablerFigures,
    });
  }
  return figures;
}
