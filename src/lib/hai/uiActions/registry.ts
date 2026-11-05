/**
 * Allow list of the forms the HAI may fill (pure, no server imports, shared by
 * the server and the browser).
 *
 * The register is an ALLOW LIST: what is not in it is forbidden (fail closed).
 * The model never chooses a path or a form on its own, the platform checks every
 * proposal against this register, the role and the current page.
 *
 * Never in the register (docs/hai-ui-aktionen.md, section 7): answers to quiz
 * questions, scenario and use case submissions, exam input, model solutions,
 * passwords and credentials, e-mail address, roles and rights, payment data,
 * anything the solution protection or the persona gate cover, fields of other
 * people. `isExcludedField` backs that up, and a test checks the register
 * against it.
 *
 * @module lib/hai/uiActions/registry
 */

import type { PageKind } from '../pageContext/shared';

export type UiRole = 'TRAINEE' | 'TRAINER';

export type UiFieldType = 'text' | 'textarea' | 'number' | 'select';

export interface UiFieldDef {
  /** Stable id, the value of data-hai-field in the page. */
  id: string;
  /** German label (prompt and bar). */
  label: string;
  type: UiFieldType;
  /** text and textarea: shortest and longest value in characters. */
  minLength?: number;
  maxLength?: number;
  /** number: range and step. */
  min?: number;
  max?: number;
  step?: number;
  /** select: the allowed values. */
  options?: readonly string[];
  /**
   * The value is personal content (text of a report, a name, feedback): never
   * stored, never logged, shown in the bar only by its label.
   */
  sensitive: boolean;
}

export interface UiFormDef {
  /** Stable id, the value of data-hai-form in the page. */
  id: string;
  /** German label. */
  label: string;
  /** The fixed routes (no placeholders) where the form exists. */
  paths: readonly string[];
  /** Who may have it filled. The area of the path must fit the role. */
  roles: readonly UiRole[];
  /** The form can occur several times on the page: `entry` picks one. */
  repeatable?: boolean;
  fields: readonly UiFieldDef[];
}

/** Page kinds that may hold a form of the register (never quiz, enabler, ...). */
export const ALLOWED_FORM_PAGE_KINDS: readonly PageKind[] = Object.freeze([
  'reports',
  'profile',
  'trainer_trainees',
  'trainer_reviews',
]);

/** Most fields of one call, and of one form. */
export const MAX_FIELDS_PER_CALL = 10;
/** Highest `entry` number. */
export const MAX_ENTRY = 20;

export const UI_FORMS: readonly UiFormDef[] = Object.freeze([
  {
    id: 'activity_report_entry',
    label: 'Eintrag im Ausbildungsnachweis',
    paths: ['/trainee/activity-reports'],
    roles: ['TRAINEE'],
    repeatable: true,
    fields: [
      {
        id: 'notes',
        label: 'Beschreibung der Tätigkeit',
        type: 'textarea',
        minLength: 1,
        maxLength: 1500,
        sensitive: true,
      },
      {
        id: 'hours',
        label: 'Tatsächliche Stunden',
        type: 'number',
        min: 0.5,
        max: 40,
        step: 0.5,
        sensitive: false,
      },
    ],
  },
  {
    id: 'profile_name',
    label: 'Anzeigename im Profil',
    paths: ['/trainee/profile', '/trainer/profile'],
    roles: ['TRAINEE', 'TRAINER'],
    fields: [
      {
        id: 'fullName',
        label: 'Name',
        type: 'text',
        minLength: 2,
        maxLength: 100,
        sensitive: true,
      },
    ],
  },
  {
    id: 'review_feedback',
    label: 'Feedback-Text zu einer Abgabe im Review',
    paths: ['/trainer/reviews'],
    roles: ['TRAINER'],
    repeatable: true,
    fields: [
      {
        id: 'feedback',
        label: 'Feedback',
        type: 'textarea',
        minLength: 1,
        maxLength: 2000,
        sensitive: true,
      },
    ],
  },
  {
    id: 'trainees_search',
    label: 'Suchfeld der Azubi-Liste',
    paths: ['/trainer/trainees'],
    roles: ['TRAINER'],
    fields: [
      {
        id: 'query',
        label: 'Suche',
        type: 'text',
        minLength: 0,
        maxLength: 100,
        sensitive: false,
      },
    ],
  },
  {
    id: 'reviews_search',
    label: 'Suchfeld der Prüfungen',
    paths: ['/trainer/reviews'],
    roles: ['TRAINER'],
    fields: [
      {
        id: 'query',
        label: 'Suche',
        type: 'text',
        minLength: 0,
        maxLength: 100,
        sensitive: false,
      },
    ],
  },
  {
    id: 'reviews_filter',
    label: 'Statusfilter der Prüfungen',
    paths: ['/trainer/reviews'],
    roles: ['TRAINER'],
    fields: [
      {
        id: 'status',
        label: 'Status',
        type: 'select',
        options: ['all', 'pending', 'approved', 'rejected'],
        sensitive: false,
      },
    ],
  },
]);

/**
 * Words in an id that make a field or form forbidden, whatever the register
 * says. Checked on the lower case id.
 */
const EXCLUDED_ID_PARTS: readonly string[] = [
  'answer',
  'antwort',
  'solution',
  'loesung',
  'lösung',
  'password',
  'passwort',
  'passwd',
  'credential',
  'secret',
  'token',
  'email',
  'mail',
  'role',
  'rolle',
  'permission',
  'recht',
  'payment',
  'zahlung',
  'iban',
  'card',
  'kredit',
  'bank',
  'exam',
  'pruefung',
  'prüfung',
  'klausur',
  'quiz',
  'scenario',
  'szenario',
  'usecase',
  'use_case',
  'submission',
  'abgabe',
  'delete',
  'loesch',
  'submit',
];

/** True for an id (field or form) that may never be filled. */
export function isExcludedField(id: unknown): boolean {
  if (typeof id !== 'string' || id === '') return true;
  const lower = id.toLowerCase();
  return EXCLUDED_ID_PARTS.some(part => lower.includes(part));
}

/** The form of the register, or undefined (also for an excluded id). */
export function getUiForm(id: unknown): UiFormDef | undefined {
  if (typeof id !== 'string' || isExcludedField(id)) return undefined;
  return UI_FORMS.find(form => form.id === id);
}

export function getUiField(
  form: UiFormDef,
  id: unknown
): UiFieldDef | undefined {
  if (typeof id !== 'string' || isExcludedField(id)) return undefined;
  return form.fields.find(field => field.id === id);
}

/** The path without query, hash and a trailing slash. */
export function normalizeUiPath(path: unknown): string {
  if (typeof path !== 'string') return '';
  const clean = path.split('?')[0].split('#')[0];
  return clean.length > 1 ? clean.replace(/\/+$/, '') : clean;
}

/** The area of a path: the part the role has to fit. */
export function areaOfPath(path: string): UiRole | null {
  if (path === '/trainee' || path.startsWith('/trainee/')) return 'TRAINEE';
  if (path === '/trainer' || path.startsWith('/trainer/')) return 'TRAINER';
  return null;
}

/** Whether the form exists on this page (exact route). */
export function formIsOnPath(form: UiFormDef, path: unknown): boolean {
  return form.paths.includes(normalizeUiPath(path));
}

/** Whether the form may be used by the role on this path (area and role). */
export function formAllowedFor(
  form: UiFormDef,
  role: UiRole,
  path: unknown
): boolean {
  const normalized = normalizeUiPath(path);
  if (!form.paths.includes(normalized)) return false;
  if (!form.roles.includes(role)) return false;
  // the area of the path must be the one of the role
  return areaOfPath(normalized) === role;
}

/** The forms the role may use on this page, in register order. */
export function formsForPage(role: UiRole, path: unknown): UiFormDef[] {
  return UI_FORMS.filter(form => formAllowedFor(form, role, path));
}
