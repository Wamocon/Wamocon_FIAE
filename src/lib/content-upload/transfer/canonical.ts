// The canonical plan and its hash (docs/ki-upload-konzept.md 3.2, 8.2).
//
// The dry run stores a hash in content_upload_runs.last_dry_run_hash, and the
// apply starts only if the hash of the plan it is about to write is the same. So
// the hash has to cover everything that decides what is written, and nothing that
// changes between two builds of the same plan:
//
//   in:  the engine version, the presets (kfbm-decisions.json), the two plans with
//        all their content, the switches of this run, the hashes of the files that
//        became rows, the originals that go to the document bucket
//   out: the time of the build (generatedAt), the order of the input
//
// Text is hashed as canonical JSON (keys sorted, no whitespace), so the same plan
// always gives the same string.

import { createHash } from 'node:crypto';

import type { Decisions, ImportPlan } from '@/lib/content-import/apply/types';
import type { LearningFieldPlan } from '@/lib/content-import/learning-fields/types';
import type { UseCasePlan } from '@/lib/content-import/use-cases/types';

/**
 * Version of the transfer logic. Raise it whenever the plan builder, the engines or
 * the protocol change what a plan means: a dry run of an older version then never
 * opens the gate of a newer one.
 */
export const TRANSFER_ENGINE_VERSION = 'upload-transfer/3';

/** JSON with sorted keys and no whitespace. undefined is left out, like JSON.stringify. */
export function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error('A number that is not finite cannot be hashed.');
      }
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value
          .map(item => (item === undefined ? 'null' : stableStringify(item)))
          .join(',')}]`;
      }
      if (value instanceof Date) return JSON.stringify(value.toISOString());
      const record = value as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of Object.keys(record).sort()) {
        if (record[key] === undefined) continue;
        parts.push(`${JSON.stringify(key)}:${stableStringify(record[key])}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      throw new Error(`A ${typeof value} cannot be hashed.`);
  }
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** What the transfer has to name besides the plans. */
export interface CanonicalInput {
  decisions: Decisions;
  importPlan: ImportPlan;
  useCasePlan: UseCasePlan;
  /** The plan of the learning field import (an Excel mapping file), null without one. */
  learningPlan?: LearningFieldPlan | null;
  /** The switches of this run: the files whose differing rows are replaced. */
  options: { replaceFiles: readonly string[] };
  /** The files that became rows of the plans: id and the hash of the object. */
  files: ReadonlyArray<{ id: string; sha256: string }>;
  /** The originals that are copied to the document bucket: file id and hash. */
  originals: ReadonlyArray<{ id: string; sha256: string; enablerCode: string }>;
}

const withoutTime = <T extends { generatedAt: string }>(plan: T) => {
  const { generatedAt: _generatedAt, ...rest } = plan;
  return rest;
};

/** The canonical plan as text. */
export function canonicalPlan(input: CanonicalInput): string {
  const byId = (a: { id: string }, b: { id: string }) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return stableStringify({
    engine: TRANSFER_ENGINE_VERSION,
    presets: input.decisions,
    // The fixed settings of every run. They are part of the hash on purpose: a
    // change of one of them (it needs a change of the code) invalidates every dry run.
    fixed: {
      activate: false,
      scenarioSolutions: false,
      useCaseSolutions: false,
      // missing questions of an existing quiz are added (docs 8.9)
      extendQuizzes: true,
      // the learning field engine only adds, it never replaces (package UP2)
      learningUpdateExisting: false,
    },
    options: { replaceFiles: [...input.options.replaceFiles].sort() },
    import: withoutTime(input.importPlan),
    useCases: withoutTime(input.useCasePlan),
    learning: input.learningPlan ? withoutTime(input.learningPlan) : null,
    files: [...input.files].sort(byId),
    originals: [...input.originals].sort(byId),
  });
}

/** The hash that the dry run stores and the gate of the apply compares. */
export function decisionsHash(input: CanonicalInput): string {
  return sha256Hex(canonicalPlan(input));
}
