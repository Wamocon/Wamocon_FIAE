// Solution protection of the use case import. Pure functions.
//
// Solutions of a use case are the model solution and the evaluation criteria.
// The app keeps them in content_documents rows of the type TRAINER_SOLUTION
// with the visibility TRAINER_ONLY, which trainee routes do not read. The
// visible parts (the assignment in use_cases.description_text and the topics
// as a THEORY document) must never hold a solution.
//
// The check fails closed: a marker word of a solution in a visible text, or a
// longer solution text inside a visible text, is a leak. It runs on the plan
// and again on the rows that are about to be written.

import { leakOf } from '../apply/guard';
import type { Row } from '../apply/db';
import { hasUseCaseSolutionMarker } from './parser';
import type { PlanUseCase, UseCasePlan } from './types';

/** A block of a solution must be at least this long to count on its own. */
const MIN_BLOCK_LENGTH = 60;
/** The first characters of a block that are looked up in a visible text. */
const KEY_LENGTH = 40;

const normalize = (text: string) =>
  text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The solution texts of the plan: the whole model solution and the whole
 * criteria of every use case. A visible field that holds one of them is a leak
 * (the plan is refused, the use case is skipped).
 */
export function solutionTextsOfUseCases(useCases: readonly PlanUseCase[]) {
  const out: string[] = [];
  for (const useCase of useCases) {
    for (const text of [useCase.solution, useCase.criteria ?? '']) {
      if (text) out.push(text);
    }
  }
  return out;
}

/**
 * Blocks of one use case's solution that also stand in the visible text of
 * another use case. That is no proof of a leak (the model solution of one use
 * case may quote a sentence of another one), so the plan only names the pair
 * as a warning for the owner. A block counts when it is long enough and does
 * not stand in the visible text of its own use case (the model solution
 * repeats the steps of its own assignment, those blocks are not secret).
 * Returns pairs of use case codes: the one whose visible text holds the block
 * and the one whose solution it is.
 */
export function sharedSolutionBlocks(
  useCases: readonly PlanUseCase[],
  assignments: ReadonlyMap<string, string> = new Map()
): Array<{ visibleIn: string; solutionOf: string }> {
  const visibleOf = new Map(
    useCases.map(u => [
      u.code,
      normalize(
        [u.description, u.topics ?? '', assignments.get(u.code) ?? ''].join(
          '\n'
        )
      ),
    ])
  );
  // blocks by their first characters, so a text is scanned once
  const index = new Map<string, Array<{ owner: string; block: string }>>();
  for (const useCase of useCases) {
    const own = visibleOf.get(useCase.code) as string;
    for (const text of [useCase.solution, useCase.criteria ?? '']) {
      for (const raw of text.split(/\n{2,}/)) {
        const block = normalize(raw);
        if (block.length < MIN_BLOCK_LENGTH || own.includes(block)) continue;
        const key = block.slice(0, KEY_LENGTH);
        const bucket = index.get(key);
        if (bucket) bucket.push({ owner: useCase.code, block });
        else index.set(key, [{ owner: useCase.code, block }]);
      }
    }
  }
  const pairs = new Map<string, { visibleIn: string; solutionOf: string }>();
  for (const useCase of useCases) {
    const visible = visibleOf.get(useCase.code) as string;
    for (let i = 0; i + KEY_LENGTH <= visible.length; i += 1) {
      const bucket = index.get(visible.slice(i, i + KEY_LENGTH));
      for (const entry of bucket ?? []) {
        if (
          entry.owner !== useCase.code &&
          visible.startsWith(entry.block, i)
        ) {
          pairs.set(`${useCase.code}|${entry.owner}`, {
            visibleIn: useCase.code,
            solutionOf: entry.owner,
          });
        }
      }
    }
  }
  return [...pairs.values()];
}

/** Where a visible text shows a solution, or null. Never returns the text. */
export function leakInUseCaseText(
  text: string | null | undefined,
  solutions: string[]
): string | null {
  if (!text) return null;
  if (hasUseCaseSolutionMarker([text])) return 'contains a solution marker';
  return leakOf(text, solutions);
}

/**
 * Problems of one use case: a solution in a field that trainees can see.
 * `assignment` is the whole visible assignment text, only known while the plan
 * is built.
 */
export function leaksInUseCase(
  useCase: PlanUseCase,
  solutions: string[],
  assignment?: string
): string[] {
  const problems: string[] = [];
  for (const [where, text] of [
    ['title', useCase.title],
    ['description', useCase.description],
    ['topics', useCase.topics],
    // the visible assignment (situation, objective, steps) is not part of the
    // plan any more (the description is the short title, the assignment is the
    // task PDF), the check reads it while the plan is built
    ['assignment', assignment],
  ] as const) {
    const reason = leakInUseCaseText(text, solutions);
    if (reason) problems.push(`use case ${useCase.code} ${where} ${reason}`);
  }
  return problems;
}

/** Problems of the plan: a solution in a field that trainees can see. */
export function findUseCaseLeaks(plan: UseCasePlan): string[] {
  const solutions = solutionTextsOfUseCases(plan.useCases);
  return plan.useCases.flatMap(useCase => leaksInUseCase(useCase, solutions));
}

/**
 * Problems of the rows that are about to be written. Besides the visible
 * columns it checks the places of the solutions: every document row is either
 * a THEORY document for everyone or a TRAINER_SOLUTION document for trainers
 * only, and nothing else.
 */
export function findUseCaseRowLeaks(
  rows: { use_cases: Row[]; content_documents: Row[] },
  solutions: string[]
): string[] {
  const problems: string[] = [];
  for (const row of rows.use_cases) {
    for (const column of ['title', 'description_text']) {
      const value = row[column];
      if (typeof value !== 'string') continue;
      const reason = leakInUseCaseText(value, solutions);
      if (reason) problems.push(`use_cases.${column} ${reason}`);
    }
  }
  for (const row of rows.content_documents) {
    const trainerOnly =
      row.document_type === 'TRAINER_SOLUTION' &&
      row.visibility === 'TRAINER_ONLY';
    const everyone = row.document_type === 'THEORY' && row.visibility === 'ALL';
    if (!trainerOnly && !everyone) {
      problems.push(
        'content_documents row has an unexpected type or visibility'
      );
      continue;
    }
    if (!row.use_case_id && !row.enabler_id) {
      problems.push('content_documents row names no use case');
    }
    if (everyone) {
      for (const column of ['title', 'description', 'file_name']) {
        const value = row[column];
        if (typeof value !== 'string') continue;
        const reason = leakInUseCaseText(value, solutions);
        if (reason) problems.push(`content_documents.${column} ${reason}`);
      }
    }
  }
  return problems;
}
