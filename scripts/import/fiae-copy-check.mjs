// Check for the content rule of the owner (02.11.2026): every Vertiefung gets an enabler of its own, which
// differs from the base course, and therefore a scenario of its own. A byte-identical copy of the base
// course in a Vertiefung is no valid content.
//
// The check reads the main file of every enabler of a Vertiefung and compares its SHA-256 with the main
// files of the enablers of the base component of the same pair (2 > 13, 3 > 14, ..., see
// src/lib/catalog/component-label.ts). A hit is a "Kopie des Grundkurses". It is a warning only: it never
// changes a run of the importers, it only makes the copies visible. Known on 02.11.2026: component 22
// (enablers 01 to 04), component 18 (01, 04, 05, 09, 13), component 14 (02, 03).
//
// Command (read only, no database, no network):
//   node scripts/import/fiae-copy-check.mjs "<folder Komponenten>"
// Exit code 1 when there is at least one copy, 0 when there is none, 2 for a wrong call.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  FIAE_COMPONENT_PAIRS,
  describeComponent,
} from './fiae-component-folder.mjs';

const sha256 = file => {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
};

/**
 * The Vertiefung enablers whose main file is the same file (SHA-256) as the main file of an enabler of the
 * base component. `comps` is the result of readSource (fiae-documents.mjs). `only` limits the Vertiefung
 * components to these order indexes (a Set of numbers), null for all.
 * Returns [{ deepNr, baseNr, enabler, folder, baseEnabler, baseFolder, sha }] in the order of the components.
 */
export function findBaseCopies(comps, only = null) {
  const byNr = new Map(comps.map(c => [c.nr, c]));
  const copies = [];
  for (const [baseNr, deepNr] of FIAE_COMPONENT_PAIRS) {
    if (only && !only.has(deepNr)) continue;
    const base = byNr.get(baseNr);
    const deep = byNr.get(deepNr);
    if (!base || !deep) continue;
    const baseHashes = new Map();
    for (const e of base.enablers) {
      const h = e.main ? sha256(e.main) : null;
      if (h && !baseHashes.has(h)) baseHashes.set(h, e);
    }
    for (const e of deep.enablers) {
      const h = e.main ? sha256(e.main) : null;
      const hit = h ? baseHashes.get(h) : null;
      if (hit)
        copies.push({
          deepNr,
          baseNr,
          enabler: e.key,
          folder: e.folder,
          baseEnabler: hit.key,
          baseFolder: hit.folder,
          sha: h.slice(0, 16),
        });
    }
  }
  return copies;
}

/** One line per copy for the report of a run. */
export const describeCopy = c =>
  `Kopie des Grundkurses: ${describeComponent(c.deepNr)} / ${c.enabler} ${c.folder} ist byte-gleich mit ${describeComponent(c.baseNr)} / ${c.baseEnabler} (SHA-256 ${c.sha}...)`;

export async function main(argv) {
  const [source, ...extra] = argv;
  if (!source || extra.length) {
    console.error(
      'Usage: node scripts/import/fiae-copy-check.mjs "<folder Komponenten>"'
    );
    return 2;
  }
  const { readSource } = await import('./fiae-documents.mjs');
  let comps;
  try {
    comps = readSource(source);
  } catch (error) {
    console.error(`Refused: ${error?.message ?? error}`);
    return 2;
  }
  const copies = findBaseCopies(comps);
  copies.forEach(c => console.log(`  - ${describeCopy(c)}`));
  console.log(
    copies.length
      ? `${copies.length} enablers of a Vertiefung are a copy of the base course (no valid content).`
      : 'No enabler of a Vertiefung is a copy of the base course.'
  );
  return copies.length ? 1 : 0;
}

if (
  process.argv[1] &&
  path.basename(process.argv[1]) === 'fiae-copy-check.mjs'
) {
  main(process.argv.slice(2)).then(code => process.exit(code));
}
