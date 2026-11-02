/**
 * Display label of a training component.
 *
 * FIAE labels its components like KfBM (K24.1, K24.2): the base component of
 * a pair is "x.1", its Vertiefung is "x.2", and x is the order index of the
 * base component. A component without a Vertiefung keeps its plain number.
 *
 *   single:  1, 7, 12, 19, 23, 24, 25, 26
 *   pairs:   2 > 13, 3 > 14, 4 > 15, 5 > 16, 6 > 17, 8 > 18, 9 > 20,
 *            10 > 21, 11 > 22  (label 2.1 and 2.2, 3.1 and 3.2, ...)
 *
 * This is a label only. The code (the key of the row) and the order index (the
 * phases and the release depend on it) never change, and every lookup, import
 * and upload assignment keeps working with the code. KfBM and every code this
 * module does not know come back unchanged.
 *
 * The folder names of the FIAE delivery use the same scheme, see
 * scripts/import/fiae-component-folder.mjs (it reads this module).
 *
 * Pure module without imports of the app, so the import scripts (Node strips
 * the types) and the browser can both load it.
 */

import { FIAE_CATALOG_CODE } from '@/lib/catalog/branding';

/** Order index of the 26 FIAE components -> component code (Preview and seed). */
export const FIAE_COMPONENT_CODES: Readonly<Record<number, string>> = {
  1: '1-P1',
  2: '2-P1',
  3: '3-P1',
  4: '4-P1',
  5: '5-P1',
  6: '6-P1',
  7: '7-P1',
  8: '8-P1',
  9: '10-P1',
  10: 'AE1-P1',
  11: 'AE2-P1',
  12: 'INT5-P1',
  13: '2-P2',
  14: '3-P2',
  15: '4-P2',
  16: '5-P2',
  17: '6-P2',
  18: '8-P2',
  19: '9-P2',
  20: '10-P2',
  21: 'AE1-P2',
  22: 'AE2-P2',
  23: 'INT1',
  24: 'INT2',
  25: 'INT3',
  26: 'INT4',
};

/** [order index of the base component, order index of its Vertiefung]. */
export const FIAE_COMPONENT_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [2, 13],
  [3, 14],
  [4, 15],
  [5, 16],
  [6, 17],
  [8, 18],
  [9, 20],
  [10, 21],
  [11, 22],
];

const FIRST_ORDER_INDEX = 1;
const LAST_ORDER_INDEX = 26;

const LABEL_OF_ORDER_INDEX = new Map<number, string>();
const ORDER_INDEX_OF_LABEL = new Map<string, number>();
const ORDER_INDEX_OF_CODE = new Map<string, number>();

for (let n = FIRST_ORDER_INDEX; n <= LAST_ORDER_INDEX; n++) {
  const pair = FIAE_COMPONENT_PAIRS.find(
    ([base, deep]) => n === base || n === deep
  );
  const label = pair ? `${pair[0]}.${n === pair[0] ? 1 : 2}` : String(n);
  LABEL_OF_ORDER_INDEX.set(n, label);
  ORDER_INDEX_OF_LABEL.set(label, n);
  ORDER_INDEX_OF_CODE.set(FIAE_COMPONENT_CODES[n], n);
}

const isFiae = (catalogCode: string | null | undefined): boolean =>
  typeof catalogCode === 'string' &&
  catalogCode.trim().toUpperCase() === FIAE_CATALOG_CODE;

/** The label of a FIAE order index (1 to 26), null for anything else. */
export function fiaeLabelOfOrderIndex(orderIndex: unknown): string | null {
  return typeof orderIndex === 'number'
    ? (LABEL_OF_ORDER_INDEX.get(orderIndex) ?? null)
    : null;
}

/**
 * The order index a FIAE label stands for ("2.1" is 2, "2.2" is 13, "7" is 7),
 * null for a text that is no label ("2.3", "13.1", "7.1", "x"). A leading zero
 * is accepted ("02.1", "07").
 */
export function fiaeOrderIndexOfLabel(label: string): number | null {
  const text = String(label).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole, part] = text.split('.');
  const normalized =
    part === undefined ? String(Number(whole)) : `${Number(whole)}.${part}`;
  return ORDER_INDEX_OF_LABEL.get(normalized) ?? null;
}

/** The order index of a FIAE component code ("2-P2" is 13), null when unknown. */
export function fiaeOrderIndexOfCode(
  code: string | null | undefined
): number | null {
  return typeof code === 'string'
    ? (ORDER_INDEX_OF_CODE.get(code.trim()) ?? null)
    : null;
}

export interface ComponentLabelInput {
  /** Code of the training catalog (occupation), for example FIAE or KFBM. */
  catalogCode: string | null | undefined;
  /** Code of the component (the key of the row). */
  code: string | null | undefined;
  /** Order index of the component, used when the code is not one of the FIAE codes. */
  orderIndex?: number | null;
}

/**
 * The label to show for a component. Only FIAE is relabelled: a known code
 * decides, otherwise the order index (production codes may differ from the
 * Preview codes, the order index is the same). Everything else, including KfBM
 * (it shows K24.2 already) and an unknown code, is the code as it is.
 */
export function getComponentLabel(input: ComponentLabelInput): string {
  const code = typeof input.code === 'string' ? input.code : '';
  if (!isFiae(input.catalogCode)) return code;
  const known = fiaeOrderIndexOfCode(code);
  const label = fiaeLabelOfOrderIndex(known ?? input.orderIndex);
  return label ?? code;
}
