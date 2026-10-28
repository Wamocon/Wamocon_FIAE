// Plan of the transfer: from the decisions of a run to the two plans of the apply
// engines (docs/ki-upload-konzept.md 8.1 points 1 to 3).
//
// What it does, in this order:
//   1. sorts out the files that do not become rows (not accepted, a copy that was
//      skipped, a format the parsers do not read) and says why
//   2. gives every other file the PathInfo of its decision (pathInfoFromAssignment,
//      or the PathInfo of the real path when the upload kept the folder tree)
//   3. resolves duplicates by the choice of the person: it never picks the newest
//      itself (selectFiles would, and the person has already decided)
//   4. reads every file AGAIN from the staging bucket and parses the full content
//      (the database needs options.is_correct and the rationales, so this is the one
//      place where the solution parts are read. They stay on the server: nothing
//      here sends them anywhere, and the report holds codes only)
//   5. buildImportPlan and buildUseCasePlan, the same functions the import script uses
//
// Two more kinds of file (package UP2):
//   - a quiz JSON file (schema 1.0) is read by the strict reader of the import
//     (quiz-json). Every quiz level becomes a synthetic source file with the path info
//     that the same function derives for a Word file, so a quiz has the same content
//     key, code and component whether it came from Word or from JSON. The component
//     facts (title, paragraph, group) come from the database row when there is one. A
//     Word file of the same run with the same key wins (mergeQuizSources lists the JSON
//     quiz as superseded), a JSON quiz fills the gap of a Word file that cannot be used.
//     Two JSON files that hold the same quiz are both left out (the person accepts one).
//   - an Excel mapping file becomes the plan of the learning field import
//     (learning-fields/plan.ts), built against the components and enablers of the
//     catalog and of this transfer's plan. At most one per transfer.
//
// The builder reads files and nothing else: no database, no connection. It runs
// BEFORE the reserved connection of the apply is taken (a pooler slot is not held
// while the files are parsed).

import {
  pathInfoFromAssignment,
  sameContentInfo,
} from '@/lib/content-import/apply/path-from-assignment';
import type { AssignmentDocType } from '@/lib/content-import/apply/path-from-assignment';
import {
  buildImportPlan,
  planCounts,
  type SourceFile as ImportSourceFile,
} from '@/lib/content-import/apply/plan';
import type { Decisions, ImportPlan } from '@/lib/content-import/apply/types';
import { pathInfo } from '@/lib/content-import/path-info';
import {
  parseQuizText,
  parseScenarioText,
} from '@/lib/content-import/source-parsers';
import type {
  Paragraph,
  PathInfo,
  SourceGroup,
} from '@/lib/content-import/types';
import {
  parseMappingSheet,
  parseReference,
} from '@/lib/content-import/learning-fields/mapping-sheet';
import {
  buildLearningFieldPlan,
  validateLearningFieldPlan,
} from '@/lib/content-import/learning-fields/plan';
import type {
  ImportIndex,
  LearningFieldPlan,
} from '@/lib/content-import/learning-fields/types';
import { mergeQuizSources } from '@/lib/content-import/quiz-json/merge';
import type { QuizJsonRead } from '@/lib/content-import/quiz-json/types';
import { solutionTextsOfUseCases } from '@/lib/content-import/use-cases/guard';
import { parseUseCaseText } from '@/lib/content-import/use-cases/parser';
import {
  buildUseCasePlan,
  countUseCasePlan,
  type SourceFile as UseCaseSourceFile,
} from '@/lib/content-import/use-cases/plan';
import { fromGroupFolder } from '@/lib/content-upload/classify/path-rule';
import { readDocx } from '@/lib/content-upload/read-docx';
import { hasUsableSet, readQuizJson } from '@/lib/content-upload/read-json';
import { readXlsx } from '@/lib/content-upload/read-xlsx';
import { mapLimit } from '@/lib/content-upload/staging/pool';
import type {
  ComponentFact,
  EnablerFact,
  ExcludedFile,
  SkippedItem,
  TransferFile,
  TransferPlan,
} from '@/lib/content-upload/transfer/types';

const PLANNED_TYPES: ReadonlySet<string> = new Set([
  'enabler',
  'quiz',
  'global_quiz',
  'scenario',
  'use_case',
]);

/** Files read at the same time (each is up to 25 MB in memory while it is parsed). */
const DEFAULT_CONCURRENCY = 4;

export interface BuildTransferInput {
  files: readonly TransferFile[];
  /** The components of the catalog in the target database. */
  components: readonly ComponentFact[];
  /**
   * The enablers of the catalog in the target database: a quiz or a scenario of one of
   * them needs no enabler document in the delivery (a supply of content).
   */
  enablers?: readonly EnablerFact[];
  decisions: Decisions;
  /** The bytes of a staging object, or null when it is gone. */
  readBytes: (file: TransferFile) => Promise<Uint8Array | null>;
  now?: Date;
  concurrency?: number;
  /**
   * Time (epoch milliseconds) after which no further file is read. The plan is then
   * refused (PLAN_TIMEOUT) and not built from a part of the files: a plan without some
   * of the accepted files would look complete.
   */
  deadline?: number;
}

export class TransferPlanError extends Error {
  readonly code: 'PLAN_TIMEOUT';
  constructor(code: 'PLAN_TIMEOUT', message: string) {
    super(message);
    this.name = 'TransferPlanError';
    this.code = code;
  }
}

/** The folder group of a component row, the inverse of phaseByGroup and kindOfComponent. */
export function groupOfComponent(
  row: Pick<ComponentFact, 'kind' | 'phase'>,
  decisions: Decisions
): SourceGroup | null {
  if (row.kind === 'wahl') return 'wahl';
  if (row.kind === 'integrativ') return 'ganze';
  if (row.kind === 'pflicht') {
    const { teil1, teil2 } = decisions.components.phaseByGroup;
    if (row.phase !== null && row.phase === teil1) return 'teil1';
    if (row.phase !== null && row.phase === teil2) return 'teil2';
  }
  return null;
}

const exclude = (
  list: ExcludedFile[],
  file: TransferFile,
  code: string,
  reason: string
) => list.push({ fileId: file.id, code, reason });

interface Candidate {
  file: TransferFile;
  info: PathInfo;
  /** The path of the real tree was used. */
  fromTree: boolean;
}

/** Complete facts in a real path: title and a group folder of the component. */
function treeIsComplete(tree: PathInfo): boolean {
  return (
    tree.issues.length === 0 &&
    !!tree.component?.title &&
    (tree.folderGroup === 'teil1' ||
      tree.folderGroup === 'teil2' ||
      tree.folderGroup === 'ganze')
  );
}

function infoFor(
  file: TransferFile,
  byCode: ReadonlyMap<string, ComponentFact>,
  decisions: Decisions
): { info: PathInfo; fromTree: boolean } {
  const d = file.decision;
  // A folder upload starts with the name of the chosen folder. The rule stage
  // finds the group folder below such a parent (classifyByPath), so the plan must
  // read the tree the same way, or every component would end without a group
  let tree = pathInfo(file.relPath);
  if (tree.issues.includes('unknown-group')) {
    const below = fromGroupFolder(file.relPath);
    if (below) tree = pathInfo(below);
  }
  const row = byCode.get(d.componentCode as string);
  const fromRow = row
    ? {
        title: row.title,
        reference: row.reference,
        group: groupOfComponent(row, decisions),
      }
    : null;
  const fromPath =
    tree.component && tree.component.code === d.componentCode
      ? {
          title: tree.component.title,
          reference: tree.component.paragraph,
          group: tree.group,
        }
      : null;
  const synthesized = pathInfoFromAssignment({
    docType: d.docType as AssignmentDocType,
    componentCode: d.componentCode as string,
    enablerCode: d.enablerCode,
    quizLevel: d.quizLevel as 'low' | 'medium' | 'high' | null,
    format: file.ext,
    version: tree.version,
    component: fromRow ?? fromPath,
  });
  // The real path is kept only where it says exactly what the decision says and
  // holds the facts of the component: then the plan is the one the script builds.
  if (treeIsComplete(tree) && sameContentInfo(tree, synthesized)) {
    return { info: tree, fromTree: true };
  }
  return { info: synthesized, fromTree: false };
}

function parseContent(
  info: PathInfo,
  paragraphs: Paragraph[],
  decisions: Decisions
): ImportSourceFile['content'] | UseCaseSourceFile['content'] {
  switch (info.type) {
    case 'enabler':
      return { type: 'enabler', paragraphs };
    case 'quiz':
      return { type: 'quiz', result: parseQuizText(paragraphs) };
    case 'global-quiz':
      return {
        type: 'global-quiz',
        result: parseQuizText(paragraphs, {
          expectedQuestions: decisions.content.globalQuizQuestions,
        }),
      };
    case 'scenario':
      return { type: 'scenario', result: parseScenarioText(paragraphs) };
    default:
      return { type: 'use-case', result: parseUseCaseText(paragraphs) };
  }
}

/** The most skipped rows of the mapping table that are named one by one in the report. */
export const MAX_LEARNING_SKIPS = 200;

/**
 * Most JSON files of one transfer. Every reading holds all questions and answers of its file
 * (some 2 to 3 times its size) until the plan is built, so the number is bounded: the others
 * are left out with a code and go into the next run.
 */
export const MAX_JSON_FILES_PER_TRANSFER = 10;

interface JsonReadContext {
  excluded: ExcludedFile[];
  fileOfSource: Map<string, string>;
  /** The source paths of the files of each JSON file, for the report. */
  jsonRelOfFile: Map<string, Set<string>>;
  sha: Map<string, string>;
}

/**
 * Reads the accepted quiz JSON files and returns their readings with the path of every
 * synthetic file made unique by the id of the file, so a plan item names its file.
 * A file that is refused, empty of usable quizzes, of another kind than its decision
 * says, or that holds a quiz another JSON file holds too, is left out with a code.
 */
async function readJsonSources(
  input: BuildTransferInput,
  files: readonly TransferFile[],
  byCode: ReadonlyMap<string, ComponentFact>,
  decisions: Decisions,
  context: JsonReadContext
): Promise<QuizJsonRead[]> {
  const ordered = [...files].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const file of ordered.slice(MAX_JSON_FILES_PER_TRANSFER)) {
    context.excluded.push({
      fileId: file.id,
      code: 'JSON_TOO_MANY',
      reason: `At most ${MAX_JSON_FILES_PER_TRANSFER} JSON files go into one transfer. Take this one in the next run.`,
    });
  }
  const outcomes = await mapLimit(
    ordered.slice(0, MAX_JSON_FILES_PER_TRANSFER),
    Math.min(input.concurrency ?? DEFAULT_CONCURRENCY, 2),
    async file => {
      if (input.deadline !== undefined && Date.now() > input.deadline) {
        throw new TransferPlanError(
          'PLAN_TIMEOUT',
          'The files could not be read in the time that is left.'
        );
      }
      let bytes: Uint8Array | null;
      try {
        bytes = await input.readBytes(file);
      } catch {
        return {
          file,
          failure: [
            'JSON_UNREADABLE',
            'The file could not be read from the staging bucket.',
          ] as const,
        };
      }
      if (!bytes) {
        return {
          file,
          failure: [
            'NO_OBJECT',
            'The file is no longer in the staging bucket.',
          ] as const,
        };
      }
      const result = readQuizJson(bytes, {
        expectedGlobalQuestions: decisions.content.globalQuizQuestions,
      });
      if (result.status === 'rejected') {
        return {
          file,
          failure: [
            'JSON_REFUSED',
            `The quiz file was refused (${result.code}).`,
          ] as const,
        };
      }
      if (!hasUsableSet(result.summary)) {
        return {
          file,
          failure: [
            'JSON_NO_USABLE_SET',
            'No quiz of the file can be read without an error.',
          ] as const,
        };
      }
      const wanted = result.kind === 'lesson' ? 'quiz' : 'global_quiz';
      if (file.decision.docType !== wanted) {
        return {
          file,
          failure: [
            'JSON_TYPE_MISMATCH',
            'The decision names another kind of quiz file than the file holds.',
          ] as const,
        };
      }
      return { file, read: result.read };
    }
  );

  const readable: Array<{ file: TransferFile; read: QuizJsonRead }> = [];
  for (const outcome of outcomes) {
    if ('failure' in outcome && outcome.failure) {
      exclude(
        context.excluded,
        outcome.file,
        outcome.failure[0],
        outcome.failure[1]
      );
    } else if ('read' in outcome && outcome.read) {
      readable.push({ file: outcome.file, read: outcome.read });
    }
  }

  // The same quiz in two JSON files: the choice is the person's, so neither is taken
  const owners = new Map<string, Set<string>>();
  for (const { file, read } of readable) {
    for (const source of read.files) {
      const key = source.info.key;
      if (
        !key ||
        !(key.startsWith('quiz:') || key.startsWith('global-quiz:'))
      ) {
        continue;
      }
      // a set with an error is no row, so a broken copy cannot take a good one out
      if (
        !source.content ||
        source.content.type === 'enabler' ||
        !source.content.result.ok
      ) {
        continue;
      }
      owners.set(key, (owners.get(key) ?? new Set()).add(file.id));
    }
  }
  const overlapping = new Set(
    [...owners.values()].filter(ids => ids.size > 1).flatMap(ids => [...ids])
  );

  const sources: QuizJsonRead[] = [];
  for (const { file, read } of readable.sort((a, b) =>
    a.file.id < b.file.id ? -1 : 1
  )) {
    if (overlapping.has(file.id)) {
      exclude(
        context.excluded,
        file,
        'JSON_KEY_OVERLAP',
        'Another JSON file of this run holds the same quizzes. Accept only one of them.'
      );
      continue;
    }
    const prefix = `upload/${file.id}/json/`;
    const rels = new Set<string>();
    // A set with an error that another file holds without one is left out here: the planner
    // would take one of the two by chance and could drop the good one
    const adopted = read.files
      .filter(source => {
        const key = source.info.key;
        const clean =
          !source.content ||
          source.content.type === 'enabler' ||
          source.content.result.ok;
        return clean || !key || !owners.has(key);
      })
      .map(source => {
        const rel = `${prefix}${source.rel}`;
        rels.add(rel);
        return {
          ...source,
          rel,
          info: adoptComponentFacts(source.info, byCode, decisions),
        };
      });
    const unmapped = read.unmapped.map(entry => {
      const name = `${prefix}${entry.file}`;
      rels.add(name);
      return { ...entry, file: name };
    });
    for (const rel of rels) context.fileOfSource.set(rel, file.id);
    context.jsonRelOfFile.set(file.id, rels);
    context.sha.set(file.id, file.sha256);
    sources.push({ ...read, files: adopted, unmapped });
  }
  return sources;
}

/**
 * The title, the paragraph and the group of a component that the database has come from
 * its row (as for a Word file), not from the section name inside the JSON file.
 */
function adoptComponentFacts(
  info: PathInfo,
  byCode: ReadonlyMap<string, ComponentFact>,
  decisions: Decisions
): PathInfo {
  const row = info.component ? byCode.get(info.component.code) : undefined;
  if (!row || !info.component) return info;
  const group = groupOfComponent(row, decisions);
  return {
    ...info,
    ...(group === null
      ? {}
      : { folderGroup: group === 'wahl' ? 'teil2' : group, group }),
    component: {
      ...info.component,
      title: row.title,
      paragraph: row.reference,
    },
  };
}

type LearningBuild =
  | { ok: true; plan: LearningFieldPlan }
  | { ok: false; code: string; reason: string };

/** The plan of the learning field import from an Excel mapping file. */
async function buildLearningPlan(
  input: BuildTransferInput,
  file: TransferFile,
  importPlan: ImportPlan,
  byCode: ReadonlyMap<string, ComponentFact>,
  now: Date
): Promise<LearningBuild> {
  if (input.deadline !== undefined && Date.now() > input.deadline) {
    throw new TransferPlanError(
      'PLAN_TIMEOUT',
      'The files could not be read in the time that is left.'
    );
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await input.readBytes(file);
  } catch {
    return {
      ok: false,
      code: 'XLSX_UNREADABLE',
      reason: 'The file could not be read from the staging bucket.',
    };
  }
  if (!bytes) {
    return {
      ok: false,
      code: 'NO_OBJECT',
      reason: 'The file is no longer in the staging bucket.',
    };
  }
  const read = await readXlsx(bytes, {
    pick: rows => parseMappingSheet(rows).ok,
  });
  if (read.status !== 'ok') {
    return {
      ok: false,
      code: 'XLSX_REFUSED',
      reason: `The Excel file was refused (${read.code ?? read.status}).`,
    };
  }
  const parsed = read.picked ? parseMappingSheet(read.rows) : null;
  if (!parsed || !parsed.ok) {
    return {
      ok: false,
      code: 'XLSX_NOT_A_MAPPING',
      reason: 'No sheet of the file has the form of the mapping table.',
    };
  }
  // The codes the mappings may point at: the catalog as it is and what this transfer adds
  const references = new Map<string, string | null>();
  const addComponent = (code: string, reference: string | null | undefined) => {
    const normalised = parseReference(reference)?.text ?? null;
    references.set(code, references.get(code) ?? normalised);
  };
  for (const c of byCode.values()) addComponent(c.code, c.reference);
  for (const c of importPlan.components) addComponent(c.code, c.reference);
  const index: ImportIndex = {
    components: [...references].map(([code, reference]) => ({
      code,
      reference,
    })),
    enablers: [
      ...new Set([
        ...(input.enablers ?? []).map(e => e.code),
        ...importPlan.enablers.map(e => e.code),
      ]),
    ].sort(),
    excludedNumbers: [...input.decisions.components.excludedNumbers],
  };
  const plan = buildLearningFieldPlan(parsed.sheet, index, {
    now,
    sheetName: read.sheetName ?? undefined,
  });
  const problems = validateLearningFieldPlan(plan);
  if (problems.length > 0) {
    return {
      ok: false,
      code: 'XLSX_PLAN_INVALID',
      reason: 'The mapping table gives no valid plan.',
    };
  }
  return { ok: true, plan };
}

export async function buildTransferPlan(
  input: BuildTransferInput
): Promise<TransferPlan> {
  const { decisions } = input;
  const byCode = new Map(input.components.map(c => [c.code, c]));
  const excluded: ExcludedFile[] = [];
  const candidates: Candidate[] = [];
  const jsonFiles: TransferFile[] = [];
  const xlsxFiles: TransferFile[] = [];

  // 1 and 2: who becomes a row ---------------------------------------------------
  const ordered = [...input.files].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const file of ordered) {
    const d = file.decision;
    if (d.action === 'reject') {
      exclude(excluded, file, 'REJECTED', 'The file was rejected by a person.');
    } else if (d.action === 'defer') {
      exclude(excluded, file, 'DEFERRED', 'The file was put back by a person.');
    } else if (d.dupChoice === 'skip') {
      exclude(
        excluded,
        file,
        'DUP_SKIP',
        'The person chose another copy of this document.'
      );
    } else if (file.ext === 'json' || file.ext === 'xlsx') {
      // The kind of the file is the one the reader found, its quizzes or positions name
      // their own component, enabler and level: there is no assignment to complete
      const expected =
        file.ext === 'json' ? ['quiz', 'global_quiz'] : ['other'];
      if (!d.docType || !expected.includes(d.docType)) {
        exclude(
          excluded,
          file,
          'NOT_PLANNABLE',
          'The document type is not part of the transfer.'
        );
      } else if (file.objectDeleted) {
        exclude(
          excluded,
          file,
          'NO_OBJECT',
          'The file is no longer in the staging bucket.'
        );
      } else {
        (file.ext === 'json' ? jsonFiles : xlsxFiles).push(file);
      }
    } else if (d.docType === 'pdf_original') {
      exclude(
        excluded,
        file,
        'ORIGINAL_ONLY',
        'A PDF original is not read into the plan.'
      );
    } else if (!d.docType || !PLANNED_TYPES.has(d.docType)) {
      exclude(
        excluded,
        file,
        'NOT_PLANNABLE',
        'The document type is not part of the transfer.'
      );
    } else if (file.ext !== 'docx') {
      exclude(
        excluded,
        file,
        'FORMAT',
        'Only Word files are read into the plan.'
      );
    } else if (file.objectDeleted) {
      exclude(
        excluded,
        file,
        'NO_OBJECT',
        'The file is no longer in the staging bucket.'
      );
    } else if (
      !d.componentCode ||
      (d.docType !== 'global_quiz' && !d.enablerCode) ||
      (d.docType === 'quiz' && !d.quizLevel)
    ) {
      exclude(
        excluded,
        file,
        'INCOMPLETE',
        'The decision names no component, enabler or level.'
      );
    } else {
      const { info, fromTree } = infoFor(file, byCode, decisions);
      candidates.push({ file, info, fromTree });
    }
  }

  // 3: duplicates, by the choice of the person ----------------------------------------
  const byKey = new Map<string, Candidate[]>();
  const keyless: Candidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.info.key;
    if (!key || candidate.info.issues.length > 0) {
      keyless.push(candidate);
      continue;
    }
    byKey.set(key, [...(byKey.get(key) ?? []), candidate]);
  }
  const chosen: Candidate[] = [...keyless];
  for (const group of byKey.values()) {
    if (group.length === 1) {
      chosen.push(group[0]);
      continue;
    }
    const keepers = group.filter(c => c.file.decision.dupChoice === 'keep');
    if (keepers.length === 1) {
      chosen.push(keepers[0]);
      for (const other of group) {
        if (other !== keepers[0]) {
          exclude(
            excluded,
            other.file,
            'DUP_SUPERSEDED',
            'Another copy of this document was chosen.'
          );
        }
      }
    } else {
      for (const other of group) {
        exclude(
          excluded,
          other.file,
          'DUP_UNRESOLVED',
          `${group.length} files hold the same document and the choice is not clear (exactly one must be kept).`
        );
      }
    }
  }
  chosen.sort((a, b) => (a.file.id < b.file.id ? -1 : 1));

  // 4: read and parse the full content ----------------------------------------------------
  const fileOfSource = new Map<string, string>();
  const used = new Set<string>();
  const importFiles: ImportSourceFile[] = [];
  const useCaseFiles: UseCaseSourceFile[] = [];
  const rels = chosen.map(c => {
    let rel = c.fromTree
      ? c.file.relPath
      : `upload/${c.file.id}/${c.file.fileName}`;
    if (used.has(rel)) rel = `upload/${c.file.id}/${c.file.fileName}`;
    used.add(rel);
    fileOfSource.set(rel, c.file.id);
    return rel;
  });
  const built = await mapLimit(
    chosen,
    input.concurrency ?? DEFAULT_CONCURRENCY,
    async (candidate, index) => {
      const { file, info } = candidate;
      const base = {
        rel: rels[index],
        size: file.sizeBytes,
        mtimeMs: file.mtimeMs,
        placeholder: false,
        info,
      };
      if (input.deadline !== undefined && Date.now() > input.deadline) {
        throw new TransferPlanError(
          'PLAN_TIMEOUT',
          'The files could not be read in the time that is left.'
        );
      }
      let bytes: Uint8Array | null;
      try {
        bytes = await input.readBytes(file);
      } catch {
        return {
          ...base,
          readError: 'The file could not be read from the staging bucket.',
        };
      }
      if (!bytes) {
        return {
          ...base,
          readError: 'The file is no longer in the staging bucket.',
        };
      }
      const read = await readDocx(bytes);
      if (read.status !== 'ok') {
        return {
          ...base,
          readError: `The Word file was refused (${read.code ?? read.status}).`,
        };
      }
      try {
        return {
          ...base,
          content: parseContent(info, read.paragraphs, decisions),
        };
      } catch {
        return { ...base, readError: 'The Word file could not be parsed.' };
      }
    }
  );
  for (const file of built) {
    if (file.info.type === 'use-case')
      useCaseFiles.push(file as UseCaseSourceFile);
    else importFiles.push(file as ImportSourceFile);
  }
  importFiles.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  useCaseFiles.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  // 4b: quiz JSON files -----------------------------------------------------------------
  const sha = new Map(chosen.map(c => [c.file.id, c.file.sha256]));
  const jsonRelOfFile = new Map<string, Set<string>>();
  const jsonSources = await readJsonSources(
    input,
    jsonFiles,
    byCode,
    decisions,
    {
      excluded,
      fileOfSource,
      jsonRelOfFile,
      sha,
    }
  );

  // 5: the plans --------------------------------------------------------------------------
  const now = input.now ?? new Date();
  const merged =
    jsonSources.length > 0 ? mergeQuizSources(importFiles, jsonSources) : null;
  // The use case plan comes first: its model solutions must not stand in a teaching text, so
  // the import plan gets them to search for (they are not stored in it).
  const useCasePlan = buildUseCasePlan(useCaseFiles, decisions, { now });
  const importPlan = buildImportPlan(
    merged ? merged.files : importFiles,
    decisions,
    {
      now,
      protectedTexts: [
        ...solutionTextsOfUseCases(useCasePlan.useCases),
        // a use case that was left out keeps its solution private as well
        ...useCaseFiles.flatMap(f =>
          f.content?.type === 'use-case'
            ? [
                f.content.result.value.solution,
                f.content.result.value.criteria ?? '',
              ].filter(text => text.length > 0)
            : []
        ),
      ],
      existingEnablers: new Map((input.enablers ?? []).map(e => [e.code, e])),
      ...(merged
        ? { extra: { skipped: merged.skipped, superseded: merged.superseded } }
        : {}),
    }
  );

  const skipped: SkippedItem[] = [
    ...importPlan.skipped.map(s => ({
      fileId: s.file ? (fileOfSource.get(s.file) ?? null) : null,
      code: s.code,
      reason: s.reason,
    })),
    ...useCasePlan.skipped.map(s => ({
      fileId: s.file ? (fileOfSource.get(s.file) ?? null) : null,
      code: s.code,
      reason: s.reason,
    })),
  ];
  // A quiz of a JSON file that lost against a Word file of the run (or the other way
  // round) is no row, and the person is told which file it was
  const jsonRels = new Set(
    [...jsonRelOfFile.values()].flatMap(set => [...set])
  );
  for (const s of importPlan.superseded) {
    if (jsonRels.has(s.file) || jsonRels.has(s.keptFile)) {
      skipped.push({
        fileId: fileOfSource.get(s.file) ?? null,
        code: 'SUPERSEDED',
        reason:
          'Another file of this run holds the same quiz and is used instead.',
      });
    }
  }

  // 5b: the learning field mapping (an Excel file) ----------------------------------------
  let learningPlan: LearningFieldPlan | null = null;
  let learningFileId: string | null = null;
  if (xlsxFiles.length > 1) {
    for (const file of xlsxFiles) {
      exclude(
        excluded,
        file,
        'XLSX_MULTIPLE',
        'More than one mapping table is part of this transfer. Accept only one.'
      );
    }
  } else if (xlsxFiles.length === 1) {
    const file = xlsxFiles[0];
    const built = await buildLearningPlan(input, file, importPlan, byCode, now);
    if (built.ok) {
      learningPlan = built.plan;
      learningFileId = file.id;
      sha.set(file.id, file.sha256);
      for (const s of built.plan.skipped.slice(0, MAX_LEARNING_SKIPS)) {
        skipped.push({ fileId: file.id, code: s.code, reason: s.reason });
      }
    } else {
      exclude(excluded, file, built.code, built.reason);
    }
  }

  const plannedSources = new Set<string>([
    ...importPlan.enablers.map(e => e.source),
    ...importPlan.scenarios.map(s => s.source),
    ...importPlan.quizzes.map(q => q.source),
    ...useCasePlan.useCases.map(u => u.source),
  ]);
  const plannedIds = [
    ...new Set([
      ...[...plannedSources]
        .map(source => fileOfSource.get(source))
        .filter((id): id is string => id !== undefined),
      ...(learningFileId ? [learningFileId] : []),
    ]),
  ].sort();
  return {
    importPlan,
    useCasePlan,
    excluded,
    skipped,
    plannedFiles: plannedIds.map(id => ({ id, sha256: sha.get(id) as string })),
    fileOfSource,
    learningPlan,
    learningFileId,
    counts: planCounts(importPlan),
    useCaseCounts: countUseCasePlan(useCasePlan),
  };
}
