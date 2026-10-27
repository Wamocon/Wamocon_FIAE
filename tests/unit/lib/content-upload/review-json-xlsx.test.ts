/**
 * @jest-environment node
 */
// The review of a quiz JSON file and of the Excel mapping file (package UP2): the
// proposal of the rule stage, the status codes of files that are refused, what the list
// shows and what a decision may do with them. The files go through the real steps of the
// queue on the in-memory repositories.
import { writeDecisions } from '@/lib/content-upload/review/decisions';
import {
  loadReviewContext,
  reviewList,
} from '@/lib/content-upload/review/service';
import { parseDecisionRequest } from '@/lib/content-upload/review/validate';
import { extractQuizJson } from '@/lib/content-upload/review/json-step';
import { extractMappingXlsx } from '@/lib/content-upload/review/xlsx-step';
import type { FileRow } from '@/lib/content-upload/staging/types';
import { transferDecisions } from '@/lib/content-upload/transfer/preset';
import { OBJECT_DELETED_KEY } from '@/lib/content-upload/staging/types';

import {
  clone,
  jsonQuiz,
  lessonFile,
  sampleLesson,
} from '../../content-import/quiz-json/fixtures';
import {
  globalJsonSeed,
  lessonJsonSeed,
  mappingSeed,
  rawSeed,
} from '../../../helpers/jsonXlsxSeeds';
import {
  enablerFile,
  reviewRun,
  type ReviewRun,
} from '../../../helpers/reviewFixtures';
import { changed, withEntry, zeroBomb } from '../../../helpers/xlsxHostile';
import { CANARY_WORDS } from '../../../helpers/uploadFixtures';
import { USER } from '../../../helpers/uploadServiceFixtures';
import { DIR } from '../../../helpers/classifyFixtures';

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

const records = (r: ReviewRun) => r.ctx.review.listRecords(r.run.id);
const only = async (r: ReviewRun) => (await records(r))[0];
const OK = <T>(result: { ok: boolean; data?: T }) => {
  expect(result.ok).toBe(true);
  return (result as { data: T }).data;
};

describe('a quiz JSON file in the review', () => {
  it('becomes a proposal of its kind, read from the head, with no code to assign', async () => {
    const r = await reviewRun([lessonJsonSeed()]);
    const record = await only(r);
    expect(record.file.status).toBe('proposed_rules');
    expect(record.file.docType).toBe('quiz');
    expect(record.proposal).toMatchObject({
      source: 'content',
      docType: 'quiz',
      componentCode: null,
      enablerCode: null,
      quizLevel: null,
      band: 'high',
      confidence: 0.95,
      model: null,
    });
    expect(record.proposal?.reasons.map(x => x.code)).toContain('JSON_HEAD');
    expect(record.file.parseSummary).toMatchObject({
      contents: 'quiz_json',
      jsonKind: 'lesson',
      quizzes: 5,
      sets: 15,
      questions: 150,
      setsWithErrors: 0,
      ruleStatus: 'proposed_rules',
    });
    expect(record.file.dupKey).toBeNull();
  });

  it('reads global quizzes by their head as well', async () => {
    const r = await reviewRun([globalJsonSeed()]);
    const record = await only(r);
    expect(record.proposal).toMatchObject({
      docType: 'global_quiz',
      band: 'high',
    });
    expect(record.file.parseSummary).toMatchObject({
      jsonKind: 'global',
      quizzes: 5,
      questions: 100,
    });
  });

  it('takes the kind from the content, not from the file name', async () => {
    const r = await reviewRun([globalJsonSeed('enabler-quizze.json')]);
    const record = await only(r);
    // the name says enabler quizzes, the content global quizzes
    expect(record.proposal).toMatchObject({
      docType: 'global_quiz',
      band: 'conflict',
      confidence: 0.3,
    });
    expect(record.proposal?.reasons.map(x => x.code)).toEqual(
      expect.arrayContaining(['JSON_HEAD', 'CONFLICT_TYPE'])
    );
    // a conflict is never taken with one click
    const result = OK(
      await decide(r, {
        command: 'set',
        items: [{ fileId: record.file.id, action: 'accept' }],
      })
    ) as { written: number; skipped: Array<{ code: string }> };
    expect(result.written).toBe(0);
    expect(result.skipped[0].code).toBe('ASSIGNMENT_REQUIRED');
  });

  it('shows what the file holds as numbers and never a question, an answer or a title', async () => {
    const r = await reviewRun([lessonJsonSeed(), globalJsonSeed()]);
    const list = await reviewList(r.ctx.reviewDeps, r.run, {});
    const json = JSON.stringify(list);
    for (const word of CANARY_WORDS) expect(json).not.toContain(word);
    expect(json).not.toMatch(/Erfundene Frage|Begründung|ZETA|Antwort/);
    expect(json).not.toContain('upload/');
    const lesson = list.rows.find(x => x.fileName === 'enabler-quizze.json')!;
    expect(lesson.ext).toBe('json');
    expect(lesson.contents).toEqual({
      kind: 'quiz_json',
      variant: 'lesson',
      numbers: {
        quizzes: 5,
        sets: 15,
        questions: 150,
        setsWithErrors: 0,
        errors: 0,
        warnings: 0,
        unmapped: 0,
      },
    });
    expect(lesson.effective).toEqual({
      docType: 'quiz',
      componentCode: null,
      enablerCode: null,
      quizLevel: null,
    });
    expect(lesson.derived).toBeNull();
    expect(lesson.duplicate).toBeNull();
  });

  it('is taken by accept all safe ones, with the type of the file and no code', async () => {
    const r = await reviewRun([lessonJsonSeed(), globalJsonSeed()]);
    const result = OK(await decide(r, { command: 'accept_high' })) as {
      written: number;
      eligible: number;
      skipped: unknown[];
    };
    expect(result).toMatchObject({ written: 2, eligible: 2, skipped: [] });
    const decided = r.ctx.review.decisionRows.filter(d => d.isCurrent);
    expect(
      decided
        .map(d => [
          d.action,
          d.docType,
          d.componentCode,
          d.enablerCode,
          d.quizLevel,
        ])
        .sort()
    ).toEqual([
      ['accept', 'global_quiz', null, null, null],
      ['accept', 'quiz', null, null, null],
    ]);
  });

  it('counts errors in some sets as medium, with a reason that no click overrides', async () => {
    const file = clone(sampleLesson());
    file.quizzes[1].difficulties.leicht.questions[0].correct_answer = 'Z';
    const r = await reviewRun([lessonJsonSeed('mit-fehler.json', file)]);
    const record = await only(r);
    expect(record.proposal).toMatchObject({ band: 'medium', confidence: 0.7 });
    expect(record.proposal?.reasons.map(x => x.code)).toContain(
      'PARSER_ERRORS'
    );
    expect(record.file.parseSummary).toMatchObject({ setsWithErrors: 1 });
    const list = await reviewList(r.ctx.reviewDeps, r.run, {});
    // neither "all safe ones" nor "same reasons" take it
    expect(list.counts.acceptableHigh).toBe(0);
    expect(list.counts.mediumGroups).toEqual([]);
    const noClick = OK(await decide(r, { command: 'accept_high' })) as {
      written: number;
    };
    expect(noClick.written).toBe(0);
    // a person accepts it on purpose
    const one = OK(
      await decide(r, {
        command: 'set',
        items: [{ fileId: record.file.id, action: 'accept' }],
      })
    ) as { written: number };
    expect(one.written).toBe(1);
  });

  it('keeps the person from giving it a component, an enabler, a level or another type', async () => {
    const r = await reviewRun([lessonJsonSeed()]);
    const id = (await only(r)).file.id;
    for (const assignment of [
      { componentCode: 'K1' },
      { enablerCode: 'K1-a' },
      { quizLevel: 'low' },
    ]) {
      const result = OK(
        await decide(r, { command: 'assign', fileIds: [id], assignment })
      ) as { written: number; skipped: Array<{ code: string }> };
      expect(result.written).toBe(0);
      expect(result.skipped[0].code).toBe('ASSIGNMENT_INVALID');
    }
    for (const docType of ['global_quiz', 'enabler', 'pdf_original', 'other']) {
      const result = OK(
        await decide(r, {
          command: 'assign',
          fileIds: [id],
          assignment: { docType },
        })
      ) as { written: number; skipped: Array<{ code: string }> };
      expect(result.written).toBe(0);
      expect(result.skipped[0].code).toBe('TYPE_EXT_MISMATCH');
    }
    expect(r.ctx.review.decisionRows).toHaveLength(0);
  });

  it('is rejected or deferred like any file, and the values stay', async () => {
    const r = await reviewRun([lessonJsonSeed()]);
    const id = (await only(r)).file.id;
    OK(await decide(r, { command: 'bulk', action: 'reject', fileIds: [id] }));
    const rejected = r.ctx.review.decisionRows.find(d => d.isCurrent)!;
    expect(rejected).toMatchObject({ action: 'reject', docType: 'quiz' });
  });

  it('reads a file between 25 and 32 MB (the limit of a JSON file), where a Word file would be refused', async () => {
    const body = new TextEncoder().encode(JSON.stringify(sampleLesson()));
    const big = new Uint8Array(26 * 1024 * 1024);
    big.fill(0x20);
    big.set(body, 0);
    const r = await reviewRun([rawSeed('q/gross.json', big)]);
    const record = await only(r);
    expect(record.file.sizeBytes).toBeGreaterThan(25 * 1024 * 1024);
    expect(record.file.status).toBe('proposed_rules');
    expect(record.proposal?.band).toBe('high');
  });

  it('does not let a JSON file name a folder tree (its path is no source path)', async () => {
    const r = await reviewRun([
      lessonJsonSeed('a.json'),
      await enablerFile('1a'),
      rawSeed(
        `${DIR.k6_1}/Szenario/nicht-quiz.json`,
        JSON.stringify(sampleLesson())
      ),
    ]);
    const list = await reviewList(r.ctx.reviewDeps, r.run, {});
    const word = list.rows.find(x => x.ext === 'docx')!;
    expect(word.proposal?.band).toBe('high');
    // no component or enabler appears out of the path of the JSON files
    expect(
      list.rows
        .filter(x => x.ext === 'json')
        .every(x => x.effective.componentCode === null)
    ).toBe(true);
  });
});

describe('a quiz JSON file that is refused', () => {
  const refused = async (seed: ReturnType<typeof rawSeed>, code: string) => {
    const r = await reviewRun([seed]);
    const record = await only(r);
    expect(record.file.status).toBe('rejected');
    expect(record.file.statusCode).toBe(code);
    expect(record.proposal).toBeNull();
    expect(record.file.parseSummary?.[OBJECT_DELETED_KEY]).toBe(true);
    return r;
  };

  it.each([
    ['not json text', 'x.json', '{ das ist kein json', 'NOT_JSON'],
    ['an array', 'x.json', '[{"schema_version":"1.0"}]', 'NOT_A_JSON'],
    ['a number', 'x.json', '42', 'NOT_A_JSON'],
    ['no quiz file', 'x.json', '{"hello":"world"}', 'NOT_QUIZ_JSON'],
    [
      'another schema version',
      'x.json',
      JSON.stringify({ ...sampleLesson(), schema_version: '2.0' }),
      'SCHEMA_VERSION',
    ],
    [
      'no kind in the head',
      'x.json',
      '{"schema_version":"1.0","quiz_count":1,"quizzes":[{"id":"x"}]}',
      'KIND_UNKNOWN',
    ],
    [
      'a wrong head',
      'x.json',
      JSON.stringify({ ...sampleLesson(), quiz_count: 77 }),
      'SCHEMA_REFUSED',
    ],
    ['an empty list', 'x.json', JSON.stringify(lessonFile([])), 'NO_QUIZ'],
  ])(
    'refuses %s with a code and deletes the object',
    async (_n, name, text, code) => {
      await refused(rawSeed(`q/${name}`, text), code);
    }
  );

  it('refuses a file that is no UTF-8, one that holds a zip, and one that is empty of usable sets', async () => {
    const bad = new Uint8Array([123, 34, 0xc3, 0x28, 34, 125]);
    await refused(rawSeed('q/x.json', bad), 'NOT_UTF8');
    const zipped = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
    await refused(rawSeed('q/x.json', zipped), 'NOT_A_JSON');
    const all = clone(sampleLesson());
    all.quizzes = [jsonQuiz({ id: '1a', componentId: '01', dir: DIR.k1 })];
    for (const level of Object.values(all.quizzes[0].difficulties) as any[]) {
      level.questions[0].correct_answer = 'Z';
    }
    all.quiz_count = 1;
    await refused(rawSeed('q/x.json', JSON.stringify(all)), 'NO_USABLE_SET');
  });

  it('refuses a file that starts with a brace but is huge nesting, without throwing', async () => {
    const deep = '{"a":'.repeat(50_000) + '1' + '}'.repeat(50_000);
    await refused(rawSeed('q/x.json', deep), 'TOO_COMPLEX');
  });

  it('says nothing of the content in the code or the summary', async () => {
    const r = await reviewRun([
      rawSeed(
        'q/x.json',
        '{"schema_version":"1.0","geheim":"ZEBRA-Kanarienvogel"}'
      ),
    ]);
    const record = await only(r);
    const text = JSON.stringify([
      record.file.statusCode,
      record.file.parseSummary,
    ]);
    expect(text).not.toMatch(/ZEBRA|Kanarienvogel|geheim/);
  });
});

describe('an Excel mapping file in the review', () => {
  it('becomes a proposal of the type other, recognized by the form of its sheet', async () => {
    const r = await reviewRun([await mappingSeed('beliebiger-name.xlsx')]);
    const record = await only(r);
    expect(record.file.status).toBe('proposed_rules');
    expect(record.file.docType).toBe('other');
    expect(record.proposal).toMatchObject({
      source: 'content',
      docType: 'other',
      componentCode: null,
      band: 'high',
      confidence: 0.95,
    });
    expect(record.proposal?.reasons.map(x => x.code)).toEqual(['XLSX_MAPPING']);
    expect(record.file.parseSummary).toMatchObject({
      contents: 'mapping_xlsx',
      positions: 7,
      blocks: 4,
      blocksWithIssues: 0,
    });
    const list = await reviewList(r.ctx.reviewDeps, r.run, {});
    expect(list.rows[0].contents).toMatchObject({
      kind: 'mapping_xlsx',
      numbers: { positions: 7, blocks: 4 },
    });
    expect(JSON.stringify(list)).not.toMatch(/Position a|Erfundenes/);
  });

  it('is taken by accept all safe ones and keeps its type', async () => {
    const r = await reviewRun([await mappingSeed()]);
    const result = OK(await decide(r, { command: 'accept_high' })) as {
      written: number;
    };
    expect(result.written).toBe(1);
    expect(r.ctx.review.decisionRows[0]).toMatchObject({
      action: 'accept',
      docType: 'other',
      componentCode: null,
    });
    const wrong = OK(
      await decide(r, {
        command: 'assign',
        fileIds: [(await only(r)).file.id],
        assignment: { docType: 'quiz' },
      })
    ) as { written: number; skipped: Array<{ code: string }> };
    expect(wrong.written).toBe(0);
    expect(wrong.skipped[0].code).toBe('TYPE_EXT_MISMATCH');
  });

  it('refuses a workbook that is no mapping table, and every file that must not be processed', async () => {
    const good = (await mappingSeed()).bytes as Buffer;
    const cases: Array<[string, Uint8Array, string]> = [
      [
        'a macro project',
        await withEntry(Buffer.from(good), 'xl/vbaProject.bin', 'x'),
        'MACRO_ENABLED',
      ],
      [
        'linked workbooks',
        await withEntry(Buffer.from(good), 'xl/externalLinks/e1.xml', '<a/>'),
        'EXTERNAL_LINKS',
      ],
      ['a zip bomb', await zeroBomb(Buffer.from(good), 3), 'ZIP_BOMB'],
      [
        'a workbook without the table',
        await changed(Buffer.from(good), async zip => {
          zip.file('xl/sharedStrings.xml', '<sst></sst>');
        }),
        'NOT_A_MAPPING',
      ],
    ];
    for (const [, bytes, code] of cases) {
      const r = await reviewRun([rawSeed('t/x.xlsx', bytes)]);
      const record = await only(r);
      expect(record.file.status).toBe('rejected');
      expect(record.file.statusCode).toBe(code);
      expect(record.file.parseSummary?.[OBJECT_DELETED_KEY]).toBe(true);
    }
  });

  it('fails a workbook that has no sheet to read (all hidden), with the code and no content', async () => {
    const good = (await mappingSeed()).bytes as Buffer;
    const hidden = await changed(Buffer.from(good), async zip => {
      const text = await zip.file('xl/workbook.xml')!.async('string');
      zip.file(
        'xl/workbook.xml',
        text.replace('<sheet name=', '<sheet state="hidden" name=')
      );
    });
    const r = await reviewRun([rawSeed('t/x.xlsx', hidden)]);
    const record = await only(r);
    expect(record.file.status).toBe('failed');
    expect(record.file.statusCode).toBe('NO_SHEET');
    expect(record.proposal).toBeNull();
  });

  it('refuses a file that says xlsx and holds something else, at the upload', async () => {
    const r = await reviewRun([
      rawSeed('t/x.xlsx', '{"schema_version":"1.0"}'),
      rawSeed('t/y.json', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])),
    ]);
    const states = (await records(r)).map(x => [
      x.file.fileName,
      x.file.status,
      x.file.statusCode,
    ]);
    expect(states).toEqual(
      expect.arrayContaining([
        ['x.xlsx', 'rejected', 'NOT_AN_XLSX'],
        ['y.json', 'rejected', 'NOT_A_JSON'],
      ])
    );
  });
});

describe('the steps of a JSON and an Excel file give the claim back instead of guessing', () => {
  const file = (claimId: string | null) =>
    ({
      id: 'f1',
      relPath: 'a/q.json',
      claimId,
    }) as unknown as FileRow;
  const reject = jest.fn(async (code: string) => ({
    kind: 'advance' as const,
    to: 'rejected' as const,
    code,
  }));
  const env = (written: boolean) => ({
    context: async () => ({ decisions: transferDecisions() }),
    writeProposal: jest.fn(async () => written),
  });
  const json = new TextEncoder().encode(JSON.stringify(sampleLesson()));

  it('asks to try again when the file has no claim or the claim was lost to another call', async () => {
    expect(await extractQuizJson(file(null), json, env(true), reject)).toEqual({
      kind: 'retry',
      reason: 'NO_CLAIM',
    });
    expect(await extractQuizJson(file('c1'), json, env(false), reject)).toEqual(
      {
        kind: 'retry',
        reason: 'CLAIM_LOST',
      }
    );
    const xlsx = (await mappingSeed()).bytes;
    expect(
      await extractMappingXlsx(file(null), xlsx, env(true), reject)
    ).toEqual({
      kind: 'retry',
      reason: 'NO_CLAIM',
    });
    expect(
      await extractMappingXlsx(file('c1'), xlsx, env(false), reject)
    ).toEqual({
      kind: 'retry',
      reason: 'CLAIM_LOST',
    });
    expect(reject).not.toHaveBeenCalled();
  });

  it('writes the proposal only once and with no code', async () => {
    const e = env(true);
    const result = await extractQuizJson(file('c1'), json, e, reject);
    expect(result).toMatchObject({ kind: 'advance', to: 'extracted' });
    expect(e.writeProposal).toHaveBeenCalledTimes(1);
    expect(e.writeProposal).toHaveBeenCalledWith(
      'f1',
      'c1',
      expect.objectContaining({
        docType: 'quiz',
        componentCode: null,
        enablerCode: null,
        quizLevel: null,
        model: null,
      })
    );
  });
});
