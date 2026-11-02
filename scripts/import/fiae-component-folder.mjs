// The number at the start of a component folder (or file) name of the FIAE delivery, as the order
// index of the component (1 to 26). There are TWO numbering schemes of the delivery folder, and they
// contradict each other for plain numbers:
//
//   old   the 26 folders 01 to 26, the number IS the order index ("13_" is the Vertiefung of 2)
//   new   the final numbering of 02.11.2026, 17 labels: a pair is written x.1 (base) and x.2
//         (Vertiefung), x is the order index of the base component (02.1_, 02.2_, 09.1_, 09.2_), the
//         single components are numbered on: 01, 07, 12, 13 (order index 19, Speicherlösungen),
//         14 (23), 15 (24), 16 (25), 17 (26). "13_" is Speicherlösungen here.
//
// The scheme is detected per delivery folder: when at least one component folder uses the dot
// notation (x.1 or x.2, with or without a leading zero) the whole folder is NEW, otherwise OLD.
// In NEW only the plain numbers 1, 7, 12, 13, 14, 15, 16, 17 are allowed, a plain 2 or 9, a number from
// 18 to 26 or a pattern like 2.3_ or 13.1_ is refused with a clear message (a mix of both schemes in
// one folder shows up this way). Nothing is guessed. The table lives in src/lib/catalog/component-label.ts
// (one source for the app and the scripts). The database codes and the order index are not touched.
//
// No network, no database. The only file access is reading folder names (listComponentFolders).

import { readdirSync } from 'node:fs';
import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);

const labels = await import(
  new URL('../../src/lib/catalog/component-label.ts', import.meta.url).href
);

export const {
  FIAE_COMPONENT_PAIRS,
  FIAE_COMPONENT_SINGLES,
  fiaeLabelOfOrderIndex,
  fiaeOrderIndexOfLabel,
} = labels;

export const SCHEMES = ['old', 'new'];

const pad = nr => String(nr).padStart(2, '0');

/** "2.1", "2.2", "13" for the order index, null when it is no FIAE component. */
export const componentLabel = nr => fiaeLabelOfOrderIndex(nr);

/**
 * The number a folder has in the given scheme, with a leading zero: old "02", "13" (the order
 * index), new "02.1", "02.2", "13" (the label of the platform). null for no FIAE component.
 */
export function folderNumberOf(nr, scheme = 'old') {
  const label = componentLabel(Number(nr));
  if (label === null) return null;
  if (scheme === 'old') return pad(nr);
  return label.includes('.')
    ? `${pad(label.split('.')[0])}.${label.split('.')[1]}`
    : pad(label);
}

/**
 * How a report names a component: the label and, in brackets, the folder number in the scheme of
 * the delivery (default old), for example "2.1 (Ordner 02)" and "2.2 (Ordner 13)" in the old scheme,
 * "2.2 (Ordner 02.2)" and "13 (Ordner 13)" in the new one.
 */
export function describeComponent(nr, scheme = 'old') {
  const label = componentLabel(Number(nr));
  return label === null
    ? `Ordner ${nr}`
    : `${label} (Ordner ${folderNumberOf(nr, scheme)})`;
}

const PAIR_LIST = FIAE_COMPONENT_PAIRS.map(([b]) => `${b}.1/${b}.2`).join(', ');
const SINGLE_LIST = FIAE_COMPONENT_SINGLES.map(([, label]) => label).join(', ');

/**
 * One number as written in a name or option. A dotted number ("2.1", "02.2") is a label and means the
 * same in both schemes. A plain number is the order index in the old scheme (1 to 26) and a label of a
 * single component in the new one (1, 7, 12 to 17). Returns { ok: true, nr } with the order index or
 * { ok: false, reason }.
 */
export function parseComponentNumber(text, scheme = 'old') {
  const raw = String(text ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(raw))
    return { ok: false, reason: `"${raw}" is not a component number.` };
  if (raw.includes('.')) {
    const nr = fiaeOrderIndexOfLabel(raw);
    if (nr === null)
      return {
        ok: false,
        reason: `"${raw}" is no component number (a pair is x.1 and x.2: ${PAIR_LIST}; a single component has no dot).`,
      };
    return { ok: true, nr };
  }
  const plain = Number(raw);
  if (scheme === 'new') {
    const nr = fiaeOrderIndexOfLabel(String(plain));
    if (nr === null)
      return {
        ok: false,
        reason: `"${raw}" is not allowed in the final numbering (plain numbers are only ${SINGLE_LIST}, a pair is written x.1 and x.2). The folder may mix the old and the new numbering.`,
      };
    return { ok: true, nr };
  }
  if (fiaeLabelOfOrderIndex(plain) !== null) return { ok: true, nr: plain };
  return { ok: false, reason: `"${raw}" is outside the components 1 to 26.` };
}

/** Does a folder or file name start with the dot notation (2.1_, 02.2 )? */
export const hasDotNotation = name =>
  /^\s*\d+\.\d+(?=[_ ])/.test(String(name ?? ''));

/**
 * The scheme of a delivery folder from the names of its component folders: new when at least one name
 * uses the dot notation, otherwise old.
 */
export const detectScheme = names =>
  [...names].some(hasDotNotation) ? 'new' : 'old';

/**
 * The number at the start of a folder or file name ("02_Planen", "02.1_Informieren ...",
 * "13 Vertiefung") in the given scheme: { ok: true, nr, key, scheme } with key the order index with
 * two digits, { ok: false, reason } for a pattern that is not clear, or null when the name does not
 * start with a number (not a component folder).
 */
export function parseFolderName(name, scheme = 'old') {
  const m = /^\s*(\d+(?:\.\d+)?)(?=[_ ])/.exec(String(name ?? ''));
  if (!m) return null;
  const parsed = parseComponentNumber(m[1], scheme);
  if (!parsed.ok) return { ok: false, reason: `${name}: ${parsed.reason}` };
  return { ok: true, nr: parsed.nr, key: pad(parsed.nr), scheme };
}

/**
 * The values of an option such as --components or --files ("05,13", "2.1,2.2,5") as typed.
 * { tokens, errors }: a value that can be no number of any scheme is an error. Plain numbers mean
 * different components in the two schemes, so they are turned into keys only when the scheme of the
 * delivery folder is known (resolveComponentTokens).
 */
export function parseComponentList(text) {
  const tokens = [];
  const errors = [];
  for (const part of String(text ?? '').split(',')) {
    const token = part.trim();
    if (token === '') continue;
    const parsed = parseComponentNumber(token, 'old');
    if (parsed.ok) tokens.push(token);
    else errors.push(parsed.reason);
  }
  return { tokens, errors };
}

/**
 * The tokens of --components or --files as keys (order index with two digits) in the scheme of the
 * delivery folder. { keys, errors }: a plain number that the scheme does not allow is an error.
 */
export function resolveComponentTokens(tokens, scheme = 'old') {
  const keys = [];
  const errors = [];
  for (const token of tokens ?? []) {
    const parsed = parseComponentNumber(token, scheme);
    if (parsed.ok) keys.push(pad(parsed.nr));
    else errors.push(parsed.reason);
  }
  return { keys, errors };
}

/**
 * The folder prefix of the final numbering for the order index: "02.1" for the base of a pair, "02.2"
 * for its Vertiefung, "13" for the single component with the order index 19. null for no component.
 */
export const finalFolderNumber = nr => folderNumberOf(nr, 'new');

/**
 * The component folders directly under `root` (a folder whose name starts with a number), read from
 * the disk: { scheme, folders: [{ nr, key, dirName, scheme }] sorted by nr, problems }. The scheme is
 * detected from the names (see the top of this file). An unclear number or two folders for one
 * component are problems, never guessed. Only reads the folder names, changes nothing.
 */
export function listComponentFolders(root) {
  const folders = [];
  const problems = [];
  const seen = new Map();
  let entries = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const dirs = entries.filter(d => d.isDirectory());
  const scheme = detectScheme(dirs.map(d => d.name));
  for (const d of dirs) {
    const parsed = parseFolderName(d.name, scheme);
    if (!parsed) continue;
    if (!parsed.ok) {
      problems.push(parsed.reason);
      continue;
    }
    if (seen.has(parsed.nr)) {
      problems.push(
        `Two folders for the component ${describeComponent(parsed.nr, scheme)}: ${seen.get(parsed.nr)} and ${d.name}.`
      );
      continue;
    }
    seen.set(parsed.nr, d.name);
    folders.push({ nr: parsed.nr, key: parsed.key, dirName: d.name, scheme });
  }
  return {
    scheme,
    folders: folders.sort((a, b) => a.nr - b.nr),
    problems,
  };
}
