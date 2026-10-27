// What a person may assign to a file and how the body of a decision request is
// read (docs/ki-upload-konzept.md 7.2: "alle Auswahlwerte kommen aus der
// Positivliste, eine freie Eingabe von Codes gibt es nicht"). Pure functions.
//
// An assignment is accepted only when it is complete and every code stands on the
// positive list: the component, the enabler of that component, a level for a quiz
// and no level for anything else. Solution parts are not a thing of this module:
// the review knows the type and the assignment of a file and nothing of its text.

import type { Decisions } from '@/lib/content-import/apply/types';
import { contentKeyOf } from '@/lib/content-upload/classify/assign';
import { deriveComponentFacts } from '@/lib/content-upload/classify/derive';
import type { PositiveList } from '@/lib/content-upload/classify/positive-list';
import type {
  QuizLevelCode,
  UploadDocType,
} from '@/lib/content-upload/classify/types';
import { originalTypeOfKey } from '@/lib/content-upload/review/build';
import {
  ASSIGNABLE_DOC_TYPES,
  DECISION_ACTIONS,
  QUIZ_LEVELS,
  type AssignmentDto,
  type DecisionAction,
} from '@/lib/content-upload/review/types';
import {
  fail,
  ok,
  type ServiceResult,
} from '@/lib/content-upload/staging/result';
import { LIMITS } from '@/lib/content-upload/staging/config';
import { isUuid } from '@/lib/uuid';

export type AssignmentFailureCode =
  | 'ASSIGNMENT_INCOMPLETE'
  | 'ASSIGNMENT_INVALID'
  | 'NOT_IN_POSITIVE_LIST'
  | 'TYPE_EXT_MISMATCH'
  | 'LEVEL_INVALID'
  | 'COMPONENT_EXCLUDED'
  | 'KIND_GROUP_MISMATCH'
  | 'NO_DECISION';

export type AssignmentCheck =
  | { ok: true; key: string; assignment: AssignmentDto }
  | { ok: false; code: AssignmentFailureCode };

export interface CheckContext {
  list: PositiveList;
  decisions: Decisions;
}

const CODE_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;
export const MAX_NOTE_CHARS = 500;
/** Items of one request (the run has at most 1500 files). */
export const MAX_ITEMS = LIMITS.maxFilesPerRun;

/**
 * Checks the assignment of a file against the positive list. `file` is what the
 * review knows of the file: its extension (a PDF is an original, a Word file is
 * one of the other types) and the content key the rule stage made (for the type a
 * PDF original belongs to).
 */
export function checkAssignment(
  a: AssignmentDto,
  file: { ext: string; dupKey: string | null },
  context: CheckContext
): AssignmentCheck {
  const bad = (code: AssignmentFailureCode): AssignmentCheck => ({
    ok: false,
    code,
  });
  const type = a.docType as UploadDocType | null;
  if (!type || !ASSIGNABLE_DOC_TYPES.includes(type)) {
    return bad('ASSIGNMENT_INCOMPLETE');
  }
  if ((type === 'pdf_original') !== (file.ext === 'pdf')) {
    return bad('TYPE_EXT_MISMATCH');
  }
  const underlying =
    type === 'pdf_original' ? originalTypeOfKey(file.dupKey) : type;
  if (!underlying) return bad('ASSIGNMENT_INCOMPLETE');

  if (!a.componentCode) return bad('ASSIGNMENT_INCOMPLETE');
  const component = context.list.component(a.componentCode);
  if (!component) return bad('NOT_IN_POSITIVE_LIST');

  let enablerCode: string | null = null;
  if (underlying === 'global_quiz') {
    if (a.enablerCode) return bad('ASSIGNMENT_INVALID');
  } else {
    if (!a.enablerCode) return bad('ASSIGNMENT_INCOMPLETE');
    const enabler = context.list.enabler(a.enablerCode);
    if (!enabler || enabler.componentCode !== component.code) {
      return bad('NOT_IN_POSITIVE_LIST');
    }
    // the code as the list writes it: the lookup does not mind the case
    enablerCode = enabler.code;
  }
  if (underlying === 'quiz') {
    if (!a.quizLevel || !QUIZ_LEVELS.includes(a.quizLevel as QuizLevelCode)) {
      return bad('LEVEL_INVALID');
    }
  } else if (a.quizLevel) {
    return bad('LEVEL_INVALID');
  }

  const facts = deriveComponentFacts(
    context.decisions,
    component.code,
    component.group
  );
  if (facts.excluded) return bad('COMPONENT_EXCLUDED');
  if (facts.issues.includes('KIND_GROUP_MISMATCH')) {
    return bad('KIND_GROUP_MISMATCH');
  }
  if (facts.issues.includes('NO_DECISION')) return bad('NO_DECISION');

  const key = contentKeyOf({
    docType: type,
    componentCode: component.code,
    enablerCode,
    quizLevel: a.quizLevel as QuizLevelCode | null,
    originalType: type === 'pdf_original' ? underlying : null,
  });
  if (!key) return bad('ASSIGNMENT_INCOMPLETE');
  // What is stored is what was checked, in the spelling of the positive list
  return {
    ok: true,
    key,
    assignment: {
      docType: type,
      componentCode: component.code,
      enablerCode,
      quizLevel: underlying === 'quiz' ? a.quizLevel : null,
    },
  };
}

// ---------------------------------------------------------------------------
// The body of POST .../decisions
// ---------------------------------------------------------------------------

/**
 * The fields a person changes when they correct an assignment. A field that is
 * left out (undefined) stays as it is, null clears it.
 */
export interface AssignmentInput {
  docType?: string | null;
  componentCode?: string | null;
  enablerCode?: string | null;
  quizLevel?: string | null;
}

export interface SetItemInput {
  fileId: string;
  action: DecisionAction;
  /** Only with `accept`: the corrected assignment. Without it the proposal counts. */
  assignment: AssignmentInput | null;
  note: string | null;
}

export type DecisionCommandInput =
  | { command: 'set'; items: SetItemInput[] }
  | { command: 'accept_high' }
  | { command: 'accept_stock' }
  | { command: 'accept_medium'; group: string }
  | {
      command: 'bulk';
      action: Exclude<DecisionAction, 'accept'>;
      fileIds: string[];
    }
  | { command: 'assign'; fileIds: string[]; assignment: AssignmentInput }
  | { command: 'duplicate'; key: string; keepFileId: string | null }
  | { command: 'accept_newest' };

export interface DecisionRequest {
  expectedVersion: number;
  command: DecisionCommandInput;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const FIELDS = [
  'docType',
  'componentCode',
  'enablerCode',
  'quizLevel',
] as const;

/**
 * A change of an assignment: a field that is left out stays as it is, a field
 * that is null is cleared, a text is a code that has to match the pattern (the
 * positive list decides later whether it exists). Null for anything else.
 */
function parseAssignment(value: unknown): AssignmentInput | null {
  if (!isRecord(value)) return null;
  const out: AssignmentInput = {};
  let any = false;
  for (const field of FIELDS) {
    const v = value[field];
    if (v === undefined) continue;
    if (v !== null && (typeof v !== 'string' || !CODE_PATTERN.test(v))) {
      return null;
    }
    out[field] = v;
    any = true;
  }
  return any ? out : null;
}

/** The assignment after a change: left out fields keep their value. */
export function mergeAssignment(
  base: AssignmentDto,
  change: AssignmentInput
): AssignmentDto {
  return {
    docType: change.docType === undefined ? base.docType : change.docType,
    componentCode:
      change.componentCode === undefined
        ? base.componentCode
        : change.componentCode,
    enablerCode:
      change.enablerCode === undefined ? base.enablerCode : change.enablerCode,
    quizLevel:
      change.quizLevel === undefined ? base.quizLevel : change.quizLevel,
  };
}

function parseIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ITEMS) {
    return null;
  }
  const ids: string[] = [];
  for (const id of value) {
    if (!isUuid(id)) return null;
    ids.push(id);
  }
  return [...new Set(ids)];
}

function parseNote(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim();
  return cleaned.length === 0 ? null : cleaned.slice(0, MAX_NOTE_CHARS);
}

const invalid = (error: string) => fail(400, error, 'BODY_INVALID');

export function parseDecisionRequest(
  body: unknown
): ServiceResult<DecisionRequest> {
  if (!isRecord(body)) return invalid('The request body must be an object');
  const version = body.expectedVersion;
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 0
  ) {
    return invalid('expectedVersion must be a whole number of zero or more');
  }
  const done = (command: DecisionCommandInput) =>
    ok({ expectedVersion: version, command });

  switch (body.command) {
    case 'accept_high':
      return done({ command: 'accept_high' });
    case 'accept_newest':
      return done({ command: 'accept_newest' });
    case 'accept_stock':
      return done({ command: 'accept_stock' });
    case 'accept_medium':
      if (
        typeof body.group !== 'string' ||
        !/^[A-Z0-9_]+(\+[A-Z0-9_]+)*$/.test(body.group) ||
        body.group.length > 200
      ) {
        return invalid('group must be the reason codes of a group');
      }
      return done({ command: 'accept_medium', group: body.group });
    case 'set': {
      const raw = body.items;
      if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_ITEMS) {
        return invalid(`items must be a list of 1 to ${MAX_ITEMS} entries`);
      }
      const items: SetItemInput[] = [];
      const seen = new Set<string>();
      for (const entry of raw) {
        if (!isRecord(entry) || !isUuid(entry.fileId)) {
          return invalid('Every item needs a fileId');
        }
        if (seen.has(entry.fileId)) return invalid('A fileId appears twice');
        seen.add(entry.fileId);
        if (
          typeof entry.action !== 'string' ||
          !(DECISION_ACTIONS as readonly string[]).includes(entry.action)
        ) {
          return invalid('action must be accept, reject or defer');
        }
        const note = parseNote(entry.note);
        if (note === undefined) return invalid('note must be text');
        let assignment: AssignmentInput | null = null;
        if (entry.assignment !== undefined && entry.assignment !== null) {
          if (entry.action !== 'accept') {
            return invalid('An assignment goes with the action accept only');
          }
          assignment = parseAssignment(entry.assignment);
          if (!assignment) return invalid('The assignment is not valid');
        }
        items.push({
          fileId: entry.fileId,
          action: entry.action as DecisionAction,
          assignment,
          note,
        });
      }
      return done({ command: 'set', items });
    }
    case 'bulk': {
      if (body.action !== 'reject' && body.action !== 'defer') {
        return invalid('action must be reject or defer');
      }
      const fileIds = parseIds(body.fileIds);
      if (!fileIds) return invalid('fileIds must be a list of file ids');
      return done({ command: 'bulk', action: body.action, fileIds });
    }
    case 'assign': {
      const fileIds = parseIds(body.fileIds);
      if (!fileIds) return invalid('fileIds must be a list of file ids');
      const assignment = parseAssignment(body.assignment);
      if (!assignment) return invalid('The assignment is not valid');
      return done({ command: 'assign', fileIds, assignment });
    }
    case 'duplicate': {
      if (
        typeof body.key !== 'string' ||
        body.key.length < 1 ||
        body.key.length > 100 ||
        !/^[a-z0-9:._-]+$/i.test(body.key)
      ) {
        return invalid('key must be a content key');
      }
      let keepFileId: string | null = null;
      if (body.keepFileId !== undefined && body.keepFileId !== null) {
        if (!isUuid(body.keepFileId)) {
          return invalid('keepFileId must be a file id or empty');
        }
        keepFileId = body.keepFileId;
      }
      return done({ command: 'duplicate', key: body.key, keepFileId });
    }
    default:
      return invalid('Unknown command');
  }
}
