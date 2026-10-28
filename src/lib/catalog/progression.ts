/**
 * ONE method for the whole platform: a trainee sees all the content of an
 * assigned course, but works through it one enabler after the other.
 *
 * This module is pure (no database, no server imports). It holds
 *
 *  - the ONE definition of "enabler completed" (isEnablerCompleted),
 *  - the state of every enabler of a course for one trainee
 *    (computeCourseProgression): locked with the reason, open or completed,
 *  - the lock chain of the lesson quizzes LOW, MEDIUM, HIGH
 *    (computeQuizChain),
 *  - the rule that decides for whom the order applies (isSequenceEnforced).
 *
 * The database side that feeds it and the guards of the routes are in
 * src/lib/catalog/progression-db.ts.
 *
 * Rules (decisions of the owner):
 *  - An enabler is completed when every ACTIVE lesson quiz linked to it was
 *    passed with at least PASS_THRESHOLD percent (best attempt). A quiz that is
 *    not passed is "not done", it can be repeated. Scenario and use case
 *    submissions do not count. An enabler without an active quiz has nothing to
 *    pass and counts as completed (content only, as before).
 *  - Inside a course the enablers follow order_index (ties by id). Inactive
 *    enablers do not exist for the trainee and are skipped. The first active
 *    enabler is open, every further one is open when all active enablers before
 *    it are completed. The reason of a lock names the first enabler that is
 *    not completed yet.
 *  - An enabler that was really completed (it has active quizzes and all are
 *    passed) is never locked again, so content that is added later does not
 *    take away what the trainee already did.
 *  - A trainer exception per trainee (trainee_enabler_overrides) beats the
 *    order: true opens the enabler out of turn, false locks it. Without a
 *    value (null) the order applies.
 *  - Grandfathering: the order only applies to a trainee who joined the
 *    training catalog on or after the cut-off date of the catalog
 *    (training_catalogs.settings.sequence_since). Without a cut-off date the
 *    order is not in force for that catalog. See isSequenceEnforced.
 *
 * Stage 2 (the order of the components of an occupation) is NOT built here. It
 * plugs in where lockReason is decided: a component that is not open yet locks
 * all of its enablers with its own reason (add a value to LockReason).
 */

/** Passing score of a lesson quiz in percent. */
export const PASS_THRESHOLD = 50;

export const QUIZ_DIFFICULTIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type QuizDifficulty = (typeof QUIZ_DIFFICULTIES)[number];

/**
 * Why an enabler is locked. SEQUENCE: an enabler before it is not completed
 * yet. MANUAL: the trainer locked it for this trainee.
 */
export type LockReason = 'SEQUENCE' | 'MANUAL';

export type EnablerState = 'locked' | 'open' | 'completed';

/** True when the best score of a quiz reaches the passing score. */
export function isQuizPassed(bestScore: number | null | undefined): boolean {
  return (bestScore ?? 0) >= PASS_THRESHOLD;
}

/** Highest score per quiz id of a list of attempts. */
export function bestScoresOf(
  attempts: ReadonlyArray<{
    quizId: unknown;
    score: number | null | undefined;
  }>
): Map<string, number> {
  const best = new Map<string, number>();
  for (const attempt of attempts) {
    const quizId = String(attempt.quizId);
    const score = attempt.score ?? 0;
    if (score > (best.get(quizId) ?? 0)) best.set(quizId, score);
    else if (!best.has(quizId)) best.set(quizId, 0);
  }
  return best;
}

export interface ProgressionQuizLink {
  enablerId: string;
  quizId: string;
  /** The difficulty slot of the link (null for an old row without one). */
  difficulty: QuizDifficulty | null;
  /** Whether the quiz itself is active. An inactive quiz does not exist. */
  quizIsActive: boolean;
}

/**
 * THE definition of "enabler completed": every active lesson quiz of the
 * enabler is passed (best attempt at or above PASS_THRESHOLD percent). Without
 * an active quiz there is nothing to pass and the enabler counts as completed.
 */
export function isEnablerCompleted(
  links: ReadonlyArray<Pick<ProgressionQuizLink, 'quizId' | 'quizIsActive'>>,
  bestScores: ReadonlyMap<string, number>
): boolean {
  for (const link of links) {
    if (!link.quizIsActive) continue;
    if (!isQuizPassed(bestScores.get(String(link.quizId)))) return false;
  }
  return true;
}

/** True when the enabler has at least one active quiz that can be passed. */
export function hasActiveQuiz(
  links: ReadonlyArray<Pick<ProgressionQuizLink, 'quizIsActive'>>
): boolean {
  return links.some(link => link.quizIsActive);
}

export interface ProgressionEnabler {
  id: string;
  title: string;
  courseId: string;
  orderIndex: number;
  isActive: boolean | null;
}

export interface EnablerProgression {
  enablerId: string;
  state: EnablerState;
  /** The definition of "completed", for counts. Not the same as the state. */
  completed: boolean;
  locked: boolean;
  lockReason: LockReason | null;
  /** The enabler to finish first (reason SEQUENCE), null otherwise. */
  lockedBy: { enablerId: string; title: string } | null;
  /** The trainer exception of this trainee: true, false or none. */
  override: boolean | null;
}

export interface CourseProgression {
  courseId: string;
  /** Whether the order applies to this trainee in this course. */
  enforced: boolean;
  /** The active enablers in course order. */
  enablers: EnablerProgression[];
  completedCount: number;
  totalCount: number;
}

export interface CourseProgressionInput {
  courseId: string;
  /** The order applies to this trainee (see isSequenceEnforced). */
  enforced: boolean;
  /** All enablers of the course, inactive ones too (they are skipped). */
  enablers: ReadonlyArray<ProgressionEnabler>;
  /** Quiz links of those enablers. */
  quizLinks: ReadonlyArray<ProgressionQuizLink>;
  bestScores: ReadonlyMap<string, number>;
  /** Trainer exceptions of this trainee by enabler id (null = none). */
  overrides?: ReadonlyMap<string, boolean | null>;
}

/** Course order: order_index, ties by id, so the order is deterministic. */
export function byCourseOrder(
  a: Pick<ProgressionEnabler, 'orderIndex' | 'id'>,
  b: Pick<ProgressionEnabler, 'orderIndex' | 'id'>
): number {
  if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
}

/**
 * The state of every active enabler of a course for one trainee.
 *
 * With enforced = false (grandfathered, or the rule is not in force for the
 * catalog) nothing is locked, the enablers are open or completed. A trainer
 * exception is only honoured when the order is enforced: before that no
 * exception can have been written for the new meaning, and old rows written by
 * the former, ineffective switch must not lock anybody.
 */
export function computeCourseProgression(
  input: CourseProgressionInput
): CourseProgression {
  const active = input.enablers.filter(e => e.isActive).sort(byCourseOrder);
  const linksOf = new Map<string, ProgressionQuizLink[]>();
  for (const link of input.quizLinks) {
    const key = String(link.enablerId);
    const list = linksOf.get(key);
    if (list) list.push(link);
    else linksOf.set(key, [link]);
  }

  const result: EnablerProgression[] = [];
  let firstOpen: ProgressionEnabler | null = null;
  let completedCount = 0;

  for (const enabler of active) {
    const links = linksOf.get(String(enabler.id)) ?? [];
    const completed = isEnablerCompleted(links, input.bestScores);
    const reallyCompleted = completed && hasActiveQuiz(links);
    if (completed) completedCount += 1;

    const override = input.enforced
      ? (input.overrides?.get(String(enabler.id)) ?? null)
      : null;

    let lockReason: LockReason | null = null;
    let lockedBy: EnablerProgression['lockedBy'] = null;
    if (input.enforced && !reallyCompleted) {
      if (override === false) {
        lockReason = 'MANUAL';
      } else if (override === null && firstOpen !== null) {
        lockReason = 'SEQUENCE';
        lockedBy = { enablerId: String(firstOpen.id), title: firstOpen.title };
      }
    }

    const locked = lockReason !== null;
    result.push({
      enablerId: String(enabler.id),
      state: locked ? 'locked' : completed ? 'completed' : 'open',
      completed,
      locked,
      lockReason,
      lockedBy,
      override,
    });

    // The first enabler in order that is not completed is the one to finish
    if (firstOpen === null && !completed) firstOpen = enabler;
  }

  return {
    courseId: input.courseId,
    enforced: input.enforced,
    enablers: result,
    completedCount,
    totalCount: active.length,
  };
}

/**
 * Does the order apply to this trainee in this catalog?
 *
 * Grandfathering without a migration: the catalog carries a cut-off date
 * (settings.sequence_since, set by the platform admin, never automatically).
 * The order applies to a trainee who joined the catalog on or after that date
 * (enrolledAt: the enrollment in the catalog, for a trainee without one the
 * creation of the profile). Everybody who started before works as before.
 * Without a cut-off date, or without a date of joining, the order does not
 * apply: nobody who is already working is blocked by a missing setting.
 */
export function isSequenceEnforced(
  since: Date | null | undefined,
  enrolledAt: Date | null | undefined
): boolean {
  if (!since || Number.isNaN(since.getTime())) return false;
  if (!enrolledAt || Number.isNaN(enrolledAt.getTime())) return false;
  return enrolledAt.getTime() >= since.getTime();
}

/**
 * The cut-off date of a catalog from its stored settings. Tolerant like the
 * other readers: a missing or invalid value means "not in force" (null).
 */
export function readSequenceSince(settings: unknown): Date | null {
  if (settings === null || typeof settings !== 'object') return null;
  const raw = (settings as Record<string, unknown>).sequence_since;
  if (typeof raw !== 'string') return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ---------------------------------------------------------------------------
// The lock chain of the lesson quizzes
// ---------------------------------------------------------------------------

export interface QuizChainEntry {
  difficulty: QuizDifficulty;
  quizId: string;
  /** The trainee made at least one attempt. */
  submitted: boolean;
  /** The best attempt reached the passing score. */
  passed: boolean;
  /** The attempts so far may start (the quiz before it was submitted). */
  unlocked: boolean;
  /** The quiz that has to be submitted first, null for the first quiz. */
  after: QuizDifficulty | null;
}

/**
 * The chain LOW, then MEDIUM, then HIGH. A quiz opens when an attempt was made
 * at the quiz before it ("submitted", as the list always showed it; passing
 * counts for the completion of the enabler, not for the chain). The first
 * existing quiz is open. A quiz that does not exist or is inactive is skipped,
 * so the chain never ends in a quiz nobody can open.
 */
export function computeQuizChain(
  links: ReadonlyArray<
    Pick<ProgressionQuizLink, 'quizId' | 'difficulty' | 'quizIsActive'>
  >,
  bestScores: ReadonlyMap<string, number>,
  submittedQuizIds: ReadonlySet<string>
): QuizChainEntry[] {
  const chain: QuizChainEntry[] = [];
  let previous: QuizChainEntry | null = null;
  for (const difficulty of QUIZ_DIFFICULTIES) {
    const link = links.find(l => l.difficulty === difficulty && l.quizIsActive);
    if (!link) continue;
    const quizId = String(link.quizId);
    const entry: QuizChainEntry = {
      difficulty,
      quizId,
      submitted: submittedQuizIds.has(quizId),
      passed: isQuizPassed(bestScores.get(quizId)),
      unlocked: previous === null ? true : previous.submitted,
      after: previous === null ? null : previous.difficulty,
    };
    chain.push(entry);
    previous = entry;
  }
  return chain;
}
