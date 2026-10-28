/**
 * Which content a trainee gets in the occupation (catalog) of the enrollment,
 * and the tool that gives it to them.
 *
 * A trainee sees a course only as a member (course_members) and a global quiz
 * only when it is assigned (quiz_assignments). For FIAE a trainer adds these
 * rows by hand. For an occupation whose courses are linked to training
 * components (KfBM, courses.training_component_id) the rows follow from the
 * phase plan of the catalog, so they can be created without a hand:
 *
 *  - the compulsory components of the CURRENT phase of the trainee
 *  - the integrative components (the whole training)
 *  - the elective components the trainee picked (trainee_elective_choices)
 *
 * Each of these components has at most one course (courses.training_component_id)
 * and its global quiz (quizzes.training_component_id). The lesson quizzes need
 * no assignment, they are reached through the enablers of a course.
 *
 * The write is exactly what a trainer does: INSERT into course_members with the
 * role TRAINEE and into quiz_assignments, ON CONFLICT DO NOTHING. It never
 * deletes and never changes a row that exists, so it is safe to run twice and
 * it never takes away what a trainer gave. A course that is not linked to a
 * component (every FIAE course) is never touched, so FIAE trainees get nothing
 * from this.
 *
 * Visibility is a separate step: the rows only give the trainee the right to
 * open a course or a quiz, whether it can be opened is decided by is_active
 * (see content-release.ts).
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import db from '@/db';
import {
  courseMembers,
  courses,
  profiles,
  quizAssignments,
  quizzes,
  traineeElectiveChoices,
  traineeEnrollments,
  trainingCatalogs,
  trainingComponents,
} from '@/db/migrations/schemas/schema';
import {
  getComponentPhase,
  getTrainingPhase,
  type TrainingPhase,
} from '@/lib/ausbildung/duration';
import { resolvePhasePlan } from '@/lib/catalog/phase-plan';
import {
  effectiveEnrollmentTerms,
  sortEnrollments,
} from '@/lib/catalog/enrollments';
import type { Executor } from '@/lib/catalog/admin';

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

export type PlanComponent = {
  id: string;
  kind: string | null;
  phase: number | null;
  orderIndex: number | null;
};

/** Phase of the trainee: 1 without a usable start date, otherwise by months. */
export function currentPhaseOf(input: {
  startDate: Date | null;
  durationYears: number | null | undefined;
  phaseOneMonths: number;
  now?: Date;
}): TrainingPhase {
  if (!input.startDate || Number.isNaN(input.startDate.getTime())) return 1;
  return getTrainingPhase(
    input.startDate,
    input.durationYears,
    input.now ?? new Date(),
    input.phaseOneMonths
  );
}

/**
 * The components a trainee of the given phase works on: compulsory ones of the
 * phase (or tied to no phase), integrative ones, and the chosen elective ones.
 */
export function componentsOfPhase(
  components: PlanComponent[],
  electiveComponentIds: string[],
  phase: TrainingPhase
): Set<string> {
  const chosen = new Set(electiveComponentIds);
  const result = new Set<string>();
  for (const component of components) {
    if (component.kind === 'wahl') {
      if (chosen.has(component.id)) result.add(component.id);
      continue;
    }
    if (component.kind === 'integrativ') {
      result.add(component.id);
      continue;
    }
    // compulsory: its own phase, no phase at all, or the integrative range
    const own = getComponentPhase(component);
    if (own === null || own === 3 || own === phase) result.add(component.id);
  }
  return result;
}

export type PlanCourse = { id: string; trainingComponentId: string | null };
export type PlanQuiz = { id: string; trainingComponentId: string | null };

export type TraineeContentPlan = {
  courseIds: string[];
  globalQuizIds: string[];
};

/** The courses and global quizzes of the planned components. */
export function planTraineeContent(input: {
  phase: TrainingPhase;
  components: PlanComponent[];
  electiveComponentIds: string[];
  courses: PlanCourse[];
  globalQuizzes: PlanQuiz[];
}): TraineeContentPlan {
  const planned = componentsOfPhase(
    input.components,
    input.electiveComponentIds,
    input.phase
  );
  const inPlan = (componentId: string | null) =>
    componentId !== null && planned.has(componentId);
  return {
    courseIds: input.courses
      .filter(c => inPlan(c.trainingComponentId))
      .map(c => c.id),
    globalQuizIds: input.globalQuizzes
      .filter(q => inPlan(q.trainingComponentId))
      .map(q => q.id),
  };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export type TraineeContentSync = {
  traineeId: string;
  phase: TrainingPhase;
  /** Rows the plan needs and that do not exist yet. */
  courseMembersMissing: number;
  quizAssignmentsMissing: number;
  /** Rows written (0 on a dry run). */
  courseMembersAdded: number;
  quizAssignmentsAdded: number;
  /** The trainee has no organization, the rows need one. Nothing is written. */
  skippedNoOrganization: boolean;
};

export type CatalogContentSync = {
  catalogId: string;
  catalogCode: string;
  /** True when nothing was written (a trial run). */
  dryRun: boolean;
  trainees: number;
  /** Trainees that get at least one row. */
  traineesChanged: number;
  skippedNoOrganization: number;
  courseMembersMissing: number;
  quizAssignmentsMissing: number;
  courseMembersAdded: number;
  quizAssignmentsAdded: number;
  /** Trainee ids with their own numbers, only for the trainees that change. */
  details: TraineeContentSync[];
};

/** Lock key that keeps two runs of the tool for one catalog apart. */
export function contentSyncLockKey(catalogId: string): string {
  return `trainee_content_sync:${catalogId}`;
}

const CHUNK = 500;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    out.push(items.slice(i, i + CHUNK));
  }
  return out;
}

/**
 * Give the trainees enrolled in a catalog the courses and global quizzes of
 * their phase plan. With `traineeId` only that trainee, otherwise every trainee
 * of the catalog. `execute: false` only counts. The caller decides about the
 * transaction (the bulk route wraps it with the lock, the enrollment hook runs
 * it on its own). Insert only, never delete, idempotent.
 */
export async function syncCatalogTraineeContent(
  q: Executor,
  input: {
    catalogId: string;
    actorId: string;
    execute: boolean;
    traineeId?: string;
    /**
     * Only the trainees of this organization. A trainee without an
     * organization never matches it (fail closed).
     */
    organizationId?: string;
    /**
     * Also give every trainee all ACTIVE global quizzes of the catalog that are
     * linked to no component (FIAE: its global quizzes have no component, a
     * trainer assigns them by hand to everybody who should take them). Only the
     * explicit tool sets it, the automatic runs at enrollment do not, so a new
     * FIAE trainee gets nothing unasked.
     */
    includeUnlinkedGlobalQuizzes?: boolean;
    now?: Date;
  }
): Promise<CatalogContentSync | null> {
  const [catalog] = await q
    .select({
      id: trainingCatalogs.id,
      code: trainingCatalogs.code,
      settings: trainingCatalogs.settings,
    })
    .from(trainingCatalogs)
    .where(eq(trainingCatalogs.id, input.catalogId))
    .limit(1);
  if (!catalog) return null;

  const empty = (): CatalogContentSync => ({
    catalogId: String(catalog.id),
    catalogCode: catalog.code,
    dryRun: !input.execute,
    trainees: 0,
    traineesChanged: 0,
    skippedNoOrganization: 0,
    courseMembersMissing: 0,
    quizAssignmentsMissing: 0,
    courseMembersAdded: 0,
    quizAssignmentsAdded: 0,
    details: [],
  });
  const summary = empty();

  // Trainees of the catalog: role TRAINEE with an enrollment in it
  const enrolled = await q
    .select({
      traineeId: profiles.id,
      organizationId: profiles.organizationId,
      enrollmentId: traineeEnrollments.id,
      enrollmentStart: traineeEnrollments.startDate,
      enrollmentDuration: traineeEnrollments.durationYears,
      profileStart: profiles.startOfTrainingDate,
      profileDuration: profiles.ausbildungDurationYears,
    })
    .from(traineeEnrollments)
    .innerJoin(profiles, eq(profiles.id, traineeEnrollments.traineeId))
    .where(
      and(
        eq(traineeEnrollments.trainingCatalogId, input.catalogId),
        eq(profiles.role, 'TRAINEE' as never),
        ...(input.traineeId ? [eq(profiles.id, input.traineeId)] : []),
        ...(input.organizationId
          ? [eq(profiles.organizationId, input.organizationId)]
          : [])
      )
    );
  summary.trainees = enrolled.length;
  if (enrolled.length === 0) return summary;

  const [components, courseRows, quizRows] = await Promise.all([
    q
      .select({
        id: trainingComponents.id,
        kind: trainingComponents.kind,
        phase: trainingComponents.phase,
        orderIndex: trainingComponents.orderIndex,
      })
      .from(trainingComponents)
      .where(eq(trainingComponents.trainingCatalogId, input.catalogId)),
    q
      .select({
        id: courses.id,
        trainingComponentId: courses.trainingComponentId,
      })
      .from(courses)
      .where(eq(courses.trainingCatalogId, input.catalogId)),
    q
      .select({
        id: quizzes.id,
        trainingComponentId: quizzes.trainingComponentId,
        isActive: quizzes.isActive,
      })
      .from(quizzes)
      .where(
        and(
          eq(quizzes.trainingCatalogId, input.catalogId),
          eq(quizzes.quizType, 'GLOBAL' as never)
        )
      ),
  ]);
  const linkedCourses = courseRows.filter(c => c.trainingComponentId);
  const linkedQuizzes = quizRows.filter(z => z.trainingComponentId);
  // Active global quizzes without a component (the FIAE pattern)
  const unlinkedQuizIds = input.includeUnlinkedGlobalQuizzes
    ? quizRows
        .filter(z => !z.trainingComponentId && z.isActive === true)
        .map(z => String(z.id))
    : [];
  const assignable = [
    ...linkedQuizzes.map(z => String(z.id)),
    ...unlinkedQuizIds,
  ];

  const traineeIds = enrolled.map(e => String(e.traineeId));
  const enrollmentIds = enrolled.map(e => String(e.enrollmentId));

  // The first enrollment of each trainee follows the profile (start date and
  // duration), a further one has its own terms: the phase is counted per
  // enrollment, so a trainee in two trainings gets the content of the current
  // phase of each (src/lib/catalog/enrollments.ts)
  const allEnrollments = await q
    .select({
      traineeId: traineeEnrollments.traineeId,
      trainingCatalogId: traineeEnrollments.trainingCatalogId,
      startDate: traineeEnrollments.startDate,
      createdAt: traineeEnrollments.createdAt,
    })
    .from(traineeEnrollments)
    .where(inArray(traineeEnrollments.traineeId, traineeIds));
  const firstCatalogOf = new Map<string, string>();
  for (const e of sortEnrollments(
    allEnrollments.map(row => ({
      ...row,
      trainingCatalogId: String(row.trainingCatalogId),
    }))
  )) {
    const key = String(e.traineeId);
    if (!firstCatalogOf.has(key)) firstCatalogOf.set(key, e.trainingCatalogId);
  }

  const choices = await q
    .select({
      enrollmentId: traineeElectiveChoices.enrollmentId,
      componentId: traineeElectiveChoices.componentId,
    })
    .from(traineeElectiveChoices)
    .where(inArray(traineeElectiveChoices.enrollmentId, enrollmentIds));
  const choicesOf = new Map<string, string[]>();
  for (const row of choices) {
    const key = String(row.enrollmentId);
    choicesOf.set(key, [
      ...(choicesOf.get(key) ?? []),
      String(row.componentId),
    ]);
  }

  const existingMembers = linkedCourses.length
    ? await q
        .select({
          courseId: courseMembers.courseId,
          userId: courseMembers.userId,
        })
        .from(courseMembers)
        .where(
          and(
            inArray(courseMembers.userId, traineeIds),
            inArray(
              courseMembers.courseId,
              linkedCourses.map(c => String(c.id))
            )
          )
        )
    : [];
  const existingAssignments = assignable.length
    ? await q
        .select({
          quizId: quizAssignments.quizId,
          traineeId: quizAssignments.traineeId,
        })
        .from(quizAssignments)
        .where(
          and(
            inArray(quizAssignments.traineeId, traineeIds),
            inArray(quizAssignments.quizId, assignable)
          )
        )
    : [];
  const hasMember = new Set(
    existingMembers.map(r => `${r.userId}|${r.courseId}`)
  );
  const hasAssignment = new Set(
    existingAssignments.map(r => `${r.traineeId}|${r.quizId}`)
  );

  const now = input.now ?? new Date();
  const memberRows: (typeof courseMembers.$inferInsert)[] = [];
  const assignmentRows: (typeof quizAssignments.$inferInsert)[] = [];

  for (const trainee of enrolled) {
    const traineeId = String(trainee.traineeId);
    const terms = effectiveEnrollmentTerms({
      enrollment: {
        startDate: trainee.enrollmentStart,
        durationYears: trainee.enrollmentDuration,
      },
      isPrimary: firstCatalogOf.get(traineeId) === input.catalogId,
      profile: {
        startDate: trainee.profileStart as string | Date | null,
        durationYears: trainee.profileDuration,
      },
    });
    const duration = terms.durationYears;
    const start = terms.startDate ? new Date(terms.startDate) : null;
    const plan = resolvePhasePlan(catalog.settings, duration);
    const phase = currentPhaseOf({
      startDate: start,
      durationYears: duration,
      phaseOneMonths: plan.phaseMonths[0],
      now,
    });
    const wanted = planTraineeContent({
      phase,
      components: components.map(c => ({
        id: String(c.id),
        kind: c.kind,
        phase: c.phase,
        orderIndex: c.orderIndex,
      })),
      electiveComponentIds: choicesOf.get(String(trainee.enrollmentId)) ?? [],
      courses: linkedCourses.map(c => ({
        id: String(c.id),
        trainingComponentId: c.trainingComponentId
          ? String(c.trainingComponentId)
          : null,
      })),
      globalQuizzes: linkedQuizzes.map(z => ({
        id: String(z.id),
        trainingComponentId: z.trainingComponentId
          ? String(z.trainingComponentId)
          : null,
      })),
    });

    const missingCourses = wanted.courseIds.filter(
      id => !hasMember.has(`${traineeId}|${id}`)
    );
    const missingQuizzes = [...wanted.globalQuizIds, ...unlinkedQuizIds].filter(
      id => !hasAssignment.has(`${traineeId}|${id}`)
    );
    if (missingCourses.length === 0 && missingQuizzes.length === 0) continue;

    const organizationId = trainee.organizationId
      ? String(trainee.organizationId)
      : null;
    const detail: TraineeContentSync = {
      traineeId,
      phase,
      courseMembersMissing: missingCourses.length,
      quizAssignmentsMissing: missingQuizzes.length,
      courseMembersAdded: 0,
      quizAssignmentsAdded: 0,
      skippedNoOrganization: organizationId === null,
    };
    summary.details.push(detail);
    if (organizationId === null) {
      summary.skippedNoOrganization += 1;
      continue;
    }
    summary.traineesChanged += 1;
    summary.courseMembersMissing += missingCourses.length;
    summary.quizAssignmentsMissing += missingQuizzes.length;
    for (const courseId of missingCourses) {
      memberRows.push({
        courseId,
        userId: traineeId,
        role: 'TRAINEE' as never,
        organizationId,
      });
    }
    for (const quizId of missingQuizzes) {
      assignmentRows.push({
        quizId,
        traineeId,
        assignedById: input.actorId,
        organizationId,
      });
    }
  }

  if (input.execute) {
    // ON CONFLICT DO NOTHING: a parallel trainer assignment is not an error,
    // and what is written is counted from the rows that came back
    const addedMembers = new Map<string, number>();
    for (const part of chunks(memberRows)) {
      const done = await q
        .insert(courseMembers)
        .values(part)
        .onConflictDoNothing()
        .returning({ userId: courseMembers.userId });
      for (const row of done) {
        const key = String(row.userId);
        addedMembers.set(key, (addedMembers.get(key) ?? 0) + 1);
      }
    }
    const addedAssignments = new Map<string, number>();
    for (const part of chunks(assignmentRows)) {
      const done = await q
        .insert(quizAssignments)
        .values(part)
        .onConflictDoNothing()
        .returning({ traineeId: quizAssignments.traineeId });
      for (const row of done) {
        const key = String(row.traineeId);
        addedAssignments.set(key, (addedAssignments.get(key) ?? 0) + 1);
      }
    }
    for (const detail of summary.details) {
      detail.courseMembersAdded = addedMembers.get(detail.traineeId) ?? 0;
      detail.quizAssignmentsAdded = addedAssignments.get(detail.traineeId) ?? 0;
      summary.courseMembersAdded += detail.courseMembersAdded;
      summary.quizAssignmentsAdded += detail.quizAssignmentsAdded;
    }
  }
  return summary;
}

/**
 * The tool for the admins: one transaction under an advisory lock, so two runs
 * for the same catalog do not overlap. `organizationId` limits it to the
 * trainees of one organization (always set for an organization admin).
 */
export async function runCatalogContentSync(input: {
  catalogId: string;
  actorId: string;
  execute: boolean;
  organizationId?: string;
  includeUnlinkedGlobalQuizzes?: boolean;
}): Promise<CatalogContentSync | null> {
  return db.transaction(async tx => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${contentSyncLockKey(input.catalogId)}))`
    );
    return syncCatalogTraineeContent(tx, input);
  });
}

/**
 * The hook of the enrollment: one trainee, written at once. A failure must not
 * undo the enrollment, so it is logged and answered with null (the platform
 * admin can run the tool later).
 */
export async function syncTraineeContentAfterEnrollment(input: {
  catalogId: string;
  traineeId: string;
  actorId: string;
}): Promise<CatalogContentSync | null> {
  try {
    return await db.transaction(tx =>
      syncCatalogTraineeContent(tx, { ...input, execute: true })
    );
  } catch (err) {
    console.error('[trainee-content] sync after enrollment failed:', err);
    return null;
  }
}
