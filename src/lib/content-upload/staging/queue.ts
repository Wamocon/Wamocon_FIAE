// The processing queue of the content upload (concept 2.4, 6.6, 9.1 T12 and T18).
//
// The file rows ARE the queue. There is no cron, so the browser calls the pump
// route in a loop while the page is open, and each call works for a limited time:
//
//   claim      take the next files of the run in one atomic statement (skip locked),
//              with a new claim_id, a lock and one more attempt, counted when the
//              file is TAKEN, so a call that dies still costs an attempt
//   step       run ONE step of the pipeline for ONE file
//   finish     write the result, but only if the claim_id is still the caller's
//
// The pipeline is a list of steps, each one for the files in one state. Today it
// has one step: `verify_metadata` (uploaded -> verified or rejected). The slots
// for the next packages are empty on purpose and named here:
//
//   extract  U3  verified       -> extracted | failed     read the text and the structure
//   rules    U4  extracted      -> proposed_rules | unclear
//   ki       U5  unclear        -> ki_pending   reserves a file for the model
//   kiCall   U5  ki_pending     -> proposed_ki | unclear   the one call per step
//
// A step gets the file and a lazy, cached read of its bytes, and answers with the
// next state (and the numbers it found) or with "try again". It never touches the
// database and never calls a model. A step that throws or asks to try again gives
// the claim back; the third failed attempt fails the file with STEP_ERROR. A call
// that died leaves its claim to run out, and the file is taken again; when the
// attempts are used up the sweeper fails it with TIMEOUT. A finished step starts
// the next one with a fresh count.

import { createHash } from 'crypto';
import { maxFileBytesFor } from '@/lib/content-upload/staging/config';
import type {
  QueueState,
  UnlessMarked,
} from '@/lib/content-upload/staging/repo';
import type { UploadDeps } from '@/lib/content-upload/staging/result';
import {
  canTransitionFile,
  type FileStatus,
  type RunStatus,
} from '@/lib/content-upload/staging/status';
import { UploadStorageError } from '@/lib/content-upload/staging/storage';
import type { FilePatch, FileRow } from '@/lib/content-upload/staging/types';
import { OBJECT_DELETED_KEY } from '@/lib/content-upload/staging/types';

export const MAX_ATTEMPTS = 3;
export const DEFAULT_BUDGET_MS = 8000;
export const MAX_BUDGET_MS = 20_000;
export const MIN_BUDGET_MS = 500;
export const DEFAULT_CONCURRENCY = 3;
/**
 * At most this many files of one run are held at once over all callers (two
 * full pumps). The rate limit of the route counts calls, not held files, so any
 * number of open tabs or retries would otherwise multiply the work in flight
 * (PDF threads, memory, storage reads).
 */
export const MAX_HELD_PER_RUN = DEFAULT_CONCURRENCY * 2;
/** A claim holds longer than a call can work: budget plus the longest step. */
export const DEFAULT_LOCK_SECONDS = 90;
// budget (at most 20 s) plus this stays inside the maxDuration of the pump route (60 s)
export const DEFAULT_STEP_TIMEOUT_MS = 30_000;
/** A file that failed an attempt waits this long (times the attempts) before the next one. */
export const RETRY_DELAY_SECONDS = 5;

// ---------------------------------------------------------------------------
// The step interface
// ---------------------------------------------------------------------------

export interface StepContext {
  file: FileRow;
  /** The bytes of the object, read once per claim (null if the object is gone). */
  loadBytes(maxBytes?: number): Promise<Uint8Array | null>;
  /** Removes the object of the file from the bucket (for a rejection). */
  removeObject(): Promise<boolean>;
}

export type StepResult =
  | {
      kind: 'advance';
      to: FileStatus;
      /** Stable code for `failed` and `rejected` (and a note otherwise). */
      code?: string;
      /** Numbers and finding codes, never document text. */
      patch?: FilePatch;
    }
  | {
      kind: 'retry';
      reason: string;
      /** How long the file waits for the next try (default: delay times attempts). */
      delaySeconds?: number;
    };

/** What a step may ask before the pump takes files for it. */
export interface StepReadyContext {
  runId: string;
  deps: UploadDeps;
}

export interface QueueStep {
  name: string;
  /** The state of the files this step works on. One step per state. */
  from: FileStatus;
  /**
   * A step whose state also holds files that are done with it (the model step: a
   * file it could not help stays `unclear`) names the key of parse_summary that
   * marks them. A file with this key is never claimed again, and does not count as
   * work that is left.
   */
  unlessMarked?: string;
  /**
   * Asked before every batch. When it says no, the files of this state are not
   * claimed and do not count as work that is left (the run may reach review without
   * them). Not asked for a step without it.
   */
  ready?(context: StepReadyContext): Promise<boolean>;
  run(context: StepContext): Promise<StepResult>;
}

/** The slots for the packages that fill in a step. */
export type ExtensionSlot = 'extract' | 'rules' | 'ki' | 'kiCall';

export const EXTENSION_SLOT_STATES: Record<ExtensionSlot, FileStatus> = {
  extract: 'verified',
  rules: 'extracted',
  ki: 'unclear',
  kiCall: 'ki_pending',
};

// ---------------------------------------------------------------------------
// Step 1: check the metadata (the placeholder of U2)
// ---------------------------------------------------------------------------

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Reads the whole object once (at most the limit of its kind) and compares size and SHA-256 with
 * what the browser announced. The storage knows no SHA-256, so this is where it
 * is checked (the complete route can only look at the size and the first bytes).
 * A mismatch rejects the file and deletes the object.
 */
export const verifyMetadataStep: QueueStep = {
  name: 'verify_metadata',
  from: 'uploaded',
  async run(context) {
    const { file } = context;
    const reject = async (code: string): Promise<StepResult> => {
      const removed = await context.removeObject();
      return {
        kind: 'advance',
        to: 'rejected',
        code,
        patch: removed ? { parseSummary: { [OBJECT_DELETED_KEY]: true } } : {},
      };
    };

    let bytes: Uint8Array | null;
    try {
      bytes = await context.loadBytes(maxFileBytesFor(file.ext));
    } catch (error) {
      if (error instanceof UploadStorageError && error.code === 'TOO_LARGE') {
        return reject('TOO_LARGE');
      }
      throw error;
    }
    if (bytes === null) {
      return { kind: 'advance', to: 'failed', code: 'OBJECT_MISSING' };
    }
    if (bytes.length !== file.sizeBytes) return reject('SIZE_MISMATCH');
    if (sha256Hex(bytes) !== file.sha256) return reject('HASH_MISMATCH');
    return {
      kind: 'advance',
      to: 'verified',
      patch: { parseSummary: { sizeVerified: true, hashVerified: true } },
    };
  },
};

/**
 * The pipeline: the placeholder step and the extension slots that were handed
 * in. U3, U4 and U5 pass their step for their slot, nothing else changes.
 */
export function buildSteps(
  extensions: Partial<Record<ExtensionSlot, QueueStep>> = {}
): QueueStep[] {
  const steps: QueueStep[] = [verifyMetadataStep];
  for (const slot of Object.keys(EXTENSION_SLOT_STATES) as ExtensionSlot[]) {
    const step = extensions[slot];
    if (!step) continue;
    if (step.from !== EXTENSION_SLOT_STATES[slot]) {
      throw new Error(
        `The step for ${slot} has to work on ${EXTENSION_SLOT_STATES[slot]} files`
      );
    }
    steps.push(step);
  }
  const froms = steps.map(s => s.from);
  if (new Set(froms).size !== froms.length) {
    throw new Error('Two steps work on files in the same state');
  }
  return steps;
}

export const DEFAULT_STEPS: readonly QueueStep[] = buildSteps();

// ---------------------------------------------------------------------------
// The pump
// ---------------------------------------------------------------------------

export interface PumpOptions {
  steps?: readonly QueueStep[];
  /** Time one call may work, checked before every new batch. */
  budgetMs?: number;
  concurrency?: number;
  /** Files of the run held at once over all calls (default MAX_HELD_PER_RUN). */
  maxHeld?: number;
  maxAttempts?: number;
  lockSeconds?: number;
  stepTimeoutMs?: number;
  /** Seconds a failed file waits per attempt before it is tried again. */
  retryDelaySeconds?: number;
  /** The browser has announced and uploaded everything: the upload phase may end. */
  closeUpload?: boolean;
}

export interface PumpResult {
  /** Files taken by this call. */
  processed: number;
  advanced: number;
  rejected: number;
  failed: number;
  /** Claims given back for another attempt. */
  retried: number;
  /** Results that were not written because the claim was lost to another call. */
  lostClaims: number;
  /** Files that ran out of attempts when their holder died (TIMEOUT). */
  timedOut: number;
  pending: QueueState;
  /** The budget ended the call while there was still work. */
  budgetExhausted: boolean;
  /** Nothing to claim, nothing held, nothing announced: the queue is empty. */
  done: boolean;
  runStatus: RunStatus;
}

export function clampBudget(value: unknown): number {
  const n =
    typeof value === 'number' && Number.isFinite(value)
      ? value
      : DEFAULT_BUDGET_MS;
  return Math.min(MAX_BUDGET_MS, Math.max(MIN_BUDGET_MS, Math.floor(n)));
}

function stepTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('STEP_TIMEOUT')), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function logStepFailure(step: string, file: FileRow, error: unknown) {
  // The name and the code only: the text of an error may hold a path or a query
  const code =
    error instanceof UploadStorageError
      ? error.code
      : error instanceof Error
        ? error.message === 'STEP_TIMEOUT'
          ? 'STEP_TIMEOUT'
          : error.name
        : 'unknown';
  console.error('[content-upload] step failed', {
    step,
    fileId: file.id,
    attempt: file.attempts,
    code,
  });
}

interface Tally {
  advanced: number;
  rejected: number;
  failed: number;
  retried: number;
  lostClaims: number;
}

async function processClaim(
  deps: UploadDeps,
  file: FileRow,
  step: QueueStep | undefined,
  options: Required<
    Pick<PumpOptions, 'maxAttempts' | 'stepTimeoutMs' | 'retryDelaySeconds'>
  >,
  tally: Tally
): Promise<void> {
  const claimId = file.claimId!;
  if (!step) {
    // No step works on this state (the slot is empty): give the claim back
    await deps.repo.releaseClaim(file.id, claimId);
    return;
  }

  const giveUp = async (code: string) => {
    // Out of attempts: the file fails (only where the model allows it)
    if (canTransitionFile(file.status, 'failed')) {
      const done = await deps.repo.finishClaim(
        file.id,
        claimId,
        file.status,
        'failed',
        { code }
      );
      if (done) tally.failed += 1;
      else tally.lostClaims += 1;
    } else {
      await deps.repo.releaseClaim(file.id, claimId);
      tally.retried += 1;
    }
  };
  const again = async (code: string, delaySeconds?: number) => {
    if (file.attempts >= options.maxAttempts) return giveUp(code);
    // The file waits before its next attempt: a transient fault (the storage, a
    // slow network) is not hit three times in one breath, and the retry is a
    // later call of the pump, not the next batch of this one
    const released = await deps.repo.releaseClaim(
      file.id,
      claimId,
      delaySeconds ?? options.retryDelaySeconds * file.attempts
    );
    if (released) tally.retried += 1;
    else tally.lostClaims += 1;
  };

  let bytes: Promise<Uint8Array | null> | null = null;
  const context: StepContext = {
    file,
    loadBytes(maxBytes = maxFileBytesFor(file.ext)) {
      bytes ??= deps.storage().download(file.storagePath, maxBytes);
      return bytes;
    },
    async removeObject() {
      try {
        await deps.storage().remove([file.storagePath]);
        return true;
      } catch {
        return false;
      }
    },
  };

  let result: StepResult;
  try {
    result = await stepTimeout(step.run(context), options.stepTimeoutMs);
  } catch (error) {
    logStepFailure(step.name, file, error);
    return again('STEP_ERROR');
  }

  if (result.kind === 'retry') return again('STEP_ERROR', result.delaySeconds);
  if (!canTransitionFile(file.status, result.to)) {
    // A step must answer with a state of the model: a bug, not a retry
    logStepFailure(step.name, file, new Error('InvalidTransition'));
    return giveUp('STEP_ERROR');
  }
  const done = await deps.repo.finishClaim(
    file.id,
    claimId,
    file.status,
    result.to,
    { code: result.code ?? null, patch: result.patch }
  );
  if (!done) {
    tally.lostClaims += 1;
    return;
  }
  if (result.to === 'rejected') tally.rejected += 1;
  else if (result.to === 'failed') tally.failed += 1;
  else tally.advanced += 1;
}

/** The states of some steps and the markers of the ones that have one. */
function scopeOf(steps: readonly QueueStep[]): {
  statuses: FileStatus[];
  unlessMarked: UnlessMarked;
} {
  const unlessMarked: UnlessMarked = {};
  for (const step of steps) {
    if (step.unlessMarked) unlessMarked[step.from] = step.unlessMarked;
  }
  return { statuses: steps.map(s => s.from), unlessMarked };
}

/** States of a run in which the pump may work. */
export const PUMPABLE_RUN_STATUSES: readonly RunStatus[] = [
  'uploading',
  'processing',
  'review',
];

/**
 * One call of the pump for one run. Works until the time budget is used up, one
 * step per file and claim, `concurrency` files at the same time, then moves the
 * run on when the queue is empty. Any number of calls may run at the same time
 * (two tabs, a retry): the files are claimed atomically.
 */
export async function pumpRun(
  deps: UploadDeps,
  runId: string,
  options: PumpOptions = {}
): Promise<PumpResult> {
  const clock = deps.clock ?? Date.now;
  const steps = options.steps ?? DEFAULT_STEPS;
  const budgetMs = clampBudget(options.budgetMs);
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const maxHeld = options.maxHeld ?? MAX_HELD_PER_RUN;
  // A limit that is no positive whole number (Infinity included) would take
  // nothing and the pump would never work: say so instead of idling
  if (!Number.isInteger(maxHeld) || maxHeld < 1) {
    throw new RangeError('maxHeld must be a positive whole number');
  }
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const lockSeconds = options.lockSeconds ?? DEFAULT_LOCK_SECONDS;
  const stepTimeoutMs = options.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const retryDelaySeconds = options.retryDelaySeconds ?? RETRY_DELAY_SECONDS;
  const stepByState = new Map(steps.map(s => [s.from, s]));
  const started = clock();

  // The steps that may work now: one that is not ready (the model step while the
  // run is still being read, or while the stage is off) takes no files and its
  // state does not count as work that is left
  const activeScope = async () => {
    const active: QueueStep[] = [];
    for (const step of steps) {
      let ready = false;
      try {
        ready = !step.ready || (await step.ready({ runId, deps }));
      } catch (error) {
        // A failing condition (a database hiccup in the model step) must not stop
        // the other steps: the step is not ready, the code is the only thing logged
        console.error('[content-upload] step not ready', {
          step: step.name,
          code: error instanceof Error ? error.name : 'unknown',
        });
      }
      if (ready) active.push(step);
    }
    return scopeOf(active);
  };

  // Files whose holder died too often are failed first
  const everything = scopeOf(steps);
  const timedOut = await deps.repo.failExhausted(
    runId,
    everything.statuses,
    maxAttempts,
    'TIMEOUT',
    everything.unlessMarked
  );

  const tally: Tally = {
    advanced: 0,
    rejected: 0,
    failed: 0,
    retried: 0,
    lostClaims: 0,
  };
  let processed = 0;
  let budgetExhausted = false;
  for (;;) {
    if (clock() - started >= budgetMs) {
      budgetExhausted = true;
      break;
    }
    const scope = await activeScope();
    const claimed = await deps.repo.claimFiles(runId, {
      statuses: scope.statuses,
      unlessMarked: scope.unlessMarked,
      limit: concurrency,
      lockSeconds,
      maxAttempts,
      maxHeld,
    });
    if (claimed.length === 0) break;
    processed += claimed.length;
    await Promise.all(
      claimed.map(file =>
        processClaim(
          deps,
          file,
          stepByState.get(file.status),
          { maxAttempts, stepTimeoutMs, retryDelaySeconds },
          tally
        )
      )
    );
  }

  // The upload is closed first: a step that waits for the processing state (the
  // model step) must see the state this very call leads to
  if (options.closeUpload === true) {
    const announced = await deps.repo.queueState(runId, [], maxAttempts);
    if (announced.announced === 0) {
      await deps.repo.transitionRun(runId, ['uploading'], 'processing');
    }
  }
  const last = await activeScope();
  const pending = await deps.repo.queueState(
    runId,
    last.statuses,
    maxAttempts,
    last.unlessMarked
  );
  const runStatus = await moveRunOn(
    deps,
    runId,
    pending,
    options.closeUpload === true
  );
  await deps.repo.touchRun(runId);
  return {
    processed,
    ...tally,
    timedOut,
    pending,
    // Work that is left and was not even started
    budgetExhausted: budgetExhausted && pending.claimable > 0,
    done:
      pending.claimable === 0 &&
      pending.locked === 0 &&
      pending.announced === 0,
    runStatus,
  };
}

/**
 * Run states follow the queue (concept 2.3), and only along the transitions of
 * the model:
 *   review      -> processing  there is work again ("Weiterverarbeiten")
 *   uploading   -> processing  the browser closed the upload and nothing is
 *                              announced any more
 *   processing  -> review      nothing to claim, nothing held, nothing announced
 */
async function moveRunOn(
  deps: UploadDeps,
  runId: string,
  state: QueueState,
  closeUpload: boolean
): Promise<RunStatus> {
  let run = await deps.repo.getRun(runId);
  if (!run) return 'discarded';
  const step = async (from: RunStatus, to: RunStatus) => {
    const moved = await deps.repo.transitionRun(runId, [from], to);
    if (moved) run = moved;
    else run = (await deps.repo.getRun(runId)) ?? run;
  };
  if (run.status === 'review' && state.claimable > 0) {
    await step('review', 'processing');
  }
  if (run.status === 'uploading' && closeUpload && state.announced === 0) {
    await step('uploading', 'processing');
  }
  if (
    run.status === 'processing' &&
    state.announced === 0 &&
    state.claimable === 0 &&
    state.locked === 0
  ) {
    await step('processing', 'review');
  }
  return run.status;
}
