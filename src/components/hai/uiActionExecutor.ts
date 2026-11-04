/**
 * The executor of the UI tools of the HAI in the browser (no React, only the
 * DOM and a tiny store for the bar).
 *
 * What it does: finds the form of the register by `data-hai-form`, the fields by
 * `data-hai-field`, and sets the values in React's controlled fields (native
 * setter, then `input` and `change`, so React sees the change). Changed fields
 * are marked (`data-hai-filled`), the old values are kept for "Rückgängig".
 *
 * What it never does: click, submit, send, write to a server. This file has no
 * click call, no submit call and no network call (a test holds that). The
 * person saves the form themselves.
 *
 * It checks again what the server checked (register, values, the page right
 * now) and skips: everything under `data-hai-ignore`, disabled and read only
 * fields, password, e-mail, file, hidden and the like, fields without a matching
 * `data-hai-field`. A form that occurs several times needs an `entry` number.
 *
 * @module components/hai/uiActionExecutor
 */

import {
  formIsOnPath,
  getUiField,
  getUiForm,
  isExcludedField,
  type UiFieldDef,
  type UiFormDef,
} from '@/lib/hai/uiActions/registry';
import { toUiActionEvent, type UiActionEvent } from '@/lib/hai/uiActions/event';

/** Marks a field the HAI filled (a global rule in globals.css draws the outline). */
export const FILLED_ATTRIBUTE = 'data-hai-filled';

const IGNORE_SELECTOR = '[data-hai-ignore]';

/** Input types a form tool may touch, by the type of the field of the register. */
const INPUT_TYPES: Readonly<Record<UiFieldDef['type'], readonly string[]>> =
  Object.freeze({
    text: ['text', 'search'],
    textarea: [],
    number: ['number'],
    select: [],
  });

export type UiNoticeKey =
  | 'hai.uiAction.bar.notFound'
  | 'hai.uiAction.bar.wrongPage'
  | 'hai.uiAction.bar.ambiguous'
  | 'hai.uiAction.bar.invalid'
  | 'hai.uiAction.bar.nothingChanged';

export type UiBarState =
  | null
  | {
      kind: 'applied';
      /** Labels of the changed fields (never the values). */
      labels: string[];
      count: number;
      /** Fields the HAI could not fill (blocked, missing, or no such option). */
      skipped: number;
      undone: boolean;
      /** Fields left as they were because the person changed them after the HAI. */
      kept: number;
    }
  | {
      kind: 'pending';
      /** What would be entered, for the person to check (spoken turns). */
      preview: { label: string; value: string }[];
    }
  | { kind: 'notice'; key: UiNoticeKey };

export type UiRunOutcome =
  | { status: 'applied'; applied: number; skipped: number }
  | { status: 'pending' }
  | { status: 'focused' }
  | { status: 'scrolled' }
  | {
      status: 'rejected';
      reason:
        | 'invalid'
        | 'wrong_page'
        | 'form_missing'
        | 'ambiguous'
        | 'no_change';
    };

interface FieldRecord {
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  previous: string;
  value: string;
}

// ============================================================================
// STORE for the bar
// ============================================================================

let barState: UiBarState = null;
let records: FieldRecord[] = [];
let pendingEvent: UiActionEvent | null = null;
let applying = false;
const listeners = new Set<() => void>();
let editGuardDoc: Document | null = null;

function setBar(next: UiBarState) {
  barState = next;
  listeners.forEach(listener => listener());
}

export function getUiBarState(): UiBarState {
  return barState;
}

export function subscribeUiBar(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function hasPendingUiAction(): boolean {
  return pendingEvent !== null;
}

// ============================================================================
// DOM helpers
// ============================================================================

function visible(el: Element): boolean {
  return el.closest('[hidden], [aria-hidden="true"]') === null;
}

function formElements(doc: Document, formId: string): Element[] {
  return Array.from(doc.querySelectorAll(`[data-hai-form="${formId}"]`)).filter(
    el => !el.closest(IGNORE_SELECTOR) && visible(el)
  );
}

type FieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** The element of a field inside a form element, or null. */
function findFieldElement(
  formEl: Element,
  fieldId: string
): FieldElement | null {
  const selector = `[data-hai-field="${fieldId}"]`;
  const el = formEl.matches(selector) ? formEl : formEl.querySelector(selector);
  if (!el || el.closest(IGNORE_SELECTOR)) return null;
  const tag = el.tagName.toLowerCase();
  if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return null;
  return el as FieldElement;
}

/** Whether the element may be touched for a field of the register. */
function isFillable(el: FieldElement, field: UiFieldDef): boolean {
  if (el.disabled) return false;
  if ('readOnly' in el && el.readOnly) return false;
  if (!visible(el)) return false;
  const tag = el.tagName.toLowerCase();
  if (field.type === 'textarea') return tag === 'textarea';
  if (field.type === 'select') return tag === 'select';
  if (tag !== 'input') return false;
  return INPUT_TYPES[field.type].includes(
    (el as HTMLInputElement).type.toLowerCase()
  );
}

/**
 * Put a value into a controlled React field: the native setter of the prototype
 * (React's own tracker is bypassed, so it sees a change), then `input` and
 * `change`. The flag keeps our own events from counting as an edit of the person.
 */
function setNativeValue(el: FieldElement, value: string) {
  const win = el.ownerDocument.defaultView;
  if (!win) return;
  const proto =
    el.tagName.toLowerCase() === 'textarea'
      ? win.HTMLTextAreaElement.prototype
      : el.tagName.toLowerCase() === 'select'
        ? win.HTMLSelectElement.prototype
        : win.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  applying = true;
  try {
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
  } finally {
    applying = false;
  }
}

/** A real edit of the person on a filled field takes the mark and the undo away. */
function installEditGuard(doc: Document) {
  if (editGuardDoc === doc) return;
  editGuardDoc = doc;
  const onEdit = (event: Event) => {
    if (applying) return;
    const target = event.target as Element | null;
    if (!target || !target.hasAttribute?.(FILLED_ATTRIBUTE)) return;
    target.removeAttribute(FILLED_ATTRIBUTE);
    records = records.filter(record => record.el !== target);
  };
  doc.addEventListener('input', onEdit, true);
  doc.addEventListener('change', onEdit, true);
}

function scrollInto(el: Element) {
  if (typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

/** The form element for an event: one match, or the one picked by `entry`. */
function pickForm(
  doc: Document,
  form: UiFormDef,
  entry: number | undefined
): { el: Element } | { reason: 'form_missing' | 'ambiguous' } {
  const all = formElements(doc, form.id);
  if (all.length === 0) return { reason: 'form_missing' };
  if (entry !== undefined) {
    const picked = all[entry - 1];
    return picked ? { el: picked } : { reason: 'form_missing' };
  }
  if (all.length > 1) return { reason: 'ambiguous' };
  return { el: all[0] };
}

function notice(key: UiNoticeKey) {
  setBar({ kind: 'notice', key });
}

const reasonKey: Record<
  Extract<UiRunOutcome, { status: 'rejected' }>['reason'],
  UiNoticeKey
> = {
  invalid: 'hai.uiAction.bar.invalid',
  wrong_page: 'hai.uiAction.bar.wrongPage',
  form_missing: 'hai.uiAction.bar.notFound',
  ambiguous: 'hai.uiAction.bar.ambiguous',
  no_change: 'hai.uiAction.bar.nothingChanged',
};

function reject(
  reason: Extract<UiRunOutcome, { status: 'rejected' }>['reason']
): UiRunOutcome {
  notice(reasonKey[reason]);
  return { status: 'rejected', reason };
}

// ============================================================================
// RUN
// ============================================================================

function applyFill(
  doc: Document,
  form: UiFormDef,
  event: UiActionEvent
): UiRunOutcome {
  const picked = pickForm(doc, form, event.entry);
  if ('reason' in picked) return reject(picked.reason);

  installEditGuard(doc);
  const changed: FieldRecord[] = [];
  const labels: string[] = [];
  let skipped = 0;
  for (const item of event.fields ?? []) {
    const field = getUiField(form, item.id);
    if (!field) {
      skipped += 1;
      continue;
    }
    const el = findFieldElement(picked.el, field.id);
    if (!el || !isFillable(el, field)) {
      skipped += 1;
      continue;
    }
    if (el.tagName.toLowerCase() === 'select') {
      const select = el as HTMLSelectElement;
      if (!Array.from(select.options).some(o => o.value === item.value)) {
        skipped += 1;
        continue;
      }
    }
    const previous = el.value;
    setNativeValue(el, item.value);
    el.setAttribute(FILLED_ATTRIBUTE, 'true');
    changed.push({ el, previous, value: el.value });
    labels.push(field.label);
  }
  if (changed.length === 0) return reject('no_change');

  // a new run replaces the marks of an earlier one (its undo is gone)
  clearMarks();
  records = changed;
  changed.forEach(record => record.el.setAttribute(FILLED_ATTRIBUTE, 'true'));
  setBar({
    kind: 'applied',
    labels,
    count: changed.length,
    skipped,
    undone: false,
    kept: 0,
  });
  scrollInto(changed[0].el);
  return { status: 'applied', applied: changed.length, skipped };
}

/**
 * Carry out an event of the server. `raw` is checked again (shape, register,
 * values), the page is checked against the path right now. An event in the mode
 * `confirm` (spoken turn) is only shown, nothing is entered before the person
 * confirms with a tap or a typed "ja".
 */
export function runUiAction(
  raw: unknown,
  doc: Document = document,
  pathname: string = typeof window !== 'undefined'
    ? window.location.pathname
    : ''
): UiRunOutcome {
  const event = toUiActionEvent(raw);
  if (!event) return reject('invalid');
  const form = getUiForm(event.form);
  if (!form || isExcludedField(form.id)) return reject('invalid');
  // the page may have changed between the question and the answer
  if (!formIsOnPath(form, pathname)) return reject('wrong_page');

  if (event.tool === 'fill_form') {
    if (event.mode === 'confirm') {
      pendingEvent = event;
      setBar({
        kind: 'pending',
        preview: (event.fields ?? []).map(item => ({
          label: getUiField(form, item.id)?.label ?? item.id,
          value: item.value,
        })),
      });
      return { status: 'pending' };
    }
    pendingEvent = null;
    return applyFill(doc, form, event);
  }

  const picked = pickForm(doc, form, event.entry);
  if ('reason' in picked) return reject(picked.reason);
  const field = event.field ? getUiField(form, event.field) : undefined;
  const target = field ? findFieldElement(picked.el, field.id) : picked.el;
  if (!target || (field && !isFillable(target as FieldElement, field))) {
    return reject('form_missing');
  }
  if (event.tool === 'focus_field') {
    (target as HTMLElement).focus();
    scrollInto(target);
    return { status: 'focused' };
  }
  scrollInto(target);
  return { status: 'scrolled' };
}

/** The person confirmed a pending event (tap on "Eintragen" or a typed "ja"). */
export function confirmPendingUiAction(
  doc: Document = document,
  pathname: string = typeof window !== 'undefined'
    ? window.location.pathname
    : ''
): UiRunOutcome | null {
  const event = pendingEvent;
  if (!event) return null;
  pendingEvent = null;
  const form = getUiForm(event.form);
  if (!form) return reject('invalid');
  if (!formIsOnPath(form, pathname)) return reject('wrong_page');
  return applyFill(doc, form, { ...event, mode: 'apply' });
}

export function discardPendingUiAction() {
  if (!pendingEvent) return;
  pendingEvent = null;
  setBar(null);
}

function clearMarks() {
  for (const record of records) record.el.removeAttribute(FILLED_ATTRIBUTE);
  records = [];
}

/**
 * Undo the last fill: every field the person did not change since goes back to
 * its old value. A field the person edited after the HAI stays as it is.
 */
export function undoUiAction() {
  if (barState?.kind !== 'applied' || barState.undone) return;
  let kept = 0;
  for (const record of records) {
    if (record.el.isConnected && record.el.value === record.value) {
      setNativeValue(record.el, record.previous);
    } else if (record.el.isConnected) {
      kept += 1;
    }
    record.el.removeAttribute(FILLED_ATTRIBUTE);
  }
  records = [];
  setBar({ ...barState, undone: true, kept });
}

/** Close the bar. The values stay, the marks go. */
export function dismissUiBar() {
  pendingEvent = null;
  clearMarks();
  setBar(null);
}

/** Test helper: back to the start state. */
export function resetUiActionExecutor() {
  pendingEvent = null;
  clearMarks();
  editGuardDoc = null;
  barState = null;
  listeners.clear();
}
