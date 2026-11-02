/**
 * HAI quiz mode: which questions a person may be asked (server side).
 *
 * The same rules as the real lesson quiz (GET /api/trainee/enablers/[id]/quizzes
 * and POST /api/trainee/quizzes/[id]/submit), derived from the session and the
 * database, never from the request:
 *  - catalog scope: the occupation of the person (a trainee: the enrollment,
 *    a trainer: the occupations of the organization). A foreign occupation is
 *    a 404, the same answer as for a missing record.
 *  - a trainee has to be a member of the course, the course and the enabler
 *    have to be active, the enabler must not be locked (order of work) and the
 *    quiz must be open in the chain LOW, MEDIUM, HIGH
 *  - only lesson quizzes: a global (assigned) quiz is an exam and stays out
 *  - only choice questions: a free text question has no option to click
 *
 * Nothing is written. The questions of a pool carry no solution (QuizCandidate),
 * the options with is_correct are read only for the one question that is
 * delivered or graded (loadQuestionSource) and leave the server through
 * toPublicQuestion or gradeAnswer only.
 *
 * @module lib/hai/quizMode/access
 */

import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import db from '@/db';
import {
  courseMembers,
  courses,
  enablerQuizLinks,
  enablers,
  options,
  questions,
  quizzes,
} from '@/db/migrations/schemas/schema';
import type { SessionUser } from '@/lib/auth/session';
import {
  allowedCatalogCondition,
  catalogCondition,
  ensureContentInScope,
  isCatalogAllowed,
  requireCatalogScopeForUser,
  type CatalogRequestLike,
  type CatalogScope,
} from '@/lib/catalog/scope';
import {
  enablerLockedResponse,
  loadCourseProgressions,
  quizChainOf,
  requireQuizOpen,
} from '@/lib/catalog/progression-db';
import type { QuizCandidate, QuizQuestionSource } from './logic';

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

/** Page of an enabler for the summary. Only a trainee has one. */
export function enablerHrefFor(
  session: Pick<SessionUser, 'isTrainerLevel'>,
  enablerId: string
): string | null {
  return session.isTrainerLevel ? null : `/trainee/enablers/${enablerId}`;
}

const notFound = () =>
  NextResponse.json({ error: 'Not found' }, { status: 404 });

/** A lesson quiz that is active and lies inside the catalogs of the caller. */
function isUsableQuiz(
  quiz: {
    isActive: boolean | null;
    quizType: unknown;
    trainingCatalogId: unknown;
  },
  scope: CatalogScope
): boolean {
  return (
    !!quiz.isActive &&
    String(quiz.quizType ?? '').toUpperCase() === 'LESSON' &&
    isCatalogAllowed(scope, quiz.trainingCatalogId as string)
  );
}

/** Eligible places of questions: one entry per usable lesson quiz of an enabler. */
interface EligibleQuiz {
  quizId: string;
  enablerId: string;
  enablerTitle: string;
  courseId: string;
  courseTitle: string | null;
}

/**
 * The candidates (questions without options) the person may be asked, or a
 * ready-made error response. With an enablerId only that enabler counts, and a
 * locked one is a 403 like in the real quiz.
 */
export async function loadQuizCandidates(
  session: SessionUser,
  req: CatalogRequestLike,
  enablerId: string | null
): Promise<QuizCandidate[] | NextResponse> {
  const scope = await requireCatalogScopeForUser(session.id, req);
  if (scope instanceof Response) return scope as NextResponse;
  const trainer = session.isTrainerLevel;

  let onlyCourseId: string | null = null;
  if (enablerId) {
    // The enabler has to lie inside the catalogs of the person: 404 otherwise
    const denied = await ensureContentInScope(scope, 'enabler', enablerId);
    if (denied) return denied;
    const [enabler] = await db
      .select({ id: enablers.id, courseId: enablers.courseId })
      .from(enablers)
      .where(and(eq(enablers.id, enablerId), eq(enablers.isActive, true)));
    if (!enabler) return notFound();
    onlyCourseId = String(enabler.courseId);
  }

  // Courses: a trainee only those of the memberships, a trainer all of the catalogs
  let courseIds: string[] | null = null;
  if (!trainer) {
    const memberships = await db
      .select({ courseId: courseMembers.courseId })
      .from(courseMembers)
      .where(eq(courseMembers.userId, session.id));
    courseIds = unique(memberships.map(m => String(m.courseId)));
    if (onlyCourseId) {
      if (!courseIds.includes(onlyCourseId))
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      courseIds = [onlyCourseId];
    }
    if (courseIds.length === 0) return [];
  } else if (onlyCourseId) {
    courseIds = [onlyCourseId];
  }

  const catalogFilter = onlyCourseId
    ? allowedCatalogCondition(courses.trainingCatalogId, scope)
    : catalogCondition(courses.trainingCatalogId, scope);
  const courseRows = await db
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(
      courseIds
        ? and(
            inArray(courses.id, courseIds),
            eq(courses.isActive, true),
            catalogFilter
          )
        : and(eq(courses.isActive, true), catalogFilter)
    );
  if (courseRows.length === 0) return onlyCourseId ? notFound() : [];
  const courseTitle = new Map(courseRows.map(c => [String(c.id), c.title]));
  const activeCourseIds = courseRows.map(c => String(c.id));

  const eligible: EligibleQuiz[] = [];
  if (!trainer) {
    // The order of work and the chain of the quizzes, by the one definition
    const progressions = await loadCourseProgressions(
      session.id,
      activeCourseIds
    );
    for (const courseId of activeCourseIds) {
      const loaded = progressions.get(courseId);
      if (!loaded) continue;
      const stateOf = new Map(
        loaded.progression.enablers.map(e => [e.enablerId, e])
      );
      for (const enabler of loaded.enablers) {
        if (!enabler.isActive) continue;
        if (enablerId && String(enabler.id) !== enablerId) continue;
        const state = stateOf.get(String(enabler.id));
        if (!state) continue;
        if (state.locked) {
          // An enabler named by the person that is locked: nothing is delivered
          if (enablerId) return enablerLockedResponse(state);
          continue;
        }
        for (const entry of quizChainOf(loaded, String(enabler.id))) {
          if (!entry.unlocked) continue;
          eligible.push({
            quizId: entry.quizId,
            enablerId: String(enabler.id),
            enablerTitle: enabler.title,
            courseId,
            courseTitle: courseTitle.get(courseId) ?? null,
          });
        }
      }
    }
  } else {
    const enablerRows = await db
      .select({
        id: enablers.id,
        title: enablers.title,
        courseId: enablers.courseId,
      })
      .from(enablers)
      .where(
        and(
          inArray(enablers.courseId, activeCourseIds),
          eq(enablers.isActive, true)
        )
      );
    const wanted = enablerRows.filter(
      e => !enablerId || String(e.id) === enablerId
    );
    const links = wanted.length
      ? await db
          .select({
            enablerId: enablerQuizLinks.enablerId,
            quizId: enablerQuizLinks.quizId,
          })
          .from(enablerQuizLinks)
          .where(
            inArray(
              enablerQuizLinks.enablerId,
              wanted.map(e => String(e.id))
            )
          )
      : [];
    for (const link of links) {
      const enabler = wanted.find(e => String(e.id) === String(link.enablerId));
      if (!enabler) continue;
      const courseId = String(enabler.courseId);
      eligible.push({
        quizId: String(link.quizId),
        enablerId: String(enabler.id),
        enablerTitle: enabler.title,
        courseId,
        courseTitle: courseTitle.get(courseId) ?? null,
      });
    }
  }
  if (eligible.length === 0) return [];

  const quizRows = await db
    .select({
      id: quizzes.id,
      isActive: quizzes.isActive,
      quizType: quizzes.quizType,
      trainingCatalogId: quizzes.trainingCatalogId,
    })
    .from(quizzes)
    .where(inArray(quizzes.id, unique(eligible.map(e => e.quizId))));
  const usable = new Set(
    quizRows.filter(q => isUsableQuiz(q, scope)).map(q => String(q.id))
  );
  const usableEligible = eligible.filter(e => usable.has(e.quizId));
  if (usableEligible.length === 0) return [];

  // Only the columns of the question itself, no option and no solution
  const questionRows = await db
    .select({
      id: questions.id,
      quizId: questions.quizId,
      questionText: questions.questionText,
      questionType: questions.questionType,
    })
    .from(questions)
    .where(
      inArray(questions.quizId, unique(usableEligible.map(e => e.quizId)))
    );

  const candidates: QuizCandidate[] = [];
  for (const row of questionRows) {
    if (row.questionType === 'TEXT') continue;
    const place = usableEligible.find(e => e.quizId === String(row.quizId));
    if (!place) continue;
    candidates.push({
      id: String(row.id),
      text: row.questionText,
      enablerId: place.enablerId,
      enablerTitle: place.enablerTitle,
      courseTitle: place.courseTitle,
      enablerHref: enablerHrefFor(session, place.enablerId),
    });
  }
  return candidates;
}

/**
 * The question with all its options, including the solution, for the server
 * only. The caller hands it to toPublicQuestion (before the attempt) or to
 * gradeAnswer (after it), never to a response.
 */
export async function loadQuestionSources(
  candidates: ReadonlyArray<QuizCandidate>
): Promise<QuizQuestionSource[]> {
  if (candidates.length === 0) return [];
  const rows = await db
    .select({
      id: options.id,
      questionId: options.questionId,
      optionText: options.optionText,
      isCorrect: options.isCorrect,
      explanation: options.explanation,
      orderIndex: options.orderIndex,
    })
    .from(options)
    .where(
      inArray(
        options.questionId,
        candidates.map(c => c.id)
      )
    );
  return candidates.map(candidate => ({
    ...candidate,
    options: rows
      .filter(o => String(o.questionId) === candidate.id)
      .map(o => ({
        id: String(o.id),
        text: o.optionText,
        isCorrect: !!o.isCorrect,
        explanation: o.explanation ?? null,
        orderIndex: o.orderIndex ?? null,
      })),
  }));
}

/**
 * One question for grading, after the same access checks as the pool: a ready-
 * made error response (404 for a missing or foreign question, 403 for a trainee
 * outside the course or a locked enabler or quiz) or the source with solution.
 */
export async function authorizeQuestion(
  session: SessionUser,
  req: CatalogRequestLike,
  questionId: string
): Promise<QuizQuestionSource | NextResponse> {
  const scope = await requireCatalogScopeForUser(session.id, req);
  if (scope instanceof Response) return scope as NextResponse;

  const [question] = await db
    .select({
      id: questions.id,
      quizId: questions.quizId,
      questionText: questions.questionText,
      questionType: questions.questionType,
    })
    .from(questions)
    .where(eq(questions.id, questionId));
  if (!question || question.questionType === 'TEXT') return notFound();

  const [quiz] = await db
    .select({
      id: quizzes.id,
      isActive: quizzes.isActive,
      quizType: quizzes.quizType,
      trainingCatalogId: quizzes.trainingCatalogId,
    })
    .from(quizzes)
    .where(eq(quizzes.id, question.quizId));
  if (!quiz || !isUsableQuiz(quiz, scope)) return notFound();

  const [link] = await db
    .select({ enablerId: enablerQuizLinks.enablerId })
    .from(enablerQuizLinks)
    .where(eq(enablerQuizLinks.quizId, quiz.id));
  if (!link) return notFound();

  const [enabler] = await db
    .select({
      id: enablers.id,
      title: enablers.title,
      courseId: enablers.courseId,
      isActive: enablers.isActive,
    })
    .from(enablers)
    .where(eq(enablers.id, link.enablerId));
  if (!enabler || !enabler.isActive) return notFound();

  const [course] = await db
    .select({
      id: courses.id,
      title: courses.title,
      isActive: courses.isActive,
      trainingCatalogId: courses.trainingCatalogId,
    })
    .from(courses)
    .where(eq(courses.id, enabler.courseId));
  if (!course || !course.isActive) return notFound();
  if (!isCatalogAllowed(scope, course.trainingCatalogId)) return notFound();

  if (!session.isTrainerLevel) {
    const [member] = await db
      .select({ id: courseMembers.id })
      .from(courseMembers)
      .where(
        and(
          eq(courseMembers.courseId, enabler.courseId),
          eq(courseMembers.userId, session.id)
        )
      );
    if (!member)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Order of work and chain of the quizzes, the same guard as the real quiz
    const access = await requireQuizOpen(
      session.id,
      { id: String(enabler.id), courseId: String(enabler.courseId) },
      String(quiz.id)
    );
    if (access.blocked) return access.blocked;
  }

  const [source] = await loadQuestionSources([
    {
      id: String(question.id),
      text: question.questionText,
      enablerId: String(enabler.id),
      enablerTitle: enabler.title,
      courseTitle: course.title ?? null,
      enablerHref: enablerHrefFor(session, String(enabler.id)),
    },
  ]);
  return source;
}
