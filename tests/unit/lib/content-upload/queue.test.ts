/**
 * @jest-environment node
 */
import { announceFiles, completeFiles } from '@/lib/content-upload/staging/files';
import {
  DEFAULT_STEPS,
  MAX_ATTEMPTS,
  MAX_BUDGET_MS,
  MAX_HELD_PER_RUN,
  MAX_PUMP_MS,
  buildSteps,
  clampBudget,
  pumpRun,
  stepTimeoutFor,
  verifyMetadataStep,
  type QueueStep,
  type StepContext,
} from '@/lib/content-upload/staging/queue';
import { UploadStorageError } from '@/lib/content-upload/staging/storage';
import type { FileRow } from '@/lib/content-upload/staging/types';
import {
  docxBytes,
  entryFor,
  newRun,
  pdfBytes,
  setup,
} from '../../../helpers/uploadServiceFixtures';

type Ctx = ReturnType<typeof setup>;

/** Files that are announced, uploaded (object in the storage) and reported as done. */
async function uploadedFiles(
  ctx: Ctx,
  runId: string,
  count: number,
  tag = 'f'
) {
  const run = (await ctx.repo.getRun(runId))!;
  const contents = Array.from({ length: count }, (_, i) =>
    i % 2 === 0 ? pdfBytes(`${tag} ${i}`) : docxBytes(`${tag} ${i}`)
  );
  const announced = await announceFiles(ctx.deps, run, {
    files: contents.map((bytes, i) =>
      entryFor(`d/${tag}${i}.${i % 2 === 0 ? 'pdf' : 'docx'}`, bytes)
    ),
  });
  if (!announced.ok) throw new Error(announced.error);
  const ids = announced.data.results.map(r => r.fileId!);
  const rows = await ctx.repo.getFiles(runId, ids);
  for (const row of rows) {
    ctx.mem.put(row.storagePath, contents[ids.indexOf(row.id)]);
  }
  const done = await completeFiles(ctx.deps, run, { fileIds: ids });
  if (!done.ok) throw new Error(done.error);
  return ids;
}

const statusOf = async (ctx: Ctx, runId: string, id: string) =>
  (await ctx.repo.getFiles(runId, [id]))[0];

/** A step that records what it works on and takes `ms` of the repository clock. */
function countingStep(
  ctx: Ctx,
  options: {
    ms?: number;
    from?: QueueStep['from'];
    to?: QueueStep['from'];
  } = {}
) {
  const seen: string[] = [];
  let running = 0;
  let maxRunning = 0;
  const step: QueueStep = {
    name: 'counting',
    from: options.from ?? 'uploaded',
    async run(context: StepContext) {
      seen.push(context.file.id);
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await Promise.resolve();
      await Promise.resolve();
      ctx.repo.advance(options.ms ?? 0);
      running -= 1;
      return { kind: 'advance', to: options.to ?? 'verified' };
    },
  };
  return { step, seen, max: () => maxRunning };
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('the step "verify_metadata" (placeholder of U2)', () => {
  async function stepFor(ctx: Ctx, runId: string, id: string) {
    const file = (await statusOf(ctx, runId, id)) as FileRow;
    const context: StepContext = {
      file,
      loadBytes: max => ctx.storage.download(file.storagePath, max ?? 1 << 30),
      removeObject: async () => {
        try {
          await ctx.storage.remove([file.storagePath]);
          return true;
        } catch {
          return false;
        }
      },
    };
    return { file, context };
  }

  it('verifies size and SHA-256 and moves the file on to verified', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const [id] = await uploadedFiles(ctx, run.id, 1);
    const { context } = await stepFor(ctx, run.id, id);
    expect(await verifyMetadataStep.run(context)).toEqual({
      kind: 'advance',
      to: 'verified',
      patch: { parseSummary: { sizeVerified: true, hashVerified: true } },
    });
  });

  it('rejects a changed content of the same size (hash mismatch) and removes the object', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const [id] = await uploadedFiles(ctx, run.id, 1);
    const { file, context } = await stepFor(ctx, run.id, id);
    // same length, other bytes: the first bytes and the size still pass at upload
    const original = ctx.mem.objects.get(file.storagePath)!.bytes;
    const tampered = new Uint8Array(original);
    tampered[tampered.length - 1] ^= 0xff;
    ctx.mem.put(file.storagePath, tampered);
    const result = await verifyMetadataStep.run(context);
    expect(result).toEqual({
      kind: 'advance',
      to: 'rejected',
      code: 'HASH_MISMATCH',
      patch: { parseSummary: { objectDeleted: true } },
    });
    expect(ctx.mem.objects.has(file.storagePath)).toBe(false);
  });

  it('rejects another size', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const [id] = await uploadedFiles(ctx, run.id, 1);
    const { file, context } = await stepFor(ctx, run.id, id);
    ctx.mem.put(file.storagePath, pdfBytes('a different, longer content'));
    expect(await verifyMetadataStep.run(context)).toMatchObject({
      to: 'rejected',
      code: 'SIZE_MISMATCH',
    });
  });

  it('rejects an object that is larger than the limit', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const [id] = await uploadedFiles(ctx, run.id, 1);
    const { file, context } = await stepFor(ctx, run.id, id);
    const huge: StepContext = {
      ...context,
      loadBytes: async () => {
        throw new UploadStorageError('TOO_LARGE', 'x');
      },
    };
    expect(await verifyMetadataStep.run(huge)).toMatchObject({
      to: 'rejected',
      code: 'TOO_LARGE',
    });
    expect(ctx.mem.objects.has(file.storagePath)).toBe(false);
  });

  it('fails a file whose object vanished, and asks to retry on a read error', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const [id] = await uploadedFiles(ctx, run.id, 1);
    const { file, context } = await stepFor(ctx, run.id, id);
    ctx.mem.objects.delete(file.storagePath);
    expect(await verifyMetadataStep.run(context)).toEqual({
      kind: 'advance',
      to: 'failed',
      code: 'OBJECT_MISSING',
    });
    const broken: StepContext = {
      ...context,
      loadBytes: async () => {
        throw new UploadStorageError('READ_FAILED', 'x');
      },
    };
    await expect(verifyMetadataStep.run(broken)).rejects.toMatchObject({
      code: 'READ_FAILED',
    });
  });

  it('writes no marker when the object could not be removed', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const [id] = await uploadedFiles(ctx, run.id, 1);
    const { file, context } = await stepFor(ctx, run.id, id);
    ctx.mem.put(file.storagePath, pdfBytes('a different, longer content'));
    ctx.mem.failRemoveFor.add(file.storagePath);
    const result = await verifyMetadataStep.run(context);
    expect(result).toEqual({
      kind: 'advance',
      to: 'rejected',
      code: 'SIZE_MISMATCH',
      patch: {},
    });
  });
});

describe('buildSteps: the slots for U3, U4 and U5', () => {
  it('has the placeholder step only, the slots are empty', () => {
    expect(DEFAULT_STEPS.map(s => s.name)).toEqual(['verify_metadata']);
    expect(buildSteps().map(s => s.from)).toEqual(['uploaded']);
  });

  it('takes a step for a slot when it works on the state of that slot', () => {
    const extract: QueueStep = {
      name: 'extract',
      from: 'verified',
      run: async () => ({ kind: 'advance', to: 'extracted' }),
    };
    const rules: QueueStep = { ...extract, name: 'rules', from: 'extracted' };
    const ki: QueueStep = { ...extract, name: 'ki', from: 'unclear' };
    expect(buildSteps({ extract, rules, ki }).map(s => s.name)).toEqual([
      'verify_metadata',
      'extract',
      'rules',
      'ki',
    ]);
  });

  it('refuses a step in the wrong slot', () => {
    const step: QueueStep = {
      name: 'wrong',
      from: 'uploaded',
      run: async () => ({ kind: 'advance', to: 'verified' }),
    };
    expect(() => buildSteps({ extract: step })).toThrow(
      /has to work on verified/
    );
  });
});

describe('clampBudget', () => {
  it('defaults to 8 seconds and stays between half a second and 20 seconds', () => {
    expect(clampBudget(undefined)).toBe(8000);
    expect(clampBudget('x')).toBe(8000);
    expect(clampBudget(NaN)).toBe(8000);
    expect(clampBudget(1)).toBe(500);
    expect(clampBudget(5000.9)).toBe(5000);
    expect(clampBudget(10 ** 9)).toBe(20_000);
  });
});

describe('pumpRun', () => {
  it('verifies every uploaded file and ends the run in review', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const ids = await uploadedFiles(ctx, run.id, 7);
    const result = await pumpRun(ctx.deps, run.id, { closeUpload: true });
    expect(result).toMatchObject({
      processed: 7,
      advanced: 7,
      rejected: 0,
      failed: 0,
      retried: 0,
      lostClaims: 0,
      timedOut: 0,
      budgetExhausted: false,
      done: true,
      runStatus: 'review',
    });
    for (const id of ids) {
      const row = await statusOf(ctx, run.id, id);
      expect(row.status).toBe('verified');
      expect(row.attempts).toBe(0);
      expect(row.claimId).toBeNull();
      expect(row.parseSummary).toEqual({
        sizeVerified: true,
        hashVerified: true,
      });
    }
  });

  it('keeps the run in the upload phase until the browser closes it', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    await uploadedFiles(ctx, run.id, 2);
    const first = await pumpRun(ctx.deps, run.id);
    expect(first.runStatus).toBe('uploading');
    expect(first.processed).toBe(2);
    const closed = await pumpRun(ctx.deps, run.id, { closeUpload: true });
    expect(closed.runStatus).toBe('review');
  });

  it('does not end the upload phase while files are still announced', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    await uploadedFiles(ctx, run.id, 1);
    const current = (await ctx.repo.getRun(run.id))!;
    await announceFiles(ctx.deps, current, {
      files: [entryFor('late/x.pdf', pdfBytes('late'))],
    });
    const result = await pumpRun(ctx.deps, run.id, { closeUpload: true });
    expect(result.runStatus).toBe('uploading');
    expect(result.pending.announced).toBe(1);
    expect(result.done).toBe(false);
  });

  it('rejects a file whose content changed and counts it', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const [good, bad] = await uploadedFiles(ctx, run.id, 2);
    const badRow = await statusOf(ctx, run.id, bad);
    const bytes = new Uint8Array(
      ctx.mem.objects.get(badRow.storagePath)!.bytes
    );
    bytes[bytes.length - 1] ^= 0xff;
    ctx.mem.put(badRow.storagePath, bytes);
    const result = await pumpRun(ctx.deps, run.id, { closeUpload: true });
    expect(result).toMatchObject({ advanced: 1, rejected: 1 });
    expect((await statusOf(ctx, run.id, good)).status).toBe('verified');
    const after = await statusOf(ctx, run.id, bad);
    expect(after.status).toBe('rejected');
    expect(after.statusCode).toBe('HASH_MISMATCH');
    expect(ctx.mem.objects.has(badRow.storagePath)).toBe(false);
  });

  it('works one step per file: a file waits for the next step that is not there', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const [id] = await uploadedFiles(ctx, run.id, 1);
    await pumpRun(ctx.deps, run.id, { closeUpload: true });
    expect((await statusOf(ctx, run.id, id)).status).toBe('verified');
    const again = await pumpRun(ctx.deps, run.id);
    expect(again.processed).toBe(0);
    expect(again.done).toBe(true);
  });

  it('runs the extension steps that were handed in, in order', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const [id] = await uploadedFiles(ctx, run.id, 1);
    const extract: QueueStep = {
      name: 'extract',
      from: 'verified',
      run: async () => ({
        kind: 'advance',
        to: 'extracted',
        patch: {
          docType: 'quiz',
          pageCount: 2,
          parseSummary: { questions: 20 },
        },
      }),
    };
    const rules: QueueStep = {
      name: 'rules',
      from: 'extracted',
      run: async () => ({ kind: 'advance', to: 'proposed_rules' }),
    };
    const result = await pumpRun(ctx.deps, run.id, {
      steps: buildSteps({ extract, rules }),
      closeUpload: true,
    });
    expect(result.processed).toBe(3);
    const row = await statusOf(ctx, run.id, id);
    expect(row.status).toBe('proposed_rules');
    expect(row.docType).toBe('quiz');
    expect(row.pageCount).toBe(2);
    expect(row.parseSummary).toMatchObject({
      questions: 20,
      sizeVerified: true,
    });
  });

  it('stops when the time budget is used up and goes on in the next call', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    await uploadedFiles(ctx, run.id, 10);
    // every file takes one second of the clock, the budget is 2.5 seconds
    const { step, seen } = countingStep(ctx, { ms: 1000 });
    const options = {
      steps: [step],
      concurrency: 1,
      budgetMs: 2500,
      closeUpload: true,
    };
    const first = await pumpRun(ctx.deps, run.id, options);
    expect(first.processed).toBe(3);
    expect(first.budgetExhausted).toBe(true);
    expect(first.done).toBe(false);
    expect(first.pending.claimable).toBe(7);
    expect(first.runStatus).toBe('processing');
    const second = await pumpRun(ctx.deps, run.id, options);
    expect(second.processed).toBe(3);
    await pumpRun(ctx.deps, run.id, options);
    const last = await pumpRun(ctx.deps, run.id, options);
    expect(last.processed).toBe(1);
    expect(last.done).toBe(true);
    expect(last.budgetExhausted).toBe(false);
    expect(last.runStatus).toBe('review');
    expect(new Set(seen).size).toBe(10);
  });

  it('checks the budget before every batch, so a slow batch ends the call', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    await uploadedFiles(ctx, run.id, 9);
    const { step, seen } = countingStep(ctx, { ms: 5000 });
    const result = await pumpRun(ctx.deps, run.id, {
      steps: [step],
      concurrency: 3,
      budgetMs: 4000,
    });
    // the first batch of three runs, then the budget is gone
    expect(seen).toHaveLength(3);
    expect(result.budgetExhausted).toBe(true);
  });

  it('works on at most `concurrency` files at the same time', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    await uploadedFiles(ctx, run.id, 12);
    const { step, max } = countingStep(ctx);
    await pumpRun(ctx.deps, run.id, { steps: [step], concurrency: 3 });
    expect(max()).toBe(3);
  });

  it('never works on one file twice when several pumps run at the same time', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const ids = await uploadedFiles(ctx, run.id, 30);
    const { step, seen } = countingStep(ctx);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        pumpRun(ctx.deps, run.id, { steps: [step], concurrency: 3 })
      )
    );
    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
    expect([...seen].sort()).toEqual([...ids].sort());
    expect(results.reduce((n, r) => n + r.processed, 0)).toBe(30);
    expect(results.reduce((n, r) => n + r.lostClaims, 0)).toBe(0);
    for (const id of ids) {
      expect((await statusOf(ctx, run.id, id)).status).toBe('verified');
    }
  });

  it('holds at most MAX_HELD_PER_RUN files of a run however many pumps run', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const ids = await uploadedFiles(ctx, run.id, 40);
    const { step, seen, max } = countingStep(ctx);
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        pumpRun(ctx.deps, run.id, { steps: [step], concurrency: 3 })
      )
    );
    expect(MAX_HELD_PER_RUN).toBe(6);
    expect(max()).toBeLessThanOrEqual(MAX_HELD_PER_RUN);
    // the limit slows the work down, it never loses a file
    expect([...seen].sort()).toEqual([...ids].sort());
    expect(results.reduce((n, r) => n + r.processed, 0)).toBe(40);
  });

  it('refuses a held limit that is no positive whole number', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    for (const bad of [0, -1, 1.5, Infinity, NaN]) {
      await expect(
        pumpRun(ctx.deps, run.id, { maxHeld: bad })
      ).rejects.toThrow(RangeError);
    }
  });

  it('lets a pump that finds the limit used up leave without working', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    await uploadedFiles(ctx, run.id, 5);
    // two callers that took files and have not finished: the limit is used up
    const held = await ctx.repo.claimFiles(run.id, {
      statuses: ['uploaded'],
      limit: 2,
      lockSeconds: 90,
      maxAttempts: MAX_ATTEMPTS,
    });
    expect(held).toHaveLength(2);
    const { step, seen } = countingStep(ctx);
    const blocked = await pumpRun(ctx.deps, run.id, {
      steps: [step],
      maxHeld: 2,
    });
    expect(blocked.processed).toBe(0);
    expect(seen).toHaveLength(0);
    expect(blocked.pending.locked).toBe(2);
    expect(blocked.done).toBe(false);
    // with room left the same call works
    const free = await pumpRun(ctx.deps, run.id, { steps: [step], maxHeld: 3 });
    expect(free.processed).toBe(3);
  });

  it('takes up a file again after the call that held it died', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const [id] = await uploadedFiles(ctx, run.id, 1);
    // a call that took the file and died: the claim is still there
    const [taken] = await ctx.repo.claimFiles(run.id, {
      statuses: ['uploaded'],
      limit: 1,
      lockSeconds: 90,
      maxAttempts: MAX_ATTEMPTS,
    });
    expect(taken.attempts).toBe(1);
    const blocked = await pumpRun(ctx.deps, run.id);
    expect(blocked.processed).toBe(0);
    expect(blocked.pending.locked).toBe(1);
    expect(blocked.done).toBe(false);
    // the claim runs out
    ctx.repo.advance(91_000);
    const resumed = await pumpRun(ctx.deps, run.id, { closeUpload: true });
    expect(resumed.processed).toBe(1);
    expect(resumed.advanced).toBe(1);
    expect((await statusOf(ctx, run.id, id)).status).toBe('verified');
  });

  it('does not let a call that was replaced overwrite the result of its successor', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const [id] = await uploadedFiles(ctx, run.id, 1);
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => (release = resolve));
    let calls = 0;
    const slowThenFast: QueueStep = {
      name: 'slow',
      from: 'uploaded',
      async run() {
        calls += 1;
        if (calls === 1) {
          await gate;
          return { kind: 'advance', to: 'rejected', code: 'FROM_THE_OLD_CALL' };
        }
        return { kind: 'advance', to: 'verified' };
      },
    };
    const options = { steps: [slowThenFast], lockSeconds: 90 };
    const first = pumpRun(ctx.deps, run.id, options);
    // let the first call take the file and wait inside its step
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(calls).toBe(1);
    // its claim runs out, another call takes the file over and finishes it
    ctx.repo.advance(91_000);
    const second = await pumpRun(ctx.deps, run.id, options);
    expect(second.advanced).toBe(1);
    release();
    const late = await first;
    expect(late.lostClaims).toBe(1);
    const row = await statusOf(ctx, run.id, id);
    expect(row.status).toBe('verified');
    expect(row.statusCode).toBeNull();
  });

  describe('attempts', () => {
    function failing(mode: 'throw' | 'retry' | 'badTransition') {
      const step: QueueStep = {
        name: 'failing',
        from: 'uploaded',
        async run() {
          if (mode === 'throw') throw new Error('secret storage detail');
          if (mode === 'retry') return { kind: 'retry', reason: 'later' };
          return { kind: 'advance', to: 'applied' };
        },
      };
      return step;
    }

    it.each(['throw', 'retry'] as const)(
      'gives the claim back after a failure (%s) and fails the file on the third attempt',
      async mode => {
        const ctx = setup();
        const run = await newRun(ctx.deps);
        const [id] = await uploadedFiles(ctx, run.id, 1);
        const options = { steps: [failing(mode)] };
        const first = await pumpRun(ctx.deps, run.id, options);
        expect(first).toMatchObject({ processed: 1, retried: 1, failed: 0 });
        expect((await statusOf(ctx, run.id, id)).attempts).toBe(1);
        // the file waits before its next attempt: the retry is a later call
        const early = await pumpRun(ctx.deps, run.id, options);
        expect(early.processed).toBe(0);
        expect(early.pending.locked).toBe(1);
        expect(early.done).toBe(false);
        ctx.repo.advance(6_000);
        const second = await pumpRun(ctx.deps, run.id, options);
        expect(second).toMatchObject({ processed: 1, retried: 1, failed: 0 });
        ctx.repo.advance(11_000);
        const third = await pumpRun(ctx.deps, run.id, options);
        expect(third).toMatchObject({ processed: 1, retried: 0, failed: 1 });
        const row = await statusOf(ctx, run.id, id);
        expect(row.status).toBe('failed');
        expect(row.statusCode).toBe('STEP_ERROR');
        // nothing is claimed any more
        const fourth = await pumpRun(ctx.deps, run.id, options);
        expect(fourth.processed).toBe(0);
        expect(MAX_ATTEMPTS).toBe(3);
      }
    );

    it('retries within one call only once per file, the next attempt is a new call', async () => {
      const ctx = setup();
      const run = await newRun(ctx.deps);
      await uploadedFiles(ctx, run.id, 1);
      const result = await pumpRun(ctx.deps, run.id, {
        steps: [failing('throw')],
      });
      expect(result.processed).toBe(1);
    });

    it('does not put the text of an error into the log', async () => {
      const ctx = setup();
      const run = await newRun(ctx.deps);
      await uploadedFiles(ctx, run.id, 1);
      await pumpRun(ctx.deps, run.id, { steps: [failing('throw')] });
      const logged = JSON.stringify((console.error as jest.Mock).mock.calls);
      expect(logged).toContain('content-upload');
      expect(logged).not.toContain('secret storage detail');
    });

    it('fails a file whose step answers with a state the model does not allow', async () => {
      const ctx = setup();
      const run = await newRun(ctx.deps);
      const [id] = await uploadedFiles(ctx, run.id, 1);
      const result = await pumpRun(ctx.deps, run.id, {
        steps: [failing('badTransition')],
      });
      expect(result.failed).toBe(1);
      expect((await statusOf(ctx, run.id, id)).status).toBe('failed');
    });

    it('treats a step that takes too long as a failed attempt', async () => {
      const ctx = setup();
      const run = await newRun(ctx.deps);
      const [id] = await uploadedFiles(ctx, run.id, 1);
      const hang: QueueStep = {
        name: 'hang',
        from: 'uploaded',
        run: () => new Promise(() => undefined),
      };
      const result = await pumpRun(ctx.deps, run.id, {
        steps: [hang],
        stepTimeoutMs: 20,
      });
      expect(result.retried).toBe(1);
      expect((await statusOf(ctx, run.id, id)).claimId).toBeNull();
    });

    it('gives a step its own time limit, and an explicit option of the call wins', async () => {
      const ctx = setup();
      const run = await newRun(ctx.deps);
      const [id] = await uploadedFiles(ctx, run.id, 1);
      const slow: QueueStep = {
        name: 'slow',
        from: 'uploaded',
        timeoutMs: 20,
        run: () => new Promise(() => undefined),
      };
      // no option of the call: the limit of the step ends the attempt
      const result = await pumpRun(ctx.deps, run.id, { steps: [slow] });
      expect(result.retried).toBe(1);
      expect((await statusOf(ctx, run.id, id)).claimId).toBeNull();

      // a step that takes 60 ms is fine under its own limit of 500 ms ...
      const ctx2 = setup();
      const run2 = await newRun(ctx2.deps);
      await uploadedFiles(ctx2, run2.id, 1);
      const patient: QueueStep = {
        name: 'patient',
        from: 'uploaded',
        timeoutMs: 500,
        run: () =>
          new Promise(resolve =>
            setTimeout(() => resolve({ kind: 'advance', to: 'verified' }), 60)
          ),
      };
      const fine = await pumpRun(ctx2.deps, run2.id, { steps: [patient] });
      expect(fine.advanced).toBe(1);

      // ... and the option of the call (20 ms) still wins over it
      const ctx3 = setup();
      const run3 = await newRun(ctx3.deps);
      await uploadedFiles(ctx3, run3.id, 1);
      const cut = await pumpRun(ctx3.deps, run3.id, {
        steps: [patient],
        stepTimeoutMs: 20,
      });
      expect(cut.retried).toBe(1);
    });

    it('keeps a long step inside the time of the route: the limit shrinks as the call goes on', () => {
      expect(stepTimeoutFor(50_000, 0)).toBe(50_000);
      expect(stepTimeoutFor(50_000, 7_000)).toBe(50_000);
      expect(stepTimeoutFor(50_000, 8_000)).toBe(MAX_PUMP_MS - 8_000);
      expect(stepTimeoutFor(50_000, 20_000)).toBe(MAX_PUMP_MS - 20_000);
      expect(stepTimeoutFor(30_000, 20_000)).toBe(30_000);
      expect(stepTimeoutFor(50_000, MAX_PUMP_MS)).toBe(1000);
      expect(stepTimeoutFor(50_000, MAX_PUMP_MS + 5000)).toBe(1000);
      expect(MAX_PUMP_MS).toBeLessThan(60_000);
      expect(MAX_BUDGET_MS).toBeLessThan(MAX_PUMP_MS);
    });

    it('tells the step the limit it really has, so it can plan its waits inside it', async () => {
      const seen: Array<number | undefined> = [];
      const make = (timeoutMs?: number): QueueStep => ({
        name: 'look',
        from: 'uploaded',
        timeoutMs,
        run: async context => {
          seen.push(context.stepTimeoutMs);
          return { kind: 'advance', to: 'verified' };
        },
      });
      for (const [step, option] of [
        [make(50_000), undefined],
        [make(undefined), undefined],
        [make(50_000), 5000],
      ] as const) {
        const ctx = setup();
        const run = await newRun(ctx.deps);
        await uploadedFiles(ctx, run.id, 1);
        await pumpRun(ctx.deps, run.id, {
          steps: [step],
          stepTimeoutMs: option,
        });
      }
      expect(seen[0]).toBeLessThanOrEqual(50_000);
      expect(seen[0]).toBeGreaterThan(40_000);
      expect(seen[1]).toBeLessThanOrEqual(30_000);
      expect(seen[2]).toBe(5000);
    });

    it('fails a file with TIMEOUT when its holder died on every attempt', async () => {
      const ctx = setup();
      const run = await newRun(ctx.deps);
      const [id] = await uploadedFiles(ctx, run.id, 1);
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const got = await ctx.repo.claimFiles(run.id, {
          statuses: ['uploaded'],
          limit: 1,
          lockSeconds: 90,
          maxAttempts: MAX_ATTEMPTS,
        });
        expect(got).toHaveLength(1);
        ctx.repo.advance(91_000);
      }
      const result = await pumpRun(ctx.deps, run.id, { closeUpload: true });
      expect(result.timedOut).toBe(1);
      expect(result.processed).toBe(0);
      const row = await statusOf(ctx, run.id, id);
      expect(row.status).toBe('failed');
      expect(row.statusCode).toBe('TIMEOUT');
      expect(result.runStatus).toBe('review');
    });
  });

  describe('run status', () => {
    it('picks up work again in a run that is in review', async () => {
      const ctx = setup();
      const run = await newRun(ctx.deps);
      await uploadedFiles(ctx, run.id, 1);
      await pumpRun(ctx.deps, run.id, { closeUpload: true });
      expect((await ctx.repo.getRun(run.id))?.status).toBe('review');
      // a step for the next state arrives (U3): the run goes back to processing
      const extract: QueueStep = {
        name: 'extract',
        from: 'verified',
        run: async () => ({ kind: 'advance', to: 'extracted' }),
      };
      const result = await pumpRun(ctx.deps, run.id, {
        steps: buildSteps({ extract }),
        budgetMs: 500,
        concurrency: 1,
      });
      expect(result.processed).toBe(1);
      expect(result.runStatus).toBe('review');
    });

    it('moves a run in review to processing when work is left after the budget', async () => {
      const ctx = setup();
      const run = await newRun(ctx.deps);
      await uploadedFiles(ctx, run.id, 3);
      await pumpRun(ctx.deps, run.id, { closeUpload: true });
      // more work shows up: three files wait for a new step, one call cannot finish
      const { step } = countingStep(ctx, {
        ms: 1000,
        from: 'verified',
        to: 'extracted',
      });
      const first = await pumpRun(ctx.deps, run.id, {
        steps: [step],
        concurrency: 1,
        budgetMs: 1500,
      });
      expect(first.runStatus).toBe('processing');
      const last = await pumpRun(ctx.deps, run.id, {
        steps: [step],
        concurrency: 1,
        budgetMs: 5000,
      });
      expect(last.runStatus).toBe('review');
    });

    it('claims nothing for a run that was discarded', async () => {
      const ctx = setup();
      const run = await newRun(ctx.deps);
      await uploadedFiles(ctx, run.id, 2);
      await ctx.repo.transitionRun(run.id, ['uploading'], 'discarded');
      const result = await pumpRun(ctx.deps, run.id, { closeUpload: true });
      expect(result.processed).toBe(0);
      expect(result.runStatus).toBe('discarded');
    });

    it('answers for a run that does not exist', async () => {
      const ctx = setup();
      const result = await pumpRun(
        ctx.deps,
        '8b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11'
      );
      expect(result.processed).toBe(0);
      expect(result.runStatus).toBe('discarded');
    });
  });
});

describe('steps that wait for a condition and files that are done with a step', () => {
  /** Files in the state `unclear`, as the rule stage leaves them. */
  async function unclearFiles(ctx: Ctx, runId: string, count: number) {
    const ids = await uploadedFiles(ctx, runId, count, 'u');
    for (const id of ids) {
      ctx.repo.files.get(id)!.status = 'unclear';
    }
    return ids;
  }
  const toPending = (
    extra: Partial<QueueStep> = {}
  ): { step: QueueStep; seen: string[] } => {
    const seen: string[] = [];
    return {
      seen,
      step: {
        name: 'reserve',
        from: 'unclear',
        async run({ file }) {
          seen.push(file.id);
          return { kind: 'advance', to: 'ki_pending' };
        },
        ...extra,
      },
    };
  };

  it('takes no files of a state while its step is not ready, and does not count them as work', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    await unclearFiles(ctx, run.id, 2);
    let ready = false;
    const { step, seen } = toPending({ ready: async () => ready });
    const first = await pumpRun(ctx.deps, run.id, {
      steps: [step],
      closeUpload: true,
    });
    expect(seen).toHaveLength(0);
    expect(first.pending.claimable).toBe(0);
    expect(first.done).toBe(true);
    // the run is not held back by files that wait for a condition
    expect(first.runStatus).toBe('review');
    ready = true;
    const second = await pumpRun(ctx.deps, run.id, { steps: [step] });
    expect(seen).toHaveLength(2);
    expect(second.advanced).toBe(2);
    expect(second.runStatus).toBe('review');
  });

  it('asks again before every batch and gets the run and the deps', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    await unclearFiles(ctx, run.id, 4);
    const asked: string[] = [];
    const { step } = toPending({
      ready: async context => {
        asked.push(context.runId);
        expect(context.deps).toBe(ctx.deps);
        return true;
      },
    });
    await pumpRun(ctx.deps, run.id, { steps: [step], concurrency: 1 });
    // four batches of one file, a fifth that finds nothing, and the final look
    expect(asked.length).toBeGreaterThanOrEqual(5);
    expect(new Set(asked)).toEqual(new Set([run.id]));
  });

  it('never takes a file again that carries the marker of its step', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const ids = await unclearFiles(ctx, run.id, 3);
    ctx.repo.files.get(ids[0])!.parseSummary = { kiState: 'conflict' };
    const { step, seen } = toPending({ unlessMarked: 'kiState' });
    const result = await pumpRun(ctx.deps, run.id, {
      steps: [step],
      closeUpload: true,
    });
    expect(seen.sort()).toEqual([ids[1], ids[2]].sort());
    expect(result.pending.claimable).toBe(0);
    // the marked file stays where it is and does not keep the run in processing
    expect((await statusOf(ctx, run.id, ids[0])).status).toBe('unclear');
    expect(result.runStatus).toBe('review');
  });

  it('lets a step choose how long a file waits for its next try', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const [id] = await uploadedFiles(ctx, run.id, 1);
    const step: QueueStep = {
      name: 'later',
      from: 'uploaded',
      async run() {
        return { kind: 'retry', reason: 'LATER', delaySeconds: 300 };
      },
    };
    await pumpRun(ctx.deps, run.id, { steps: [step], retryDelaySeconds: 1 });
    const locked = await statusOf(ctx, run.id, id);
    expect(locked.attempts).toBe(1);
    const wait = locked.lockedUntil!.getTime() - ctx.repo.now().getTime();
    expect(wait).toBe(300_000);
  });

  it('knows the slots of the model step and their states', () => {
    const noop = async () => ({ kind: 'advance', to: 'ki_pending' }) as const;
    const steps = buildSteps({
      ki: { name: 'a', from: 'unclear', run: noop },
      kiCall: { name: 'b', from: 'ki_pending', run: noop },
    });
    expect(steps.map(s => s.from)).toEqual([
      'uploaded',
      'unclear',
      'ki_pending',
    ]);
    expect(() =>
      buildSteps({ kiCall: { name: 'b', from: 'unclear', run: noop } })
    ).toThrow();
  });
});

describe('a step whose condition cannot be answered', () => {
  it('is not ready, and the other steps go on', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const ids = await uploadedFiles(ctx, run.id, 2, 'r');
    for (const id of ids) ctx.repo.files.get(id)!.status = 'unclear';
    const waiting: QueueStep = {
      name: 'waits',
      from: 'unclear',
      ready: async () => {
        throw new Error('the database is gone SECRET-DETAIL');
      },
      async run() {
        return { kind: 'advance', to: 'ki_pending' };
      },
    };
    const [more] = await uploadedFiles(ctx, run.id, 1, 'm');
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await pumpRun(ctx.deps, run.id, {
      steps: [verifyMetadataStep, waiting],
      closeUpload: true,
    });
    // the step of the upload check still worked, the waiting step took nothing
    expect((await statusOf(ctx, run.id, more)).status).toBe('verified');
    for (const id of ids) {
      expect((await statusOf(ctx, run.id, id)).status).toBe('unclear');
    }
    expect(result.advanced).toBeGreaterThanOrEqual(1);
    expect(result.runStatus).toBe('review');
    // only the name of the error is logged, never its text
    const printed = JSON.stringify(logged.mock.calls);
    expect(printed).toContain('step not ready');
    expect(printed).not.toContain('SECRET-DETAIL');
  });
});
