// The presets of the transfer: scripts/import/kfbm-decisions.json, read by the app.
//
// The file stays where the import scripts read it (scripts/import). The app
// imports that one file instead of keeping a copy under src, so the script and the
// upload can never drift apart (a copy would need a test and a person to keep it
// in step). The bundler inlines the JSON at build time, so the deployment needs no
// file at run time.
//
// Whatever the file says about activation, the transfer never activates content:
// `content.activate` is forced to false here, and runTransfer passes false to the
// engines again (two locks, both with a test).

import rawPreset from '../../../../scripts/import/kfbm-decisions.json';
import { parseDecisions } from '@/lib/content-import/apply/decisions';
import type { Decisions } from '@/lib/content-import/apply/types';

let cached: Decisions | undefined;

/** The presets as the plan builder needs them. Throws when the file is not valid. */
export function transferDecisions(): Decisions {
  if (cached) return cached;
  const result = parseDecisions(JSON.parse(JSON.stringify(rawPreset)));
  if (!result.ok) {
    throw new Error(
      `scripts/import/kfbm-decisions.json is not valid: ${result.errors.join('; ')}`
    );
  }
  const decisions: Decisions = {
    ...result.decisions,
    content: { ...result.decisions.content, activate: false },
  };
  cached = deepFreeze(decisions);
  return cached;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
