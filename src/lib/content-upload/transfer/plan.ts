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
import type { Decisions } from '@/lib/content-import/apply/types';
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
import { parseUseCaseText } from '@/lib/content-import/use-cases/parser';
import {
  buildUseCasePlan,
  countUseCasePlan,
  type SourceFile as UseCaseSourceFile,
} from '@/lib/content-import/use-cases/plan';
import { fromGroupFolder } from '@/lib/content-upload/classify/path-rule';
import { readDocx } from '@/lib/content-upload/read-docx';
import { mapLimit } from '@/lib/content-upload/staging/pool';
import type {
  ComponentFact,
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

export async function buildTransferPlan(
  input: BuildTransferInput
): Promise<TransferPlan> {
  const { decisions } = input;
  const byCode = new Map(input.components.map(c => [c.code, c]));
  const excluded: ExcludedFile[] = [];
  const candidates: Candidate[] = [];

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

  // 5: the plans --------------------------------------------------------------------------
  const now = input.now ?? new Date();
  const importPlan = buildImportPlan(importFiles, decisions, { now });
  const useCasePlan = buildUseCasePlan(useCaseFiles, decisions, { now });

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

  const plannedSources = new Set<string>([
    ...importPlan.enablers.map(e => e.source),
    ...importPlan.scenarios.map(s => s.source),
    ...importPlan.quizzes.map(q => q.source),
    ...useCasePlan.useCases.map(u => u.source),
  ]);
  const sha = new Map(chosen.map(c => [c.file.id, c.file.sha256]));
  const plannedIds = [
    ...new Set(
      [...plannedSources]
        .map(source => fileOfSource.get(source))
        .filter((id): id is string => id !== undefined)
    ),
  ].sort();
  return {
    importPlan,
    useCasePlan,
    excluded,
    skipped,
    plannedFiles: plannedIds.map(id => ({ id, sha256: sha.get(id) as string })),
    fileOfSource,
    counts: planCounts(importPlan),
    useCaseCounts: countUseCasePlan(useCasePlan),
  };
}
