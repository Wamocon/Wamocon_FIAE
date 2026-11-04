/**
 * The event `uiAction` of the HAI (pure, no server imports): what the chat
 * answer carries so that the browser can fill a form, set the focus or scroll.
 *
 * The server builds it from a checked proposal of the model (validate.ts), the
 * browser reads it with `toUiActionEvent`, which checks the shape, the register
 * and every value once more. The event is a display of an intent, it carries no
 * authority: the executor in the browser only sets values in the form of the
 * current page, it never clicks, never sends and never writes to the database.
 *
 * Fields are listed as `{ id, value }`, never as an object, so a hostile key
 * (`__proto__`) cannot do anything.
 *
 * @module lib/hai/uiActions/event
 */

import {
  MAX_ENTRY,
  MAX_FIELDS_PER_CALL,
  getUiField,
  getUiForm,
  type UiFormDef,
} from './registry';
import { cleanFieldValue } from './values';

export type UiToolName = 'fill_form' | 'focus_field' | 'scroll_to';

export const UI_TOOL_NAMES: readonly UiToolName[] = Object.freeze([
  'fill_form',
  'focus_field',
  'scroll_to',
]);

export interface UiActionField {
  id: string;
  value: string;
}

export interface UiActionEvent {
  tool: UiToolName;
  /** Id of the form in the register. */
  form: string;
  /** Position (from 1) of the form on the page when it occurs several times. */
  entry?: number;
  /** fill_form: the fields with their cleaned values. */
  fields?: UiActionField[];
  /** focus_field (required) and scroll_to (optional). */
  field?: string;
  /**
   * apply: the browser carries it out. confirm: the browser only shows what
   * would be entered and waits for the person (spoken turns).
   */
  mode: 'apply' | 'confirm';
}

export function isUiToolName(value: unknown): value is UiToolName {
  return (
    typeof value === 'string' &&
    (UI_TOOL_NAMES as readonly string[]).includes(value)
  );
}

/** A plain object (no array, no null). */
export function isPlainRecord(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The entry number, or undefined when absent, or null when it is invalid. */
export function readEntry(
  form: UiFormDef,
  raw: unknown
): number | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (!form.repeatable) return null;
  if (
    typeof raw !== 'number' ||
    !Number.isInteger(raw) ||
    raw < 1 ||
    raw > MAX_ENTRY
  ) {
    return null;
  }
  return raw;
}

/**
 * The event as the browser reads it from the answer of the server (untrusted),
 * or undefined when anything is off: shape, tool, form, entry, field, value.
 * Only the known members are taken over.
 */
export function toUiActionEvent(raw: unknown): UiActionEvent | undefined {
  if (!isPlainRecord(raw)) return undefined;
  if (!isUiToolName(raw.tool)) return undefined;
  const form = getUiForm(raw.form);
  if (!form) return undefined;
  const entry = readEntry(form, raw.entry);
  if (entry === null) return undefined;
  const mode = raw.mode === 'confirm' ? 'confirm' : 'apply';

  if (raw.tool === 'fill_form') {
    if (!Array.isArray(raw.fields)) return undefined;
    if (raw.fields.length === 0 || raw.fields.length > MAX_FIELDS_PER_CALL) {
      return undefined;
    }
    const seen = new Set<string>();
    const fields: UiActionField[] = [];
    for (const item of raw.fields) {
      if (!isPlainRecord(item)) return undefined;
      const field = getUiField(form, item.id);
      if (!field || seen.has(field.id)) return undefined;
      const value = cleanFieldValue(field, item.value);
      if (!value.ok) return undefined;
      seen.add(field.id);
      fields.push({ id: field.id, value: value.value });
    }
    return {
      tool: 'fill_form',
      form: form.id,
      ...(entry !== undefined ? { entry } : {}),
      fields,
      mode,
    };
  }

  // focus_field and scroll_to never carry values and never wait
  const field =
    raw.field === undefined ? undefined : getUiField(form, raw.field);
  if (raw.field !== undefined && !field) return undefined;
  if (raw.tool === 'focus_field' && !field) return undefined;
  return {
    tool: raw.tool,
    form: form.id,
    ...(entry !== undefined ? { entry } : {}),
    ...(field ? { field: field.id } : {}),
    mode: 'apply',
  };
}

/**
 * What is stored with the message: identifiers only (tool, form, field ids),
 * never a value. Values can be personal content.
 */
export function uiActionMeta(event: UiActionEvent): {
  tool: UiToolName;
  form: string;
  fieldIds: string[];
  mode: UiActionEvent['mode'];
} {
  return {
    tool: event.tool,
    form: event.form,
    fieldIds: event.fields
      ? event.fields.map(f => f.id)
      : event.field
        ? [event.field]
        : [],
    mode: event.mode,
  };
}
