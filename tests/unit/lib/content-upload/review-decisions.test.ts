/**
 * @jest-environment node
 */
import { buildRows, countRows } from '@/lib/content-upload/review/build';
import { writeDecisions } from '@/lib/content-upload/review/decisions';
import {
  loadReviewContext,
  reviewDuplicates,
  reviewList,
  reviewOptions,
} from '@/lib/content-upload/review/service';
import { parseDecisionRequest } from '@/lib/content-upload/review/validate';
import { DIR } from '../../../helpers/classifyFixtures';
import {
  enablerFile,
  macroFile,
  quizFile,
  reviewRun,
  scenarioFile,
  unknownFile,
  type ReviewRun,
} from '../../../helpers/reviewFixtures';
import { CANARY_WORDS } from '../../../helpers/uploadFixtures';
import { USER } from '../../../helpers/uploadServiceFixtures';

async function decide(
  r: ReviewRun,
  command: Record<string, unknown>,
  version?: number
) {
  const run = (await r.ctx.repo.getRun(r.run.id))!;
  const records = await r.ctx.review.listRecords(run.id);
  const context = await loadReviewContext(
    r.ctx.reviewDeps,
    run,
    records.map(x => x.file.relPath)
  );
  const parsed = parseDecisionRequest({
    expectedVersion: version ?? run.decisionsVersion,
    ...command,
  });
  if (!parsed.ok) return parsed;
  return writeDecisions(
    r.ctx.reviewDeps,
    run,
    USER,
    parsed.data,
    records,
    context
  );
}

const OK = <T>(result: { ok: boolean; data?: T }) => {
  expect(result.ok).toBe(true);
  return (result as { data: T }).data;
};

const byName = (records: { file: { fileName: string } }[], name: string) =>
  records.find(r => r.file.fileName === name)!;

async function standard(): Promise<ReviewRun> {
  return reviewRun([
    await quizFile('1a', 'Low'),
    await quizFile('1a', 'Medium'),
    await enablerFile('1a'),
    await scenarioFile('1a'),
    await unknownFile(),
    await macroFile(),
  ]);
}

describe('the list of a run', () => {
  it('counts the bands, the problems and the open files of the whole run', async () => {
    const r = await standard();
    const list = await reviewList(r.ctx.reviewDeps, r.run, {});
    expect(list.run.status).toBe('review');
    expect(list.counts).toMatchObject({
      total: 6,
      high: 4,
      low: 1,
      problems: 1,
      open: 5,
      acceptableHigh: 4,
      accepted: 0,
    });
    expect(list.version).toBe(0);
    expect(list.rows).toHaveLength(6);
  });

  it('never carries a storage path, the claim, an excerpt or a part of a solution', async () => {
    const r = await standard();
    const list = await reviewList(r.ctx.reviewDeps, r.run, {});
    const json = JSON.stringify(list);
    for (const word of CANARY_WORDS) expect(json).not.toContain(word);
    expect(json).not.toContain('upload/');
    expect(json).not.toContain('storagePath');
    expect(json).not.toContain('claimId');
    expect(json).not.toContain('parseSummary');
    expect(json).not.toContain('excerpt');
    for (const row of list.rows) {
      expect(Object.keys(row).sort()).toEqual(
        [
          'id',
          'fileName',
          'relPath',
          'ext',
          'sizeBytes',
          'pageCount',
          'status',
          'statusCode',
          'clientMtimeMs',
          'proposal',
          'effective',
          'decision',
          'derived',
          'duplicate',
          'copyOfId',
        ].sort()
      );
    }
  });

  it('shows the reasons as code and short German text', async () => {
    const r = await standard();
    const list = await reviewList(r.ctx.reviewDeps, r.run, { band: 'high' });
    const reasons = list.rows[0].proposal!.reasons;
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      expect(reason.code).toMatch(/^[A-Z_]+$/);
      expect(reason.text.length).toBeLessThanOrEqual(200);
    }
  });

  it('derives mandatory or elective and the phase from the component, not from the file', async () => {
    const r = await standard();
    const list = await reviewList(r.ctx.reviewDeps, r.run, {
      type: undefined,
    } as any);
    const quiz = list.rows.find(x => x.effective.docType === 'quiz')!;
    expect(quiz.derived).toEqual({ kind: 'pflicht', phase: 1 });
  });

  it('offers only the components and enablers of the positive list', async () => {
    const r = await standard();
    const options = await reviewOptions(r.ctx.reviewDeps, r.run);
    expect(options.docTypes).toContain('quiz');
    expect(options.docTypes).not.toContain('other');
    expect(options.quizLevels).toEqual(['low', 'medium', 'high']);
    const k1 = options.components.find(c => c.code === 'K1')!;
    expect(k1.isNew).toBe(false);
    expect(k1.enablers.map(e => e.code)).toEqual(['K1-a', 'K1-b', 'K1-c']);
    expect(options.components.map(c => c.code)).toEqual(['K1', 'K6.1', 'K12']);
  });

  it('marks what only the folder tree of the run would create as new', async () => {
    const r = await reviewRun([await quizFile('5z', 'Low', { code: '5z' })]);
    r.ctx.review.components = [];
    const options = await reviewOptions(r.ctx.reviewDeps, r.run);
    expect(options.components.length).toBeGreaterThan(0);
    expect(options.components.every(c => c.isNew)).toBe(true);
  });
});

describe('writing decisions', () => {
  it('accepts every safe proposal at once and raises the version', async () => {
    const r = await standard();
    const outcome = OK(await decide(r, { command: 'accept_high' }));
    // the two quizzes are two files of one group? no: low and medium are two documents
    expect(outcome.written).toBe(4);
    expect(outcome.version).toBe(1);
    expect(outcome.eligible).toBe(4);
    const records = await r.ctx.review.listRecords(r.run.id);
    const accepted = records.filter(x => x.decision?.action === 'accept');
    expect(accepted).toHaveLength(4);
    for (const record of accepted) {
      expect(record.file.status).toBe('decided');
      expect(record.decision?.decisionsVersion).toBe(0);
      expect(record.decision?.proposalId).toBe(record.proposal?.id);
      expect(record.decision?.decidedById).toBe(USER);
    }
    // the unclear file and the failed one are untouched
    expect(byName(records, 'Sicherung.docx').decision).toBeNull();
    expect(byName(records, 'Makro.docx').decision).toBeNull();
  });

  it('clears the hash of the last dry run on every change of a decision', async () => {
    const r = await standard();
    r.ctx.review.dryRunHash.set(r.run.id, 'hash-of-a-dry-run');
    OK(await decide(r, { command: 'accept_high' }));
    expect(r.ctx.review.dryRunHash.get(r.run.id)).toBeNull();
    r.ctx.review.dryRunHash.set(r.run.id, 'another-hash');
    const records = await r.ctx.review.listRecords(r.run.id);
    OK(
      await decide(r, {
        command: 'set',
        items: [{ fileId: records[0].file.id, action: 'defer' }],
      })
    );
    expect(r.ctx.review.dryRunHash.get(r.run.id)).toBeNull();
  });

  it('does not clear the hash when nothing was written', async () => {
    const r = await standard();
    r.ctx.review.dryRunHash.set(r.run.id, 'keep-me');
    const outcome = OK(
      await decide(r, {
        command: 'set',
        items: [
          { fileId: '11111111-1111-4111-8111-111111111111', action: 'defer' },
        ],
      })
    );
    expect(outcome.written).toBe(0);
    expect(outcome.version).toBe(0);
    expect(outcome.skipped).toEqual([
      {
        fileId: '11111111-1111-4111-8111-111111111111',
        code: 'FILE_NOT_FOUND',
      },
    ]);
    expect(r.ctx.review.dryRunHash.get(r.run.id)).toBe('keep-me');
  });

  it('writes only in the state review: 409 otherwise', async () => {
    const r = await standard();
    for (const status of [
      'processing',
      'uploading',
      'applying',
      'applied',
    ] as const) {
      r.ctx.repo.forceRunStatus(r.run.id, status);
      const result = await decide(r, { command: 'accept_high' });
      expect(result).toMatchObject({
        ok: false,
        status: 409,
        code: 'RUN_STATE',
      });
    }
    expect(r.ctx.review.decisionRows).toHaveLength(0);
  });

  it('refuses a version that is not the current one (409 VERSION_CONFLICT) and writes nothing', async () => {
    const r = await standard();
    OK(await decide(r, { command: 'accept_high' }));
    const records = await r.ctx.review.listRecords(r.run.id);
    const stale = await decide(
      r,
      {
        command: 'set',
        items: [{ fileId: records[0].file.id, action: 'reject' }],
      },
      0
    );
    expect(stale).toMatchObject({
      ok: false,
      status: 409,
      code: 'VERSION_CONFLICT',
    });
    expect((await r.ctx.review.listRecords(r.run.id))[0].decision?.action).toBe(
      'accept'
    );
  });

  it('keeps the history: the old decision loses is_current, nothing is deleted', async () => {
    const r = await standard();
    const [first] = await r.ctx.review.listRecords(r.run.id);
    const id = first.file.id;
    OK(
      await decide(r, {
        command: 'set',
        items: [{ fileId: id, action: 'accept' }],
      })
    );
    OK(
      await decide(r, {
        command: 'set',
        items: [{ fileId: id, action: 'reject' }],
      })
    );
    OK(
      await decide(r, {
        command: 'set',
        items: [{ fileId: id, action: 'defer' }],
      })
    );
    const rows = r.ctx.review.decisionRows.filter(d => d.fileId === id);
    expect(rows.map(d => [d.action, d.isCurrent])).toEqual([
      ['accept', false],
      ['reject', false],
      ['defer', true],
    ]);
  });

  it('takes a proposal in the band high or medium as it stands, never one that is unclear', async () => {
    const r = await standard();
    const records = await r.ctx.review.listRecords(r.run.id);
    const unclear = byName(records, 'Sicherung.docx');
    const result = OK(
      await decide(r, {
        command: 'set',
        items: [{ fileId: unclear.file.id, action: 'accept' }],
      })
    );
    expect(result.written).toBe(0);
    expect(result.skipped).toEqual([
      { fileId: unclear.file.id, code: 'ASSIGNMENT_REQUIRED' },
    ]);
  });

  it('accepts an unclear file when the person names a valid assignment', async () => {
    const r = await standard();
    const records = await r.ctx.review.listRecords(r.run.id);
    const unclear = byName(records, 'Sicherung.docx');
    const result = OK(
      await decide(r, {
        command: 'set',
        items: [
          {
            fileId: unclear.file.id,
            action: 'accept',
            assignment: {
              docType: 'enabler',
              componentCode: 'K1',
              enablerCode: 'K1-b',
            },
          },
        ],
      })
    );
    expect(result.written).toBe(1);
    const after = byName(
      await r.ctx.review.listRecords(r.run.id),
      'Sicherung.docx'
    );
    expect(after.decision).toMatchObject({
      action: 'accept',
      docType: 'enabler',
      componentCode: 'K1',
      enablerCode: 'K1-b',
      quizLevel: null,
    });
    expect(after.file.status).toBe('decided');
  });

  it.each([
    [
      'a component that is not on the list',
      { docType: 'enabler', componentCode: 'K99', enablerCode: 'K99-a' },
      'NOT_IN_POSITIVE_LIST',
    ],
    [
      'an enabler of another component',
      { docType: 'enabler', componentCode: 'K1', enablerCode: 'K12-a' },
      'NOT_IN_POSITIVE_LIST',
    ],
    [
      'a quiz without a level',
      { docType: 'quiz', componentCode: 'K1', enablerCode: 'K1-a' },
      'LEVEL_INVALID',
    ],
    [
      'a level on an enabler text',
      {
        docType: 'enabler',
        componentCode: 'K1',
        enablerCode: 'K1-a',
        quizLevel: 'low',
      },
      'LEVEL_INVALID',
    ],
    [
      'an enabler without a component',
      { docType: 'enabler', enablerCode: 'K1-a' },
      'ASSIGNMENT_INCOMPLETE',
    ],
    [
      'a PDF type on a Word file',
      { docType: 'pdf_original', componentCode: 'K1', enablerCode: 'K1-a' },
      'TYPE_EXT_MISMATCH',
    ],
    [
      'a type that does not exist',
      { docType: 'other', componentCode: 'K1', enablerCode: 'K1-a' },
      'ASSIGNMENT_INCOMPLETE',
    ],
    [
      'an excluded component',
      { docType: 'global_quiz', componentCode: 'K18' },
      'NOT_IN_POSITIVE_LIST',
    ],
  ])('refuses %s', async (_name, assignment, code) => {
    const r = await standard();
    const records = await r.ctx.review.listRecords(r.run.id);
    const target = byName(records, 'Sicherung.docx');
    const result = OK(
      await decide(r, {
        command: 'set',
        items: [{ fileId: target.file.id, action: 'accept', assignment }],
      })
    );
    expect(result.written).toBe(0);
    expect(result.skipped).toEqual([{ fileId: target.file.id, code }]);
  });

  it('rejects and defers with the values that counted before', async () => {
    const r = await standard();
    const records = await r.ctx.review.listRecords(r.run.id);
    const quiz = records.find(x => x.proposal?.docType === 'quiz')!;
    OK(
      await decide(r, {
        command: 'bulk',
        action: 'reject',
        fileIds: [quiz.file.id],
      })
    );
    const after = (await r.ctx.review.listRecords(r.run.id)).find(
      x => x.file.id === quiz.file.id
    )!;
    expect(after.decision).toMatchObject({
      action: 'reject',
      docType: 'quiz',
      componentCode: 'K1',
      enablerCode: 'K1-a',
    });
  });

  it('does not decide a file that failed, was rejected or skipped (FILE_STATE)', async () => {
    const r = await standard();
    const records = await r.ctx.review.listRecords(r.run.id);
    const macro = byName(records, 'Makro.docx');
    const result = OK(
      await decide(r, {
        command: 'bulk',
        action: 'defer',
        fileIds: [macro.file.id],
      })
    );
    expect(result.skipped).toEqual([
      { fileId: macro.file.id, code: 'FILE_STATE' },
    ]);
  });

  it('corrects the assignment of a selection and accepts it (assign)', async () => {
    const r = await standard();
    const records = await r.ctx.review.listRecords(r.run.id);
    const scenario = records.find(x => x.proposal?.docType === 'scenario')!;
    const result = OK(
      await decide(r, {
        command: 'assign',
        fileIds: [scenario.file.id],
        assignment: { enablerCode: 'K1-b' },
      })
    );
    expect(result.written).toBe(1);
    const after = (await r.ctx.review.listRecords(r.run.id)).find(
      x => x.file.id === scenario.file.id
    )!;
    expect(after.decision).toMatchObject({
      action: 'accept',
      docType: 'scenario',
      enablerCode: 'K1-b',
    });
    // the proposal itself is not changed
    expect(after.proposal?.enablerCode).toBe('K1-a');
  });

  it('does not take a file of another run: ids are looked up in the records of the run', async () => {
    const r = await standard();
    const other = await standard();
    const foreign = (await other.ctx.review.listRecords(other.run.id))[0];
    const result = OK(
      await decide(r, {
        command: 'bulk',
        action: 'reject',
        fileIds: [foreign.file.id],
      })
    );
    expect(result.written).toBe(0);
    expect(result.skipped).toEqual([
      { fileId: foreign.file.id, code: 'FILE_NOT_FOUND' },
    ]);
    expect(other.ctx.review.decisionRows).toHaveLength(0);
  });
});

describe('versions of one document (duplicate groups)', () => {
  async function withVersions(): Promise<ReviewRun> {
    const original = await quizFile('1a', 'Low', {
      lastModified: Date.UTC(2026, 8, 3),
    });
    const newer = await quizFile('1a', 'Low', {
      name: '1a_Quiz_Low_v2.docx',
      lastModified: Date.UTC(2026, 9, 12),
      // another content, same key: the bytes differ, so it is no exact copy
      questions: 4,
    });
    return reviewRun([original, newer, await enablerFile('1a')]);
  }

  it('finds the group, suggests the higher version and tells why', async () => {
    const r = await withVersions();
    const { groups } = await reviewDuplicates(r.ctx.reviewDeps, r.run);
    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group.key).toBe('quiz:1a:low');
    expect(group.members).toHaveLength(2);
    const suggested = group.members.find(m => m.suggested)!;
    expect(suggested.fileName).toBe('1a_Quiz_Low_v2.docx');
    expect(suggested.version).toBe(2);
    expect(group.reasons[0].code).toBe('NEWEST_VERSION');
    expect(group.ambiguous).toBe(false);
    expect(group.resolved).toBe(false);
  });

  it('marks the rows of the group and leaves them out of "accept all safe ones"', async () => {
    const r = await withVersions();
    const list = await reviewList(r.ctx.reviewDeps, r.run, {
      duplicates: true,
    });
    expect(list.matching).toBe(2);
    expect(list.counts.duplicates).toBe(2);
    expect(list.counts.acceptableHigh).toBe(1);
    const outcome = OK(await decide(r, { command: 'accept_high' }));
    expect(outcome.written).toBe(1);
    const records = await r.ctx.review.listRecords(r.run.id);
    expect(
      records.filter(x => x.proposal?.docType === 'quiz' && x.decision)
    ).toHaveLength(0);
  });

  it('keeps one version and skips the others in one decision (duplicate)', async () => {
    const r = await withVersions();
    const { groups } = await reviewDuplicates(r.ctx.reviewDeps, r.run);
    const keep = groups[0].members.find(m => m.suggested)!;
    const outcome = OK(
      await decide(r, {
        command: 'duplicate',
        key: groups[0].key,
        keepFileId: keep.fileId,
      })
    );
    expect(outcome.written).toBe(2);
    const records = await r.ctx.review.listRecords(r.run.id);
    const kept = records.find(x => x.file.id === keep.fileId)!;
    expect(kept.decision).toMatchObject({
      action: 'accept',
      dupChoice: 'keep',
    });
    const skipped = records.find(
      x => x.proposal?.docType === 'quiz' && x.file.id !== keep.fileId
    )!;
    expect(skipped.decision).toMatchObject({
      action: 'reject',
      dupChoice: 'skip',
    });
    const after = await reviewDuplicates(r.ctx.reviewDeps, {
      ...r.run,
      decisionsVersion: 1,
    });
    expect(after.groups[0].resolved).toBe(true);
  });

  it('keeps none when the person chooses to take no version', async () => {
    const r = await withVersions();
    const { groups } = await reviewDuplicates(r.ctx.reviewDeps, r.run);
    OK(
      await decide(r, {
        command: 'duplicate',
        key: groups[0].key,
        keepFileId: null,
      })
    );
    const records = await r.ctx.review.listRecords(r.run.id);
    for (const record of records.filter(x => x.proposal?.docType === 'quiz')) {
      expect(record.decision).toMatchObject({
        action: 'reject',
        dupChoice: 'skip',
      });
    }
  });

  it('refuses a file that is not part of the group, and a group that does not exist', async () => {
    const r = await withVersions();
    const { groups } = await reviewDuplicates(r.ctx.reviewDeps, r.run);
    const records = await r.ctx.review.listRecords(r.run.id);
    const enabler = records.find(x => x.proposal?.docType === 'enabler')!;
    expect(
      await decide(r, {
        command: 'duplicate',
        key: groups[0].key,
        keepFileId: enabler.file.id,
      })
    ).toMatchObject({ ok: false, status: 400, code: 'NOT_A_MEMBER' });
    expect(
      await decide(r, {
        command: 'duplicate',
        key: 'quiz:9z:low',
        keepFileId: null,
      })
    ).toMatchObject({ ok: false, status: 404, code: 'GROUP_NOT_FOUND' });
  });

  it('never accepts two versions of one document: the second accept is cut back', async () => {
    const r = await withVersions();
    const records = await r.ctx.review.listRecords(r.run.id);
    const quizzes = records.filter(x => x.proposal?.docType === 'quiz');
    const result = OK(
      await decide(r, {
        command: 'set',
        items: quizzes.map(q => ({ fileId: q.file.id, action: 'accept' })),
      })
    );
    expect(result.written).toBe(0);
    expect(result.skipped.map(s => s.code)).toEqual([
      'DUPLICATE_UNRESOLVED',
      'DUPLICATE_UNRESOLVED',
    ]);
  });

  it('lets one version be accepted when the other is rejected in the same request', async () => {
    const r = await withVersions();
    const records = await r.ctx.review.listRecords(r.run.id);
    const [a, b] = records.filter(x => x.proposal?.docType === 'quiz');
    const result = OK(
      await decide(r, {
        command: 'set',
        items: [
          { fileId: a.file.id, action: 'accept' },
          { fileId: b.file.id, action: 'reject' },
        ],
      })
    );
    expect(result.written).toBe(2);
  });

  it('takes the suggested version of every group that has one (accept_newest)', async () => {
    const r = await withVersions();
    const outcome = OK(await decide(r, { command: 'accept_newest' }));
    expect(outcome.eligible).toBe(1);
    expect(outcome.ambiguousGroups).toBe(0);
    const records = await r.ctx.review.listRecords(r.run.id);
    const kept = records.filter(x => x.decision?.dupChoice === 'keep');
    expect(kept.map(k => k.file.fileName)).toEqual(['1a_Quiz_Low_v2.docx']);
  });

  it('does not guess when the versions are equal and the times are close (no suggestion)', async () => {
    const day = Date.UTC(2026, 9, 12);
    const a = await quizFile('1a', 'Low', {
      name: 'A_Quiz_Low.docx',
      lastModified: day,
    });
    const b = await quizFile('1a', 'Low', {
      name: 'B_Quiz_Low.docx',
      lastModified: day + 3600_000,
      questions: 4,
    });
    const r = await reviewRun([a, b]);
    const { groups } = await reviewDuplicates(r.ctx.reviewDeps, r.run);
    expect(groups[0].suggestedId).toBeNull();
    expect(groups[0].ambiguous).toBe(true);
    const outcome = OK(await decide(r, { command: 'accept_newest' }));
    expect(outcome.written).toBe(0);
    expect(outcome.ambiguousGroups).toBe(1);
  });
});

describe('rows and counts are pure functions of the records', () => {
  it('count the same as the list', async () => {
    const r = await standard();
    const records = await r.ctx.review.listRecords(r.run.id);
    const context = await loadReviewContext(
      r.ctx.reviewDeps,
      r.run,
      records.map(x => x.file.relPath)
    );
    expect(countRows(buildRows(records, context)).total).toBe(6);
  });

  it('use the path of the folder tree of the test', () => {
    expect(DIR.k1).toContain('Erfundenes Thema Eins');
  });
});

// What the reviews of package U6 found: a proposal that needs a person is never
// accepted by a click, not as a single decision, not as the suggested version of a
// group, and what is stored is what the positive list calls it.
describe('proposals that need a person', () => {
  async function twoVersions(): Promise<ReviewRun> {
    const original = await quizFile('1a', 'Low', {
      lastModified: Date.UTC(2026, 8, 3),
    });
    const newer = await quizFile('1a', 'Low', {
      name: '1a_Quiz_Low_v2.docx',
      lastModified: Date.UTC(2026, 9, 12),
      questions: 4,
    });
    return reviewRun([original, newer]);
  }
  const proposalOf = (r: ReviewRun, fileName: string) => {
    const file = [...r.ctx.repo.files.values()].find(
      f => f.fileName === fileName
    )!;
    return r.ctx.review.proposals.find(p => p.fileId === file.id && p.isCurrent)!;
  };

  it.each([
    'SOLUTION_MARKER',
    'CONTENT_UNREADABLE',
    'INPUT_TRUNCATED',
    'ARCHIVE_ABOVE_TREE',
  ])('does not take a proposal with the reason %s as it stands, also in the band medium', async code => {
    const r = await reviewRun([await enablerFile('1a')]);
    const proposal = proposalOf(r, '1a.docx');
    proposal.band = 'medium';
    proposal.reasons = [{ code, text: 'Text' }];
    const id = proposal.fileId;
    const result = OK(
      await decide(r, {
        command: 'set',
        items: [{ fileId: id, action: 'accept' }],
      })
    );
    expect(result).toMatchObject({
      written: 0,
      skipped: [{ fileId: id, code: 'ASSIGNMENT_REQUIRED' }],
    });
  });

  it('takes a proposal in the band medium with ordinary reasons as it stands', async () => {
    const r = await reviewRun([await enablerFile('1a')]);
    const proposal = proposalOf(r, '1a.docx');
    proposal.band = 'medium';
    proposal.reasons = [{ code: 'HEADING_VARIANT', text: 'Text' }];
    const result = OK(
      await decide(r, {
        command: 'set',
        items: [{ fileId: proposal.fileId, action: 'accept' }],
      })
    );
    expect(result.written).toBe(1);
  });

  it('does not accept the suggested version of a group when its proposal is unclear (accept_newest)', async () => {
    const r = await twoVersions();
    proposalOf(r, '1a_Quiz_Low_v2.docx').band = 'low';
    const outcome = OK(await decide(r, { command: 'accept_newest' }));
    expect(outcome.written).toBe(0);
    expect(outcome.skipped.map(s => s.code)).toEqual(['ASSIGNMENT_REQUIRED']);
  });

  it('refuses to keep a version with an unclear proposal in the duplicate view (422)', async () => {
    const r = await twoVersions();
    const unclear = proposalOf(r, '1a_Quiz_Low_v2.docx');
    unclear.band = 'conflict';
    const result = await decide(r, {
      command: 'duplicate',
      key: 'quiz:1a:low',
      keepFileId: unclear.fileId,
    });
    expect(result).toMatchObject({
      ok: false,
      status: 422,
      code: 'ASSIGNMENT_REQUIRED',
    });
    expect(r.ctx.review.decisionRows).toHaveLength(0);
  });

  it('keeps a version whose assignment a person named before (an accepted decision with values)', async () => {
    const r = await twoVersions();
    const unclear = proposalOf(r, '1a_Quiz_Low_v2.docx');
    unclear.band = 'low';
    // the other version is rejected first, so this one can be accepted alone
    const other = proposalOf(r, '1a_Quiz_Low.docx');
    OK(
      await decide(r, {
        command: 'set',
        items: [
          { fileId: other.fileId, action: 'reject' },
          {
            fileId: unclear.fileId,
            action: 'accept',
            assignment: {
              docType: 'quiz',
              componentCode: 'K1',
              enablerCode: 'K1-a',
              quizLevel: 'low',
            },
          },
        ],
      })
    );
    const result = OK(
      await decide(r, {
        command: 'duplicate',
        key: 'quiz:1a:low',
        keepFileId: unclear.fileId,
      })
    );
    expect(result.written).toBe(2);
  });

  it('needs the whole assignment for a proposal that needs a person (assign)', async () => {
    const r = await standard();
    const unclear = (await r.ctx.review.listRecords(r.run.id)).find(
      x => x.file.fileName === 'Sicherung.docx'
    )!;
    const partial = OK(
      await decide(r, {
        command: 'assign',
        fileIds: [unclear.file.id],
        assignment: { docType: 'enabler' },
      })
    );
    expect(partial.written).toBe(0);
    expect(partial.skipped[0].code).toBe('ASSIGNMENT_INCOMPLETE');
    const full = OK(
      await decide(r, {
        command: 'assign',
        fileIds: [unclear.file.id],
        assignment: {
          docType: 'use_case',
          componentCode: 'K1',
          enablerCode: 'K1-b',
        },
      })
    );
    expect(full.written).toBe(1);
  });

  it('stores the codes in the spelling of the positive list, not as they were typed', async () => {
    const r = await standard();
    const unclear = (await r.ctx.review.listRecords(r.run.id)).find(
      x => x.file.fileName === 'Sicherung.docx'
    )!;
    OK(
      await decide(r, {
        command: 'set',
        items: [
          {
            fileId: unclear.file.id,
            action: 'accept',
            assignment: {
              docType: 'use_case',
              componentCode: 'k1',
              enablerCode: 'k1-b',
            },
          },
        ],
      })
    );
    const after = (await r.ctx.review.listRecords(r.run.id)).find(
      x => x.file.id === unclear.file.id
    )!;
    expect(after.decision).toMatchObject({
      componentCode: 'K1',
      enablerCode: 'K1-b',
    });
  });

  it('keeps one accepted version per group also when another member cannot be decided any more (duplicate)', async () => {
    const r = await twoVersions();
    const [a, b] = [...r.ctx.repo.files.values()].filter(
      f => f.runId === r.run.id
    );
    // a was applied earlier: accepted, and no longer decidable
    const stored = r.ctx.review.proposals.find(
      p => p.fileId === a.id && p.isCurrent
    )!;
    r.ctx.review.decisionRows.push({
      id: 'earlier',
      runId: r.run.id,
      fileId: a.id,
      proposalId: stored.id,
      decisionsVersion: 0,
      decidedById: USER,
      action: 'accept',
      docType: 'quiz',
      componentCode: 'K1',
      enablerCode: 'K1-a',
      quizLevel: 'low',
      dupChoice: 'keep',
      note: null,
      decidedAt: new Date(0),
      isCurrent: true,
    });
    r.ctx.repo.forceFileStatus(a.id, 'applied');
    const result = OK(
      await decide(r, {
        command: 'duplicate',
        key: 'quiz:1a:low',
        keepFileId: b.id,
      })
    );
    expect(result.skipped.map(s => s.code)).toContain('DUPLICATE_UNRESOLVED');
    const current = r.ctx.review.decisionRows.filter(
      d => d.isCurrent && d.action === 'accept'
    );
    expect(current.map(d => d.fileId)).toEqual([a.id]);
  });
});

describe('the counts of the bands', () => {
  it('leave out a file that is left out (an archive folder), also in the band filter', async () => {
    const quiz = await quizFile('1a', 'Low');
    const r = await reviewRun([
      { ...quiz, path: quiz.path.replace('/Quiz/', '/Archiv/Quiz/') },
      await enablerFile('1a'),
    ]);
    const list = await reviewList(r.ctx.reviewDeps, r.run, {});
    expect(list.counts).toMatchObject({ total: 2, low: 0, skipped: 1, high: 1 });
    const low = await reviewList(r.ctx.reviewDeps, r.run, { band: 'low' });
    expect(low.matching).toBe(0);
  });
});
