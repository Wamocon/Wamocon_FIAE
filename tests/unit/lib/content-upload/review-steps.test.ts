/**
 * @jest-environment node
 */
import {
  createExtractStep,
  createRulesStep,
  reviewStepEnv,
  reviewSteps,
  type ReviewStepEnv,
} from '@/lib/content-upload/review/steps';
import { buildPositiveList } from '@/lib/content-upload/classify/positive-list';
import { databaseInput } from '@/lib/content-upload/review/service';
import { decisionsPreset } from '@/lib/content-upload/review/service';
import { OBJECT_DELETED_KEY } from '@/lib/content-upload/staging/types';
import type { FileRow } from '@/lib/content-upload/staging/types';
import { DIR, paths } from '../../../helpers/classifyFixtures';
import {
  DB_COMPONENTS,
  enablerFile,
  macroFile,
  pdfFile,
  quizFile,
  reviewRun,
  scenarioFile,
  unknownFile,
} from '../../../helpers/reviewFixtures';
import { pdfBytes } from '../../../helpers/uploadFixtures';
import { newRun, setup } from '../../../helpers/uploadServiceFixtures';
import { CANARY_WORDS } from '../../../helpers/uploadFixtures';

describe('the steps of the review: from a verified file to its proposal', () => {
  it('leads a quiz, an enabler text and a scenario of the tree to the band high', async () => {
    const { ctx, run } = await reviewRun([
      await quizFile('1a'),
      await enablerFile('1a'),
      await scenarioFile('1a'),
    ]);
    expect(run.status).toBe('review');
    const records = await ctx.review.listRecords(run.id);
    expect(records).toHaveLength(3);
    for (const record of records) {
      expect(record.file.status).toBe('proposed_rules');
      expect(record.proposal?.band).toBe('high');
      expect(record.proposal?.source).toBe('path_content');
      expect(record.proposal?.componentCode).toBe('K1');
      expect(record.proposal?.enablerCode).toBe('K1-a');
    }
    const quiz = records.find(r => r.proposal?.docType === 'quiz')!;
    expect(quiz.proposal).toMatchObject({ quizLevel: 'low', confidence: 0.99 });
    expect(quiz.file.dupKey).toBe('quiz:1a:low');
    expect(quiz.file.docType).toBe('quiz');
  });

  it('keeps only numbers, codes and flags in the summary of the file, never text of the document', async () => {
    const { ctx, run } = await reviewRun([
      await quizFile('1a'),
      await scenarioFile('1a'),
    ]);
    for (const record of await ctx.review.listRecords(run.id)) {
      const json = JSON.stringify([record.file.parseSummary, record.proposal]);
      for (const word of CANARY_WORDS) expect(json).not.toContain(word);
      expect(Object.keys(record.file.parseSummary ?? {}).sort()).toEqual(
        [
          'contentRead',
          'findingCodes',
          'hashVerified',
          'paragraphs',
          'ruleCode',
          'ruleStatus',
          'sizeVerified',
          'withoutSolution',
        ].sort()
      );
    }
  });

  it('leaves a file without the structure of the sources unclear', async () => {
    const { ctx, run } = await reviewRun([await unknownFile()]);
    const [record] = await ctx.review.listRecords(run.id);
    expect(record.file.status).toBe('unclear');
    expect(record.proposal?.band).toBe('low');
    expect(record.proposal?.confidence).toBe(0);
    expect(record.file.statusCode).toBeTruthy();
  });

  it('rejects a Word file with a macro and removes the object from the bucket', async () => {
    const { ctx, run } = await reviewRun([await macroFile()]);
    const [record] = await ctx.review.listRecords(run.id);
    expect(record.file.status).toBe('rejected');
    expect(record.file.statusCode).toBe('MACRO_ENABLED');
    expect(record.proposal).toBeNull();
    expect(record.file.parseSummary?.[OBJECT_DELETED_KEY]).toBe(true);
    expect(ctx.mem.objects.has(record.file.storagePath)).toBe(false);
  });

  it('reads a PDF original and binds it to its type by the path', async () => {
    const lines = Array.from(
      { length: 6 },
      (_, i) => `Eine erfundene Zeile Nummer ${i} mit genug Text für den Test.`
    );
    const { ctx, run } = await reviewRun([
      {
        path: paths.quiz(DIR.k1, '1a', 'Low').replace(/\.docx$/, '.pdf'),
        bytes: pdfBytes({ pages: [lines] }),
      },
    ]);
    const [record] = await ctx.review.listRecords(run.id);
    expect(record.file.pageCount).toBe(1);
    expect(record.proposal?.docType).toBe('pdf_original');
    expect(record.file.dupKey).toBe('pdf:quiz:1a:low');
    expect(['proposed_rules', 'unclear']).toContain(record.file.status);
  });

  it('fails a scanned PDF (no text) with the code NO_TEXT', async () => {
    const { ctx, run } = await reviewRun([pdfFile()]);
    const [record] = await ctx.review.listRecords(run.id);
    expect(record.file.status).toBe('failed');
    expect(record.file.statusCode).toBe('NO_TEXT');
    expect(record.proposal).toBeNull();
  });

  it('skips a file of an archive folder (rule stage) and the run reaches review', async () => {
    const quiz = await quizFile('1a');
    const { ctx, run } = await reviewRun([
      { ...quiz, path: quiz.path.replace('/Quiz/', '/Archiv/Quiz/') },
    ]);
    expect(run.status).toBe('review');
    const [record] = await ctx.review.listRecords(run.id);
    expect(record.file.status).toBe('skipped');
    expect(record.file.statusCode).toBeTruthy();
    expect(record.proposal).not.toBeNull();
  });

  it('writes one current proposal per file, also after a second pass', async () => {
    const { ctx, run, ids } = await reviewRun([await quizFile('1a')]);
    const [record] = await ctx.review.listRecords(run.id);
    // a later pass of the queue replaces the proposal and keeps the history
    const first = record.proposal!.id;
    ctx.repo.files.get(ids[0])!.claimId = 'claim-2';
    await ctx.review.writeProposal(ids[0], 'claim-2', {
      source: 'content',
      docType: 'quiz',
      componentCode: 'K1',
      enablerCode: 'K1-a',
      quizLevel: 'low',
      confidence: 0.95,
      band: 'high',
      reasons: [],
      model: null,
    });
    const current = ctx.review.proposals.filter(
      p => p.fileId === ids[0] && p.isCurrent
    );
    expect(current).toHaveLength(1);
    expect(current[0].id).not.toBe(first);
    expect(ctx.review.proposals.filter(p => p.fileId === ids[0])).toHaveLength(
      2
    );
  });
});

describe('the extract step on its own', () => {
  function stepFile(overrides: Partial<FileRow> = {}): FileRow {
    return {
      id: 'f1',
      runId: 'r1',
      relPath: 'x.docx',
      fileName: 'x.docx',
      ext: 'docx',
      sizeBytes: 10,
      sha256: 'a'.repeat(64),
      clientMtimeMs: null,
      storagePath: 'upload/x',
      status: 'verified',
      statusCode: null,
      attempts: 1,
      lockedUntil: null,
      claimId: 'c1',
      duplicateOfId: null,
      docType: null,
      pageCount: null,
      charCount: null,
      parseSummary: null,
      dupKey: null,
      createdAt: new Date(0),
      completedAt: null,
      processedAt: null,
      ...overrides,
    };
  }
  const env = (write: ReviewStepEnv['writeProposal']): ReviewStepEnv => ({
    context: async () => ({
      list: buildPositiveList(databaseInput(DB_COMPONENTS)),
      decisions: decisionsPreset(),
    }),
    writeProposal: write,
  });

  it('asks for a retry when the claim was lost and the proposal was not written', async () => {
    const bytes = new Uint8Array(await (await quizFile('1a')).bytes);
    const step = createExtractStep(env(async () => false));
    const result = await step.run({
      file: stepFile({ relPath: (await quizFile('1a')).path }),
      loadBytes: async () => bytes,
      removeObject: async () => true,
    });
    expect(result).toEqual({ kind: 'retry', reason: 'CLAIM_LOST' });
  });

  it('fails a file whose object is gone', async () => {
    const step = createExtractStep(env(async () => true));
    const result = await step.run({
      file: stepFile(),
      loadBytes: async () => null,
      removeObject: async () => true,
    });
    expect(result).toMatchObject({
      kind: 'advance',
      to: 'failed',
      code: 'OBJECT_MISSING',
    });
  });

  it('lets an error of the storage through so that the queue counts an attempt', async () => {
    const step = createExtractStep(env(async () => true));
    await expect(
      step.run({
        file: stepFile(),
        loadBytes: async () => {
          throw new Error('storage down');
        },
        removeObject: async () => true,
      })
    ).rejects.toThrow('storage down');
  });

  it('fails a Word file that cannot be read with the code of the reader', async () => {
    const step = createExtractStep(env(async () => true));
    const result = await step.run({
      file: stepFile(),
      loadBytes: async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]),
      removeObject: async () => true,
    });
    expect(result.kind).toBe('advance');
    expect(['failed', 'rejected']).toContain((result as { to: string }).to);
    expect((result as { code?: string }).code).toBeTruthy();
  });
});

describe('the rules step', () => {
  const run = (parseSummary: Record<string, unknown> | null) =>
    createRulesStep().run({
      file: { parseSummary } as unknown as FileRow,
      loadBytes: async () => null,
      removeObject: async () => true,
    });

  it.each([
    ['proposed_rules', null],
    ['unclear', 'NO_STRUCTURE'],
    ['skipped', 'COMPONENT_EXCLUDED'],
  ])('moves the file to %s as the extract step decided', async (to, code) => {
    expect(await run({ ruleStatus: to, ruleCode: code })).toEqual({
      kind: 'advance',
      to,
      ...(code ? { code } : {}),
    });
  });

  it('treats a missing or unknown decision as unclear, never as proposed', async () => {
    expect(await run(null)).toEqual({ kind: 'advance', to: 'unclear' });
    expect(await run({ ruleStatus: 'decided' })).toEqual({
      kind: 'advance',
      to: 'unclear',
    });
  });
});

describe('the context of the steps', () => {
  it('does not keep a fault of the database for the rest of the call', async () => {
    const ctx = setup();
    ctx.review.components = DB_COMPONENTS;
    const run = await newRun(ctx.deps);
    jest
      .spyOn(ctx.review, 'catalogComponents')
      .mockRejectedValueOnce(new Error('database down'));
    const env = reviewStepEnv(ctx.reviewDeps, run.id);
    await expect(env.context()).rejects.toThrow('database down');
    // the next file of the same call gets the context
    const again = await env.context();
    expect(again.list.component('K1')).not.toBeNull();
    // and the context is read once, not for every file
    await env.context();
    expect(ctx.review.catalogComponents).toHaveBeenCalledTimes(2);
  });

  it('asks for a retry, not for a claim that is not there', async () => {
    const step = createExtractStep({
      context: async () => ({
        list: buildPositiveList(databaseInput(DB_COMPONENTS)),
        decisions: decisionsPreset(),
      }),
      writeProposal: async () => true,
    });
    const bytes = new Uint8Array(await (await quizFile('1a')).bytes);
    const result = await step.run({
      file: {
        id: 'f1',
        ext: 'docx',
        relPath: (await quizFile('1a')).path,
        claimId: null,
        parseSummary: null,
      } as unknown as FileRow,
      loadBytes: async () => bytes,
      removeObject: async () => true,
    });
    expect(result).toEqual({ kind: 'retry', reason: 'NO_CLAIM' });
  });
});

describe('the pipeline of the review', () => {
  it('has the slots of the extract and rules steps filled and the model slot empty', () => {
    const steps = reviewSteps({
      context: async () => {
        throw new Error('not needed');
      },
      writeProposal: async () => true,
    });
    expect(steps.map(s => [s.name, s.from])).toEqual([
      ['verify_metadata', 'uploaded'],
      ['extract_and_classify', 'verified'],
      ['rules', 'extracted'],
    ]);
  });
});
