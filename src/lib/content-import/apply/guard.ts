// Solution protection of the apply step. Pure functions.
//
// Solutions of the KfBM content are the correct option of a question and its
// rationale, the solution of a scenario and the text about how the knowledge
// contributes to the solution. The app keeps them in columns that trainee
// routes do not read (options.is_correct, options.explanation of the correct
// option, content_documents of the type TRAINER_SOLUTION with the visibility
// TRAINER_ONLY). This module checks, on the plan and on the rows that are
// about to be written, that no solution reaches a field that a trainee can see.
//
// The check fails closed: a marker word of a solution in a visible text, or a
// longer solution text inside a visible text, is a leak.

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
  /(?:^|\n)[^\S\n]*L(?:ö|oe)sung[^\S\n]*(?::[^\S\n]*)?(?:\n|$)/i,
  // Variants of the label of an answer or a solution
  /(?:^|\n)[^\S\n]*(?:Korrekte[^\S\n]+Antwort|Antwortschl(?:ü|ue)ssel|L(?:ö|oe)sungsvorschlag)\b/i,
  /(?:Korrekte[^\S\n]+Antwort|Antwortschl(?:ü|ue)ssel|L(?:ö|oe)sungsvorschlag)[^\S\n]*:/i,
]);

/** A solution text must be at least this long to be searched inside others. */
const MIN_SOLUTION_LENGTH = 20;

const normalize = (text: string) =>
  text.replace(/\s+/g, ' ').trim().toLowerCase();

/** Every solution text of the plan (rationales, scenario solutions). */
export function solutionTexts(plan: ImportPlan): string[] {
  const out: string[] = [];
  for (const quiz of plan.quizzes) {
    for (const question of quiz.questions) {
      for (const option of question.options) {
        if (option.explanation) out.push(option.explanation);
      }
    }
  }
  for (const scenario of plan.scenarios) {
    if (scenario.solution) out.push(scenario.solution);
    if (scenario.knowledgeContribution) {
      out.push(scenario.knowledgeContribution);
    }
  }
  return out;
}

/**
 * The long solution texts of the scenarios (solution and knowledge text). A
 * Lehrtext may repeat a sentence of a rationale, because the rationales are
 * taken from it, so only these long texts are searched in descriptions of
 * components, courses and enablers.
 */
export function scenarioSolutionTexts(plan: ImportPlan): string[] {
  const out: string[] = [];
  for (const scenario of plan.scenarios) {
    if (scenario.solution) out.push(scenario.solution);
    if (scenario.knowledgeContribution) {
      out.push(scenario.knowledgeContribution);
    }
  }
  return out;
}

/**
 * Where a visible text shows a solution. `solutions` are the solution texts to
 * search for. Returns a description of the problem (never the text itself).
 */
export function leakOf(text: string, solutions: string[]): string | null {
  const visible = normalize(text);
  if (visible.length === 0) return null;
  if (SOLUTION_MARKERS.some(marker => marker.test(text))) {
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
 * Index of the solution texts by their first MIN_SOLUTION_LENGTH characters,
 * so a text is searched in one pass instead of once per solution (a run has
 * thousands of rationales and tens of thousands of options). Built once per
 * list of solutions.
 */
const indexCache = new WeakMap<string[], Map<string, string[]>>();
function needleIndex(solutions: string[]): Map<string, string[]> {
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
export function findSolutionLeaks(plan: ImportPlan): string[] {
  const solutions = solutionTexts(plan);
  const strong = scenarioSolutionTexts(plan);
  const problems: string[] = [];
  const check = (
    where: string,
    text: string | null | undefined,
    against = solutions
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
    check(`enabler ${e.code} text`, e.descriptionText, strong);
  }
  for (const s of plan.scenarios) {
    check(`scenario ${s.enablerCode} title`, s.title);
    check(`scenario ${s.enablerCode} situation`, s.situation);
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
 * holds a solution is TRAINER_SOLUTION and TRAINER_ONLY.
 */
export function findRowLeaks(
  rows: Record<string, Row[]>,
  solutions: string[],
  strong: string[] = solutions
): string[] {
  const problems: string[] = [];
  const longOnly = ['training_components', 'courses', 'enablers'];
  for (const [table, columns] of Object.entries(VISIBLE_COLUMNS)) {
    for (const row of rows[table] ?? []) {
      for (const column of columns) {
        const value = row[column];
        if (typeof value !== 'string') continue;
        const reason = leakOf(
          value,
          longOnly.includes(table) ? strong : solutions
        );
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
    if (!trainerOnly && !traineeQuestion && !theory) {
      problems.push(
        'content_documents row has an unexpected type or visibility'
      );
      continue;
    }
    if (theory && !row.enabler_id) {
      problems.push('content_documents THEORY row names no enabler');
      continue;
    }
    if (theory && row.use_case_id) {
      problems.push('content_documents THEORY row belongs to a use case');
      continue;
    }
    const traineeSafe = traineeQuestion || theory;
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
