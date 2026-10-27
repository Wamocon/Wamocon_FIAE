// Builds the import plan of the KfBM content (phase 4.4, step "plan"). Pure
// functions: no file access and no database. The caller reads the files and
// hands over the parsed content (see SourceFile).
//
// The plan holds everything that a run would write: components, enablers,
// scenarios and quizzes with questions and options, plus the files that were
// skipped and why. Anything that is unclear is skipped with a reason and never
// guessed. Skipped files do not reach the database.

import { enablerKeysMatch } from '../path-info';
import type {
  Paragraph,
  ParsedQuiz,
  ParsedScenario,
  ParseResult,
  PathInfo,
} from '../types';
import { kindOfComponent } from './decisions';
import {
  findSolutionLeaks,
  leakOf,
  leakOfEnablerText,
  scenarioSolutionTexts,
  solutionTexts,
} from './guard';
import type {
  ComponentKind,
  Decisions,
  ImportPlan,
  PlanComponent,
  PlanCounts,
  PlanEnabler,
  PlanQuestion,
  PlanReviewedMarker,
  PlanQuiz,
  PlanScenario,
  PlanSkip,
  QuizLevel,
} from './types';

/** Parsed content of one source file. */
export type SourceContent =
  | { type: 'quiz' | 'global-quiz'; result: ParseResult<ParsedQuiz> }
  | { type: 'scenario'; result: ParseResult<ParsedScenario> }
  | { type: 'enabler'; paragraphs: Paragraph[] };

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

export interface Selection {
  /** Files to read and plan, one per content key. */
  chosen: string[];
  skipped: PlanSkip[];
  superseded: ImportPlan['superseded'];
  notPlanned: Record<string, number>;
  /** Decided components by code. */
  components: Map<string, ComponentDecision>;
}

export interface ComponentDecision {
  code: string;
  key: string;
  number: number;
  split: number | null;
  title: string;
  reference: string | null;
  group: string;
  kind: ComponentKind;
  phase: number | null;
}

type FileMeta = Pick<SourceFile, 'rel' | 'mtimeMs' | 'info'>;

const PLANNED_TYPES = new Set(['enabler', 'quiz', 'scenario', 'global-quiz']);
const SILENT_TYPES = new Set(['use-case', 'pdf', 'overview']);
const HOUR = 3600 * 1000;
const LEVELS: QuizLevel[] = ['low', 'medium', 'high'];
const LEVEL_LABEL: Record<QuizLevel, string> = {
  low: 'leicht',
  medium: 'mittel',
  high: 'anspruchsvoll',
};
/** Same pattern as the CHECK constraints of courses.code, enablers.code and quizzes.code. */
const CODE_FORMAT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const componentOrder = (number: number, split: number | null) =>
  number * 10 + (split ?? 0);

const skip = (
  file: string | null,
  key: string | null,
  type: string,
  code: string,
  reason: string
): PlanSkip => ({ file, key, type, code, reason });

function groupOfKind(kind: ComponentKind): string[] {
  return kind === 'pflicht'
    ? ['teil1', 'teil2']
    : kind === 'wahl'
      ? ['wahl']
      : ['ganze'];
}

/** The decided components, or the reason why a component is skipped. */
function decideComponents(
  files: FileMeta[],
  decisions: Decisions
): {
  decided: Map<string, ComponentDecision>;
  rejected: Map<string, PlanSkip>;
} {
  const seen = new Map<
    string,
    {
      info: NonNullable<PathInfo['component']>;
      group: string | null;
      title: string | null;
      reference: string | null;
      files: number;
    }
  >();
  for (const { info } of files) {
    const c = info.component;
    if (!c || c.excluded) continue;
    const row = seen.get(c.code) ?? {
      info: c,
      group: null,
      title: null,
      reference: null,
      files: 0,
    };
    row.files += 1;
    // The group and the title come from the component folders, not from the
    // folder of the global quizzes.
    if (info.folderGroup && info.folderGroup !== 'global') {
      row.group = info.group;
    }
    if (c.title && !row.title) {
      row.title = c.title;
      row.reference = c.paragraph;
    }
    seen.set(c.code, row);
  }

  const decided = new Map<string, ComponentDecision>();
  const rejected = new Map<string, PlanSkip>();
  for (const [code, row] of seen) {
    const c = row.info;
    const reject = (skipCode: string, reason: string) =>
      rejected.set(
        code,
        skip(
          null,
          `component:${code}`,
          'component',
          skipCode,
          `${reason} (${row.files} file(s) not planned)`
        )
      );
    const kind = kindOfComponent(decisions, c.number);
    if (!kind) {
      reject(
        'NO_DECISION',
        `Component ${code} has no decision in kfbm-decisions.json`
      );
      continue;
    }
    if (!row.group || !row.title) {
      reject(
        'NO_GROUP',
        `Component ${code} has no component folder, so group and title are unknown`
      );
      continue;
    }
    if (!groupOfKind(kind).includes(row.group)) {
      reject(
        'KIND_GROUP_MISMATCH',
        `Component ${code} is ${kind} in the presets but lies in the folder group ${row.group}`
      );
      continue;
    }
    let phase: number | null = null;
    if (kind === 'pflicht') {
      phase =
        code in decisions.components.phaseOverrides
          ? decisions.components.phaseOverrides[code]
          : decisions.components.phaseByGroup[row.group as 'teil1' | 'teil2'];
    }
    decided.set(code, {
      code,
      key: c.key,
      number: c.number,
      split: c.split,
      title: row.title,
      reference: row.reference,
      group: row.group,
      kind,
      phase,
    });
  }
  return { decided, rejected };
}

/**
 * Chooses the files that are read and planned: one per content key. Files that
 * are not part of this package, files that fit no scheme and files of a
 * component without a usable decision are left out. Of several copies of one
 * document the newest wins (highest version, then latest change), unless the
 * copies cannot be told apart.
 */
export function selectFiles(
  files: FileMeta[],
  decisions: Decisions,
  options: { limitedTo?: string[] } = {}
): Selection {
  const limited = new Set(options.limitedTo ?? []);
  const notPlanned: Record<string, number> = {};
  const count = (name: string) => {
    notPlanned[name] = (notPlanned[name] ?? 0) + 1;
  };
  const skipped: PlanSkip[] = [];
  const superseded: ImportPlan['superseded'] = [];

  const inScope = files.filter(
    f =>
      limited.size === 0 ||
      (f.info.component && limited.has(f.info.component.code))
  );
  const { decided, rejected } = decideComponents(inScope, decisions);
  skipped.push(...rejected.values());

  const candidates: FileMeta[] = [];
  for (const file of inScope) {
    const { info } = file;
    if (info.component?.excluded) {
      count('excluded');
    } else if (info.type === 'archive') {
      count('archive');
    } else if (SILENT_TYPES.has(info.type)) {
      count(info.type);
    } else if (info.issues.length > 0 || !PLANNED_TYPES.has(info.type)) {
      skipped.push(
        skip(
          file.rel,
          info.key,
          info.type,
          'PATH_ISSUE',
          `The path does not fit the scheme: ${
            info.issues.length > 0
              ? info.issues.join(', ')
              : 'unknown file type'
          }`
        )
      );
    } else if (!info.component || !info.key) {
      skipped.push(
        skip(
          file.rel,
          info.key,
          info.type,
          'PATH_ISSUE',
          'The path names no component or no content key'
        )
      );
    } else if (!decided.has(info.component.code)) {
      // The component is listed once in `rejected`, its files are not.
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
    const [best, second] = sorted;
    const sameVersion = (best.info.version ?? 0) === (second.info.version ?? 0);
    if (sameVersion && best.mtimeMs - second.mtimeMs <= window) {
      for (const file of sorted) {
        skipped.push(
          skip(
            file.rel,
            key,
            file.info.type,
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
  return { chosen, skipped, superseded, notPlanned, components: decided };
}

const levelOf = (info: PathInfo): QuizLevel | null =>
  info.difficulty && LEVELS.includes(info.difficulty) ? info.difficulty : null;

/** Short description of the error issues of a parse result (codes only, no content). */
function describeIssues(result: ParseResult<unknown>): string {
  const parts: string[] = [];
  for (const issue of result.issues) {
    if (issue.severity !== 'error') continue;
    const text =
      issue.question !== undefined
        ? `${issue.code} (question ${issue.question})`
        : issue.code;
    if (!parts.includes(text)) parts.push(text);
  }
  const shown = parts.slice(0, 6).join(', ');
  return parts.length > 6 ? `${shown} and ${parts.length - 6} more` : shown;
}

function warningCodes(result: ParseResult<unknown>): string[] {
  return [
    ...new Set(
      result.issues.filter(i => i.severity === 'warning').map(i => i.code)
    ),
  ];
}

const HEADING_CODE =
  /^(?:Szenario[\s_]+|Quiz\s+)?(\d{1,2})(?:[._/](\d))?([a-z])\s*[:.)\-–—]\s*(.+)$/;

export function splitEnablerHeading(heading: string): {
  code: string | null;
  title: string;
} {
  const match = HEADING_CODE.exec(heading.trim());
  if (!match) return { code: null, title: heading.trim() };
  return {
    code: `${Number(match[1])}${match[2] ? `.${match[2]}` : ''}${match[3]}`,
    title: match[4].trim(),
  };
}

const letterOrdinal = (letter: string) =>
  letter.toLowerCase().charCodeAt(0) - 96;

export interface BuildOptions {
  limitedTo?: string[];
  now?: Date;
  /**
   * Entries that a source besides the Word tree adds (the quiz JSON, see
   * quiz-json/merge.ts): skip entries of items that have no content key and the
   * copies that lost against another source.
   */
  extra?: {
    skipped?: PlanSkip[];
    superseded?: ImportPlan['superseded'];
  };
}

/**
 * Builds the plan from the source files. A file that was chosen but has no
 * content (placeholder, read error) is skipped with its reason.
 */
export function buildImportPlan(
  files: SourceFile[],
  decisions: Decisions,
  options: BuildOptions = {}
): ImportPlan {
  const limitedTo = [...(options.limitedTo ?? [])];
  const selection = selectFiles(files, decisions, { limitedTo });
  const skipped = [...selection.skipped, ...(options.extra?.skipped ?? [])];
  const warnings: string[] = [];
  const byRel = new Map(files.map(f => [f.rel, f]));
  const chosen = selection.chosen
    .map(rel => byRel.get(rel))
    .filter((f): f is SourceFile => f !== undefined);

  // Components ---------------------------------------------------------------
  const components: PlanComponent[] = [...selection.components.values()]
    .sort(
      (a, b) =>
        componentOrder(a.number, a.split) - componentOrder(b.number, b.split)
    )
    .map(c => {
      const weeks = decisions.components.totalWeeks[c.code];
      const hours = decisions.components.totalHours[c.code];
      const provisional = weeks === undefined || hours === undefined;
      return {
        code: c.code,
        key: c.key,
        number: c.number,
        split: c.split,
        title: c.title,
        reference: c.reference,
        group: c.group,
        kind: c.kind,
        phase: c.phase,
        orderIndex: componentOrder(c.number, c.split),
        totalWeeks: weeks ?? decisions.components.placeholderWeeks,
        totalHours: hours ?? decisions.components.placeholderHours,
        provisionalTotals: provisional,
      };
    });
  const componentByCode = new Map(components.map(c => [c.code, c]));

  // Files without content ----------------------------------------------------
  const ready: SourceFile[] = [];
  for (const file of chosen) {
    if (file.readError) {
      skipped.push(
        skip(
          file.rel,
          file.info.key,
          file.info.type,
          'READ_ERROR',
          `The file could not be read: ${file.readError.replace(/\s+/g, ' ').slice(0, 160)}`
        )
      );
    } else if (!file.content && file.placeholder) {
      skipped.push(
        skip(
          file.rel,
          file.info.key,
          file.info.type,
          'PLACEHOLDER',
          'The file is a OneDrive placeholder and was not downloaded'
        )
      );
    } else if (!file.content) {
      skipped.push(
        skip(
          file.rel,
          file.info.key,
          file.info.type,
          'NOT_READ',
          'The file was not read'
        )
      );
    } else {
      ready.push(file);
    }
  }

  // Enablers -----------------------------------------------------------------
  const enablers: PlanEnabler[] = [];
  for (const file of ready) {
    const { info, content } = file;
    if (info.type !== 'enabler' || content?.type !== 'enabler') continue;
    const lines = content.paragraphs
      .map(p => p.text.trim())
      .filter(text => text.length > 0);
    if (lines.length === 0) {
      skipped.push(
        skip(
          file.rel,
          info.key,
          'enabler',
          'NO_HEADING',
          'The enabler document has no heading'
        )
      );
      continue;
    }
    const heading = splitEnablerHeading(lines[0]);
    if (heading.code && !enablerKeysMatch(heading.code, info.enablerKey)) {
      skipped.push(
        skip(
          file.rel,
          info.key,
          'enabler',
          'CODE_MISMATCH',
          `The heading names enabler ${heading.code}, the path enabler ${info.enablerKey}`
        )
      );
      continue;
    }
    if (!heading.code) {
      warnings.push(`${info.key}: the heading carries no enabler code`);
    }
    const code = info.enablerCode as string;
    if (!CODE_FORMAT.test(code) || !info.enablerLetter) {
      skipped.push(
        skip(
          file.rel,
          info.key,
          'enabler',
          'PATH_ISSUE',
          'The enabler code is not valid'
        )
      );
      continue;
    }
    const text = lines.slice(1).join('\n\n');
    enablers.push({
      code,
      letter: info.enablerLetter,
      componentCode: (info.component as NonNullable<PathInfo['component']>)
        .code,
      title: heading.title,
      orderIndex: letterOrdinal(info.enablerLetter),
      descriptionText:
        decisions.content.enablerText && text.length > 0 ? text : null,
      source: file.rel,
    });
  }
  const enablerByCode = new Map(enablers.map(e => [e.code, e]));

  // Scenarios and quizzes ------------------------------------------------------
  const scenarios: PlanScenario[] = [];
  const quizzes: PlanQuiz[] = [];
  for (const file of ready) {
    const { info, content } = file;
    if (!content || content.type === 'enabler') continue;
    const componentCode = (info.component as NonNullable<PathInfo['component']>)
      .code;

    if (content.type === 'global-quiz') {
      const parsed = content.result;
      const quiz = parsed.value;
      if (!parsed.ok) {
        skipped.push(
          skip(
            file.rel,
            info.key,
            'global-quiz',
            'PARSE_ERROR',
            `Format errors: ${describeIssues(parsed)}`
          )
        );
        continue;
      }
      if (quiz.kind !== 'global') {
        skipped.push(
          skip(
            file.rel,
            info.key,
            'global-quiz',
            'KIND_MISMATCH',
            'The file lies in the place of a global quiz but is not one'
          )
        );
        continue;
      }
      if (quiz.componentKey !== info.component?.key) {
        skipped.push(
          skip(
            file.rel,
            info.key,
            'global-quiz',
            'CODE_MISMATCH',
            `The heading names component ${quiz.componentKey}, the path component ${info.component?.key}`
          )
        );
        continue;
      }
      if (quiz.questions.length !== decisions.content.globalQuizQuestions) {
        skipped.push(
          skip(
            file.rel,
            info.key,
            'global-quiz',
            'QUESTION_COUNT',
            `The quiz has ${quiz.questions.length} questions, expected ${decisions.content.globalQuizQuestions}`
          )
        );
        continue;
      }
      const component = componentByCode.get(componentCode);
      if (!component) continue;
      warnings.push(...warningCodes(parsed).map(w => `${info.key}: ${w}`));
      quizzes.push({
        code: `${componentCode}-global`,
        kind: 'global',
        componentCode,
        enablerCode: null,
        level: null,
        title: `Global-Quiz ${componentCode}: ${component.title}`,
        questions: quiz.questions.map(toPlanQuestion),
        source: file.rel,
      });
    } else if (content.type === 'quiz') {
      const parsed = content.result;
      const quiz = parsed.value;
      const level = levelOf(info);
      const enabler = enablerByCode.get(info.enablerCode ?? '');
      if (!enabler) {
        skipped.push(
          skip(
            file.rel,
            info.key,
            'quiz',
            'ENABLER_MISSING',
            'The enabler document of this quiz is not part of the plan'
          )
        );
        continue;
      }
      if (!parsed.ok) {
        skipped.push(
          skip(
            file.rel,
            info.key,
            'quiz',
            'PARSE_ERROR',
            `Format errors: ${describeIssues(parsed)}`
          )
        );
        continue;
      }
      if (quiz.kind === 'global') {
        skipped.push(
          skip(
            file.rel,
            info.key,
            'quiz',
            'KIND_MISMATCH',
            'The file lies in the place of an enabler quiz but is a global quiz'
          )
        );
        continue;
      }
      if (quiz.difficulty !== level) {
        skipped.push(
          skip(
            file.rel,
            info.key,
            'quiz',
            'DIFFICULTY_MISMATCH',
            `The heading says ${quiz.difficulty}, the file name ${level}`
          )
        );
        continue;
      }
      if (!enablerKeysMatch(quiz.enablerCode, info.enablerKey)) {
        skipped.push(
          skip(
            file.rel,
            info.key,
            'quiz',
            'CODE_MISMATCH',
            `The heading names enabler ${quiz.enablerCode}, the path enabler ${info.enablerKey}`
          )
        );
        continue;
      }
      warnings.push(...warningCodes(parsed).map(w => `${info.key}: ${w}`));
      quizzes.push({
        code: `${enabler.code}-${level as QuizLevel}`,
        kind: 'lesson',
        componentCode,
        enablerCode: enabler.code,
        level: level as QuizLevel,
        title: `${enabler.title} (Quiz ${LEVEL_LABEL[level as QuizLevel]})`,
        questions: quiz.questions.map(toPlanQuestion),
        source: file.rel,
      });
    } else if (content.type === 'scenario') {
      const parsed = content.result;
      const scenario = parsed.value;
      const enabler = enablerByCode.get(info.enablerCode ?? '');
      if (!enabler) {
        skipped.push(
          skip(
            file.rel,
            info.key,
            'scenario',
            'ENABLER_MISSING',
            'The enabler document of this scenario is not part of the plan'
          )
        );
        continue;
      }
      if (!parsed.ok) {
        skipped.push(
          skip(
            file.rel,
            info.key,
            'scenario',
            'PARSE_ERROR',
            `Format errors: ${describeIssues(parsed)}`
          )
        );
        continue;
      }
      if (!enablerKeysMatch(scenario.code, info.enablerKey)) {
        skipped.push(
          skip(
            file.rel,
            info.key,
            'scenario',
            'CODE_MISMATCH',
            `The heading names scenario ${scenario.code}, the path enabler ${info.enablerKey}`
          )
        );
        continue;
      }
      warnings.push(...warningCodes(parsed).map(w => `${info.key}: ${w}`));
      scenarios.push({
        enablerCode: enabler.code,
        title: scenario.title,
        situation: scenario.situation,
        solution: scenario.solution,
        knowledgeContribution: scenario.knowledgeContribution,
        source: file.rel,
      });
    }
  }

  // Solution protection on the finished items: an item that shows a solution
  // marker in a visible field is skipped.
  const solutions = solutionTexts({
    quizzes,
    scenarios,
  } as unknown as ImportPlan);
  const strong = scenarioSolutionTexts({
    scenarios,
  } as unknown as ImportPlan);
  const guardQuizzes = quizzes.filter(q => {
    let reason: string | null = null;
    const bad = q.questions.find(question => {
      reason =
        leakOf(question.text, solutions) ??
        question.options
          .map(o => leakOf(o.text, solutions))
          .find(r => r !== null) ??
        null;
      return reason !== null;
    });
    if (bad) {
      skipped.push(
        skip(
          q.source,
          `quiz:${q.code}`,
          'quiz',
          'SOLUTION_MARKER',
          `Question ${bad.number} ${reason} in a visible field`
        )
      );
    }
    return !bad;
  });
  const guardScenarios = scenarios.filter(s => {
    const bad =
      leakOf(s.situation, solutions) ?? leakOf(s.title ?? '', solutions);
    if (bad) {
      skipped.push(
        skip(
          s.source,
          `scenario:${s.enablerCode}`,
          'scenario',
          'SOLUTION_MARKER',
          `The situation ${bad}`
        )
      );
    }
    return !bad;
  });
  // Enablers whose bare line "Lösung" the owner has checked (a table cell label
  // in the teaching text). Only the text of such an enabler, only that pattern.
  const reviewedByCode = new Map(
    decisions.content.reviewedSolutionWordFalsePositives.map(r => [
      r.enabler,
      r.reason,
    ])
  );
  const reviewedMarkers: PlanReviewedMarker[] = [];
  const guardEnablers = enablers.filter(e => {
    // The text of an enabler may repeat a sentence of a rationale (the
    // rationales come from it), only a marker or a scenario solution counts.
    // The title stays strict.
    const text = leakOfEnablerText(
      e.descriptionText ?? '',
      strong,
      reviewedByCode.has(e.code)
    );
    const bad = leakOf(e.title, strong) ?? text.reason;
    if (!bad && text.reviewUsed) {
      reviewedMarkers.push({
        enablerCode: e.code,
        pattern: 'bare-solution-line',
        reason: reviewedByCode.get(e.code) as string,
      });
      warnings.push(
        `${e.code}: REVIEWED_MARKER the bare line "Lösung" in the enabler text was checked by the owner and is let through (${reviewedByCode.get(e.code)})`
      );
    }
    if (bad) {
      skipped.push(
        skip(
          e.source,
          `enabler:${e.code}`,
          'enabler',
          'SOLUTION_MARKER',
          `The enabler text ${bad}`
        )
      );
    }
    return !bad;
  });

  // Enablers that were dropped by the guard take their quizzes and scenarios along
  const keptEnablers = new Set(guardEnablers.map(e => e.code));
  const finalQuizzes = guardQuizzes.filter(q => {
    if (q.enablerCode && !keptEnablers.has(q.enablerCode)) {
      skipped.push(
        skip(
          q.source,
          `quiz:${q.code}`,
          'quiz',
          'ENABLER_MISSING',
          'The enabler of this quiz was left out'
        )
      );
      return false;
    }
    return true;
  });
  const finalScenarios = guardScenarios.filter(s => {
    if (!keptEnablers.has(s.enablerCode)) {
      skipped.push(
        skip(
          s.source,
          `scenario:${s.enablerCode}`,
          'scenario',
          'ENABLER_MISSING',
          'The enabler of this scenario was left out'
        )
      );
      return false;
    }
    return true;
  });

  // Order --------------------------------------------------------------------
  const compIndex = new Map(components.map(c => [c.code, c.orderIndex]));
  const enablerOrder = (code: string) => {
    const e = enablerByCode.get(code);
    return e ? (compIndex.get(e.componentCode) ?? 0) * 100 + e.orderIndex : 0;
  };
  guardEnablers.sort(
    (a, b) =>
      (compIndex.get(a.componentCode) ?? 0) -
        (compIndex.get(b.componentCode) ?? 0) || a.orderIndex - b.orderIndex
  );
  finalScenarios.sort(
    (a, b) => enablerOrder(a.enablerCode) - enablerOrder(b.enablerCode)
  );
  reviewedMarkers.sort((a, b) => a.enablerCode.localeCompare(b.enablerCode));
  finalQuizzes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'lesson' ? -1 : 1;
    if (a.kind === 'global') {
      return (
        (compIndex.get(a.componentCode) ?? 0) -
        (compIndex.get(b.componentCode) ?? 0)
      );
    }
    return (
      enablerOrder(a.enablerCode as string) -
        enablerOrder(b.enablerCode as string) ||
      LEVELS.indexOf(a.level as QuizLevel) -
        LEVELS.indexOf(b.level as QuizLevel)
    );
  });
  skipped.sort(
    (a, b) =>
      (a.file ?? a.key ?? '').localeCompare(b.file ?? b.key ?? '') ||
      a.code.localeCompare(b.code)
  );

  // Open questions -------------------------------------------------------------
  const open = [...decisions.open];
  const provisional = components.filter(c => c.provisionalTotals);
  if (provisional.length > 0) {
    open.unshift(
      `Weeks and planned hours are placeholders (${decisions.components.placeholderWeeks} and ${decisions.components.placeholderHours}) for ${provisional.length} component(s) until the owner names them.`
    );
  }

  return {
    version: 1,
    catalog: decisions.catalog,
    generatedAt: (options.now ?? new Date()).toISOString(),
    limitedTo,
    decisions: {
      status: decisions.status,
      duplicatesPolicy: decisions.duplicates.policy,
      ambiguousWithinHours: decisions.duplicates.ambiguousWithinHours,
      activate: decisions.content.activate,
    },
    components,
    enablers: guardEnablers,
    scenarios: finalScenarios,
    quizzes: finalQuizzes,
    skipped,
    ...(reviewedMarkers.length > 0 ? { reviewedMarkers } : {}),
    superseded: [
      ...selection.superseded,
      ...(options.extra?.superseded ?? []),
    ].sort((a, b) => a.file.localeCompare(b.file)),
    notPlanned: selection.notPlanned,
    open,
    warnings: [...new Set(warnings)].sort(),
  };
}

function toPlanQuestion(
  question: ParsedQuiz['questions'][number]
): PlanQuestion {
  return {
    number: question.number,
    text: question.text,
    difficulty: question.difficulty,
    options: question.options.map(option => {
      const isCorrect = option.letter === question.correctLetter;
      return {
        letter: option.letter,
        text: option.text,
        isCorrect,
        // The rationale belongs to the question, the app keeps it on the
        // correct option (options.explanation).
        explanation: isCorrect ? question.rationale : null,
      };
    }),
  };
}

export function planCounts(plan: ImportPlan): PlanCounts {
  const questions = plan.quizzes.reduce((n, q) => n + q.questions.length, 0);
  const options = plan.quizzes.reduce(
    (n, q) =>
      n + q.questions.reduce((m, question) => m + question.options.length, 0),
    0
  );
  return {
    components: plan.components.length,
    enablers: plan.enablers.length,
    scenarios: plan.scenarios.length,
    quizzes: plan.quizzes.length,
    lessonQuizzes: plan.quizzes.filter(q => q.kind === 'lesson').length,
    globalQuizzes: plan.quizzes.filter(q => q.kind === 'global').length,
    questions,
    options,
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
 * the format of the database, that nothing is listed twice, that every
 * reference points to an item of the plan and that no solution stands in a
 * visible field.
 */
export function validatePlan(raw: unknown): string[] {
  if (!isRecord(raw)) return ['The plan is not an object'];
  const errors: string[] = [];
  if (raw.version !== 1) errors.push('The plan version must be 1');
  if (raw.catalog !== 'KFBM') errors.push('The plan catalog must be KFBM');
  for (const list of [
    'components',
    'enablers',
    'scenarios',
    'quizzes',
    'skipped',
  ]) {
    if (!Array.isArray(raw[list])) errors.push(`${list} is missing`);
  }
  if (errors.length > 0) return errors;
  const plan = raw as unknown as ImportPlan;

  const unique = (what: string, values: string[]) => {
    const seen = new Set<string>();
    for (const value of values) {
      if (!CODE_FORMAT.test(value)) {
        errors.push(`${what} code "${value}" does not fit the code format`);
      }
      if (seen.has(value)) errors.push(`${what} code ${value} is used twice`);
      seen.add(value);
    }
    return seen;
  };
  const componentCodes = unique(
    'component',
    plan.components.map(c => c.code)
  );
  const enablerCodes = unique(
    'enabler',
    plan.enablers.map(e => e.code)
  );
  unique(
    'quiz',
    plan.quizzes.map(q => q.code)
  );

  for (const c of plan.components) {
    if (!['pflicht', 'wahl', 'integrativ'].includes(c.kind)) {
      errors.push(`component ${c.code} has an unknown kind`);
    }
    if (c.phase !== null && c.phase !== 1 && c.phase !== 2) {
      errors.push(`component ${c.code} has an unknown phase`);
    }
    if (c.kind === 'integrativ' && c.phase !== null) {
      errors.push(`component ${c.code} is integrative and must have no phase`);
    }
  }
  // Every item names its source file, which is written as file_name of a
  // document row. It must be a plain string without line breaks.
  const badSource = (value: unknown) =>
    typeof value !== 'string' || value.length > 500 || /[\r\n]/.test(value);
  for (const item of [...plan.enablers, ...plan.scenarios, ...plan.quizzes]) {
    if (badSource((item as { source?: unknown }).source)) {
      errors.push('an item has no valid source path');
      break;
    }
  }
  for (const e of plan.enablers) {
    if (!componentCodes.has(e.componentCode)) {
      errors.push(
        `enabler ${e.code} names the unknown component ${e.componentCode}`
      );
    }
  }
  const scenarioOwners = new Set<string>();
  for (const s of plan.scenarios) {
    if (!enablerCodes.has(s.enablerCode)) {
      errors.push(`a scenario names the unknown enabler ${s.enablerCode}`);
    }
    if (scenarioOwners.has(s.enablerCode)) {
      errors.push(`enabler ${s.enablerCode} has two scenarios`);
    }
    scenarioOwners.add(s.enablerCode);
  }
  const lessonSlots = new Set<string>();
  const globalSlots = new Set<string>();
  for (const q of plan.quizzes) {
    if (!componentCodes.has(q.componentCode)) {
      errors.push(
        `quiz ${q.code} names the unknown component ${q.componentCode}`
      );
    }
    if (q.kind === 'lesson') {
      if (!q.enablerCode || !enablerCodes.has(q.enablerCode)) {
        errors.push(
          `quiz ${q.code} names the unknown enabler ${q.enablerCode}`
        );
      }
      if (!q.level || !LEVELS.includes(q.level)) {
        errors.push(`quiz ${q.code} has no valid level`);
      }
      const slot = `${q.enablerCode}/${q.level}`;
      if (lessonSlots.has(slot)) errors.push(`quiz slot ${slot} is used twice`);
      lessonSlots.add(slot);
    } else if (q.kind === 'global') {
      if (q.enablerCode !== null) {
        errors.push(`global quiz ${q.code} must not name an enabler`);
      }
      if (globalSlots.has(q.componentCode)) {
        errors.push(`component ${q.componentCode} has two global quizzes`);
      }
      globalSlots.add(q.componentCode);
    } else {
      errors.push(`quiz ${q.code} has an unknown kind`);
    }
    if (!Array.isArray(q.questions) || q.questions.length === 0) {
      errors.push(`quiz ${q.code} has no questions`);
      continue;
    }
    const numbers = q.questions.map(question => question.number).join(',');
    if (numbers !== q.questions.map((_, i) => i + 1).join(',')) {
      errors.push(`quiz ${q.code} must number its questions 1 to n`);
    }
    for (const question of q.questions) {
      const letters = question.options.map(o => o.letter).join('');
      if (letters !== 'ABCD') {
        errors.push(
          `quiz ${q.code} question ${question.number} must have the options A to D`
        );
      }
      if (question.options.filter(o => o.isCorrect).length !== 1) {
        errors.push(
          `quiz ${q.code} question ${question.number} needs exactly one correct option`
        );
      }
      for (const o of question.options) {
        if (o.explanation !== null && !o.isCorrect) {
          errors.push(
            `quiz ${q.code} question ${question.number} has an explanation on a wrong option`
          );
        }
      }
    }
  }
  errors.push(...reviewedMarkerProblems(plan, enablerCodes));
  errors.push(...findSolutionLeaks(plan));
  return errors;
}

/**
 * The reviewed markers of a plan (the release of the bare line "Lösung" for
 * named enabler texts). Strict: a list of known enablers, each once, with its
 * reason and the one pattern, no other field.
 */
function reviewedMarkerProblems(
  plan: ImportPlan,
  enablerCodes: Set<string>
): string[] {
  const raw = (plan as { reviewedMarkers?: unknown }).reviewedMarkers;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return ['reviewedMarkers must be a list'];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isRecord(entry)) {
      problems.push('a reviewed marker is not an object');
      continue;
    }
    for (const field of Object.keys(entry)) {
      if (!['enablerCode', 'pattern', 'reason'].includes(field)) {
        problems.push(`a reviewed marker has the unknown field ${field}`);
      }
    }
    const code = entry.enablerCode;
    if (typeof code !== 'string' || !enablerCodes.has(code)) {
      problems.push('a reviewed marker names an enabler that is not in the plan');
    } else if (seen.has(code)) {
      problems.push(`enabler ${code} has two reviewed markers`);
    } else {
      seen.add(code);
    }
    if (entry.pattern !== 'bare-solution-line') {
      problems.push('a reviewed marker names a pattern that cannot be reviewed');
    }
    if (
      typeof entry.reason !== 'string' ||
      entry.reason.trim().length === 0 ||
      entry.reason.length > 400 ||
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u001f\u007f\u0085\u2028\u2029]/.test(entry.reason)
    ) {
      problems.push('a reviewed marker has no valid reason');
    }
  }
  return problems;
}

const mdCell = (text: string) => text.replace(/\|/g, '/').replace(/\s+/g, ' ');

/** Short summary of a plan in German Markdown. Never holds content of a file. */
export function renderPlanSummary(plan: ImportPlan): string {
  const counts = planCounts(plan);
  const out: string[] = [];
  out.push('# Importplan KfBM');
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
  out.push(`| Komponenten | ${counts.components} |`);
  out.push(`| Enabler | ${counts.enablers} |`);
  out.push(`| Szenarien | ${counts.scenarios} |`);
  out.push(
    `| Quizze | ${counts.quizzes} (Enabler: ${counts.lessonQuizzes}, Global: ${counts.globalQuizzes}) |`
  );
  out.push(`| Fragen | ${counts.questions} |`);
  out.push(`| Optionen | ${counts.options} |`);
  out.push(`| übersprungene Dateien | ${counts.skipped} |`);
  out.push(
    `| ältere Kopien (neueste Fassung gewählt) | ${counts.superseded} |`
  );
  out.push('');
  out.push('## Komponenten');
  out.push('');
  out.push(
    '| Komponente | Art | Phase | Enabler | Szenarien | Quizze | Global-Quiz |'
  );
  out.push('|---|---|---|---|---|---|---|');
  for (const c of plan.components) {
    const enablers = plan.enablers.filter(e => e.componentCode === c.code);
    const lesson = plan.quizzes.filter(
      q => q.kind === 'lesson' && q.componentCode === c.code
    );
    const scenarioCount = plan.scenarios.filter(s =>
      enablers.some(e => e.code === s.enablerCode)
    ).length;
    const hasGlobal = plan.quizzes.some(
      q => q.kind === 'global' && q.componentCode === c.code
    );
    out.push(
      `| ${c.code} | ${c.kind} | ${c.phase ?? '-'} | ${enablers.length} | ${scenarioCount} | ${lesson.length} | ${hasGlobal ? 'ja' : 'nein'} |`
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
