// The codes of the content import (phase 4.4) that the learning field mappings
// may point at, taken from an apply plan (kfbm-apply.mjs plan) or from the names
// of the source files (no content is read). Pure functions.

import type { PathInfo } from '../types';
import { parseReference } from './mapping-sheet';
import type { ImportIndex } from './types';

const normalised = (reference: string | null | undefined) =>
  parseReference(reference)?.text ?? null;

/** Components and enablers of an apply plan. */
export function importIndexFromPlan(
  plan: {
    components?: Array<{ code: string; reference?: string | null }>;
    enablers?: Array<{ code: string }>;
  },
  excludedNumbers: number[]
): ImportIndex {
  return {
    components: (plan.components ?? []).map(c => ({
      code: c.code,
      reference: normalised(c.reference),
    })),
    enablers: (plan.enablers ?? []).map(e => e.code),
    excludedNumbers: [...excludedNumbers],
  };
}

/**
 * Components and enablers from the paths of the chosen source files (the
 * selection of the apply step: newest copy, no archive, no excluded
 * component). An enabler is a file of the type enabler.
 */
export function importIndexFromFiles(
  files: Array<{
    rel: string;
    info: Pick<PathInfo, 'type' | 'enablerCode' | 'component'>;
  }>,
  chosen: string[],
  excludedNumbers: number[]
): ImportIndex {
  const wanted = new Set(chosen);
  const components = new Map<string, string | null>();
  const enablers = new Set<string>();
  for (const file of files) {
    if (!wanted.has(file.rel)) continue;
    const component = file.info.component;
    if (component) {
      components.set(
        component.code,
        components.get(component.code) ?? normalised(component.paragraph)
      );
    }
    if (file.info.type === 'enabler' && file.info.enablerCode) {
      enablers.add(file.info.enablerCode);
    }
  }
  return {
    components: [...components.entries()].map(([code, reference]) => ({
      code,
      reference,
    })),
    enablers: [...enablers].sort(),
    excludedNumbers: [...excludedNumbers],
  };
}
