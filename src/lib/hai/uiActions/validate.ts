/**
 * The server checks every proposal of the model (pure, no database): the model
 * decides nothing. A proposal passes only when ALL of this holds:
 *
 *  1. the switch HAI_UI_ACTIONS is on
 *  2. the role comes from the server (database), the page from the checked page
 *     context
 *  3. the message of the person itself asked for an input (intent.ts)
 *  4. the tool is one of the list, the form is in the register and on exactly
 *     this page, the role may use it and the area of the path fits the role
 *  5. every field is in the register for the form, none is excluded, every value
 *     is clean and within its limits (values.ts)
 *  6. at most one form and at most 10 fields
 *
 * All or nothing: one bad field drops the whole proposal. The reason is a code
 * for the log and the tests, never a text for the person.
 *
 * @module lib/hai/uiActions/validate
 */

import {
  isPlainRecord,
  isUiToolName,
  readEntry,
  type UiActionEvent,
  type UiActionField,
} from './event';
import type { UiIntent } from './intent';
import {
  MAX_FIELDS_PER_CALL,
  formAllowedFor,
  getUiField,
  getUiForm,
  isExcludedField,
  normalizeUiPath,
  UI_FORMS,
  type UiRole,
} from './registry';
import { cleanFieldValue } from './values';

export type UiRejectReason =
  | 'switch_off'
  | 'no_role'
  | 'no_page'
  | 'no_intent'
  | 'bad_shape'
  | 'unknown_tool'
  | 'excluded'
  | 'unknown_form'
  | 'wrong_page'
  | 'wrong_role'
  | 'bad_entry'
  | 'no_fields'
  | 'too_many_fields'
  | 'unknown_field'
  | 'bad_value'
  | 'rate_limited';

export interface UiValidationContext {
  enabled: boolean;
  /** From the database (access.audience), never from the message. */
  role: UiRole | null;
  /** The path of the checked page context, or null. */
  pagePath: string | null;
  /** From the message of the person. */
  intent: UiIntent;
  /** The turn was spoken: values are only shown, never put in. */
  voice: boolean;
}

export type UiValidation =
  | { ok: true; event: UiActionEvent }
  | { ok: false; reason: UiRejectReason };

const fail = (reason: UiRejectReason): UiValidation => ({ ok: false, reason });

/** Check a form tool (fill_form, focus_field, scroll_to) of the model. */
export function validateFormTool(
  proposal: Record<string, unknown>,
  ctx: UiValidationContext
): UiValidation {
  if (!ctx.enabled) return fail('switch_off');
  if (!ctx.role) return fail('no_role');
  if (!ctx.pagePath) return fail('no_page');
  if (!ctx.intent.fill) return fail('no_intent');
  if (!isUiToolName(proposal.tool)) return fail('unknown_tool');

  // the form: excluded ids first, so the reason is the right one
  if (typeof proposal.form !== 'string') return fail('bad_shape');
  if (isExcludedField(proposal.form)) return fail('excluded');
  const form = getUiForm(proposal.form);
  if (!form) return fail('unknown_form');
  if (!formAllowedFor(form, ctx.role, ctx.pagePath)) {
    // the page decides first: another page is "wrong page", the right page
    // with another role is "wrong role"
    return form.paths.includes(normalizeUiPath(ctx.pagePath))
      ? fail('wrong_role')
      : fail('wrong_page');
  }

  const entry = readEntry(form, proposal.entry);
  if (entry === null) return fail('bad_entry');
  const entryPart = entry !== undefined ? { entry } : {};

  if (proposal.tool === 'fill_form') {
    if (!isPlainRecord(proposal.fields)) return fail('bad_shape');
    // own keys only, in the order given
    const keys = Object.keys(proposal.fields);
    if (keys.length === 0) return fail('no_fields');
    if (keys.length > MAX_FIELDS_PER_CALL) return fail('too_many_fields');
    const fields: UiActionField[] = [];
    for (const key of keys) {
      if (isExcludedField(key)) return fail('excluded');
      const field = getUiField(form, key);
      if (!field) return fail('unknown_field');
      const value = cleanFieldValue(field, proposal.fields[key]);
      if (!value.ok) return fail('bad_value');
      fields.push({ id: field.id, value: value.value });
    }
    return {
      ok: true,
      event: {
        tool: 'fill_form',
        form: form.id,
        ...entryPart,
        fields,
        // a spoken turn only shows the values, the person confirms in the text
        mode: ctx.voice ? 'confirm' : 'apply',
      },
    };
  }

  // focus_field and scroll_to: no values
  let fieldId: string | undefined;
  if (proposal.field !== undefined) {
    if (typeof proposal.field !== 'string') return fail('bad_shape');
    if (isExcludedField(proposal.field)) return fail('excluded');
    const field = getUiField(form, proposal.field);
    if (!field) return fail('unknown_field');
    fieldId = field.id;
  }
  if (proposal.tool === 'focus_field' && !fieldId) return fail('no_fields');
  return {
    ok: true,
    event: {
      tool: proposal.tool,
      form: form.id,
      ...entryPart,
      ...(fieldId ? { field: fieldId } : {}),
      mode: 'apply',
    },
  };
}

