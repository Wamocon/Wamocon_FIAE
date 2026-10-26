/**
 * Policy for the actions HAI can perform on the platform. Pure functions, no
 * database access, so the pipeline, the action route and the tests share one
 * definition.
 *
 * Rules:
 *  - Only the types on the list below can be executed. Everything else is
 *    rejected (fail closed).
 *  - Every action on the list writes data. A write needs the explicit
 *    confirmation of the person: the pipeline only proposes it
 *    (PendingAction), the confirmed call of /api/hai/action executes it.
 *  - A trainee may only run trainee actions, trainer level (TRAINER, ADMIN,
 *    TEMP_ADMIN, SUPER_ADMIN) only trainer actions. Reading the own
 *    notifications is open to both.
 *  - Parameters are whitelisted per type. Unknown keys are dropped, ids must
 *    be UUIDs, numbers must be integers in a sane range.
 */

import type { ActionType } from './actions';

export type ActionAudience = 'TRAINEE' | 'TRAINER';

const ACTION_AUDIENCE = {
  create_activity_report: 'TRAINEE',
  submit_activity_report: 'TRAINEE',
  complete_enabler: 'TRAINEE',
  submit_quiz: 'TRAINEE',
  mark_notification_read: 'ANY',
  approve_submission: 'TRAINER',
  approve_report: 'TRAINER',
  grade_quiz: 'TRAINER',
} as const satisfies Partial<Record<ActionType, 'TRAINEE' | 'TRAINER' | 'ANY'>>;

/** Action types that can be executed. All of them write data. */
export type WriteActionType = keyof typeof ACTION_AUDIENCE;

export const WRITE_ACTION_TYPES = Object.keys(
  ACTION_AUDIENCE
) as WriteActionType[];

export function isWriteAction(type: unknown): type is WriteActionType {
  return (
    typeof type === 'string' &&
    Object.prototype.hasOwnProperty.call(ACTION_AUDIENCE, type)
  );
}

/** Whether a role may run the action type. */
export function isActionAllowedForRole(
  type: WriteActionType,
  role: ActionAudience
): boolean {
  const audience = ACTION_AUDIENCE[type];
  return audience === 'ANY' || audience === role;
}

/** The action types a role may run, in the order of the list. */
export function actionsForRole(role: ActionAudience): WriteActionType[] {
  return WRITE_ACTION_TYPES.filter(type => isActionAllowedForRole(type, role));
}

/** What the pipeline hands to the client: a proposal, nothing is executed. */
export interface PendingAction {
  type: WriteActionType;
  parameters: Record<string, unknown>;
  /** Readable description of what happens on confirmation (German). */
  description: string;
}

// ============================================================================
// PARAMETERS
// ============================================================================

export type SanitizeResult =
  | { ok: true; parameters: Record<string, unknown> }
  | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uuidOf(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

function intIn(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : null;
}

type Reader = (raw: Record<string, unknown>) => SanitizeResult;

const invalid = (message: string): SanitizeResult => ({ ok: false, message });
const valid = (parameters: Record<string, unknown>): SanitizeResult => ({
  ok: true,
  parameters,
});

/** weekNumber and year are optional, but must be sane when present. */
function readWeek(raw: Record<string, unknown>): SanitizeResult {
  const parameters: Record<string, unknown> = {};
  if (raw.weekNumber !== undefined) {
    const weekNumber = intIn(raw.weekNumber, 1, 53);
    if (weekNumber === null) return invalid('Ungültige Kalenderwoche.');
    parameters.weekNumber = weekNumber;
  }
  if (raw.year !== undefined) {
    const year = intIn(raw.year, 2000, 2100);
    if (year === null) return invalid('Ungültiges Jahr.');
    parameters.year = year;
  }
  return valid(parameters);
}

function requireId(
  key: string,
  message: string,
  extra?: (raw: Record<string, unknown>) => SanitizeResult
): Reader {
  return raw => {
    if (raw[key] === undefined || raw[key] === null || raw[key] === '') {
      return invalid(message);
    }
    const id = uuidOf(raw[key]);
    if (!id) return invalid('Ungültige Kennung.');
    const rest = extra ? extra(raw) : valid({});
    if (!rest.ok) return rest;
    return valid({ [key]: id, ...rest.parameters });
  };
}

const READERS: Record<WriteActionType, Reader> = {
  create_activity_report: readWeek,

  submit_activity_report: raw => {
    const week = readWeek(raw);
    if (!week.ok) return week;
    if (raw.reportId === undefined) return week;
    const reportId = uuidOf(raw.reportId);
    if (!reportId) return invalid('Ungültige Kennung.');
    return valid({ ...week.parameters, reportId });
  },

  complete_enabler: requireId(
    'enablerId',
    'Keine Enabler-ID angegeben. Bitte öffne den Enabler, den du abschließen möchtest.'
  ),

  submit_quiz: requireId(
    'quizId',
    'Keine Quiz-ID angegeben. Bitte reiche das Quiz über die Quiz-Seite ein.',
    raw => {
      const answers = raw.answers;
      if (!Array.isArray(answers) || answers.length === 0) {
        return invalid(
          'Keine Antworten angegeben. Bitte reiche das Quiz über die Quiz-Seite ein.'
        );
      }
      if (answers.length > 500) return invalid('Zu viele Antworten.');
      return valid({ answers });
    }
  ),

  mark_notification_read: raw => {
    if (raw.markAll === true) return valid({ markAll: true });
    if (raw.notificationId !== undefined) {
      const notificationId = uuidOf(raw.notificationId);
      if (!notificationId) return invalid('Ungültige Kennung.');
      return valid({ notificationId });
    }
    return invalid(
      'Bitte gib an, welche Benachrichtigung(en) markiert werden sollen.'
    );
  },

  approve_submission: requireId(
    'submissionId',
    'Keine Submission-ID angegeben. Bitte öffne die Abgabe in der Prüfliste.'
  ),

  approve_report: requireId(
    'reportId',
    'Keine Report-ID angegeben. Bitte öffne den Nachweis in der Prüfliste.'
  ),

  grade_quiz: requireId(
    'submissionId',
    'Keine Quiz-Abgabe angegeben. Bitte öffne die Abgabe in der Prüfliste.',
    raw => {
      const score = intIn(raw.score, 0, 100);
      if (score === null) {
        return invalid(
          'Die Bewertung muss eine ganze Zahl von 0 bis 100 sein.'
        );
      }
      return valid({ score });
    }
  ),
};

/**
 * Whitelist the parameters of an action. Returns the clean parameters, or the
 * German reason why the action cannot run (missing or invalid value).
 */
export function sanitizeActionParameters(
  type: WriteActionType,
  raw: unknown
): SanitizeResult {
  if (raw !== undefined && raw !== null && !isPlainObject(raw)) {
    return invalid('Ungültige Parameter.');
  }
  return READERS[type](isPlainObject(raw) ? raw : {});
}

// ============================================================================
// DESCRIPTION
// ============================================================================

function cleanTitle(title: string): string {
  // eslint-disable-next-line no-control-regex
  return title
    .replace(/[\u0000-\u001f"`*_]/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * Readable German description of an action for the confirmation card. Built
 * from the clean parameters, never from free text of the model.
 */
export function describeAction(
  type: WriteActionType,
  parameters: Record<string, unknown>,
  hints: { enablerTitle?: string } = {}
): string {
  const week = parameters.weekNumber
    ? `KW ${parameters.weekNumber}${parameters.year ? `/${parameters.year}` : ''}`
    : null;
  switch (type) {
    case 'create_activity_report':
      return week
        ? `Tätigkeitsnachweis für ${week} als Entwurf anlegen`
        : 'Tätigkeitsnachweis für die aktuelle Woche als Entwurf anlegen';
    case 'submit_activity_report':
      return week
        ? `Tätigkeitsnachweis für ${week} zur Prüfung einreichen`
        : 'Den neuesten Entwurf des Tätigkeitsnachweises zur Prüfung einreichen';
    case 'complete_enabler': {
      const title = hints.enablerTitle ? cleanTitle(hints.enablerTitle) : '';
      return title
        ? `Enabler "${title}" als abgeschlossen markieren`
        : 'Den aktuellen Enabler als abgeschlossen markieren';
    }
    case 'submit_quiz':
      return 'Quiz einreichen';
    case 'mark_notification_read':
      return parameters.markAll
        ? 'Alle Benachrichtigungen als gelesen markieren'
        : 'Benachrichtigung als gelesen markieren';
    case 'approve_submission':
      return 'Abgabe des Auszubildenden genehmigen';
    case 'approve_report':
      return 'Tätigkeitsnachweis genehmigen';
    case 'grade_quiz':
      return `Quiz-Abgabe mit ${parameters.score} % bewerten`;
  }
}
