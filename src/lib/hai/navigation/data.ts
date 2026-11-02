/**
 * Database side of the navigation: the records a trainee may be taken to.
 *
 * Everything is keyed by the user id of the session and limited like the pages
 * themselves limit it (see /api/trainee/enablers/[enablerId],
 * /api/trainee/use-cases/[useCaseId] and /api/trainee/courses):
 *  - the record lies inside the catalogs of the person (occupation separation),
 *  - the record is active and so is its course,
 *  - the trainee is a member of the course.
 * A record that does not pass is not in the result, so it can neither be
 * named nor offered, and a record of another occupation is not told apart from
 * one that does not exist.
 *
 * A query that fails throws, the caller answers "cannot check now" and offers
 * nothing (fail closed).
 *
 * @module lib/hai/navigation/data
 */

import { and, eq, inArray } from 'drizzle-orm';
import db from '@/db';
import {
  courseMembers,
  courses,
  enablers,
  useCases,
} from '@/db/migrations/schemas/schema';
import {
  getEnablerProgression,
  loadCourseProgressions,
  type LoadedCourseProgression,
} from '@/lib/catalog/progression-db';
import type { ContentCandidate } from './match';
import type { NextStepEntry } from './nextStep';

/** The enablers the trainee may be taken to (active, own course, own catalogs). */
export async function loadTraineeEnablers(
  userId: string,
  catalogIds: readonly string[]
): Promise<ContentCandidate[]> {
  if (catalogIds.length === 0) return [];
  const rows = await db
    .select({
      id: enablers.id,
      title: enablers.title,
      code: enablers.code,
      courseId: enablers.courseId,
      courseTitle: courses.title,
    })
    .from(enablers)
    .innerJoin(courses, eq(enablers.courseId, courses.id))
    .innerJoin(
      courseMembers,
      and(
        eq(courseMembers.courseId, enablers.courseId),
        eq(courseMembers.userId, userId as never)
      )
    )
    .where(
      and(
        eq(enablers.isActive, true),
        eq(courses.isActive, true),
        inArray(enablers.trainingCatalogId, catalogIds as string[])
      )
    );
  return rows.map(r => ({
    id: String(r.id),
    title: String(r.title),
    code: r.code ? String(r.code) : null,
    courseId: String(r.courseId),
    courseTitle: String(r.courseTitle),
  }));
}

/** The use cases the trainee may be taken to (active, own course, own catalogs). */
export async function loadTraineeUseCases(
  userId: string,
  catalogIds: readonly string[]
): Promise<ContentCandidate[]> {
  if (catalogIds.length === 0) return [];
  const rows = await db
    .select({
      id: useCases.id,
      title: useCases.title,
      code: useCases.code,
      courseId: useCases.courseId,
      courseTitle: courses.title,
    })
    .from(useCases)
    .innerJoin(courses, eq(useCases.courseId, courses.id))
    .innerJoin(
      courseMembers,
      and(
        eq(courseMembers.courseId, useCases.courseId),
        eq(courseMembers.userId, userId as never)
      )
    )
    .where(
      and(
        eq(useCases.isActive, true),
        eq(courses.isActive, true),
        inArray(useCases.trainingCatalogId, catalogIds as string[])
      )
    );
  return rows.map(r => ({
    id: String(r.id),
    title: String(r.title),
    code: r.code ? String(r.code) : null,
    courseId: String(r.courseId),
    courseTitle: String(r.courseTitle),
  }));
}

/** An enabler of the trainee with its state in the order of work. */
export interface EnablerLock {
  locked: boolean;
  /** The enabler to finish first (order of work), null for a manual lock. */
  lockedByTitle: string | null;
  /** The active quizzes of the enabler that count (for "the quiz of"). */
  hasActiveQuiz: boolean;
}

/**
 * The state of one enabler in the order of work, from the helper the pages use
 * (getEnablerProgression). null when the enabler is not active for the trainee.
 */
export async function loadEnablerLock(
  userId: string,
  enabler: { id: string; courseId: string }
): Promise<EnablerLock | null> {
  const found = await getEnablerProgression(userId, enabler);
  if (!found) return null;
  const links = (found.loaded as LoadedCourseProgression).quizLinks.filter(
    l => l.enablerId === String(enabler.id)
  );
  return {
    locked: found.enabler.locked,
    lockedByTitle: found.enabler.lockedBy?.title ?? null,
    hasActiveQuiz: links.some(l => l.quizIsActive),
  };
}

/**
 * The active enablers of the active courses of the trainee, each with its
 * state in the order of work (loadCourseProgressions: completed and locked
 * come from the one definition of the order of work, the exceptions of the
 * trainer included).
 */
export async function loadNextStepEntries(
  userId: string,
  catalogIds: readonly string[]
): Promise<NextStepEntry[]> {
  if (catalogIds.length === 0) return [];
  const courseRows = await db
    .select({
      id: courses.id,
      title: courses.title,
      year: courses.year,
      chapter: courses.chapter,
    })
    .from(courseMembers)
    .innerJoin(courses, eq(courseMembers.courseId, courses.id))
    .where(
      and(
        eq(courseMembers.userId, userId as never),
        eq(courses.isActive, true),
        inArray(courses.trainingCatalogId, catalogIds as string[])
      )
    );
  if (courseRows.length === 0) return [];

  const courseIds = courseRows.map(c => String(c.id));
  const progressions = await loadCourseProgressions(userId, courseIds);
  const entries: NextStepEntry[] = [];
  for (const course of courseRows) {
    const loaded = progressions.get(String(course.id));
    if (!loaded) continue;
    const titles = new Map(loaded.enablers.map(e => [e.id, e]));
    for (const state of loaded.progression.enablers) {
      const enabler = titles.get(state.enablerId);
      if (!enabler) continue;
      entries.push({
        enablerId: state.enablerId,
        title: enabler.title,
        courseTitle: String(course.title),
        stage: course.year ?? null,
        chapter: course.chapter ?? null,
        orderIndex: enabler.orderIndex,
        completed: state.completed,
        locked: state.locked,
      });
    }
  }
  return entries;
}
