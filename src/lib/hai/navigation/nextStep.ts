/**
 * "Weiter lernen": the next sensible step of a trainee, with the reason in one
 * sentence. Pure function over the data that data.ts loads with the helpers of
 * the order of work (src/lib/catalog/progression-db.ts) and the training phase
 * of the plan (src/lib/hai/trainingScope.ts).
 *
 * Rule, the same as the "next item" of the dashboard, refined by the phase plan:
 *  - the candidates are the active enablers of the courses of the trainee in
 *    course order (stage, chapter, order in the course),
 *  - an enabler counts when it is not completed and not locked (the order of
 *    work and the exceptions of the trainer are already in `locked`),
 *  - an enabler of a stage that the plan has not reached yet comes after the
 *    ones of the current phase, and the reason says so.
 *
 * @module lib/hai/navigation/nextStep
 */

import { plainText } from './text';

/** An active enabler of the trainee with its state in the order of work. */
export interface NextStepEntry {
  enablerId: string;
  title: string;
  courseTitle: string;
  /** courses.year: 1, 2 (phases) or 3 (integrative skills), null if unset. */
  stage: number | null;
  chapter: number | null;
  orderIndex: number;
  completed: boolean;
  locked: boolean;
}

/** What the plan says about the trainee now: the phases whose content is due. */
export interface NextStepPlan {
  currentPhase: number;
  allowedStages: readonly number[];
}

export type NextStep =
  | { kind: 'next'; entry: NextStepEntry; reason: string }
  | { kind: 'all_done' }
  | { kind: 'all_locked' }
  | { kind: 'none' };

const LAST = Number.MAX_SAFE_INTEGER;

function byCourseOrder(a: NextStepEntry, b: NextStepEntry): number {
  const stage = (a.stage ?? LAST) - (b.stage ?? LAST);
  if (stage !== 0) return stage;
  const chapter = (a.chapter ?? LAST) - (b.chapter ?? LAST);
  if (chapter !== 0) return chapter;
  if (a.courseTitle !== b.courseTitle) {
    return a.courseTitle < b.courseTitle ? -1 : 1;
  }
  if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
  return a.enablerId < b.enablerId ? -1 : a.enablerId > b.enablerId ? 1 : 0;
}

function stageLabel(stage: number | null): string | null {
  if (stage === 1 || stage === 2) return `Phase ${stage}`;
  if (stage === 3) return 'Integrative Fertigkeiten';
  return null;
}

export function pickNextStep(
  entries: readonly NextStepEntry[],
  plan?: NextStepPlan | null
): NextStep {
  if (entries.length === 0) return { kind: 'none' };
  const open = entries.filter(e => !e.completed && !e.locked);
  if (open.length === 0) {
    return entries.every(e => e.completed)
      ? { kind: 'all_done' }
      : { kind: 'all_locked' };
  }

  const sorted = [...open].sort(byCourseOrder);
  const due = plan
    ? sorted.find(e => e.stage === null || plan.allowedStages.includes(e.stage))
    : sorted[0];
  const entry = due ?? sorted[0];
  const early =
    !!plan && entry.stage !== null && !plan.allowedStages.includes(entry.stage);

  const course = plainText(entry.courseTitle);
  const label = stageLabel(entry.stage);
  const where = label ? `im Kurs ${course} (${label})` : `im Kurs ${course}`;
  const reason = early
    ? `Das ist dein nächster freigeschalteter Enabler ${where}, er gehört zu einer Phase, die nach deinem Plan erst später beginnt.`
    : `Das ist dein nächster freigeschalteter Enabler ${where}, den du noch nicht abgeschlossen hast.`;
  return { kind: 'next', entry, reason };
}
