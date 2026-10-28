/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';

import { transferDecisions } from '@/lib/content-upload/transfer/preset';
import { buildTransferPlan } from '@/lib/content-upload/transfer/plan';
import type {
  ComponentFact,
  TransferFile,
} from '@/lib/content-upload/transfer/types';

import {
  docx,
  enablerFiles,
  fixtureFile,
  type FixtureFile,
} from '../../../helpers/transferFixtures';
import {
  CANARY,
  enablerBlocks,
  globalQuizBlocks,
  t as textBlock,
  useCaseBlocks,
} from '../../../helpers/uploadFixtures';

const K4: ComponentFact = {
  code: 'K4',
  title: 'Erfundenes Thema Vier',
  reference: '§ 4 Abs. 2 Nr. 4',
  kind: 'pflicht',
  phase: 1,
};

async function plan(
  fixtures: FixtureFile[],
  components: ComponentFact[] = [K4],
  extra: { now?: Date } = {}
) {
  const bytes = new Map(fixtures.map(f => [f.file.id, f.bytes]));
  return buildTransferPlan({
    files: fixtures.map(f => f.file),
    components,
    decisions: transferDecisions(),
    readBytes: async (file: TransferFile) => bytes.get(file.id) ?? null,
    ...extra,
  });
}

describe('buildTransferPlan', () => {
  it('builds both plans from files of a kept folder tree', async () => {
    const result = await plan(await enablerFiles({ tree: true }), []);
    expect(result.importPlan.enablers.map(e => e.code)).toEqual(['K4-a']);
    expect(result.importPlan.quizzes.map(q => q.code)).toEqual(['K4-a-low']);
    expect(result.importPlan.scenarios).toHaveLength(1);
    expect(result.useCasePlan.useCases.map(u => u.code)).toEqual(['K4-a']);
    expect(result.importPlan.components.map(c => c.code)).toEqual(['K4']);
    expect(result.importPlan.components[0]).toMatchObject({
      kind: 'pflicht',
      phase: 1,
      group: 'teil1',
    });
    expect(result.excluded).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.plannedFiles).toHaveLength(4);
  });

  it('reads the tree below the folder that the person chose, like the rule stage does', async () => {
    const plain = await plan(await enablerFiles({ tree: true }), []);
    const fixtures = await enablerFiles({ tree: true });
    // the browser reports the name of the chosen folder first
    for (const f of fixtures) f.file.relPath = `KfBM Upload/${f.file.relPath}`;
    const result = await plan(fixtures, []);
    expect(result.skipped).toEqual([]);
    expect(result.importPlan.components.map(c => [c.code, c.group])).toEqual([
      ['K4', 'teil1'],
    ]);
    expect(result.importPlan.enablers.map(e => e.code)).toEqual(['K4-a']);
    expect(result.counts).toEqual(plain.counts);
    expect(result.useCaseCounts).toEqual(plain.useCaseCounts);
  });

  it('builds the same plan for files without a tree, with the facts of the component row', async () => {
    const withTree = await plan(await enablerFiles({ tree: true }), []);
    const flat = await plan(await enablerFiles({ tree: false }), [K4]);
    const strip = (p: typeof withTree) => ({
      components: p.importPlan.components.map(c => ({
        ...c,
        // The title of a component comes from the folder or from the row
        title: undefined,
      })),
      enablers: p.importPlan.enablers.map(e => ({ ...e, source: undefined })),
      quizzes: p.importPlan.quizzes.map(q => ({ ...q, source: undefined })),
      scenarios: p.importPlan.scenarios.map(s => ({ ...s, source: undefined })),
      useCases: p.useCasePlan.useCases.map(u => ({ ...u, source: undefined })),
    });
    expect(strip(flat)).toEqual(strip(withTree));
    expect(flat.importPlan.components[0].title).toBe('Erfundenes Thema Vier');
    expect(flat.importPlan.components[0].reference).toBe('§ 4 Abs. 2 Nr. 4');
  });

  it('skips the component, and says so, when neither the database nor a path names it', async () => {
    const result = await plan(await enablerFiles({ tree: false }), []);
    expect(result.importPlan.components).toEqual([]);
    expect(result.importPlan.enablers).toEqual([]);
    expect(result.skipped.map(s => s.code)).toContain('NO_GROUP');
  });

  it('uses the group of the database row, an elective component lies in wahl', async () => {
    const files = await enablerFiles({ tree: false });
    const k4 = files.map(f => ({
      ...f,
      file: {
        ...f.file,
        decision: {
          ...f.file.decision,
          componentCode: 'K12',
          enablerCode: (f.file.decision.enablerCode ?? '').replace('K4', 'K12'),
        },
      },
    }));
    const result = await plan(
      k4.slice(0, 1).map(f => ({
        ...f,
        // the text of the file names enabler 4a, the decision says 12a: the
        // planner reports the mismatch and builds nothing from it
      })),
      [
        {
          code: 'K12',
          title: 'Erfundenes Wahlthema',
          reference: null,
          kind: 'wahl',
          phase: null,
        },
      ]
    );
    expect(result.importPlan.components[0]).toMatchObject({
      code: 'K12',
      kind: 'wahl',
      group: 'wahl',
      phase: null,
    });
  });

  it('leaves out files that were not accepted, with a code and no content', async () => {
    const files = await enablerFiles({ tree: true });
    files[1].file.decision.action = 'reject';
    files[2].file.decision.action = 'defer';
    const result = await plan(files, []);
    expect(result.excluded.map(e => e.code).sort()).toEqual([
      'DEFERRED',
      'REJECTED',
    ]);
    expect(result.importPlan.quizzes).toEqual([]);
    expect(result.importPlan.scenarios).toEqual([]);
    expect(JSON.stringify(result.excluded)).not.toMatch(/Kanarien/);
  });

  it('excludes PDF originals, other types, the wrong format and gone objects', async () => {
    const files = [
      ...(await enablerFiles({ tree: true })).slice(0, 1),
      fixtureFile(new Uint8Array([1]), {
        ext: 'pdf',
        docType: 'pdf_original',
        componentCode: 'K4',
        enablerCode: 'K4-a',
      }),
      fixtureFile(new Uint8Array([2]), { docType: 'other' }),
      fixtureFile(new Uint8Array([3]), {
        ext: 'pdf',
        docType: 'quiz',
        componentCode: 'K4',
        enablerCode: 'K4-a',
        quizLevel: 'low',
      }),
      fixtureFile(new Uint8Array([4]), {
        docType: 'quiz',
        componentCode: 'K4',
        enablerCode: 'K4-a',
        quizLevel: 'low',
        objectDeleted: true,
      }),
      fixtureFile(new Uint8Array([5]), {
        docType: 'quiz',
        componentCode: 'K4',
        enablerCode: 'K4-a',
        quizLevel: null,
      }),
    ];
    const result = await plan(files, [K4]);
    expect(result.excluded.map(e => e.code).sort()).toEqual([
      'FORMAT',
      'INCOMPLETE',
      'NOT_PLANNABLE',
      'NO_OBJECT',
      'ORIGINAL_ONLY',
    ]);
  });

  it('never picks a copy itself: the choice of the person decides', async () => {
    const [a] = await enablerFiles({ tree: true });
    const copy = (id: string, dupChoice: 'keep' | 'skip' | null) => ({
      ...a,
      file: {
        ...a.file,
        id,
        storagePath: `upload/x/${id}.docx`,
        sha256: a.file.sha256,
        decision: { ...a.file.decision, dupChoice },
      },
    });
    const one = copy('bbbbbbbb-0000-4000-8000-000000000001', 'keep');
    const two = copy('bbbbbbbb-0000-4000-8000-000000000002', 'skip');
    const three = copy('bbbbbbbb-0000-4000-8000-000000000003', null);

    const kept = await plan([one, two], []);
    expect(kept.importPlan.enablers).toHaveLength(1);
    expect(kept.excluded.map(e => e.code)).toEqual(['DUP_SKIP']);

    const superseded = await plan([one, three], []);
    expect(superseded.importPlan.enablers).toHaveLength(1);
    expect(superseded.excluded).toEqual([
      expect.objectContaining({
        fileId: three.file.id,
        code: 'DUP_SUPERSEDED',
      }),
    ]);

    // two files hold the same document and nobody chose: both stay out
    const unclear = await plan(
      [
        three,
        {
          ...three,
          file: { ...three.file, id: 'bbbbbbbb-0000-4000-8000-000000000004' },
        },
      ],
      []
    );
    expect(unclear.importPlan.enablers).toEqual([]);
    expect(unclear.excluded.map(e => e.code)).toEqual([
      'DUP_UNRESOLVED',
      'DUP_UNRESOLVED',
    ]);
  });

  it('reports a file that cannot be read or parsed as skipped, never as part of the plan', async () => {
    const files = await enablerFiles({ tree: true });
    const bytes = new Map(files.map(f => [f.file.id, f.bytes]));
    bytes.delete(files[0].file.id);
    bytes.set(files[1].file.id, new Uint8Array([1, 2, 3]));
    const result = await buildTransferPlan({
      files: files.map(f => f.file),
      components: [],
      decisions: transferDecisions(),
      readBytes: async f => bytes.get(f.id) ?? null,
    });
    const codes = result.skipped.map(s => s.code);
    expect(codes).toContain('READ_ERROR');
    expect(result.importPlan.enablers).toEqual([]);
    expect(result.importPlan.quizzes).toEqual([]);
    expect(JSON.stringify(result.skipped)).not.toMatch(/\u0001|Kanarien/);
  });

  it('reports a storage error as a read error of that file only', async () => {
    const files = await enablerFiles({ tree: true });
    const result = await buildTransferPlan({
      files: files.map(f => f.file),
      components: [],
      decisions: transferDecisions(),
      readBytes: async f => {
        if (f.id === files[0].file.id) throw new Error('boom secret');
        return files.find(x => x.file.id === f.id)?.bytes ?? null;
      },
    });
    expect(result.skipped.some(s => s.code === 'READ_ERROR')).toBe(true);
    expect(JSON.stringify(result.skipped)).not.toContain('secret');
  });

  it('refuses the whole plan when the time ends while files are read', async () => {
    const files = await enablerFiles({ tree: true });
    await expect(
      buildTransferPlan({
        files: files.map(f => f.file),
        components: [],
        decisions: transferDecisions(),
        readBytes: async f => files.find(x => x.file.id === f.id)!.bytes,
        deadline: Date.now() - 1,
      })
    ).rejects.toMatchObject({ code: 'PLAN_TIMEOUT' });
  });

  it('keeps the global quiz of a component and checks its question count', async () => {
    const quiz = fixtureFile(await docx(globalQuizBlocks()), {
      name: '06.1_Global_Quiz_Thema.docx',
      docType: 'global_quiz',
      componentCode: 'K6.1',
    });
    const result = await plan(
      [quiz],
      [
        {
          code: 'K6.1',
          title: 'Betriebliche Abläufe',
          reference: '§ 4 Abs. 2 Nr. 6',
          kind: 'pflicht',
          phase: 1,
        },
      ]
    );
    expect(result.importPlan.quizzes.map(q => q.code)).toEqual(['K6.1-global']);
    expect(result.importPlan.quizzes[0].questions).toHaveLength(20);
  });

  it.each([
    ['a scenario', CANARY.scenarioSolution, 'WOMBAT'],
    ['a use case', CANARY.useCaseSolution, 'OKAPI'],
  ])(
    'leaves out a teaching text that repeats the solution of %s, and never stores the use case solution in the import plan',
    async (_what, solution, word) => {
      const fixtures = await enablerFiles({ tree: true });
      const index = fixtures.findIndex(
        f => f.file.decision.docType === 'enabler'
      );
      fixtures[index] = fixtureFile(
        await docx([...enablerBlocks({ code: '4a' }), textBlock(solution)]),
        {
          rel: fixtures[index].file.relPath,
          name: '4a.docx',
          docType: 'enabler',
          componentCode: 'K4',
          enablerCode: 'K4-a',
        }
      );
      const result = await plan(fixtures, []);
      expect(result.importPlan.enablers.map(e => e.code)).not.toContain('K4-a');
      expect(
        result.importPlan.skipped.map(s => [s.key, s.code])
      ).toContainEqual(['enabler:K4-a', 'SOLUTION_MARKER']);
      // the whole scenario and the use case are not touched by it
      expect(result.useCasePlan.useCases.map(u => u.code)).toEqual(['K4-a']);
      const stored = JSON.stringify(result.importPlan.enablers);
      expect(stored).not.toContain(word);
      expect(JSON.stringify(result.importPlan.skipped)).not.toContain(word);
    }
  );

  it('also protects the solution of a use case that was left out of the plan', async () => {
    const fixtures = await enablerFiles({ tree: true });
    const textIndex = fixtures.findIndex(
      f => f.file.decision.docType === 'enabler'
    );
    const ucIndex = fixtures.findIndex(
      f => f.file.decision.docType === 'use_case'
    );
    // the assignment names the model solution: the planner leaves this use case out
    fixtures[ucIndex] = fixtureFile(
      await docx([
        // before the heading of the solution, so it stays in the visible assignment
        ...useCaseBlocks({ code: '4a' }).slice(0, -2),
        textBlock('Vergleichen Sie mit der Musterlösung.'),
        ...useCaseBlocks({ code: '4a' }).slice(-2),
      ]),
      {
        rel: fixtures[ucIndex].file.relPath,
        name: 'UC_4a.docx',
        docType: 'use_case',
        componentCode: 'K4',
        enablerCode: 'K4-a',
      }
    );
    fixtures[textIndex] = fixtureFile(
      await docx([
        ...enablerBlocks({ code: '4a' }),
        textBlock(CANARY.useCaseSolution),
      ]),
      {
        rel: fixtures[textIndex].file.relPath,
        name: '4a.docx',
        docType: 'enabler',
        componentCode: 'K4',
        enablerCode: 'K4-a',
      }
    );
    const result = await plan(fixtures, []);
    expect(result.useCasePlan.useCases).toEqual([]);
    expect(result.importPlan.skipped.map(s => [s.key, s.code])).toContainEqual([
      'enabler:K4-a',
      'SOLUTION_MARKER',
    ]);
  });

  it('holds the full content including the solution parts, and nowhere else', async () => {
    const result = await plan(await enablerFiles({ tree: true }), []);
    const text = JSON.stringify(result.importPlan);
    // the database needs the correct option and the rationale: they are in the plan
    expect(text).toMatch(/ZEBRAKANAL/);
    expect(text).toMatch(/WOMBAT/);
    // the report parts hold codes only
    expect(JSON.stringify([result.excluded, result.skipped])).not.toMatch(
      /ZEBRAKANAL|WOMBAT|OKAPI/
    );
  });
});
