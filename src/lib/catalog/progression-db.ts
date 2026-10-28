/**
 * The database side of the order of work (the pure rules are in
 * src/lib/catalog/progression.ts): load what the rules need for one trainee
 * and turn a locked enabler into the answer of a route.
 *
 * Everything is keyed by the trainee id of the session, never by a client
 * value. A failed query throws, so a route answers 500 and no write goes
 * through on a guess.
 */

import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import db from '@/db';
import {
  courses,
  enablerQuizLinks,
  enablers,
  profiles,
  quizSubmissions,
  quizzes,
  traineeEnablerOverrides,
  traineeEnrollments,
  trainingCatalogs,
} from '@/db/migrations/schemas/schema';
import {
  bestScoresOf,
  computeCourseProgression,
  computeQuizChain,
  isSequenceEnforced,
  readSequenceSince,
  type CourseProgression,
  type EnablerProgression,
  type ProgressionEnabler,
  type ProgressionQuizLink,
  type QuizChainEntry,
  type QuizDifficulty,
} from '@/lib/catalog/progression';

/** A course of one trainee with the data its progression was computed from. */
export interface LoadedCourseProgression {
  progression: CourseProgression;
  enablers: ProgressionEnabler[];
  quizLinks: ProgressionQuizLink[];
  /** Best score per quiz, a key exists for every quiz the trainee attempted. */
  bestScores: Map<string, number>;
}

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

function asDifficulty(value: unknown): QuizDifficulty | null {
  return value === 'LOW' || value === 'MEDIUM' || value === 'HIGH'
    ? value
    : null;
}

/**
 * The progression of a trainee in the given courses (a course without active
 * enablers has an empty one). Whether the order applies comes from the cut-off
 * date of the catalog of each course and the date the trainee joined it.
 */
export async function loadCourseProgressions(
  traineeId: string,
  courseIds: string[]
): Promise<Map<string, LoadedCourseProgression>> {
  const result = new Map<string, LoadedCourseProgression>();
  const ids = unique(courseIds.map(String));
  if (ids.length === 0) return result;

  const courseRows = await db
    .select({ id: courses.id, trainingCatalogId: courses.trainingCatalogId })
    .from(courses)
    .where(inArray(courses.id, ids));
  const catalogIds = unique(
    courseRows
      .map(c => (c.trainingCatalogId ? String(c.trainingCatalogId) : null))
      .filter((v): v is string => v !== null)
  );

  const [catalogRows, enrollmentRows, profileRows, enablerRows] =
    await Promise.all([
      catalogIds.length
        ? db
            .select({
              id: trainingCatalogs.id,
              settings: trainingCatalogs.settings,
            })
            .from(trainingCatalogs)
            .where(inArray(trainingCatalogs.id, catalogIds))
        : Promise.resolve([]),
      catalogIds.length
        ? db
            .select({
              trainingCatalogId: traineeEnrollments.trainingCatalogId,
              createdAt: traineeEnrollments.createdAt,
            })
            .from(traineeEnrollments)
            .where(
              and(
                eq(traineeEnrollments.traineeId, traineeId),
                inArray(traineeEnrollments.trainingCatalogId, catalogIds)
              )
            )
        : Promise.resolve([]),
      db
        .select({ createdAt: profiles.createdAt })
        .from(profiles)
        .where(eq(profiles.id, traineeId)),
      db
        .select({
          id: enablers.id,
          title: enablers.title,
          courseId: enablers.courseId,
          orderIndex: enablers.orderIndex,
          isActive: enablers.isActive,
        })
        .from(enablers)
        .where(inArray(enablers.courseId, ids)),
    ]);

  const enablerIds = enablerRows.map(e => String(e.id));
  const linkRows = enablerIds.length
    ? await db
        .select({
          enablerId: enablerQuizLinks.enablerId,
          quizId: enablerQuizLinks.quizId,
          difficulty: enablerQuizLinks.difficulty,
        })
        .from(enablerQuizLinks)
        .where(inArray(enablerQuizLinks.enablerId, enablerIds))
    : [];
  const quizIds = unique(linkRows.map(l => String(l.quizId)));
  const [quizRows, attemptRows, overrideRows] = await Promise.all([
    quizIds.length
      ? db
          .select({ id: quizzes.id, isActive: quizzes.isActive })
          .from(quizzes)
          .where(inArray(quizzes.id, quizIds))
      : Promise.resolve([]),
    quizIds.length
      ? db
          .select({
            quizId: quizSubmissions.quizId,
            score: quizSubmissions.score,
          })
          .from(quizSubmissions)
          .where(
            and(
              eq(quizSubmissions.traineeId, traineeId),
              inArray(quizSubmissions.quizId, quizIds)
            )
          )
      : Promise.resolve([]),
    enablerIds.length
      ? db
          .select({
            enablerId: traineeEnablerOverrides.enablerId,
            isActive: traineeEnablerOverrides.isActive,
          })
          .from(traineeEnablerOverrides)
          .where(
            and(
              eq(traineeEnablerOverrides.traineeId, traineeId),
              inArray(traineeEnablerOverrides.enablerId, enablerIds)
            )
          )
      : Promise.resolve([]),
  ]);

  const quizActive = new Map(quizRows.map(q => [String(q.id), !!q.isActive]));
  const bestScores = bestScoresOf(attemptRows);
  const overrides = new Map<string, boolean | null>(
    overrideRows.map(o => [
      String(o.enablerId),
      o.isActive === null || o.isActive === undefined ? null : !!o.isActive,
    ])
  );
  const sinceOf = new Map(
    catalogRows.map(c => [String(c.id), readSequenceSince(c.settings)])
  );
  const joinedOf = new Map(
    enrollmentRows.map(e => [
      String(e.trainingCatalogId),
      e.createdAt ?? null,
    ])
  );
  const profileCreated = profileRows[0]?.createdAt ?? null;

  for (const course of courseRows) {
    const courseId = String(course.id);
    const catalogId = course.trainingCatalogId
      ? String(course.trainingCatalogId)
      : null;
    // The date of joining: the enrollment in the catalog, for a trainee without
    // one (a self registered FIAE trainee) the creation of the profile
    const joined = catalogId
      ? (joinedOf.get(catalogId) ?? profileCreated)
      : profileCreated;
    const enforced = isSequenceEnforced(
      catalogId ? sinceOf.get(catalogId) : null,
      joined
    );

    const courseEnablers: ProgressionEnabler[] = enablerRows
      .filter(e => String(e.courseId) === courseId)
      .map(e => ({
        id: String(e.id),
        title: e.title,
        courseId,
        orderIndex: e.orderIndex,
        isActive: e.isActive,
      }));
    const enablerSet = new Set(courseEnablers.map(e => e.id));
    const quizLinks: ProgressionQuizLink[] = linkRows
      .filter(l => enablerSet.has(String(l.enablerId)))
      .map(l => ({
        enablerId: String(l.enablerId),
        quizId: String(l.quizId),
        difficulty: asDifficulty(l.difficulty),
        quizIsActive: quizActive.get(String(l.quizId)) ?? false,
      }));

    result.set(courseId, {
      progression: computeCourseProgression({
        courseId,
        enforced,
        enablers: courseEnablers,
        quizLinks,
        bestScores,
        overrides,
      }),
      enablers: courseEnablers,
      quizLinks,
      bestScores,
    });
  }
  return result;
}

/** The progression of one enabler for a trainee, null when it is not active. */
export async function getEnablerProgression(
  traineeId: string,
  enabler: { id: string; courseId: string }
): Promise<{
  enabler: EnablerProgression;
  loaded: LoadedCourseProgression;
} | null> {
  const loaded = (
    await loadCourseProgressions(traineeId, [String(enabler.courseId)])
  ).get(String(enabler.courseId));
  if (!loaded) return null;
  const entry = loaded.progression.enablers.find(
    e => e.enablerId === String(enabler.id)
  );
  return entry ? { enabler: entry, loaded } : null;
}

/** The 403 answer for a locked enabler: the reason and the enabler to finish first, no content. */
export function enablerLockedResponse(
  progression: Pick<EnablerProgression, 'lockReason' | 'lockedBy'>
): NextResponse {
  return NextResponse.json(
    {
      error: 'Enabler locked',
      code: 'ENABLER_LOCKED',
      reason: progression.lockReason,
      lockedBy: progression.lockedBy
        ? {
            id: progression.lockedBy.enablerId,
            title: progression.lockedBy.title,
          }
        : null,
    },
    { status: 403 }
  );
}

/**
 * Guard of the write routes (and of the routes that deliver quiz questions):
 * null when the trainee may work on the enabler, otherwise the 403 answer with
 * code ENABLER_LOCKED. An enabler that is not active is answered by the route
 * itself (404) before this is called.
 */
export async function requireEnablerOpen(
  traineeId: string,
  enabler: { id: string; courseId: string }
): Promise<NextResponse | null> {
  const found = await getEnablerProgression(traineeId, enabler);
  if (!found || !found.enabler.locked) return null;
  return enablerLockedResponse(found.enabler);
}

/** The lock chain LOW, MEDIUM, HIGH of the lesson quizzes of one enabler. */
export function quizChainOf(
  loaded: LoadedCourseProgression,
  enablerId: string
): QuizChainEntry[] {
  const links = loaded.quizLinks.filter(l => l.enablerId === String(enablerId));
  return computeQuizChain(
    links,
    loaded.bestScores,
    new Set(loaded.bestScores.keys())
  );
}

export type QuizAccess =
  | { blocked: NextResponse; entry: null }
  | { blocked: null; entry: QuizChainEntry | null };

/**
 * Guard for the routes that deliver or accept a lesson quiz: the enabler has to
 * be open (403 ENABLER_LOCKED) and the quiz before it in the chain has to be
 * attempted (403 QUIZ_LOCKED, naming the difficulty to do first). The entry of
 * the quiz comes back so the route can see whether it is passed already. A quiz
 * that is not in the chain (inactive or not linked) has no entry.
 */
export async function requireQuizOpen(
  traineeId: string,
  enabler: { id: string; courseId: string },
  quizId: string
): Promise<QuizAccess> {
  const found = await getEnablerProgression(traineeId, enabler);
  if (!found) return { blocked: null, entry: null };
  if (found.enabler.locked) {
    return { blocked: enablerLockedResponse(found.enabler), entry: null };
  }
  const entry =
    quizChainOf(found.loaded, String(enabler.id)).find(
      c => c.quizId === String(quizId)
    ) ?? null;
  if (entry && !entry.unlocked) {
    return {
      blocked: NextResponse.json(
        { error: 'Quiz locked', code: 'QUIZ_LOCKED', after: entry.after },
        { status: 403 }
      ),
      entry: null,
    };
  }
  return { blocked: null, entry };
}
