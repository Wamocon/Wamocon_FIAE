// Builds the plan of the use case import (phase 4.6, step "plan"). Pure
// functions: no file access and no database. The caller reads the files and
// hands over the parsed content (see SourceFile).
//
// The plan holds everything that a run would write: one use case per enabler,
// with its assignment, its topics and its solution texts, plus the files that
// were skipped and why. Anything that is unclear is skipped with a reason and
// never guessed. Skipped files do not reach the database.
//
// The use cases hang on the courses and enablers of the content import
// (kfbm-apply.mjs), which has to run first. The keys are the component code,
// the enabler code and the letter of the use case (K6.2, K6.2-d, d).

import { kindOfComponent } from '../apply/decisions';
import type { Decisions } from '../apply/types';
import { MAX_USE_CASE_DESCRIPTION, describeUseCase } from '../descriptions';
import { enablerKeysMatch } from '../path-info';
import type { ParseResult, PathInfo } from '../types';
import {
  findUseCaseLeaks,
  sharedSolutionBlocks,
  leaksInUseCase,
  solutionTextsOfUseCases,
} from './guard';
import { assignmentText, toTraineeUseCase } from './parser';
import type {
  ParsedUseCase,
  PlanUseCase,
  UseCasePlan,
  UseCasePlanCounts,
  UseCaseSkip,
} from './types';

/** Parsed content of one source file. */
export type SourceContent = {
  type: 'use-case';
  result: ParseResult<ParsedUseCase>;
};

/** One file of the source tree with its metadata and, if read, its content. */
export interface SourceFile {
  /** Path below the source folder, forward slashes. */
  rel: string;
  size: number;
  mtimeMs: number;
  /** OneDrive placeholder, not downloaded. */
  placeholder: boolean;
  info: PathInfo;
  content?: SourceContent;
  /** Set when reading the file failed (timeout, damaged file). */
  readError?: string;
}

type FileMeta = Pick<SourceFile, 'rel' | 'mtimeMs' | 'info'>;

export interface UseCaseSelection {
  /** Files to read and plan, one per content key. */
  chosen: string[];
  skipped: UseCaseSkip[];
  superseded: UseCasePlan['superseded'];
  notPlanned: Record<string, number>;
}

const HOUR = 3600 * 1000;
/** Same pattern as the CHECK constraint of use_cases.code. */
const CODE_FORMAT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const COMPONENT_CODE = /^K\d{1,2}(?:\.\d)?$/;

const skip = (
  file: string | null,
  key: string | null,
  code: string,
  reason: string
): UseCaseSkip => ({ file, key, code, reason });

const letterOrdinal = (letter: string) =>
  letter.toLowerCase().charCodeAt(0) - 96;

/**
 * Chooses the files that are read and planned: one per content key. Files that
 * are not part of this package, files that fit no scheme and files of a
 * component without a decision are left out. Of several copies of one use case
 * the newest wins (highest version, then latest change), unless the copies
 * cannot be told apart, and a copy from a folder "Ohne Musterlösung" next to
 * another copy is a conflict that only the owner resolves (both are skipped).
 */
export function selectUseCaseFiles(
  files: FileMeta[],
  decisions: Decisions,
  options: { limitedTo?: string[] } = {}
): UseCaseSelection {
  const limited = new Set(options.limitedTo ?? []);
  const notPlanned: Record<string, number> = {};
  const count = (name: string) => {
    notPlanned[name] = (notPlanned[name] ?? 0) + 1;
  };
  const skipped: UseCaseSkip[] = [];
  const superseded: UseCasePlan['superseded'] = [];

  const candidates: FileMeta[] = [];
  for (const file of files) {
    const { info } = file;
    if (
      limited.size > 0 &&
      !(info.component && limited.has(info.component.code))
    ) {
      continue;
    }
    if (info.component?.excluded) {
      count('excluded');
    } else if (info.type === 'archive') {
      count('archive');
    } else if (info.type !== 'use-case') {
      // Enabler texts, quizzes, scenarios and global quizzes belong to the
      // content import, PDFs of global quizzes and overviews to no import.
      count(info.type);
    } else if (info.format === 'pdf') {
      // A PDF is kept as an original file by the later upload package, there
      // is no text parser for it.
      count('use-case-pdf');
    } else if (info.issues.length > 0) {
      skipped.push(
        skip(
          file.rel,
          info.key,
          'PATH_ISSUE',
          `The path does not fit the scheme: ${info.issues.join(', ')}`
        )
      );
    } else if (!info.component || !info.key) {
      skipped.push(
        skip(
          file.rel,
          info.key,
          'PATH_ISSUE',
          'The path names no component or no content key'
        )
      );
    } else if (!kindOfComponent(decisions, info.component.number)) {
      skipped.push(
        skip(
          file.rel,
          info.key,
          'NO_DECISION',
          `Component ${info.component.code} has no decision in kfbm-decisions.json`
        )
      );
    } else {
      candidates.push(file);
    }
  }

  const byKey = new Map<string, FileMeta[]>();
  for (const file of candidates) {
    const key = file.info.key as string;
    byKey.set(key, [...(byKey.get(key) ?? []), file]);
  }
  const chosen: string[] = [];
  const window = decisions.duplicates.ambiguousWithinHours * HOUR;
  for (const [key, group] of byKey) {
    if (group.length === 1) {
      chosen.push(group[0].rel);
      continue;
    }
    const sorted = [...group].sort(
      (a, b) =>
        (b.info.version ?? 0) - (a.info.version ?? 0) ||
        b.mtimeMs - a.mtimeMs ||
        (a.rel < b.rel ? -1 : 1)
    );
    if (sorted.some(f => f.info.flags.includes('without-solution'))) {
      for (const file of sorted) {
        skipped.push(
          skip(
            file.rel,
            key,
            'DUPLICATE_SOLUTION_VARIANT',
            `${sorted.length} copies, one of them from a folder "Ohne Musterlösung": which one is valid must be named by the owner`
          )
        );
      }
      continue;
    }
    const [best, second] = sorted;
    const sameVersion = (best.info.version ?? 0) === (second.info.version ?? 0);
    if (sameVersion && best.mtimeMs - second.mtimeMs <= window) {
      for (const file of sorted) {
        skipped.push(
          skip(
            file.rel,
            key,
            'DUPLICATE_AMBIGUOUS',
            `${sorted.length} copies with the same version and modification times within ${decisions.duplicates.ambiguousWithinHours} hours: the valid copy must be named by the owner`
          )
        );
      }
      continue;
    }
    chosen.push(best.rel);
    for (const file of sorted.slice(1)) {
      superseded.push({ file: file.rel, key, keptFile: best.rel });
    }
  }

  chosen.sort();
  skipped.sort(
    (a, b) =>
      (a.file ?? a.key ?? '').localeCompare(b.file ?? b.key ?? '') ||
      a.code.localeCompare(b.code)
  );
  superseded.sort((a, b) => a.file.localeCompare(b.file));
  return { chosen, skipped, superseded, notPlanned };
}

/** Short description of the error issues of a parse result (codes only, no content). */
function describeIssues(result: ParseResult<unknown>): string {
  const parts: string[] = [];
  for (const issue of result.issues) {
    if (issue.severity === 'error' && !parts.includes(issue.code)) {
      parts.push(issue.code);
    }
  }
  const shown = parts.slice(0, 6).join(', ');
  return parts.length > 6 ? `${shown} and ${parts.length - 6} more` : shown;
}

export interface UseCaseBuildOptions {
  limitedTo?: string[];
  now?: Date;
}

/**
 * Builds the plan from the source files. A file that was chosen but has no
 * content (placeholder, read error) is skipped with its reason.
 */
export function buildUseCasePlan(
  files: SourceFile[],
  decisions: Decisions,
  options: UseCaseBuildOptions = {}
): UseCasePlan {
  const limitedTo = [...(options.limitedTo ?? [])];
  const selection = selectUseCaseFiles(files, decisions, { limitedTo });
  const skipped = [...selection.skipped];
  const warnings: string[] = [];
  const byRel = new Map(files.map(f => [f.rel, f]));
  const useCases: PlanUseCase[] = [];
  // The whole visible assignment of each use case, only for the solution guard
  // below (never part of the plan: the description is the short title and the
  // assignment is the task PDF).
  const assignments = new Map<string, string>();

  for (const rel of selection.chosen) {
    const file = byRel.get(rel);
    if (!file) continue;
    const { info } = file;
    const key = info.key;
    if (file.readError) {
      skipped.push(
        skip(
          rel,
          key,
          'READ_ERROR',
          `The file could not be read: ${file.readError.replace(/\s+/g, ' ').slice(0, 160)}`
        )
      );
      continue;
    }
    if (!file.content && file.placeholder) {
      skipped.push(
        skip(
          rel,
          key,
          'PLACEHOLDER',
          'The file is a OneDrive placeholder and was not downloaded'
        )
      );
      continue;
    }
    if (!file.content) {
      skipped.push(skip(rel, key, 'NOT_READ', 'The file was not read'));
      continue;
    }
    const parsed = file.content.result;
    if (!parsed.ok) {
      skipped.push(
        skip(
          rel,
          key,
          'PARSE_ERROR',
          `Format errors: ${describeIssues(parsed)}`
        )
      );
      continue;
    }
    const parsedUseCase = parsed.value;
    if (!enablerKeysMatch(parsedUseCase.code, info.enablerKey)) {
      skipped.push(
        skip(
          rel,
          key,
          'CODE_MISMATCH',
          `The heading names use case ${parsedUseCase.code}, the path enabler ${info.enablerKey}`
        )
      );
      continue;
    }
    const component = info.component as NonNullable<PathInfo['component']>;
    const letter = info.enablerLetter;
    const code = `${component.code}-${letter}`;
    if (!letter || !CODE_FORMAT.test(code)) {
      skipped.push(
        skip(rel, key, 'PATH_ISSUE', 'The use case code is not valid')
      );
      continue;
    }
    // The visible view refuses a solution marker in a visible section.
    const trainee = toTraineeUseCase(parsed);
    if (!trainee) {
      skipped.push(
        skip(
          rel,
          key,
          'SOLUTION_MARKER',
          'A visible section names a solution (marker word)'
        )
      );
      continue;
    }
    warnings.push(
      ...parsed.issues
        .filter(i => i.severity === 'warning')
        .map(i => `${key}: ${i.code}`)
    );
    assignments.set(code, assignmentText(trainee));
    useCases.push({
      code,
      componentCode: component.code,
      enablerCode: code,
      letter,
      title: trainee.title ?? '',
      // the short title, like FIAE: the assignment is the task PDF
      description: describeUseCase(trainee.title ?? ''),
      topics: trainee.topics.length > 0 ? trainee.topics : null,
      solution: parsedUseCase.solution,
      criteria:
        parsedUseCase.criteria.length > 0 ? parsedUseCase.criteria : null,
      orderIndex: letterOrdinal(letter),
      source: rel,
    });
  }

  // Two use cases of one component with the same title would break the key of
  // the content sync (course and title), nothing is guessed: both are skipped.
  const byTitle = new Map<string, PlanUseCase[]>();
  for (const useCase of useCases) {
    const titleKey = `${useCase.componentCode}|${useCase.title
      .toLowerCase()
      .replace(/\s+/g, ' ')}`;
    byTitle.set(titleKey, [...(byTitle.get(titleKey) ?? []), useCase]);
  }
  const clashing = new Set<PlanUseCase>();
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    for (const useCase of group) {
      clashing.add(useCase);
      skipped.push(
        skip(
          useCase.source,
          `use-case:${useCase.code}`,
          'TITLE_DUPLICATE',
          `${group.length} use cases of ${useCase.componentCode} have the same title`
        )
      );
    }
  }
  const kept = useCases.filter(u => !clashing.has(u));
  // A solution paragraph of one use case that stands in the visible text of
  // another is named for the owner (no skip, see sharedSolutionBlocks).
  for (const pair of sharedSolutionBlocks(kept, assignments)) {
    warnings.push(
      `use-case:${pair.visibleIn}: SOLUTION_TEXT_OF_${pair.solutionOf}_IN_VISIBLE_TEXT`
    );
  }

  // Solution protection on the finished items.
  const plan: UseCasePlan = {
    version: 1,
    kind: 'use-cases',
    catalog: decisions.catalog,
    generatedAt: (options.now ?? new Date()).toISOString(),
    limitedTo,
    decisions: {
      status: decisions.status,
      duplicatesPolicy: decisions.duplicates.policy,
      ambiguousWithinHours: decisions.duplicates.ambiguousWithinHours,
      activate: decisions.content.activate,
    },
    useCases: kept,
    skipped,
    superseded: selection.superseded,
    notPlanned: selection.notPlanned,
    open: [],
    warnings: [...new Set(warnings)].sort(),
  };
  const finalUseCases: PlanUseCase[] = [];
  // A visible field is checked against the solutions of all use cases, so a
  // text that holds the solution of another one is found too.
  const solutions = solutionTextsOfUseCases(kept);
  for (const useCase of kept) {
    if (
      leaksInUseCase(useCase, solutions, assignments.get(useCase.code)).length >
      0
    ) {
      skipped.push(
        skip(
          useCase.source,
          `use-case:${useCase.code}`,
          'SOLUTION_MARKER',
          'A visible field shows a solution'
        )
      );
    } else {
      finalUseCases.push(useCase);
    }
  }
  const order = (code: string) => {
    const match = /^K(\d+)(?:\.(\d))?-/.exec(code);
    return match ? Number(match[1]) * 10 + Number(match[2] ?? 0) : 0;
  };
  finalUseCases.sort(
    (a, b) => order(a.code) - order(b.code) || a.orderIndex - b.orderIndex
  );
  skipped.sort(
    (a, b) =>
      (a.file ?? a.key ?? '').localeCompare(b.file ?? b.key ?? '') ||
      a.code.localeCompare(b.code)
  );

  const open: string[] = [
    'The model solutions and the criteria are written only with --use-case-solutions and only to a local database (the policy cd_select of content_documents lets the public key read rows without an organization).',
    'The original documents are not uploaded by this package (a package of its own).',
  ];
  for (const s of skipped) {
    if (
      s.code === 'DUPLICATE_SOLUTION_VARIANT' ||
      s.code === 'DUPLICATE_AMBIGUOUS'
    ) {
      const text = `${s.key}: the valid copy must be named by the owner (${s.code}).`;
      if (!open.includes(text)) open.push(text);
    }
  }
  return { ...plan, useCases: finalUseCases, skipped, open };
}

export function countUseCasePlan(plan: UseCasePlan): UseCasePlanCounts {
  return {
    useCases: plan.useCases.length,
    withTopics: plan.useCases.filter(u => u.topics !== null).length,
    withCriteria: plan.useCases.filter(u => u.criteria !== null).length,
    components: new Set(plan.useCases.map(u => u.componentCode)).size,
    skipped: plan.skipped.length,
    superseded: plan.superseded.length,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Checks a plan, for example one that was read back from a JSON file. Returns
 * the problems, an empty list means the plan may be applied. Besides the
 * structure it checks that the plan targets only KFBM, that every code fits
 * the format of the database, that nothing is listed twice and that no
 * solution stands in a visible field.
 */
export function validateUseCasePlan(raw: unknown): string[] {
  if (!isRecord(raw)) return ['The plan is not an object'];
  const errors: string[] = [];
  if (raw.version !== 1) errors.push('The plan version must be 1');
  if (raw.kind !== 'use-cases') {
    errors.push('This is not a plan of the use case import');
  }
  if (raw.catalog !== 'KFBM') errors.push('The plan catalog must be KFBM');
  for (const list of ['useCases', 'skipped']) {
    if (!Array.isArray(raw[list])) errors.push(`${list} is missing`);
  }
  if (errors.length > 0) return errors;
  const plan = raw as unknown as UseCasePlan;

  const codes = new Set<string>();
  const titles = new Set<string>();
  const text = (value: unknown) =>
    typeof value === 'string' && value.length > 0;
  for (const u of plan.useCases) {
    if (!isRecord(u)) {
      errors.push('a use case is not an object');
      continue;
    }
    if (!text(u.code) || !CODE_FORMAT.test(u.code)) {
      errors.push(
        `use case code "${String(u.code)}" does not fit the code format`
      );
      continue;
    }
    if (codes.has(u.code)) errors.push(`use case code ${u.code} is used twice`);
    codes.add(u.code);
    if (
      typeof u.componentCode !== 'string' ||
      !COMPONENT_CODE.test(u.componentCode)
    ) {
      errors.push(`use case ${u.code} has no valid component code`);
    }
    if (typeof u.letter !== 'string' || !/^[a-z]$/.test(u.letter)) {
      errors.push(`use case ${u.code} has no valid letter`);
    }
    if (
      u.code !== `${u.componentCode}-${u.letter}` ||
      u.enablerCode !== u.code
    ) {
      errors.push(
        `use case ${u.code}: code and enabler code must be the component code, a hyphen and the letter`
      );
    }
    if (!text(u.title)) errors.push(`use case ${u.code} has no title`);
    if (!text(u.description)) {
      errors.push(`use case ${u.code} has no description`);
    } else if (u.description.length > MAX_USE_CASE_DESCRIPTION) {
      errors.push(
        `use case ${u.code} has a description of ${u.description.length} characters (limit ${MAX_USE_CASE_DESCRIPTION}): the plan was built before the short description, build it again`
      );
    }
    if (!text(u.solution)) errors.push(`use case ${u.code} has no solution`);
    for (const field of ['topics', 'criteria'] as const) {
      if (u[field] !== null && !text(u[field])) {
        errors.push(`use case ${u.code} has an invalid ${field}`);
      }
    }
    if (!Number.isInteger(u.orderIndex) || u.orderIndex < 1) {
      errors.push(`use case ${u.code} has no valid position`);
    }
    // The source path is written as file_name of a document row.
    if (
      typeof u.source !== 'string' ||
      u.source.length > 500 ||
      // forward slashes only, no drive letter, no parent folder, no control
      // character
      /[\u0000-\u001f\\:]/.test(u.source) ||
      u.source.startsWith('/') ||
      u.source.split('/').includes('..')
    ) {
      errors.push('an item has no valid source path');
    }
    const titleKey = `${u.componentCode}|${String(u.title)
      .toLowerCase()
      .replace(/\s+/g, ' ')}`;
    if (titles.has(titleKey)) {
      errors.push(`use case ${u.code} has the title of another use case`);
    }
    titles.add(titleKey);
  }
  if (errors.length === 0) errors.push(...findUseCaseLeaks(plan));
  return errors;
}

const mdCell = (value: string) =>
  value.replace(/\|/g, '/').replace(/\s+/g, ' ');

/** Short summary of a plan in German Markdown. Never holds content of a file. */
export function renderUseCaseSummary(plan: UseCasePlan): string {
  const counts = countUseCasePlan(plan);
  const out: string[] = [];
  out.push('# Importplan Use Cases KfBM');
  out.push('');
  out.push(`Katalog: ${plan.catalog}. Stand: ${plan.generatedAt}.`);
  if (plan.limitedTo.length > 0) {
    out.push(`Begrenzt auf die Komponenten: ${plan.limitedTo.join(', ')}.`);
  }
  out.push(
    'Die Zusammenfassung nennt Zahlen, Namen und Gründe, keine Inhalte der Dateien.'
  );
  out.push('');
  out.push('## Zahlen');
  out.push('');
  out.push('| Größe | Anzahl |');
  out.push('|---|---|');
  out.push(`| Use Cases | ${counts.useCases} |`);
  out.push(`| Komponenten mit Use Cases | ${counts.components} |`);
  out.push(`| mit Behandelten Themen | ${counts.withTopics} |`);
  out.push(`| mit Bewertungskriterien | ${counts.withCriteria} |`);
  out.push(`| übersprungene Dateien | ${counts.skipped} |`);
  out.push(
    `| ältere Kopien (neueste Fassung gewählt) | ${counts.superseded} |`
  );
  out.push('');
  out.push('## Je Komponente');
  out.push('');
  out.push('| Komponente | Use Cases | Buchstaben |');
  out.push('|---|---|---|');
  const byComponent = new Map<string, PlanUseCase[]>();
  for (const u of plan.useCases) {
    byComponent.set(u.componentCode, [
      ...(byComponent.get(u.componentCode) ?? []),
      u,
    ]);
  }
  for (const [code, list] of byComponent) {
    out.push(
      `| ${code} | ${list.length} | ${list.map(u => u.letter).join(' ')} |`
    );
  }
  out.push('');
  out.push('## Übersprungen');
  out.push('');
  if (plan.skipped.length === 0) {
    out.push('Keine.');
  } else {
    out.push('| Schlüssel | Datei | Code | Grund |');
    out.push('|---|---|---|---|');
    for (const s of plan.skipped) {
      out.push(
        `| ${mdCell(s.key ?? '')} | ${mdCell(s.file ?? '')} | ${s.code} | ${mdCell(s.reason)} |`
      );
    }
  }
  out.push('');
  if (plan.superseded.length > 0) {
    out.push('## Ältere Kopien');
    out.push('');
    for (const s of plan.superseded) {
      out.push(
        `- ${s.key}: ${mdCell(s.file)} (gewählt: ${mdCell(s.keptFile)})`
      );
    }
    out.push('');
  }
  const notPlanned = Object.entries(plan.notPlanned);
  if (notPlanned.length > 0) {
    out.push('## Nicht Teil dieses Laufs');
    out.push('');
    out.push(notPlanned.map(([type, n]) => `${type}: ${n}`).join(', ') + '.');
    out.push('');
  }
  out.push('## Offene Fragen');
  out.push('');
  for (const item of plan.open) out.push(`- ${item}`);
  out.push('');
  if (plan.warnings.length > 0) {
    out.push('## Hinweise der Parser');
    out.push('');
    for (const warning of plan.warnings) out.push(`- ${mdCell(warning)}`);
    out.push('');
  }
  return out.join('\n');
}
