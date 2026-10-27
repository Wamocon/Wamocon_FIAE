/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';

import { transferDecisions } from '@/lib/content-upload/transfer/preset';
import {
  MAX_JSON_FILES_PER_TRANSFER,
  buildTransferPlan,
} from '@/lib/content-upload/transfer/plan';
import type {
  ComponentFact,
  EnablerFact,
  TransferFile,
} from '@/lib/content-upload/transfer/types';

import {
  jsonGlobalQuiz,
  jsonQuiz,
  lessonFile,
  globalFile,
} from '../../content-import/quiz-json/fixtures';
import { sampleRows } from '../../content-import/learning-fields/fixtures';
import { makeXlsx } from '../../../helpers/xlsxFixture';
import { changed, validMapping, withEntry } from '../../../helpers/xlsxHostile';
import {
  K4_DIR,
  docx,
  enablerFiles,
  fixtureFile,
  jsonQuizFile,
  xlsxMappingFile,
  type FixtureFile,
} from '../../../helpers/transferFixtures';
import { quizBlocks } from '../../../helpers/uploadFixtures';

const K4: ComponentFact = {
  code: 'K4',
  title: 'Datenbank-Titel Vier',
  reference: '§ 4 Abs. 2 Nr. 4',
  kind: 'pflicht',
  phase: 1,
};

async function plan(
  fixtures: FixtureFile[],
  options: {
    components?: ComponentFact[];
    enablers?: EnablerFact[];
    readBytes?: (file: TransferFile) => Promise<Uint8Array | null>;
  } = {}
) {
  const bytes = new Map(fixtures.map(f => [f.file.id, f.bytes]));
  return buildTransferPlan({
    files: fixtures.map(f => f.file),
    components: options.components ?? [K4],
    enablers: options.enablers,
    decisions: transferDecisions(),
    readBytes: options.readBytes ?? (async f => bytes.get(f.id) ?? null),
    now: new Date('2026-10-27T10:00:00Z'),
  });
}

const k4Quiz = (id: string, count = 10) =>
  jsonQuiz({ id, componentId: '04', dir: K4_DIR, count });

describe('buildTransferPlan: a quiz JSON file of enabler quizzes', () => {
  it('turns every level into a quiz of the plan with the code and the component of a Word file', async () => {
    const file = jsonQuizFile(lessonFile([k4Quiz('4a'), k4Quiz('4b')]));
    const result = await plan([file]);
    expect(result.excluded).toEqual([]);
    expect(result.importPlan.quizzes.map(q => q.code).sort()).toEqual([
      'K4-a-high',
      'K4-a-low',
      'K4-a-medium',
      'K4-b-high',
      'K4-b-low',
      'K4-b-medium',
    ]);
    expect(
      result.importPlan.quizzes.every(q => q.questions.length === 10)
    ).toBe(true);
    // the quiz title names the enabler, so the enablers come with it
    expect(result.importPlan.enablers.map(e => e.code)).toEqual([
      'K4-a',
      'K4-b',
    ]);
    expect(result.importPlan.components.map(c => c.code)).toEqual(['K4']);
    expect(result.plannedFiles).toEqual([
      { id: file.file.id, sha256: file.file.sha256 },
    ]);
  });

  it('gives the same quiz code, enabler and component as a Word file of the same quiz', async () => {
    const word = await enablerFiles({ tree: true });
    const wordQuiz = word.find(f => f.file.decision.docType === 'quiz')!;
    const fromWord = await plan([wordQuiz, word[0]], { components: [] });
    const fromJson = await plan([jsonQuizFile(lessonFile([k4Quiz('4a', 5)]))], {
      components: [],
    });
    const word4aLow = fromWord.importPlan.quizzes.find(
      q => q.code === 'K4-a-low'
    )!;
    const json4aLow = fromJson.importPlan.quizzes.find(
      q => q.code === 'K4-a-low'
    )!;
    expect(json4aLow.code).toBe(word4aLow.code);
    expect(json4aLow.enablerCode).toBe(word4aLow.enablerCode);
    expect(json4aLow.level).toBe(word4aLow.level);
    expect(json4aLow.kind).toBe(word4aLow.kind);
    expect(json4aLow.questions).toHaveLength(word4aLow.questions.length);
    expect(fromJson.importPlan.components[0]).toMatchObject({
      code: fromWord.importPlan.components[0].code,
      group: fromWord.importPlan.components[0].group,
      kind: fromWord.importPlan.components[0].kind,
      phase: fromWord.importPlan.components[0].phase,
    });
  });

  it('takes title, paragraph and group of a component from its row in the database', async () => {
    const result = await plan([jsonQuizFile(lessonFile([k4Quiz('4a')]))]);
    expect(result.importPlan.components[0]).toMatchObject({
      code: 'K4',
      title: 'Datenbank-Titel Vier',
      reference: '§ 4 Abs. 2 Nr. 4',
      group: 'teil1',
    });
  });

  it('plans the quizzes of an enabler that exists without an enabler text (a supply)', async () => {
    const enablers: EnablerFact[] = ['a', 'b'].map((l, i) => ({
      code: `K4-${l}`,
      title: `Titel ${l}`,
      componentCode: 'K4',
      orderIndex: i + 1,
    }));
    const result = await plan([jsonQuizFile(lessonFile([k4Quiz('4a')]))], {
      enablers,
    });
    expect(result.importPlan.quizzes).toHaveLength(3);
    expect(result.skipped).toEqual([]);
  });

  it('lets a Word file of the same run win and names the quiz of the JSON file as set aside', async () => {
    const word = await enablerFiles({ tree: true });
    const json = jsonQuizFile(lessonFile([k4Quiz('4a'), k4Quiz('4b')]));
    const result = await plan([...word, json]);
    const low = result.importPlan.quizzes.find(q => q.code === 'K4-a-low')!;
    // the Word quiz has five questions, the JSON quiz ten: the Word file was taken
    expect(low.questions).toHaveLength(5);
    expect(result.importPlan.quizzes.map(q => q.code)).toContain('K4-b-low');
    const superseded = result.skipped.filter(s => s.code === 'SUPERSEDED');
    expect(superseded.length).toBeGreaterThan(0);
    expect(superseded[0].fileId).toBe(json.file.id);
  });

  it('refuses a file twice: two JSON files with the same quiz are both left out', async () => {
    const one = jsonQuizFile(lessonFile([k4Quiz('4a')]), { name: 'eins.json' });
    const two = jsonQuizFile(lessonFile([k4Quiz('4a'), k4Quiz('4b')]), {
      name: 'zwei.json',
    });
    const three = jsonQuizFile(lessonFile([k4Quiz('4c')]), {
      name: 'drei.json',
    });
    const result = await plan([one, two, three]);
    expect(
      result.excluded
        .map(e => [e.fileId, e.code])
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    ).toEqual(
      [
        [one.file.id, 'JSON_KEY_OVERLAP'],
        [two.file.id, 'JSON_KEY_OVERLAP'],
      ].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    );
    expect(
      result.importPlan.quizzes.every(q => q.code.startsWith('K4-c'))
    ).toBe(true);
  });

  it('does not let a broken copy of a quiz take a good one out of the plan', async () => {
    const good = jsonQuizFile(lessonFile([k4Quiz('4a')]), { name: 'gut.json' });
    const brokenQuiz = k4Quiz('4a');
    for (const level of Object.values(brokenQuiz.difficulties) as any[]) {
      level.questions[0].correct_answer = 'Z';
    }
    // the broken copy sits in a file with a usable quiz of its own
    const broken = jsonQuizFile(lessonFile([brokenQuiz, k4Quiz('4b')]), {
      name: 'kaputt.json',
    });
    const result = await plan([good, broken]);
    expect(result.excluded).toEqual([]);
    expect(result.importPlan.quizzes.map(q => q.code)).toEqual(
      expect.arrayContaining(['K4-a-low', 'K4-b-low'])
    );
  });

  it('takes at most ten JSON files into one transfer and names the others', async () => {
    const letters = 'abcdefghijkl'.split('');
    const files = letters.map(l =>
      jsonQuizFile(lessonFile([k4Quiz(`4${l}`, 3)]), { name: `q-${l}.json` })
    );
    const result = await plan(files);
    expect(MAX_JSON_FILES_PER_TRANSFER).toBe(10);
    const left = result.excluded.filter(e => e.code === 'JSON_TOO_MANY');
    expect(left).toHaveLength(2);
    // the first ten by id are planned, the last two are not
    const ids = files.map(f => f.file.id).sort();
    expect(left.map(e => e.fileId).sort()).toEqual(ids.slice(10));
    expect(result.plannedFiles).toHaveLength(10);
  });

  it('skips a set with an error with its reason and plans the others', async () => {
    const quizzes = [k4Quiz('4a'), k4Quiz('4b')];
    quizzes[1].difficulties.leicht.questions[0].correct_answer = 'Z';
    const result = await plan([jsonQuizFile(lessonFile(quizzes))]);
    const codes = result.importPlan.quizzes.map(q => q.code);
    expect(codes).toContain('K4-a-low');
    expect(codes).not.toContain('K4-b-low');
    expect(codes).toContain('K4-b-medium');
    const skipped = result.skipped.filter(s => s.fileId !== null);
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped[0].fileId).toBe(result.plannedFiles[0].id);
    expect(JSON.stringify(result.skipped)).not.toMatch(/Erfundene Frage/);
  });
});

describe('buildTransferPlan: a quiz JSON file of global quizzes', () => {
  it('plans the global quiz of a component with its twenty questions', async () => {
    const file = jsonQuizFile(globalFile([jsonGlobalQuiz('04')]), {
      kind: 'global',
    });
    const result = await plan([file]);
    expect(result.excluded).toEqual([]);
    const quiz = result.importPlan.quizzes.find(q => q.kind === 'global')!;
    expect(quiz.questions).toHaveLength(20);
    expect(quiz.code).toBe('K4-global');
    expect(result.plannedFiles[0].id).toBe(file.file.id);
  });
});

describe('buildTransferPlan: a JSON file that cannot be used', () => {
  it('leaves out a refused file with a code and not one word of its content', async () => {
    const bad = jsonQuizFile('{"schema_version":"9.9","quizzes":[]}');
    const garbage = jsonQuizFile(
      new TextDecoder().decode(new Uint8Array([123, 34, 120]))
    );
    const result = await plan([bad, garbage]);
    expect(result.excluded.map(e => e.code)).toEqual([
      'JSON_REFUSED',
      'JSON_REFUSED',
    ]);
    expect(result.importPlan.quizzes).toEqual([]);
    expect(JSON.stringify(result.excluded)).not.toMatch(/9\.9/);
  });

  it('leaves out a file whose sets all have errors', async () => {
    const quizzes = [k4Quiz('4a')];
    for (const level of Object.values(quizzes[0].difficulties) as any[]) {
      level.questions[0].correct_answer = 'Z';
    }
    const result = await plan([jsonQuizFile(lessonFile(quizzes))]);
    expect(result.excluded.map(e => e.code)).toEqual(['JSON_NO_USABLE_SET']);
  });

  it('leaves out a file of another kind than the decision names', async () => {
    const asGlobal = jsonQuizFile(lessonFile([k4Quiz('4a')]), {
      kind: 'global',
    });
    const result = await plan([asGlobal]);
    expect(result.excluded.map(e => e.code)).toEqual(['JSON_TYPE_MISMATCH']);
  });

  it('leaves out an object that is gone, an unreadable file and files that were not accepted', async () => {
    const gone = jsonQuizFile(lessonFile([k4Quiz('4a')]), {
      objectDeleted: true,
    });
    const unreadable = jsonQuizFile(lessonFile([k4Quiz('4b')]));
    const missing = jsonQuizFile(lessonFile([k4Quiz('4c')]));
    const rejected = jsonQuizFile(lessonFile([k4Quiz('4d')]), {
      action: 'reject',
    });
    const deferred = jsonQuizFile(lessonFile([k4Quiz('4e')]), {
      action: 'defer',
    });
    const wrongType = fixtureFile(new TextEncoder().encode('{}'), {
      ext: 'json',
      docType: 'enabler',
    });
    const result = await plan(
      [gone, unreadable, missing, rejected, deferred, wrongType],
      {
        readBytes: async f => {
          if (f.id === unreadable.file.id) throw new Error('storage down');
          return null;
        },
      }
    );
    const byFile = new Map(result.excluded.map(e => [e.fileId, e.code]));
    expect(byFile.get(gone.file.id)).toBe('NO_OBJECT');
    expect(byFile.get(unreadable.file.id)).toBe('JSON_UNREADABLE');
    expect(byFile.get(missing.file.id)).toBe('NO_OBJECT');
    expect(byFile.get(rejected.file.id)).toBe('REJECTED');
    expect(byFile.get(deferred.file.id)).toBe('DEFERRED');
    expect(byFile.get(wrongType.file.id)).toBe('NOT_PLANNABLE');
    expect(result.importPlan.quizzes).toEqual([]);
  });

  it('stops with the plan timeout when the time is used up, never with a part of the files', async () => {
    const file = jsonQuizFile(lessonFile([k4Quiz('4a')]));
    await expect(
      buildTransferPlan({
        files: [file.file],
        components: [K4],
        decisions: transferDecisions(),
        readBytes: async () => file.bytes,
        deadline: Date.now() - 1,
      })
    ).rejects.toMatchObject({ code: 'PLAN_TIMEOUT' });
  });
});

describe('buildTransferPlan: an Excel mapping file', () => {
  const enablers: EnablerFact[] = [
    ['K1-a', 'K1'],
    ['K1-b', 'K1'],
    ['K6.1-a', 'K6.1'],
    ['K6.2-d', 'K6.2'],
  ].map(([code, componentCode], i) => ({
    code,
    title: code,
    componentCode,
    orderIndex: i + 1,
  }));
  const components: ComponentFact[] = [
    ['K1', '§ 4 Abs. 2 Nr. 1'],
    ['K6.1', '§ 4 Abs. 2 Nr. 6'],
    ['K6.2', '§ 4 Abs. 2 Nr. 6'],
  ].map(([code, reference]) => ({
    code,
    title: `Titel ${code}`,
    reference,
    kind: 'pflicht',
    phase: 1,
  }));

  it('builds the plan of the learning field import against the catalog', async () => {
    const file = xlsxMappingFile(await validMapping());
    const result = await plan([file], { components, enablers });
    expect(result.excluded).toEqual([]);
    expect(result.learningFileId).toBe(file.file.id);
    expect(result.learningPlan).not.toBeNull();
    expect(result.learningPlan!.learningFields).toHaveLength(13);
    const mapped = result.learningPlan!.mappings.map(m => m.enablerCode);
    expect(mapped).toEqual(expect.arrayContaining(['K1-a', 'K1-b', 'K6.1-a']));
    expect(result.plannedFiles).toEqual([
      { id: file.file.id, sha256: file.file.sha256 },
    ]);
    // the rows that no enabler of the catalog answers are named for the file
    expect(
      result.skipped.every(s => s.fileId === file.file.id && s.code && s.reason)
    ).toBe(true);
    expect(result.skipped.length).toBeGreaterThan(0);
    // no text of a cell in the answer
    expect(JSON.stringify(result.skipped)).not.toMatch(/Position/);
  });

  it('counts the enablers that this transfer brings with it', async () => {
    const mapping = xlsxMappingFile(await validMapping());
    const json = jsonQuizFile(
      lessonFile([
        jsonQuiz({
          id: '24_1a',
          componentId: '24.1',
          dir: 'Komponente Teil 2 (16-36 Monate)/24.1 - Erfundene Organisation (§ 4 Abs. 4 Nr. 5)',
          title: '24a) Erfundene Organisation planen',
        }),
      ])
    );
    const withContent = await plan([mapping, json], { components, enablers });
    const withoutContent = await plan([mapping], { components, enablers });
    const has = (p: typeof withContent) =>
      p.learningPlan!.mappings.some(m => m.enablerCode === 'K24.1-a');
    expect(has(withContent)).toBe(true);
    expect(has(withoutContent)).toBe(false);
  });

  it('leaves out a second mapping table, a refused workbook and a workbook without the table', async () => {
    const good = await validMapping();
    const one = xlsxMappingFile(good, { name: 'eins.xlsx' });
    const two = xlsxMappingFile(good, { name: 'zwei.xlsx' });
    const both = await plan([one, two], { components, enablers });
    expect(both.excluded.map(e => e.code)).toEqual([
      'XLSX_MULTIPLE',
      'XLSX_MULTIPLE',
    ]);
    expect(both.learningPlan).toBeNull();

    const macro = xlsxMappingFile(
      await withEntry(good, 'xl/vbaProject.bin', 'x')
    );
    expect(
      (await plan([macro], { components, enablers })).excluded.map(e => e.code)
    ).toEqual(['XLSX_REFUSED']);

    const other = xlsxMappingFile(
      await makeXlsx([
        { name: 'Blatt', rows: [{ row: 1, cells: { A: 'Erfunden' } }] },
      ])
    );
    expect(
      (await plan([other], { components, enablers })).excluded.map(e => e.code)
    ).toEqual(['XLSX_NOT_A_MAPPING']);

    const gone = xlsxMappingFile(good, { objectDeleted: true });
    expect(
      (await plan([gone], { components, enablers })).excluded.map(e => e.code)
    ).toEqual(['NO_OBJECT']);

    const unreadable = xlsxMappingFile(good);
    expect(
      (
        await plan([unreadable], {
          components,
          enablers,
          readBytes: async () => {
            throw new Error('storage down');
          },
        })
      ).excluded.map(e => e.code)
    ).toEqual(['XLSX_UNREADABLE']);
  });

  it('refuses a table with a type that is not the mapping type', async () => {
    const wrong = xlsxMappingFile(await validMapping(), { docType: 'quiz' });
    const result = await plan([wrong], { components, enablers });
    expect(result.excluded.map(e => e.code)).toEqual(['NOT_PLANNABLE']);
    expect(result.learningPlan).toBeNull();
  });

  it('never builds the plan from a zip bomb or a table with a hidden macro', async () => {
    const good = await validMapping();
    const bomb = xlsxMappingFile(
      await changed(good, zip => {
        zip.file('xl/worksheets/bomb.xml', Buffer.alloc(3 * 1024 * 1024, 0x20));
      })
    );
    const result = await plan([bomb], { components, enablers });
    expect(result.excluded.map(e => e.code)).toEqual(['XLSX_REFUSED']);
    expect(result.learningPlan).toBeNull();
  });

  it('uses the sample table as it is (guards the fixtures of these tests)', () => {
    expect(sampleRows().length).toBeGreaterThan(8);
    expect(typeof docx).toBe('function');
    expect(typeof quizBlocks).toBe('function');
  });
});
