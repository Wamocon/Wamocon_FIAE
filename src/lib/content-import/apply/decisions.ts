// Reads and checks the presets of the KfBM import (scripts/import/
// kfbm-decisions.json). Pure functions: the caller reads the file.
//
// The presets are proposals that the owner has not confirmed. They are kept
// in a file so that a change needs no code change, and they are checked
// strictly: a typo must stop the run, not change what is written.

import type {
  ComponentKind,
  Decisions,
  ReviewedSolutionWord,
} from './types';

export type DecisionsResult =
  | { ok: true; decisions: Decisions }
  | { ok: false; errors: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function numberList(value: unknown, name: string, errors: string[]): number[] {
  if (
    !Array.isArray(value) ||
    !value.every(n => Number.isInteger(n) && n > 0 && n < 100)
  ) {
    errors.push(`${name} must be a list of component numbers`);
    return [];
  }
  return value as number[];
}

function amountMap(
  value: unknown,
  name: string,
  errors: string[]
): Record<string, number> {
  if (!isRecord(value)) {
    errors.push(`${name} must be an object (component code to number)`);
    return {};
  }
  const out: Record<string, number> = {};
  for (const [code, amount] of Object.entries(value)) {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      errors.push(`${name}.${code} must be a number of zero or more`);
    } else {
      out[code] = amount;
    }
  }
  return out;
}

const phaseOf = (value: unknown): value is 1 | 2 | null =>
  value === null || value === 1 || value === 2;

/** Code of an enabler of the KfBM: K24.2-e, K6.2-d, K9-a. */
export const ENABLER_KEY = /^K\d{1,2}(?:\.\d{1,2})?-[a-z]$/;
const REASON_MIN = 10;
const REASON_MAX = 400;
const REVIEWED_NAME = 'content.reviewedSolutionWordFalsePositives';

/**
 * The enablers whose bare line "Lösung" was checked. Strict on purpose: only
 * well-formed enabler codes (no wildcard, no component), every entry with a
 * reason in one line, no duplicate and no other field. A mistake stops the run,
 * it must never widen what is released.
 */
function reviewedSolutionWords(
  value: unknown,
  errors: string[]
): ReviewedSolutionWord[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${REVIEWED_NAME} must be a list of {enabler, reason}`);
    return [];
  }
  const out: ReviewedSolutionWord[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const where = `${REVIEWED_NAME}[${index}]`;
    if (!isRecord(entry)) {
      errors.push(`${where} must be an object {enabler, reason}`);
      return;
    }
    for (const field of Object.keys(entry)) {
      if (field !== 'enabler' && field !== 'reason') {
        errors.push(`${where} has the unknown field ${field}`);
      }
    }
    const enabler = entry.enabler;
    const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';
    let valid = true;
    if (typeof enabler !== 'string' || !ENABLER_KEY.test(enabler)) {
      errors.push(`${where} needs an enabler key like K24.2-e`);
      valid = false;
    } else if (seen.has(enabler)) {
      errors.push(`${where} names the enabler ${enabler} twice`);
      valid = false;
    } else {
      seen.add(enabler);
    }
    if (
      reason.length < REASON_MIN ||
      reason.length > REASON_MAX ||
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u001f\u007f\u0085\u2028\u2029]/.test(reason)
    ) {
      errors.push(
        `${where} needs a reason of ${REASON_MIN} to ${REASON_MAX} characters in one line`
      );
      valid = false;
    }
    if (valid) out.push({ enabler: enabler as string, reason });
  });
  return out;
}

/** Checks the raw JSON of the presets and returns it typed. */
export function parseDecisions(raw: unknown): DecisionsResult {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return { ok: false, errors: ['The decisions must be a JSON object'] };
  }

  if (raw.version !== 1) errors.push('version must be 1');
  if (typeof raw.status !== 'string') errors.push('status must be text');
  // Only the KfBM catalog may be written, never FIAE.
  if (raw.catalog !== 'KFBM') {
    errors.push(
      'catalog must be KFBM (the import never writes another catalog)'
    );
  }

  const duplicates = isRecord(raw.duplicates) ? raw.duplicates : null;
  if (!duplicates) {
    errors.push('duplicates is missing');
  } else {
    if (duplicates.policy !== 'newest') {
      errors.push('duplicates.policy must be "newest"');
    }
    const hours = duplicates.ambiguousWithinHours;
    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0) {
      errors.push('duplicates.ambiguousWithinHours must be zero or more');
    }
  }

  const components = isRecord(raw.components) ? raw.components : null;
  const content = isRecord(raw.content) ? raw.content : null;
  if (!components) errors.push('components is missing');
  if (!content) errors.push('content is missing');
  if (!components || !content) return { ok: false, errors };

  const excludedNumbers = numberList(
    components.excludedNumbers,
    'components.excludedNumbers',
    errors
  );
  const mandatoryNumbers = numberList(
    components.mandatoryNumbers,
    'components.mandatoryNumbers',
    errors
  );
  const electiveNumbers = numberList(
    components.electiveNumbers,
    'components.electiveNumbers',
    errors
  );
  const integrativeNumbers = numberList(
    components.integrativeNumbers,
    'components.integrativeNumbers',
    errors
  );
  const seen = new Map<number, string>();
  for (const [kind, list] of [
    ['excluded', excludedNumbers],
    ['mandatory', mandatoryNumbers],
    ['elective', electiveNumbers],
    ['integrative', integrativeNumbers],
  ] as const) {
    for (const n of list) {
      const before = seen.get(n);
      if (before) {
        errors.push(`component ${n} is both ${before} and ${kind}`);
      }
      seen.set(n, kind);
    }
  }

  const phaseByGroup = isRecord(components.phaseByGroup)
    ? components.phaseByGroup
    : null;
  if (
    !phaseByGroup ||
    !phaseOf(phaseByGroup.teil1) ||
    !phaseOf(phaseByGroup.teil2)
  ) {
    errors.push('components.phaseByGroup needs teil1 and teil2 (1, 2 or null)');
  }
  const phaseOverrides: Record<string, 1 | 2 | null> = {};
  if (!isRecord(components.phaseOverrides)) {
    errors.push('components.phaseOverrides must be an object');
  } else {
    for (const [code, phase] of Object.entries(components.phaseOverrides)) {
      if (phaseOf(phase)) phaseOverrides[code] = phase;
      else
        errors.push(`components.phaseOverrides.${code} must be 1, 2 or null`);
    }
  }
  const totalWeeks = amountMap(
    components.totalWeeks,
    'components.totalWeeks',
    errors
  );
  const totalHours = amountMap(
    components.totalHours,
    'components.totalHours',
    errors
  );
  const placeholders = [
    components.placeholderWeeks,
    components.placeholderHours,
  ];
  if (placeholders.some(n => typeof n !== 'number' || !(n >= 0))) {
    errors.push(
      'components.placeholderWeeks and placeholderHours must be numbers of zero or more'
    );
  }

  if (typeof content.activate !== 'boolean') {
    errors.push('content.activate must be true or false');
  }
  if (
    !Number.isInteger(content.globalQuizQuestions) ||
    (content.globalQuizQuestions as number) < 1
  ) {
    errors.push('content.globalQuizQuestions must be a whole number');
  }
  if (typeof content.enablerText !== 'boolean') {
    errors.push('content.enablerText must be true or false');
  }
  const reviewedSolutionWordFalsePositives = reviewedSolutionWords(
    content.reviewedSolutionWordFalsePositives,
    errors
  );
  const open =
    Array.isArray(raw.open) && raw.open.every(s => typeof s === 'string')
      ? (raw.open as string[])
      : null;
  if (!open) errors.push('open must be a list of texts');

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    decisions: {
      version: 1,
      status: raw.status as string,
      catalog: 'KFBM',
      duplicates: {
        policy: 'newest',
        ambiguousWithinHours: (duplicates as Record<string, unknown>)
          .ambiguousWithinHours as number,
      },
      components: {
        excludedNumbers,
        mandatoryNumbers,
        electiveNumbers,
        integrativeNumbers,
        phaseByGroup: {
          teil1: (phaseByGroup as Record<string, unknown>).teil1 as
            | 1
            | 2
            | null,
          teil2: (phaseByGroup as Record<string, unknown>).teil2 as
            | 1
            | 2
            | null,
        },
        phaseOverrides,
        totalWeeks,
        totalHours,
        placeholderWeeks: components.placeholderWeeks as number,
        placeholderHours: components.placeholderHours as number,
      },
      content: {
        activate: content.activate as boolean,
        globalQuizQuestions: content.globalQuizQuestions as number,
        enablerText: content.enablerText as boolean,
        reviewedSolutionWordFalsePositives,
      },
      open: open as string[],
    },
  };
}

/**
 * Kind of a component number by the presets. null = no decision (an excluded
 * number or one nobody listed), such a component is not imported.
 */
export function kindOfComponent(
  decisions: Decisions,
  number: number
): ComponentKind | null {
  const c = decisions.components;
  if (c.excludedNumbers.includes(number)) return null;
  if (c.mandatoryNumbers.includes(number)) return 'pflicht';
  if (c.electiveNumbers.includes(number)) return 'wahl';
  if (c.integrativeNumbers.includes(number)) return 'integrativ';
  return null;
}
