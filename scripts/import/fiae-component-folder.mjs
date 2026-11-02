// The number at the start of a component folder (or file) name of the FIAE delivery, as the order
// index of the component (1 to 26). Both spellings of the delivery are read:
//   old   02_, 13_, 09_, 20_   the order index, with or without a leading zero
//   new   2.1_, 2.2_, 9.1_, 9.2_   the label of the platform: x.1 is the base component, x.2 its
//         Vertiefung, x is the order index of the base component (single components keep 1, 7, ...)
// Examples: "02_" and "2.1_" are 2, "13_" and "2.2_" are 13, "09_" and "9.1_" are 9, "20_" and "9.2_"
// are 20. A pattern that is neither ("2.3_", "13.1_", "7.1_", "27_") is refused with a clear message,
// it is never guessed. The table lives in src/lib/catalog/component-label.ts (one source for the
// app and the scripts). The database codes and the order index are not touched by any of this.
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
  fiaeLabelOfOrderIndex,
  fiaeOrderIndexOfLabel,
} = labels;

const pad = nr => String(nr).padStart(2, '0');

/** "2.1", "2.2", "7" for the order index, null when it is no FIAE component. */
export const componentLabel = nr => fiaeLabelOfOrderIndex(nr);

/**
 * How a report names a component: the new label and, in brackets, the folder number (the order
 * index with two digits), for example "2.1 (Ordner 02)" and "2.2 (Ordner 13)".
 */
export function describeComponent(nr) {
  const label = componentLabel(Number(nr));
  return label === null ? `Ordner ${nr}` : `${label} (Ordner ${pad(nr)})`;
}

/**
 * One number as written in a name or option: "02", "13" (order index) or "2.1", "2.2" (label).
 * Returns { ok: true, nr } with the order index, or { ok: false, reason }.
 */
export function parseComponentNumber(text) {
  const raw = String(text ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(raw))
    return { ok: false, reason: `"${raw}" is not a component number.` };
  if (raw.includes('.')) {
    const nr = fiaeOrderIndexOfLabel(raw);
    if (nr === null) {
      const known = FIAE_COMPONENT_PAIRS.map(([b]) => `${b}.1/${b}.2`).join(
        ', '
      );
      return {
        ok: false,
        reason: `"${raw}" is no component number (a pair is x.1 and x.2: ${known}; the others have no dot).`,
      };
    }
    return { ok: true, nr };
  }
  // a plain number is the order index (old spelling): 1 to 26, also where the new label has a dot
  const asOrder = Number(raw);
  if (fiaeLabelOfOrderIndex(asOrder) !== null) return { ok: true, nr: asOrder };
  return { ok: false, reason: `"${raw}" is outside the components 1 to 26.` };
}

/**
 * The number at the start of a folder or file name ("02_Planen", "2.1_Informieren ...",
 * "13 Vertiefung"): { ok: true, nr, key, spelling } with key the order index with two digits and
 * spelling "old" or "new", { ok: false, reason } for a pattern that is not clear, or null when the
 * name does not start with a number (not a component folder).
 */
export function parseFolderName(name) {
  const m = /^\s*(\d+(?:\.\d+)?)(?=[_ ])/.exec(String(name ?? ''));
  if (!m) return null;
  const parsed = parseComponentNumber(m[1]);
  if (!parsed.ok) return { ok: false, reason: `${name}: ${parsed.reason}` };
  return {
    ok: true,
    nr: parsed.nr,
    key: pad(parsed.nr),
    spelling: m[1].includes('.') ? 'new' : 'old',
  };
}

/**
 * The values of an option such as --components or --files ("05,13", "2.1,2.2,5") as keys with two
 * digits. { keys, errors }: an unknown value is an error, not skipped.
 */
export function parseComponentList(text) {
  const keys = [];
  const errors = [];
  for (const part of String(text ?? '').split(',')) {
    if (part.trim() === '') continue;
    const parsed = parseComponentNumber(part);
    if (parsed.ok) keys.push(pad(parsed.nr));
    else errors.push(parsed.reason);
  }
  return { keys, errors };
}

/** The new folder name for the order index: "2.1_<rest>" for the base, "2.2_" for the Vertiefung. */
export const newFolderPrefix = nr => {
  const label = componentLabel(nr);
  return label === null ? null : `${label}_`;
};

/**
 * The component folders directly under `root` (a folder whose name starts with a number), read from
 * the disk, with both spellings: { folders: [{ nr, key, dirName, spelling }] sorted by nr, problems }.
 * An unclear number (2.3_, 13.1_, 27_) or two folders for one component are problems, never guessed.
 * Only reads the folder names, changes nothing.
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
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    const parsed = parseFolderName(d.name);
    if (!parsed) continue;
    if (!parsed.ok) {
      problems.push(parsed.reason);
      continue;
    }
    if (seen.has(parsed.nr)) {
      problems.push(
        `Two folders for the component ${describeComponent(parsed.nr)}: ${seen.get(parsed.nr)} and ${d.name}.`
      );
      continue;
    }
    seen.set(parsed.nr, d.name);
    folders.push({
      nr: parsed.nr,
      key: parsed.key,
      dirName: d.name,
      spelling: parsed.spelling,
    });
  }
  return { folders: folders.sort((a, b) => a.nr - b.nr), problems };
}
