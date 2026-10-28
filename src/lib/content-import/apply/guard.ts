// Solution protection of the apply step. Pure functions.
//
// Solutions of the KfBM content are the correct option of a question and its
// rationale, and the model solution of a use case (use-cases/guard.ts). The app
// keeps them in columns that trainee routes do not read (options.is_correct,
// options.explanation of the correct option, content_documents of the type
// TRAINER_SOLUTION with the visibility TRAINER_ONLY). This module checks, on the
// plan and on the rows that are about to be written, that no solution reaches a
// field that a trainee can see.
//
// A scenario is no secret since the decision of the owner of 29.10.2026: it is one
// file, whole, and trainees read all of it (solution approach and knowledge text
// included, like the scenario documents of FIAE). Only that file may show its
// solution. The decision of the owner holds for the other texts as well: a teaching
// text of an enabler, a component or a course must not repeat a solution part of a
// scenario word for word (see longSolutionTexts), and never the model solution of a
// use case (the caller names those texts, see findSolutionLeaks).
//
// The check fails closed: a marker word of a solution in a visible text, or a
// rationale of a quiz inside a visible text, is a leak.

import type { ImportPlan } from './types';

/**
 * Marker words of a solution, as they stand in the source format: the labels
 * "Richtige Antwort" and "Kurzbegründung" at the start of a line or followed by
 * a colon (the same words as toTraineeQuiz refuses, but not the plain words in
 * running text, a question may ask for "the right answer"), and the headings of
 * the scenario solution. Tested on the raw text, line by line.
 */
//
// The list is shared with the upload excerpts (src/lib/content-upload) and also
// holds the markers of the use case documents and the variants of a solution
// heading ("Lösung", "Korrekte Antwort", "Antwortschlüssel", "Lösungsvorschlag").
// A marker that needs a line of its own ("Lösung", "Bewertungskriterien") is not
// found in running text, a tasks uses these words often. The newer patterns use
// [^\S\n] (white space without a line break) so a long run of white space cannot
// make the scan quadratic.
/**
 * The bare heading of a solution: a line of just the word "Lösung", with an
 * optional colon. It is the only marker an owner review can release (see
 * leakOfEnablerText), for the text of a named enabler where the word labels a
 * table cell.
 */
const BARE_SOLUTION_LINE =
  /(?:^|\n)[^\S\n]*L(?:ö|oe)sung[^\S\n]*(?::[^\S\n]*)?(?:\n|$)/i;

export const SOLUTION_MARKERS: readonly RegExp[] = Object.freeze([
  /(?:^|\n)\s*Richtige\s+Antwort\b/i,
  /Richtige\s+Antwort\s*:/i,
  /(?:^|\n)\s*Kurzbegr(?:ü|ue)ndung\b/i,
  /Kurzbegr(?:ü|ue)ndung\s*:/i,
  /L(?:ö|oe)sungs?szenario/i,
  /Fachwissen\s+zur\s+L(?:ö|oe)sung/i,
  // Use case documents
  /(?:^|\n)[^\S\n]*Musterl(?:ö|oe)sung\b/i,
  /Musterl(?:ö|oe)sung[^\S\n]*:/i,
  /(?:^|\n)[^\S\n]*Bewertungskriterien[^\S\n]*(?::[^\S\n]*)?(?:\n|$)/i,
  // The bare heading of a solution (the scenario parser reads it as one)
  BARE_SOLUTION_LINE,
  // Variants of the label of an answer or a solution
  /(?:^|\n)[^\S\n]*(?:Korrekte[^\S\n]+Antwort|Antwortschl(?:ü|ue)ssel|L(?:ö|oe)sungsvorschlag)\b/i,
  /(?:Korrekte[^\S\n]+Antwort|Antwortschl(?:ü|ue)ssel|L(?:ö|oe)sungsvorschlag)[^\S\n]*:/i,
]);

/**
 * The markers that never belong to a whole scenario: the answers and rationales of a quiz
 * and the model solution and criteria of a use case. A scenario holds its own solution
 * approach on purpose (Lösungsszenario, Fachwissen zur Lösung, a Lösung heading), so those
 * markers are left out. The upload uses this list to refuse a file that is typed as a
 * scenario but is really a quiz or a use case.
 */
export const NON_SCENARIO_MARKERS: readonly RegExp[] = Object.freeze([
  /(?:^|\n)\s*Richtige\s+Antwort\b/i,
  /Richtige\s+Antwort\s*:/i,
  /(?:^|\n)\s*Kurzbegr(?:ü|ue)ndung\b/i,
  /Kurzbegr(?:ü|ue)ndung\s*:/i,
  /(?:^|\n)[^\S\n]*Musterl(?:ö|oe)sung\b/i,
  /Musterl(?:ö|oe)sung[^\S\n]*:/i,
  /(?:^|\n)[^\S\n]*Bewertungskriterien[^\S\n]*(?::[^\S\n]*)?(?:\n|$)/i,
  /(?:^|\n)[^\S\n]*(?:Korrekte[^\S\n]+Antwort|Antwortschl(?:ü|ue)ssel)\b/i,
  /(?:Korrekte[^\S\n]+Antwort|Antwortschl(?:ü|ue)ssel)[^\S\n]*:/i,
]);

/** A solution text must be at least this long to be searched inside others. */
const MIN_SOLUTION_LENGTH = 20;

const normalize = (text: string) =>
  text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Every solution text of the plan: the rationales of the quizzes. The solution
 * parts of a scenario are not among them: the scenario itself, its title, its
 * situation and its task may show them (the whole scenario is public).
 */
export function solutionTexts(plan: ImportPlan): string[] {
  const out: string[] = [];
  for (const quiz of plan.quizzes) {
    for (const question of quiz.questions) {
      for (const option of question.options) {
        if (option.explanation) out.push(option.explanation);
      }
    }
  }
  return out;
}

/**
 * The solution parts of the scenarios of the plan (solution approach and the text
 * about how the knowledge helps). Only the scenario file itself may show them.
 */
export function scenarioSolutionTexts(plan: ImportPlan): string[] {
  const out: string[] = [];
  for (const scenario of plan.scenarios) {
    // a plan read back from a file may hold anything: only text counts
    if (typeof scenario.solution === 'string' && scenario.solution) {
      out.push(scenario.solution);
    }
    if (
      typeof scenario.knowledgeContribution === 'string' &&
      scenario.knowledgeContribution
    ) {
      out.push(scenario.knowledgeContribution);
    }
  }
  return out;
}

/**
 * The long solution texts that are searched in the descriptions of components,
 * courses and enablers: the solution parts of the scenarios of the plan and the
 * texts the caller names (the model solutions of the use cases, which a plan of
 * this import does not know). A Lehrtext may repeat a sentence of a rationale,
 * because the rationales are taken from it, so the rationales do not count here.
 */
export function longSolutionTexts(
  plan: ImportPlan,
  protectedTexts: readonly string[] = []
): string[] {
  return [...scenarioSolutionTexts(plan), ...protectedTexts];
}

/**
 * Where a visible text shows a solution. `solutions` are the solution texts to
 * search for. Returns a description of the problem (never the text itself).
 */
export function leakOf(
  text: string,
  solutions: readonly string[],
  options: {
    allowBareSolutionLine?: boolean;
    /** The markers to look for, SOLUTION_MARKERS when left out. */
    markers?: readonly RegExp[];
  } = {}
): string | null {
  const visible = normalize(text);
  if (visible.length === 0) return null;
  // allowBareSolutionLine skips that one marker and no other (an owner review,
  // see leakOfEnablerText). Every other marker and the solution texts stay.
  if (
    (options.markers ?? SOLUTION_MARKERS).some(
      marker =>
        !(options.allowBareSolutionLine && marker === BARE_SOLUTION_LINE) &&
        marker.test(text)
    )
  ) {
    return 'contains a solution marker';
  }
  const index = needleIndex(solutions);
  for (let i = 0; i + MIN_SOLUTION_LENGTH <= visible.length; i += 1) {
    const bucket = index.get(visible.slice(i, i + MIN_SOLUTION_LENGTH));
    if (bucket && bucket.some(needle => visible.startsWith(needle, i))) {
      return 'contains a solution text';
    }
  }
  return null;
}

/**
 * The check of an enabler text. `reviewed` is true for an enabler whose bare line
 * "Lösung" the owner has checked (a table cell label in the teaching text): then
 * that one pattern is let through, every other marker and every solution text
 * still counts. `reviewUsed` tells whether the review was needed, so the
 * plan can say so. Only for the enabler text, never for titles, scenarios,
 * quizzes or use cases.
 */
export function leakOfEnablerText(
  text: string,
  solutions: readonly string[],
  reviewed: boolean
): { reason: string | null; reviewUsed: boolean } {
  const strict = leakOf(text, solutions);
  if (strict === null || !reviewed)
    return { reason: strict, reviewUsed: false };
  const relaxed = leakOf(text, solutions, { allowBareSolutionLine: true });
  return { reason: relaxed, reviewUsed: relaxed === null };
}

/**
 * Enabler codes whose text the plan lets pass with a reviewed bare line. Only
 * well-formed entries count (validatePlan reports the others), so a damaged
 * list releases nothing.
 */
export function reviewedEnablerCodes(
  plan: Pick<ImportPlan, 'reviewedMarkers'>
): Set<string> {
  const list: unknown = plan.reviewedMarkers;
  const codes = new Set<string>();
  if (!Array.isArray(list)) return codes;
  for (const entry of list as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { enablerCode, pattern } = entry as Record<string, unknown>;
    if (typeof enablerCode === 'string' && pattern === 'bare-solution-line') {
      codes.add(enablerCode);
    }
  }
  return codes;
}

/**
 * Index of the solution texts by their first MIN_SOLUTION_LENGTH characters,
 * so a text is searched in one pass instead of once per solution (a run has
 * thousands of rationales and tens of thousands of options). Built once per
 * list of solutions.
 */
const indexCache = new WeakMap<readonly string[], Map<string, string[]>>();
function needleIndex(solutions: readonly string[]): Map<string, string[]> {
  const cached = indexCache.get(solutions);
  if (cached) return cached;
  const index = new Map<string, string[]>();
  for (const solution of solutions) {
    const needle = normalize(solution);
    if (needle.length < MIN_SOLUTION_LENGTH) continue;
    const key = needle.slice(0, MIN_SOLUTION_LENGTH);
    const bucket = index.get(key);
    if (bucket) bucket.push(needle);
    else index.set(key, [needle]);
  }
  indexCache.set(solutions, index);
  return index;
}

/** Problems of the plan: a solution in a field that trainees can see. */
export function findSolutionLeaks(
  plan: ImportPlan,
  protectedTexts: readonly string[] = []
): string[] {
  const solutions = solutionTexts(plan);
  const strong = longSolutionTexts(plan, protectedTexts);
  const reviewed = reviewedEnablerCodes(plan);
  const problems: string[] = [];
  const check = (
    where: string,
    text: string | null | undefined,
    against: readonly string[] = solutions
  ) => {
    if (!text) return;
    const reason = leakOf(text, against);
    if (reason) problems.push(`${where} ${reason}`);
  };

  for (const c of plan.components) {
    check(`component ${c.code} title`, c.title, strong);
    check(`component ${c.code} reference`, c.reference, strong);
  }
  for (const e of plan.enablers) {
    check(`enabler ${e.code} title`, e.title, strong);
    if (e.descriptionText) {
      const reason = leakOfEnablerText(
        e.descriptionText,
        strong,
        reviewed.has(e.code)
      ).reason;
      if (reason) problems.push(`enabler ${e.code} text ${reason}`);
    }
  }
  for (const s of plan.scenarios) {
    check(`scenario ${s.enablerCode} title`, s.title);
    check(`scenario ${s.enablerCode} situation`, s.situation);
    // The task is visible text. A marker word or a rationale of a quiz in it is a leak. That it
    // repeats a solution part of its own scenario is no leak: the whole scenario is public (the
    // parser reports it as the warning TASK_SOLUTION_OVERLAP or TASK_SOLUTION_HEADING).
    if (typeof s.task === 'string') {
      check(`scenario ${s.enablerCode} task`, s.task);
    }
  }
  for (const quiz of plan.quizzes) {
    check(`quiz ${quiz.code} title`, quiz.title);
    for (const q of quiz.questions) {
      check(`quiz ${quiz.code} question ${q.number}`, q.text);
      for (const o of q.options) {
        check(
          `quiz ${quiz.code} question ${q.number} option ${o.letter}`,
          o.text
        );
      }
    }
  }
  return problems;
}

type Row = Record<string, unknown>;

/** Columns a trainee can read, by table (the rows of the other tables are not visible text). */
const VISIBLE_COLUMNS: Record<string, string[]> = {
  training_components: ['title', 'description'],
  courses: ['title', 'description'],
  enablers: ['title', 'description_text'],
  quizzes: ['title'],
  questions: ['question_text'],
  options: ['option_text'],
};

/**
 * Problems of the rows that are about to be written. Besides the visible
 * columns it checks the places of the solutions: an explanation only on the
 * correct option, no expected answer on a question, and every document that
 * holds a solution is TRAINER_SOLUTION and TRAINER_ONLY. `reviewedEnablers`
 * are the codes of the enablers whose text may carry a reviewed bare line
 * "Lösung" (the column description_text of their rows, nothing else).
 */
export function findRowLeaks(
  rows: Record<string, Row[]>,
  solutions: readonly string[],
  strong: readonly string[] = solutions,
  reviewedEnablers: ReadonlySet<string> = new Set()
): string[] {
  const problems: string[] = [];
  const longOnly = ['training_components', 'courses', 'enablers'];
  for (const [table, columns] of Object.entries(VISIBLE_COLUMNS)) {
    for (const row of rows[table] ?? []) {
      for (const column of columns) {
        const value = row[column];
        if (typeof value !== 'string') continue;
        const against = longOnly.includes(table) ? strong : solutions;
        const reason =
          table === 'enablers' && column === 'description_text'
            ? leakOfEnablerText(
                value,
                against,
                reviewedEnablers.has(String(row.code))
              ).reason
            : leakOf(value, against);
        if (reason) problems.push(`${table}.${column} ${reason}`);
      }
    }
  }
  for (const row of rows.options ?? []) {
    if (row.explanation && row.is_correct !== true) {
      problems.push(
        'options.explanation is set on an option that is not correct'
      );
    }
  }
  for (const row of rows.questions ?? []) {
    if (row.expected_answer !== undefined && row.expected_answer !== null) {
      problems.push('questions.expected_answer must stay empty');
    }
  }
  for (const row of rows.content_documents ?? []) {
    const trainerOnly =
      row.document_type === 'TRAINER_SOLUTION' &&
      row.visibility === 'TRAINER_ONLY';
    const traineeQuestion =
      row.document_type === 'TRAINEE_QUESTION' && row.visibility === 'ALL';
    // The original of an enabler text (upload): a theory document for everyone
    // that hangs on an enabler. The theory documents of a use case belong to the
    // use case import and are not written here.
    const theory = row.document_type === 'THEORY' && row.visibility === 'ALL';
    // The whole scenario (upload): the exercise document of FIAE, for everyone, at
    // an enabler. Trainees may read all of it, so it is no solution document. The
    // task and the model solution of a use case are not part of this.
    const exercise =
      row.document_type === 'EXERCISE' && row.visibility === 'ALL';
    if (!trainerOnly && !traineeQuestion && !theory && !exercise) {
      problems.push(
        'content_documents row has an unexpected type or visibility'
      );
      continue;
    }
    const filed = theory ? 'THEORY' : 'EXERCISE';
    if ((theory || exercise) && !row.enabler_id) {
      problems.push(`content_documents ${filed} row names no enabler`);
      continue;
    }
    if ((theory || exercise) && row.use_case_id) {
      problems.push(`content_documents ${filed} row belongs to a use case`);
      continue;
    }
    const traineeSafe = traineeQuestion || theory || exercise;
    const title = typeof row.title === 'string' ? row.title : '';
    if (leakOf(title, solutions)) {
      problems.push('content_documents.title contains a solution');
    }
    if (traineeSafe && typeof row.description === 'string') {
      const reason = leakOf(row.description, solutions);
      if (reason) problems.push(`content_documents.description ${reason}`);
    }
    if (traineeSafe && typeof row.file_name === 'string') {
      const reason = leakOf(row.file_name, solutions);
      if (reason) problems.push(`content_documents.file_name ${reason}`);
    }
  }
  return problems;
}
