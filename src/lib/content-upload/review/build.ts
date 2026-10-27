// From the records of a run to the rows of the review list and to the duplicate
// groups (docs/ki-upload-konzept.md 7.1 and 7.2). Pure: no database, no clock (the
// caller passes `now`), no network.
//
// The assignment that counts for a file is the decision when there is one, else
// the proposal. Duplicate groups are made from that assignment, so a correction in
// the list moves a file between groups at once. Only the metadata of a file goes in:
// nothing of its text is stored or kept here.

import type { Decisions } from '@/lib/content-import/apply/types';
import {
  analyzeDuplicates,
  versionOfPath,
  type DuplicateAnalysis,
  type DuplicateFile,
} from '@/lib/content-upload/classify/duplicates';
import { deriveComponentFacts } from '@/lib/content-upload/classify/derive';
import type { PositiveList } from '@/lib/content-upload/classify/positive-list';
import type {
  OriginalType,
  UploadDocType,
} from '@/lib/content-upload/classify/types';
import {
  DECIDABLE,
  GROUPABLE,
  isLeftOut,
  isProblem,
} from '@/lib/content-upload/review/states';
import {
  KI_STATES,
  type AssignmentDto,
  type DerivedDto,
  type DuplicateGroupDto,
  type KiStateName,
  type ReviewCounts,
  type ReviewRecord,
  type ReviewRowDto,
} from '@/lib/content-upload/review/types';

export interface ReviewContext {
  list: PositiveList;
  decisions: Decisions;
  /** Time of now in milliseconds, from the caller. */
  now: number;
}

/** What counts for a file now: the decision, else the proposal, else nothing. */
export function effectiveOf(record: ReviewRecord): AssignmentDto {
  const source = record.decision ?? record.proposal;
  return {
    docType: source?.docType ?? null,
    componentCode: source?.componentCode ?? null,
    enablerCode: source?.enablerCode ?? null,
    quizLevel: source?.quizLevel ?? null,
  };
}

const ORIGINAL_OF_KEY: Record<string, OriginalType> = {
  enabler: 'enabler',
  quiz: 'quiz',
  scenario: 'scenario',
  'use-case': 'use_case',
  'global-quiz': 'global_quiz',
};

/** The type a PDF original is a copy of, read from its content key (pdf:quiz:1a:low). */
export function originalTypeOfKey(dupKey: string | null): OriginalType | null {
  const m = /^pdf:([a-z-]+):/.exec(dupKey ?? '');
  return m ? (ORIGINAL_OF_KEY[m[1]] ?? null) : null;
}

const QUIZ_LEVEL_SET: ReadonlySet<string> = new Set(['low', 'medium', 'high']);

function duplicateInput(record: ReviewRecord): DuplicateFile {
  const { file } = record;
  const effective = effectiveOf(record);
  const live = GROUPABLE.includes(file.status);
  const hasAssignment = effective.docType !== null;
  return {
    id: file.id,
    sha256: file.sha256,
    relPath: file.relPath,
    mtimeMs: file.clientMtimeMs,
    excluded: !live,
    withoutSolution: file.parseSummary?.withoutSolution === true,
    assignment: hasAssignment
      ? {
          docType: effective.docType as UploadDocType,
          componentCode: effective.componentCode,
          enablerCode: effective.enablerCode,
          quizLevel:
            effective.quizLevel && QUIZ_LEVEL_SET.has(effective.quizLevel)
              ? (effective.quizLevel as 'low' | 'medium' | 'high')
              : null,
          originalType:
            effective.docType === 'pdf_original'
              ? originalTypeOfKey(file.dupKey)
              : null,
        }
      : null,
  };
}

/** The duplicate groups of a run over the assignments that count now. */
export function analyzeRun(
  records: readonly ReviewRecord[],
  context: ReviewContext
): DuplicateAnalysis {
  return analyzeDuplicates(records.map(duplicateInput), {
    now: context.now,
    ambiguousWithinHours: context.decisions.duplicates.ambiguousWithinHours,
  });
}

function derivedOf(
  effective: AssignmentDto,
  context: ReviewContext
): DerivedDto | null {
  if (!effective.componentCode) return null;
  const entry = context.list.component(effective.componentCode);
  const facts = deriveComponentFacts(
    context.decisions,
    effective.componentCode,
    entry?.group ?? null
  );
  return { kind: facts.kind, phase: facts.phase };
}

/** The state of the model stage of a file, from its summary (only known values). */
function kiStateOf(file: ReviewRecord['file']): KiStateName | null {
  const value = file.parseSummary?.kiState;
  return typeof value === 'string' &&
    (KI_STATES as readonly string[]).includes(value)
    ? (value as KiStateName)
    : null;
}

function isNewIn(effective: AssignmentDto, list: PositiveList): boolean {
  const component = effective.componentCode
    ? list.component(effective.componentCode)
    : null;
  const enabler = effective.enablerCode
    ? list.enabler(effective.enablerCode)
    : null;
  return component?.origin === 'plan' || enabler?.origin === 'plan';
}

export function buildRows(
  records: readonly ReviewRecord[],
  context: ReviewContext,
  analysis: DuplicateAnalysis = analyzeRun(records, context)
): ReviewRowDto[] {
  const groupOfFile = new Map<
    string,
    {
      key: string;
      size: number;
      suggestedId: string | null;
      ambiguous: boolean;
    }
  >();
  for (const group of analysis.keyGroups) {
    for (const id of group.memberIds) {
      groupOfFile.set(id, {
        key: group.key,
        size: group.memberIds.length,
        suggestedId: group.suggestedId,
        ambiguous: group.ambiguous,
      });
    }
  }
  return records.map(record => {
    const { file, proposal, decision } = record;
    const effective = effectiveOf(record);
    const group = groupOfFile.get(file.id);
    return {
      id: file.id,
      fileName: file.fileName,
      relPath: file.relPath,
      ext: file.ext,
      sizeBytes: file.sizeBytes,
      pageCount: file.pageCount,
      status: file.status,
      statusCode: file.statusCode,
      clientMtimeMs: file.clientMtimeMs,
      proposal: proposal
        ? {
            source: proposal.source,
            docType: proposal.docType,
            componentCode: proposal.componentCode,
            enablerCode: proposal.enablerCode,
            quizLevel: proposal.quizLevel,
            band: proposal.band,
            confidence: proposal.confidence,
            reasons: proposal.reasons,
            isNew: isNewIn(
              {
                docType: proposal.docType,
                componentCode: proposal.componentCode,
                enablerCode: proposal.enablerCode,
                quizLevel: proposal.quizLevel,
              },
              context.list
            ),
          }
        : null,
      effective,
      decision: decision
        ? {
            action: decision.action,
            dupChoice: decision.dupChoice,
            decidedAt: decision.decidedAt.toISOString(),
            docType: decision.docType,
            componentCode: decision.componentCode,
            enablerCode: decision.enablerCode,
            quizLevel: decision.quizLevel,
          }
        : null,
      derived: derivedOf(effective, context),
      duplicate: group
        ? {
            key: group.key,
            size: group.size,
            suggested: group.suggestedId === file.id,
            ambiguous: group.ambiguous,
          }
        : null,
      copyOfId: file.duplicateOfId,
      ki: kiStateOf(file),
    };
  });
}

export function countRows(rows: readonly ReviewRowDto[]): ReviewCounts {
  const counts: ReviewCounts = {
    total: rows.length,
    high: 0,
    medium: 0,
    low: 0,
    conflict: 0,
    duplicates: 0,
    problems: 0,
    skipped: 0,
    accepted: 0,
    rejected: 0,
    deferred: 0,
    open: 0,
    acceptableHigh: 0,
  };
  for (const row of rows) {
    // a file that is left out (a copy, an archive) is no work for the band filter
    if (row.proposal && !isLeftOut(row.status)) counts[row.proposal.band] += 1;
    if (row.duplicate) counts.duplicates += 1;
    if (isProblem(row.status)) counts.problems += 1;
    if (isLeftOut(row.status)) counts.skipped += 1;
    if (row.decision) {
      if (row.decision.action === 'accept') counts.accepted += 1;
      else if (row.decision.action === 'reject') counts.rejected += 1;
      else counts.deferred += 1;
    } else if (DECIDABLE.includes(row.status)) {
      counts.open += 1;
      if (
        row.status === 'proposed_rules' &&
        row.proposal?.band === 'high' &&
        row.duplicate === null
      ) {
        counts.acceptableHigh += 1;
      }
    }
  }
  return counts;
}

/** The groups of versions of a run for the duplicate view (two or more members). */
export function buildDuplicateGroups(
  records: readonly ReviewRecord[],
  analysis: DuplicateAnalysis
): DuplicateGroupDto[] {
  const byId = new Map(records.map(r => [r.file.id, r]));
  const groups: DuplicateGroupDto[] = [];
  for (const group of analysis.keyGroups) {
    const members = group.memberIds
      .map(id => byId.get(id))
      .filter((r): r is ReviewRecord => r !== undefined);
    if (members.length < 2) continue;
    const first = members[0];
    groups.push({
      key: group.key,
      label: effectiveOf(first),
      members: members.map(r => ({
        fileId: r.file.id,
        fileName: r.file.fileName,
        relPath: r.file.relPath,
        sizeBytes: r.file.sizeBytes,
        pageCount: r.file.pageCount,
        clientMtimeMs: r.file.clientMtimeMs,
        version: versionOfPath(r.file.relPath) ?? 0,
        suggested: group.suggestedId === r.file.id,
        decision: r.decision
          ? { action: r.decision.action, dupChoice: r.decision.dupChoice }
          : null,
      })),
      suggestedId: group.suggestedId,
      ambiguous: group.ambiguous,
      reasons: group.reasons,
      resolved: members.every(r => r.decision !== null),
    });
  }
  return groups;
}
