/**
 * @jest-environment node
 */
// The status of the supply in the review list: the column, the filter, the counts, the
// staleness after a correction of the assignment and the mass action "accept new and
// added" (docs/ki-upload-konzept.md 8.9).
import { writeDecisions } from '@/lib/content-upload/review/decisions';
import {
  filterToParams,
  parseFilter,
  stockKeyOf,
} from '@/lib/content-upload/review/filter';
import {
  loadReviewContext,
  reviewList,
} from '@/lib/content-upload/review/service';
import { parseDecisionRequest } from '@/lib/content-upload/review/validate';
import {
  assignmentFingerprint,
  type StockStatus,
} from '@/lib/content-upload/transfer/stock';
import {
  enablerFile,
  macroFile,
  quizFile,
  reviewRun,
  scenarioFile,
  unknownFile,
  type ReviewRun,
} from '../../../helpers/reviewFixtures';
import { USER } from '../../../helpers/uploadServiceFixtures';

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

const list = (r: ReviewRun, filter = {}) =>
  reviewList(r.ctx.reviewDeps, r.run, filter);

/** Stores a comparison for the file the way the transfer does. */
async function store(
  r: ReviewRun,
  fileName: string,
  status: StockStatus,
  extra: { added?: number; assign?: string } = {}
) {
  const rows = (await list(r)).rows;
  const row = rows.find(x => x.fileName === fileName)!;
  const file = r.ctx.repo.files.get(row.id)!;
  file.parseSummary = {
    ...(file.parseSummary ?? {}),
    stock: {
      status,
      added: extra.added ?? 0,
      moved: 0,
      assign: extra.assign ?? assignmentFingerprint(row.effective),
      at: '2026-10-27T10:00:00.000Z',
    },
  };
  return row.id;
}

async function decide(r: ReviewRun, command: Record<string, unknown>) {
  const run = (await r.ctx.repo.getRun(r.run.id))!;
  const records = await r.ctx.review.listRecords(run.id);
  const context = await loadReviewContext(
    r.ctx.reviewDeps,
    run,
    records.map(x => x.file.relPath)
  );
  const parsed = parseDecisionRequest({
    expectedVersion: run.decisionsVersion,
    ...command,
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return writeDecisions(
    r.ctx.reviewDeps,
    run,
    USER,
    parsed.data,
    records,
    context
  );
}

describe('the status of the supply in the list', () => {
  it('is empty before a comparison and counted as none', async () => {
    const r = await standard();
    const answer = await list(r);
    expect(answer.rows.every(x => x.stock === null)).toBe(true);
    expect(answer.counts.stock).toEqual({
      conflict: 0,
      differs: 0,
      extended: 0,
      new: 0,
      unchanged: 0,
      none: 5,
    });
    expect(answer.counts.acceptableStock).toBe(0);
  });

  it('shows the stored status, counts it and filters by it', async () => {
    const r = await standard();
    const rows = (await list(r)).rows;
    const names = rows.map(x => x.fileName);
    const quiz = names.find(n => /Low/i.test(n)) as string;
    const enabler = names.find(n => /^1a\.docx$/i.test(n)) as string;
    const scenario = names.find(n => /Szenario/i.test(n)) as string;
    await store(r, quiz, 'extended', { added: 2 });
    await store(r, enabler, 'unchanged');
    await store(r, scenario, 'differs');
    const answer = await list(r);
    const quizRow = answer.rows.find(x => x.fileName === quiz)!;
    expect(quizRow.stock).toEqual({
      status: 'extended',
      added: 2,
      at: '2026-10-27T10:00:00.000Z',
      stale: false,
    });
    expect(answer.counts.stock).toMatchObject({
      extended: 1,
      unchanged: 1,
      differs: 1,
      none: 2,
    });
    expect(
      (await list(r, { stock: 'differs' })).rows.map(x => x.fileName)
    ).toEqual([scenario]);
    expect((await list(r, { stock: 'none' })).matching).toBe(2);
    expect((await list(r, { stock: 'new' })).matching).toBe(0);
  });

  it('marks a status as stale when the assignment was corrected afterwards, and counts it as none', async () => {
    const r = await standard();
    const names = (await list(r)).rows.map(x => x.fileName);
    const enabler = names.find(n => /^1a\.docx$/i.test(n)) as string;
    const id = await store(r, enabler, 'new', { assign: 'enabler|K1|K1-b|' });
    const row = (await list(r)).rows.find(x => x.id === id)!;
    expect(row.stock?.stale).toBe(true);
    expect(stockKeyOf(row)).toBe('none');
    expect((await list(r)).counts.stock.new).toBe(0);
    expect((await list(r, { stock: 'new' })).matching).toBe(0);
    expect((await list(r)).counts.acceptableStock).toBe(0);
  });

  it('ignores a damaged record in the summary', async () => {
    const r = await standard();
    const row = (await list(r)).rows[0];
    const file = r.ctx.repo.files.get(row.id)!;
    file.parseSummary = {
      ...(file.parseSummary ?? {}),
      stock: { status: 'x' },
    };
    expect((await list(r)).rows.find(x => x.id === row.id)?.stock).toBeNull();
  });

  it('reads and writes the filter in the query string, and ignores a value it does not know', () => {
    expect(parseFilter(new URLSearchParams('stock=extended'))).toEqual({
      stock: 'extended',
    });
    expect(parseFilter(new URLSearchParams('stock=none')).stock).toBe('none');
    expect(parseFilter(new URLSearchParams('stock=%3Cscript%3E'))).toEqual({});
    expect(filterToParams({ stock: 'differs' }).toString()).toBe(
      'stock=differs'
    );
  });
});

describe('"accept new and added"', () => {
  it('takes only files that are new or extended, current, undecided and safe', async () => {
    const r = await standard();
    const names = (await list(r)).rows.map(x => x.fileName);
    const find = (re: RegExp) => names.find(n => re.test(n)) as string;
    const low = find(/Low/i);
    const medium = find(/Medium/i);
    const enabler = find(/^1a\.docx$/i);
    const scenario = find(/Szenario/i);
    const unknown = find(/Sicherung/);
    const macro = find(/Makro/);
    const ids = {
      low: await store(r, low, 'extended', { added: 2 }),
      medium: await store(r, medium, 'differs'),
      enabler: await store(r, enabler, 'new'),
      scenario: await store(r, scenario, 'unchanged'),
      unknown: await store(r, unknown, 'new'),
      macro: await store(r, macro, 'new'),
    };
    const before = await list(r);
    // the unknown file has a proposal of the band low, the macro file is a problem
    expect(before.counts.acceptableStock).toBe(2);

    const outcome = await decide(r, { command: 'accept_stock' });
    expect(outcome.ok && outcome.data).toMatchObject({
      written: 2,
      eligible: 2,
    });
    const after = await list(r);
    const decided = (id: string) =>
      after.rows.find(x => x.id === id)?.decision?.action ?? null;
    expect(decided(ids.low)).toBe('accept');
    expect(decided(ids.enabler)).toBe('accept');
    expect(decided(ids.medium)).toBeNull();
    expect(decided(ids.scenario)).toBeNull();
    expect(decided(ids.unknown)).toBeNull();
    expect(decided(ids.macro)).toBeNull();
    expect(after.counts.acceptableStock).toBe(0);

    // a second click writes nothing more
    const again = await decide(r, { command: 'accept_stock' });
    expect(again.ok && again.data).toMatchObject({ written: 0, eligible: 0 });
  });

  it('never takes a conflict and never a stale status', async () => {
    const r = await standard();
    const names = (await list(r)).rows.map(x => x.fileName);
    const enabler = names.find(n => /^1a\.docx$/i.test(n)) as string;
    const scenario = names.find(n => /Szenario/i.test(n)) as string;
    await store(r, enabler, 'conflict');
    await store(r, scenario, 'new', { assign: 'scenario|K1|K1-c|' });
    const outcome = await decide(r, { command: 'accept_stock' });
    expect(outcome.ok && outcome.data).toMatchObject({
      written: 0,
      eligible: 0,
    });
  });
});

describe('"confirm all with the same reasons" (band medium)', () => {
  const proposalOf = (r: ReviewRun, fileName: string) => {
    const file = [...r.ctx.repo.files.values()].find(
      f => f.fileName === fileName
    )!;
    return r.ctx.review.proposals.find(
      p => p.fileId === file.id && p.isCurrent
    )!;
  };
  const mark = (
    r: ReviewRun,
    name: string,
    band: 'high' | 'medium' | 'low' | 'conflict',
    codes: string[]
  ) => {
    const p = proposalOf(r, name);
    p.band = band;
    p.reasons = codes.map(code => ({ code, text: `Text ${code}` }));
    return p.fileId;
  };

  async function mediumRun() {
    const r = await reviewRun([
      await quizFile('1a', 'Low'),
      await quizFile('1a', 'Medium'),
      await enablerFile('1a'),
      await scenarioFile('1a'),
    ]);
    const names = [...r.ctx.repo.files.values()].map(f => f.fileName);
    const find = (re: RegExp) => names.find(n => re.test(n)) as string;
    return {
      r,
      low: find(/Low/i),
      medium: find(/Medium/i),
      enabler: find(/^1a\.docx$/i),
      scenario: find(/Szenario/i),
    };
  }

  it('offers the groups with the same reasons and takes exactly the chosen one', async () => {
    const { r, low, medium, enabler, scenario } = await mediumRun();
    const a = mark(r, low, 'medium', ['NEW_IN_PLAN', 'PATH_RULE']);
    const b = mark(r, medium, 'medium', ['PATH_RULE', 'NEW_IN_PLAN']);
    const c = mark(r, enabler, 'medium', ['HEADING_VARIANT']);
    mark(r, scenario, 'low', ['NEW_IN_PLAN', 'PATH_RULE']);
    const counts = (await list(r)).counts;
    expect(counts.mediumGroups).toEqual([
      {
        key: 'NEW_IN_PLAN+PATH_RULE',
        text: 'Text NEW_IN_PLAN · Text PATH_RULE',
        count: 2,
      },
      { key: 'HEADING_VARIANT', text: 'Text HEADING_VARIANT', count: 1 },
    ]);
    const outcome = await decide(r, {
      command: 'accept_medium',
      group: 'NEW_IN_PLAN+PATH_RULE',
    });
    expect(outcome.ok && outcome.data).toMatchObject({
      written: 2,
      eligible: 2,
    });
    const rows = (await list(r)).rows;
    const action = (id: string) =>
      rows.find(x => x.id === id)?.decision?.action ?? null;
    expect([action(a), action(b), action(c)]).toEqual(['accept', 'accept', null]);
    // the low proposal with the same reasons stays for a person
    expect(rows.find(x => x.fileName === scenario)?.decision).toBeNull();
    expect((await list(r)).counts.mediumGroups.map(g => g.key)).toEqual([
      'HEADING_VARIANT',
    ]);
  });

  it.each([
    ['SOLUTION_MARKER'],
    ['CONTENT_UNREADABLE'],
    ['INPUT_TRUNCATED'],
    ['ARCHIVE_ABOVE_TREE'],
    ['PARSER_ERRORS'],
  ])('never takes a proposal with the reason %s', async code => {
    const { r, enabler } = await mediumRun();
    mark(r, enabler, 'medium', ['NEW_IN_PLAN', code]);
    expect((await list(r)).counts.mediumGroups).toEqual([]);
    const outcome = await decide(r, {
      command: 'accept_medium',
      group: ['NEW_IN_PLAN', code].sort().join('+'),
    });
    expect(outcome.ok && outcome.data).toMatchObject({
      written: 0,
      eligible: 0,
    });
  });

  it('never takes the band low or conflict and writes nothing for a group that does not exist', async () => {
    const { r, low, medium } = await mediumRun();
    mark(r, low, 'low', ['NEW_IN_PLAN']);
    mark(r, medium, 'conflict', ['NEW_IN_PLAN']);
    const outcome = await decide(r, {
      command: 'accept_medium',
      group: 'NEW_IN_PLAN',
    });
    expect(outcome.ok && outcome.data).toMatchObject({
      written: 0,
      eligible: 0,
    });
    const none = await decide(r, { command: 'accept_medium', group: 'NOTHING' });
    expect(none.ok && none.data).toMatchObject({ written: 0, eligible: 0 });
  });

  it('only reads a group of reason codes from the body', () => {
    for (const group of [
      undefined,
      5,
      '',
      'a b',
      'lower',
      'X;DROP',
      'A+',
      '+A',
      'A'.repeat(201),
    ]) {
      expect(
        parseDecisionRequest({
          expectedVersion: 0,
          command: 'accept_medium',
          group,
        })
      ).toMatchObject({ ok: false, status: 400 });
    }
    expect(
      parseDecisionRequest({
        expectedVersion: 0,
        command: 'accept_medium',
        group: 'A_1+B',
      })
    ).toMatchObject({ ok: true });
  });
});
