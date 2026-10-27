// Writing decisions (docs/ki-upload-konzept.md 7.2): one decision per file, set
// one by one or by a mass action. The rules of this module:
//
//  - Decisions are written only while the run is in the state `review` (409
//    otherwise) and only for the version of the run the person saw (409).
//  - A decision to accept needs an assignment that is complete and on the positive
//    list. A proposal in the band low or conflict is never accepted as it stands: the
//    person has to name the assignment. "Alle sicheren bestätigen" takes the band
//    high only, and no file that is a version of another one (that is decided in
//    the duplicate view, where one version is kept and the others are skipped).
//  - Rejecting and deferring keep the values that counted before, so the list can
//    show them and a later accept starts from them.
//  - At most one version of a document can be accepted in a group of versions. A
//    plan that would accept a second one is cut back to the ones that keep the rule
//    (code DUPLICATE_UNRESOLVED).
//  - Solution parts are no thing of this module: it knows type, assignment and
//    state of a file, nothing of its text.
//
// The service plans the writes (pure, over the records of the run) and hands them
// to ReviewRepo.applyDecisions, which writes them in one transaction.

import {
  acceptableByMedium,
  acceptableByStock,
  analyzeRun,
  buildRows,
  effectiveOf,
  mediumGroupKey,
  originalTypeOfKey,
  type ReviewContext,
} from '@/lib/content-upload/review/build';
import type {
  ReviewRepo,
  DecisionWriteItem,
} from '@/lib/content-upload/review/repo';
import {
  DECIDABLE,
  UNCHECKED_REASONS,
} from '@/lib/content-upload/review/states';
import type {
  AssignmentDto,
  DecisionAction,
  DecisionRecord,
  DupChoice,
  ReviewRecord,
} from '@/lib/content-upload/review/types';
import {
  checkAssignment,
  mergeAssignment,
  type AssignmentFailureCode,
  type DecisionRequest,
} from '@/lib/content-upload/review/validate';
import {
  fail,
  ok,
  type ServiceResult,
} from '@/lib/content-upload/staging/result';
import type { RunRow } from '@/lib/content-upload/staging/types';

export type SkipCode =
  | AssignmentFailureCode
  | 'FILE_NOT_FOUND'
  | 'FILE_STATE'
  | 'PROPOSAL_CHANGED'
  | 'ASSIGNMENT_REQUIRED'
  | 'DUPLICATE_UNRESOLVED';

export interface DecisionOutcome {
  /** decisions_version after the write. */
  version: number;
  written: number;
  skipped: { fileId: string; code: SkipCode }[];
  /** Files an accept_high, accept_stock or accept_newest looked at (what was eligible). */
  eligible?: number;
  /** Groups an accept_newest left alone because they have no suggestion. */
  ambiguousGroups?: number;
}

interface Plan {
  items: DecisionWriteItem[];
  skipped: { fileId: string; code: SkipCode }[];
  eligible?: number;
  ambiguousGroups?: number;
}

const NOTHING: AssignmentDto = {
  docType: null,
  componentCode: null,
  enablerCode: null,
  quizLevel: null,
};

/**
 * A proposal that is unclear, contradicts itself or was not checked with full
 * certainty is never accepted as it stands, not by a single click, not as the
 * suggested version of a group. A person who named the assignment before has
 * already decided (an accepted decision with values).
 */
export function needsExplicitAssignment(record: ReviewRecord): boolean {
  if (record.decision?.action === 'accept') return false;
  const proposal = record.proposal;
  if (!proposal) return true;
  if (proposal.band === 'low' || proposal.band === 'conflict') return true;
  return proposal.reasons.some(r => UNCHECKED_REASONS.has(r.code));
}

/** What a change of the assignment starts from: nothing for a proposal that needs a person. */
function baseOf(record: ReviewRecord): AssignmentDto {
  return needsExplicitAssignment(record) ? NOTHING : effectiveOf(record);
}

function itemOf(
  record: ReviewRecord,
  action: DecisionAction,
  assignment: AssignmentDto,
  dupChoice: DupChoice | null,
  note: string | null
): DecisionWriteItem {
  return {
    fileId: record.file.id,
    proposalId: record.proposal?.id ?? null,
    action,
    docType: assignment.docType,
    componentCode: assignment.componentCode,
    enablerCode: assignment.enablerCode,
    quizLevel: assignment.quizLevel,
    dupChoice,
    note,
  };
}

/** The assignment as it is stored: a global quiz has no enabler. */
function normalized(
  a: AssignmentDto,
  file: ReviewRecord['file']
): AssignmentDto {
  const underlying =
    a.docType === 'pdf_original' ? originalTypeOfKey(file.dupKey) : a.docType;
  return underlying === 'global_quiz' ? { ...a, enablerCode: null } : a;
}

class Planner {
  readonly items: DecisionWriteItem[] = [];
  readonly skipped: { fileId: string; code: SkipCode }[] = [];
  private readonly byId: Map<string, ReviewRecord>;

  constructor(
    readonly records: readonly ReviewRecord[],
    readonly context: ReviewContext
  ) {
    this.byId = new Map(records.map(r => [r.file.id, r]));
  }

  record(fileId: string): ReviewRecord | null {
    const record = this.byId.get(fileId);
    if (!record) {
      this.skipped.push({ fileId, code: 'FILE_NOT_FOUND' });
      return null;
    }
    if (!DECIDABLE.includes(record.file.status)) {
      this.skipped.push({ fileId, code: 'FILE_STATE' });
      return null;
    }
    return record;
  }

  /** Accept with `assignment`, if it is complete and on the positive list. */
  accept(
    record: ReviewRecord,
    assignment: AssignmentDto,
    dupChoice: DupChoice | null,
    note: string | null
  ): boolean {
    const check = checkAssignment(
      normalized(assignment, record.file),
      record.file,
      this.context
    );
    if (!check.ok) {
      this.skipped.push({ fileId: record.file.id, code: check.code });
      return false;
    }
    this.items.push(
      itemOf(record, 'accept', check.assignment, dupChoice, note)
    );
    return true;
  }

  /** Reject or defer with the values that counted until now. */
  keepValues(
    record: ReviewRecord,
    action: Exclude<DecisionAction, 'accept'>,
    dupChoice: DupChoice | null,
    note: string | null
  ) {
    this.items.push(
      itemOf(record, action, effectiveOf(record), dupChoice, note)
    );
  }

  plan(extra: Partial<Plan> = {}): Plan {
    return { items: this.items, skipped: this.skipped, ...extra };
  }
}

/** The records as they would be after the planned writes (for the group rule). */
function hypothetical(
  records: readonly ReviewRecord[],
  items: readonly DecisionWriteItem[],
  decidedById: string,
  version: number
): ReviewRecord[] {
  const byFile = new Map(items.map(i => [i.fileId, i]));
  return records.map(record => {
    const item = byFile.get(record.file.id);
    if (!item) return record;
    const decision: DecisionRecord = {
      id: 'hypothetical',
      fileId: item.fileId,
      proposalId: item.proposalId,
      decisionsVersion: version,
      decidedById,
      action: item.action,
      docType: item.docType,
      componentCode: item.componentCode,
      enablerCode: item.enablerCode,
      quizLevel: item.quizLevel,
      dupChoice: item.dupChoice,
      note: item.note,
      decidedAt: new Date(0),
    };
    return { ...record, decision };
  });
}

/**
 * Cuts a plan back so that no group of versions would hold two accepted files:
 * the planned accepts that sit in such a group are dropped.
 */
function enforceGroupRule(
  plan: Plan,
  records: readonly ReviewRecord[],
  context: ReviewContext,
  decidedById: string,
  version: number
): Plan {
  if (!plan.items.some(i => i.action === 'accept')) return plan;
  const after = hypothetical(records, plan.items, decidedById, version);
  const analysis = analyzeRun(after, context);
  const afterById = new Map(after.map(r => [r.file.id, r]));
  const violating = new Set<string>();
  for (const group of analysis.keyGroups) {
    const accepted = group.memberIds.filter(
      id => afterById.get(id)?.decision?.action === 'accept'
    );
    if (accepted.length > 1)
      for (const id of group.memberIds) violating.add(id);
  }
  if (violating.size === 0) return plan;
  const items: DecisionWriteItem[] = [];
  const skipped = [...plan.skipped];
  for (const item of plan.items) {
    if (item.action === 'accept' && violating.has(item.fileId)) {
      skipped.push({ fileId: item.fileId, code: 'DUPLICATE_UNRESOLVED' });
    } else {
      items.push(item);
    }
  }
  return { ...plan, items, skipped };
}

function planSet(
  request: Extract<DecisionRequest['command'], { command: 'set' }>,
  planner: Planner
): Plan {
  for (const input of request.items) {
    const record = planner.record(input.fileId);
    if (!record) continue;
    if (input.action !== 'accept') {
      planner.keepValues(record, input.action, null, input.note);
      continue;
    }
    if (!input.assignment && needsExplicitAssignment(record)) {
      planner.skipped.push({
        fileId: input.fileId,
        code: 'ASSIGNMENT_REQUIRED',
      });
      continue;
    }
    const base = baseOf(record);
    planner.accept(
      record,
      input.assignment ? mergeAssignment(base, input.assignment) : base,
      null,
      input.note
    );
  }
  return planner.plan();
}

function planAcceptHigh(planner: Planner, context: ReviewContext): Plan {
  const duplicates = new Set(
    analyzeRun(planner.records, context).keyGroups.flatMap(g => g.memberIds)
  );
  let eligible = 0;
  for (const record of planner.records) {
    const { file, proposal } = record;
    if (
      file.status !== 'proposed_rules' ||
      !proposal ||
      proposal.band !== 'high' ||
      record.decision !== null ||
      duplicates.has(file.id)
    ) {
      continue;
    }
    eligible += 1;
    planner.accept(record, effectiveOf(record), null, null);
  }
  return planner.plan({ eligible });
}

/**
 * "Accept new and added": the files that the comparison with the database found new or
 * extended (a missing document, missing questions of a quiz) and whose proposal a click
 * may take. What differs from the database or conflicts is never taken here.
 */
function planAcceptStock(planner: Planner, context: ReviewContext): Plan {
  const byId = new Map(planner.records.map(r => [r.file.id, r]));
  let eligible = 0;
  for (const row of buildRows(planner.records, context)) {
    if (!acceptableByStock(row)) continue;
    const record = byId.get(row.id);
    if (!record) continue;
    eligible += 1;
    planner.accept(record, effectiveOf(record), null, null);
  }
  return planner.plan({ eligible });
}

/**
 * "Confirm all with the same reasons": the proposals of the band medium whose reason
 * codes are exactly the group the person looked at. A proposal that needs a person
 * (low, conflict, unchecked content) is never part of it, the assignment of every file
 * is still checked against the positive list.
 */
function planAcceptMedium(
  planner: Planner,
  context: ReviewContext,
  groupKey: string
): Plan {
  const byId = new Map(planner.records.map(r => [r.file.id, r]));
  let eligible = 0;
  for (const row of buildRows(planner.records, context)) {
    if (!acceptableByMedium(row) || mediumGroupKey(row) !== groupKey) continue;
    const record = byId.get(row.id);
    if (!record) continue;
    eligible += 1;
    planner.accept(record, effectiveOf(record), null, null);
  }
  return planner.plan({ eligible });
}

function planDuplicate(
  command: Extract<DecisionRequest['command'], { command: 'duplicate' }>,
  planner: Planner,
  context: ReviewContext
): ServiceResult<Plan> {
  const analysis = analyzeRun(planner.records, context);
  const group = analysis.keyGroups.find(g => g.key === command.key);
  if (!group || group.memberIds.length < 2) {
    return fail(404, 'Duplicate group not found', 'GROUP_NOT_FOUND');
  }
  if (
    command.keepFileId !== null &&
    !group.memberIds.includes(command.keepFileId)
  ) {
    return fail(400, 'The file is not part of the group', 'NOT_A_MEMBER');
  }
  const members = group.memberIds
    .map(id => planner.records.find(r => r.file.id === id))
    .filter((r): r is ReviewRecord => r !== undefined);
  if (command.keepFileId !== null) {
    const keep = members.find(r => r.file.id === command.keepFileId)!;
    if (needsExplicitAssignment(keep)) {
      return fail(
        422,
        'This version has to be assigned first, its proposal is not certain',
        'ASSIGNMENT_REQUIRED'
      );
    }
    const check = checkAssignment(
      normalized(effectiveOf(keep), keep.file),
      keep.file,
      context
    );
    if (!check.ok) {
      return fail(
        422,
        'The assignment of this version is not valid',
        check.code
      );
    }
  }
  for (const record of members) {
    if (!planner.record(record.file.id)) continue;
    if (record.file.id === command.keepFileId) {
      planner.accept(record, effectiveOf(record), 'keep', null);
    } else {
      planner.keepValues(record, 'reject', 'skip', null);
    }
  }
  return ok(planner.plan());
}

function planAcceptNewest(planner: Planner, context: ReviewContext): Plan {
  const analysis = analyzeRun(planner.records, context);
  let eligible = 0;
  let ambiguousGroups = 0;
  for (const group of analysis.keyGroups) {
    const members = group.memberIds
      .map(id => planner.records.find(r => r.file.id === id))
      .filter((r): r is ReviewRecord => r !== undefined);
    if (members.length < 2 || members.some(r => r.decision !== null)) continue;
    if (!group.suggestedId || group.ambiguous) {
      ambiguousGroups += 1;
      continue;
    }
    const keep = members.find(r => r.file.id === group.suggestedId);
    if (!keep) continue;
    if (needsExplicitAssignment(keep)) {
      planner.skipped.push({
        fileId: keep.file.id,
        code: 'ASSIGNMENT_REQUIRED',
      });
      continue;
    }
    const check = checkAssignment(
      normalized(effectiveOf(keep), keep.file),
      keep.file,
      context
    );
    if (!check.ok) {
      planner.skipped.push({ fileId: keep.file.id, code: check.code });
      continue;
    }
    eligible += 1;
    for (const record of members) {
      if (!planner.record(record.file.id)) continue;
      if (record === keep)
        planner.accept(record, effectiveOf(record), 'keep', null);
      else planner.keepValues(record, 'reject', 'skip', null);
    }
  }
  return planner.plan({ eligible, ambiguousGroups });
}

/**
 * Plans and writes a decision request for a run. The caller has checked that
 * the person may work in the run.
 */
export async function writeDecisions(
  deps: { review: ReviewRepo },
  run: RunRow,
  decidedById: string,
  request: DecisionRequest,
  records: readonly ReviewRecord[],
  context: ReviewContext
): Promise<ServiceResult<DecisionOutcome>> {
  if (run.status !== 'review') {
    return fail(
      409,
      `Decisions are written only while the run is in review, not in ${run.status}`,
      'RUN_STATE'
    );
  }
  if (request.expectedVersion !== run.decisionsVersion) {
    return fail(
      409,
      'The decisions of the run changed, reload the list',
      'VERSION_CONFLICT'
    );
  }

  const planner = new Planner(records, context);
  const { command } = request;
  let plan: Plan;
  switch (command.command) {
    case 'set':
      plan = planSet(command, planner);
      break;
    case 'bulk':
      for (const id of command.fileIds) {
        const record = planner.record(id);
        if (record) planner.keepValues(record, command.action, null, null);
      }
      plan = planner.plan();
      break;
    case 'assign':
      for (const id of command.fileIds) {
        const record = planner.record(id);
        if (!record) continue;
        planner.accept(
          record,
          mergeAssignment(baseOf(record), command.assignment),
          null,
          null
        );
      }
      plan = planner.plan();
      break;
    case 'accept_high':
      plan = planAcceptHigh(planner, context);
      break;
    case 'accept_newest':
      plan = planAcceptNewest(planner, context);
      break;
    case 'accept_stock':
      plan = planAcceptStock(planner, context);
      break;
    case 'accept_medium':
      plan = planAcceptMedium(planner, context, command.group);
      break;
    case 'duplicate': {
      const planned = planDuplicate(command, planner, context);
      if (!planned.ok) return planned;
      plan = planned.data;
      break;
    }
  }
  // One accepted version per group, for every command: a group may hold a file that
  // cannot be decided any more (applied earlier) next to the ones that are planned
  plan = enforceGroupRule(
    plan,
    records,
    context,
    decidedById,
    request.expectedVersion
  );

  const outcome = (
    base: Partial<DecisionOutcome> &
      Pick<DecisionOutcome, 'version' | 'written'>,
    skipped: DecisionOutcome['skipped']
  ): DecisionOutcome => ({
    ...base,
    skipped,
    ...(plan.eligible !== undefined ? { eligible: plan.eligible } : {}),
    ...(plan.ambiguousGroups !== undefined
      ? { ambiguousGroups: plan.ambiguousGroups }
      : {}),
  });

  if (plan.items.length === 0) {
    return ok(
      outcome({ version: run.decisionsVersion, written: 0 }, plan.skipped)
    );
  }
  const result = await deps.review.applyDecisions({
    runId: run.id,
    expectedVersion: request.expectedVersion,
    decidedById,
    items: plan.items,
  });
  if (!result.ok) {
    if (result.reason === 'RUN_NOT_FOUND') {
      return fail(404, 'Run not found');
    }
    if (result.reason === 'RUN_STATE') {
      return fail(
        409,
        `Decisions are written only while the run is in review, not in ${result.status}`,
        'RUN_STATE'
      );
    }
    return fail(
      409,
      'The decisions of the run changed, reload the list',
      'VERSION_CONFLICT'
    );
  }
  return ok(
    outcome({ version: result.version, written: result.written }, [
      ...plan.skipped,
      ...result.skipped,
    ])
  );
}
