/**
 * @jest-environment node
 */
// A scenario comes as one file, whole (decision of the owner of 29.10.2026): the upload copies
// the whole Word file or PDF to the public bucket as the exercise document of its enabler,
// visible for everyone. A use case does not: its task and its model solution stay apart.
import { describe, expect, it } from '@jest/globals';

import { KIND_ROWS } from '@/lib/content-import/documents/engine';
import {
  checkOriginalBytes,
  enablerOfOriginal,
  evaluateOriginals,
  originalOf,
  originalStoragePath,
  originalTitle,
  toEnablerOriginals,
} from '@/lib/content-upload/transfer/originals';
import {
  runTransfer,
  type TransferRequest,
} from '@/lib/content-upload/transfer/run';
import type { TransferFile } from '@/lib/content-upload/transfer/types';

import { CREATOR_ID } from '../../../helpers/memoryImportDb';
import { harness } from '../../../helpers/memoryTransfer';
import {
  enablerFiles,
  fixtureFile,
  type FixtureFile,
} from '../../../helpers/transferFixtures';
import {
  CANARY,
  blocksToBody,
  docxBytes,
  enablerBlocks,
  pdfBytes,
  scenarioBlocks,
  t,
} from '../../../helpers/uploadFixtures';

const OWNER = '11111111-0000-4000-8000-0000000000a7';

const scenarioWordBytes = async () =>
  new Uint8Array(await docxBytes(blocksToBody(scenarioBlocks({ code: '4a' }))));
// the text of a whole scenario PDF: situation, solution approach and knowledge, with the
// words that mark a solution in a quiz or an enabler text
const scenarioPdfBytes = (extra: string[] = []) =>
  new Uint8Array(
    pdfBytes({
      pages: [
        [
          'Szenario 4a) Der ausgefallene Router',
          'Ausgangssituation',
          'Die erfundene Firma Beispiel Technik betreibt ein kleines Netz mit einem Router.',
          'Loesungsszenario',
          'Die Auszubildende prueft zuerst den Router und danach die beiden Switches.',
          ...extra,
        ],
      ],
    })
  );

const scenarioWord = async (
  options: Partial<Parameters<typeof fixtureFile>[1]> = {}
): Promise<FixtureFile> =>
  fixtureFile(await scenarioWordBytes(), {
    name: 'Szenario_4a.docx',
    docType: 'scenario',
    componentCode: 'K4',
    enablerCode: 'K4-a',
    ...options,
  });
const scenarioPdf = (
  options: Partial<Parameters<typeof fixtureFile>[1]> = {}
) =>
  fixtureFile(scenarioPdfBytes(), {
    ext: 'pdf',
    name: 'Szenario_4a.pdf',
    docType: 'pdf_original',
    componentCode: 'K4',
    enablerCode: 'K4-a',
    dupKey: 'pdf:scenario:4a',
    ...options,
  });
const useCasePdf = () =>
  fixtureFile(scenarioPdfBytes(), {
    ext: 'pdf',
    name: 'UC_4a.pdf',
    docType: 'pdf_original',
    componentCode: 'K4',
    enablerCode: 'K4-a',
    dupKey: 'pdf:use-case:4a',
  });
const enablerText = async () =>
  fixtureFile(
    new Uint8Array(
      await docxBytes(blocksToBody(enablerBlocks({ code: '4a' })))
    ),
    {
      name: '4a.docx',
      docType: 'enabler',
      componentCode: 'K4',
      enablerCode: 'K4-a',
    }
  );

describe('checkOriginalBytes for a scenario', () => {
  it('takes the whole scenario with the solution approach, the marker words and the knowledge text', async () => {
    // the solutions of a transfer are those of the use cases, never those of a scenario
    const solutions = [CANARY.useCaseSolution];
    expect(
      await checkOriginalBytes(
        'docx',
        await scenarioWordBytes(),
        solutions,
        'scenario'
      )
    ).toEqual({ ok: true, pageCount: null });
    expect(
      await checkOriginalBytes('pdf', scenarioPdfBytes(), solutions, 'scenario')
    ).toEqual({ ok: true, pageCount: 1 });
  });

  it('refuses a file typed as a scenario that holds the answers of a quiz or the solution of a use case', async () => {
    const quizAnswer = new Uint8Array(
      await docxBytes(
        blocksToBody([
          ...scenarioBlocks({ code: '4a' }),
          t('Richtige Antwort: B'),
        ])
      )
    );
    expect(
      await checkOriginalBytes('docx', quizAnswer, [], 'scenario')
    ).toMatchObject({ ok: false, code: 'SOLUTION_MARKER' });
    const modelSolution = scenarioPdfBytes(['Musterloesung: Schritt eins']);
    expect(
      await checkOriginalBytes('pdf', modelSolution, [], 'scenario')
    ).toMatchObject({ ok: false, code: 'SOLUTION_MARKER' });
    const useCaseText = new Uint8Array(
      await docxBytes(
        blocksToBody([
          ...scenarioBlocks({ code: '4a' }),
          t(CANARY.useCaseSolution),
        ])
      )
    );
    expect(
      await checkOriginalBytes(
        'docx',
        useCaseText,
        [CANARY.useCaseSolution],
        'scenario'
      )
    ).toMatchObject({ ok: false, code: 'SOLUTION_TEXT' });
  });

  it('refuses the same files as the original of an enabler text', async () => {
    expect(
      await checkOriginalBytes('docx', await scenarioWordBytes(), [])
    ).toMatchObject({ ok: false, code: 'SOLUTION_MARKER' });
    expect(
      await checkOriginalBytes('pdf', scenarioPdfBytes(), [], 'enabler')
    ).toMatchObject({ ok: false, code: 'SOLUTION_MARKER' });
  });

  it('still refuses what hides in the file: comments, a script, an unreadable file', async () => {
    const withComments = new Uint8Array(
      await docxBytes(blocksToBody(scenarioBlocks({ code: '4a' })), {
        parts: { 'word/comments.xml': '<w:comments xmlns:w="x"/>' },
      })
    );
    expect(
      await checkOriginalBytes('docx', withComments, [], 'scenario')
    ).toMatchObject({ ok: false, code: 'ORIGINAL_FEATURES' });
    const withScript = new Uint8Array(
      pdfBytes({
        pages: [
          ['Ein erfundenes Szenario, lang genug für den Leser des Tests.'],
        ],
        catalog: '/OpenAction << /S /JavaScript /JS (app.alert(1)) >>',
      })
    );
    expect(
      await checkOriginalBytes('pdf', withScript, [], 'scenario')
    ).toMatchObject({ ok: false, code: 'ORIGINAL_FEATURES' });
    expect(
      await checkOriginalBytes('pdf', new Uint8Array([1, 2]), [], 'scenario')
    ).toMatchObject({ ok: false, code: 'ORIGINAL_UNREADABLE' });
  });
});

describe('originalOf', () => {
  it('knows the Word file of a scenario and the PDF original of one', async () => {
    expect(originalOf((await scenarioWord()).file)).toEqual({
      kind: 'scenario',
      enablerCode: 'K4-a',
    });
    expect(originalOf(scenarioPdf().file)).toEqual({
      kind: 'scenario',
      enablerCode: 'K4-a',
    });
    expect(originalOf((await enablerText()).file)).toEqual({
      kind: 'enabler',
      enablerCode: 'K4-a',
    });
  });

  it('knows no use case, no quiz, nothing not accepted, no PDF typed as a Word file', async () => {
    expect(originalOf(useCasePdf().file)).toBeNull();
    expect(
      originalOf((await scenarioWord({ docType: 'use_case' })).file)
    ).toBeNull();
    expect(
      originalOf((await scenarioWord({ docType: 'quiz' })).file)
    ).toBeNull();
    expect(
      originalOf(scenarioPdf({ dupKey: 'pdf:quiz:4a:low' }).file)
    ).toBeNull();
    expect(originalOf(scenarioPdf({ dupKey: null }).file)).toBeNull();
    expect(
      originalOf((await scenarioWord({ action: 'reject' })).file)
    ).toBeNull();
    expect(
      originalOf((await scenarioWord({ enablerCode: null })).file)
    ).toBeNull();
    expect(originalOf(scenarioPdf({ ext: 'docx' }).file)).toBeNull();
    expect(originalOf((await scenarioWord({ ext: 'pdf' })).file)).toBeNull();
  });

  it('leaves enablerOfOriginal alone: it answers for enabler texts only', async () => {
    expect(enablerOfOriginal((await scenarioWord()).file)).toBeNull();
    expect(enablerOfOriginal(scenarioPdf().file)).toBeNull();
  });
});

describe('evaluateOriginals with scenarios', () => {
  const run = async (
    fixtures: FixtureFile[],
    requested: string[],
    options: {
      solutions?: string[];
      scenarioSolutions?: string[];
      planned?: string[];
    } = {}
  ) => {
    const bytes = new Map(fixtures.map(f => [f.file.id, f.bytes]));
    return evaluateOriginals({
      requested,
      files: fixtures.map(f => f.file),
      readBytes: async (f: TransferFile) => bytes.get(f.id) ?? null,
      solutions: options.solutions ?? [],
      ...(options.scenarioSolutions
        ? { scenarioSolutions: options.scenarioSolutions }
        : {}),
      plannedFileIds: new Set(options.planned ?? fixtures.map(f => f.file.id)),
    });
  };

  it('takes the Word file and the PDF of a scenario, whatever they say about the solution', async () => {
    const word = await scenarioWord();
    const pdfFile = scenarioPdf();
    const result = await run([word, pdfFile], [word.file.id, pdfFile.file.id], {
      solutions: [CANARY.useCaseSolution],
    });
    expect(result.refused).toEqual([]);
    expect(
      result.plans.map(p => [p.kind, p.ext, p.enablerCode]).sort()
    ).toEqual([
      ['scenario', 'docx', 'K4-a'],
      ['scenario', 'pdf', 'K4-a'],
    ]);
    expect(result.plans.find(p => p.ext === 'pdf')?.pageCount).toBe(1);
  });

  it('takes the scenario and the teaching text of one enabler side by side, one of each', async () => {
    const text = await enablerText();
    const word = await scenarioWord();
    const second = await scenarioWord({ name: 'again.docx' });
    const result = await run(
      [text, word, second],
      [text.file.id, word.file.id, second.file.id]
    );
    expect(result.plans.map(p => p.kind ?? 'enabler').sort()).toEqual([
      'enabler',
      'scenario',
    ]);
    expect(result.refused.map(r => r.code)).toEqual(['DUPLICATE_ORIGINAL']);
  });

  it('looks for the solution text of a use case in a teaching text and in a scenario alike', async () => {
    const solution =
      'Ein erfundenes Ergebnis eines Use Cases, lang genug zum Suchen.';
    const text = fixtureFile(
      new Uint8Array(
        await docxBytes(
          blocksToBody([...enablerBlocks({ code: '4a' }), t(solution)])
        )
      ),
      {
        name: '4a.docx',
        docType: 'enabler',
        componentCode: 'K4',
        enablerCode: 'K4-a',
      }
    );
    const scenario = fixtureFile(
      new Uint8Array(
        await docxBytes(
          blocksToBody([...scenarioBlocks({ code: '4a' }), t(solution)])
        )
      ),
      {
        name: 'Szenario_4a.docx',
        docType: 'scenario',
        componentCode: 'K4',
        enablerCode: 'K4-a',
      }
    );
    const result = await run(
      [text, scenario],
      [text.file.id, scenario.file.id],
      { solutions: [solution] }
    );
    expect(result.plans).toEqual([]);
    expect(result.refused).toEqual([
      expect.objectContaining({ fileId: text.file.id, code: 'SOLUTION_TEXT' }),
      expect.objectContaining({
        fileId: scenario.file.id,
        code: 'SOLUTION_TEXT',
      }),
    ]);
  });

  it('refuses a teaching text that repeats a scenario solution, and still takes the whole scenario with it', async () => {
    const solution =
      'Die Auszubildende prueft zuerst den Router und danach beide Switches.';
    const text = fixtureFile(
      new Uint8Array(
        await docxBytes(
          blocksToBody([...enablerBlocks({ code: '4a' }), t(solution)])
        )
      ),
      {
        name: '4a.docx',
        docType: 'enabler',
        componentCode: 'K4',
        enablerCode: 'K4-a',
      }
    );
    const scenario = fixtureFile(
      new Uint8Array(
        await docxBytes(
          blocksToBody([...scenarioBlocks({ code: '4a' }), t(solution)])
        )
      ),
      {
        name: 'Szenario_4a.docx',
        docType: 'scenario',
        componentCode: 'K4',
        enablerCode: 'K4-a',
      }
    );
    const result = await run(
      [text, scenario],
      [text.file.id, scenario.file.id],
      { scenarioSolutions: [solution] }
    );
    expect(result.plans.map(p => [p.kind ?? 'enabler', p.fileId])).toEqual([
      ['scenario', scenario.file.id],
    ]);
    expect(result.refused).toEqual([
      expect.objectContaining({ fileId: text.file.id, code: 'SOLUTION_TEXT' }),
    ]);
  });

  it('never publishes a use case: not its Word file, not its PDF', async () => {
    const word = await scenarioWord({ docType: 'use_case' });
    const pdfFile = useCasePdf();
    const result = await run([word, pdfFile], [word.file.id, pdfFile.file.id]);
    expect(result.plans).toEqual([]);
    expect(result.refused.map(r => r.code)).toEqual([
      'NOT_AN_ENABLER_TEXT',
      'NOT_AN_ENABLER_TEXT',
    ]);
  });

  it('wants a Word scenario in the plan, but not a PDF', async () => {
    const word = await scenarioWord();
    const pdfFile = scenarioPdf();
    const result = await run([word, pdfFile], [word.file.id, pdfFile.file.id], {
      planned: [],
    });
    expect(result.plans.map(p => p.ext)).toEqual(['pdf']);
    expect(result.refused).toEqual([
      expect.objectContaining({ fileId: word.file.id, code: 'NOT_IN_PLAN' }),
    ]);
  });
});

describe('the title, the path and the row of a scenario', () => {
  it('uses the title of the PDF import for a PDF, so both ways meet one row', () => {
    expect(originalTitle('K6.2-d', 'pdf', 'scenario')).toBe(
      KIND_ROWS.scenario.title('K6.2-d')
    );
    expect(originalTitle('K6.2-d', 'pdf', 'scenario')).toBe(
      'Szenario K6.2-d (PDF)'
    );
    expect(originalTitle('K6.2-d', 'docx', 'scenario')).toBe(
      'Szenario K6.2-d (Word)'
    );
    // the teaching text keeps its title (and the one of the PDF import)
    expect(originalTitle('K6.2-d', 'pdf')).toBe(
      KIND_ROWS.enabler.title('K6.2-d')
    );
  });

  it('has the one form of the document bucket and its own name', () => {
    expect(
      originalStoragePath(
        OWNER,
        { enablerCode: 'K6.2-d', ext: 'pdf', kind: 'scenario' },
        1730000000000
      )
    ).toBe(`${OWNER}/1730000000000_K6.2-d_szenario.pdf`);
    expect(
      originalStoragePath(OWNER, { enablerCode: 'K6.2-d', ext: 'pdf' }, 5)
    ).toBe(`${OWNER}/5_K6.2-d_lehrtext.pdf`);
    expect(
      originalStoragePath(
        '../x',
        { enablerCode: 'K1-a', ext: 'pdf', kind: 'scenario' },
        1
      )
    ).toBeNull();
  });

  it('builds an exercise row for everyone, behind the teaching texts, like the PDF import', () => {
    const [pdfRow, wordRow, textRow] = toEnablerOriginals(
      [
        {
          fileId: 'a',
          sha256: 'x',
          enablerCode: 'K4-a',
          ext: 'pdf',
          kind: 'scenario',
          sizeBytes: 100,
          pageCount: 3,
        },
        {
          fileId: 'b',
          sha256: 'y',
          enablerCode: 'K4-a',
          ext: 'docx',
          kind: 'scenario',
          sizeBytes: 200,
          pageCount: null,
        },
        {
          fileId: 'c',
          sha256: 'z',
          enablerCode: 'K4-a',
          ext: 'pdf',
          sizeBytes: 300,
          pageCount: 2,
        },
      ],
      OWNER,
      7
    );
    expect(pdfRow.original).toMatchObject({
      enablerCode: 'K4-a',
      title: KIND_ROWS.scenario.title('K4-a'),
      documentType: KIND_ROWS.scenario.documentType,
      orderIndex: KIND_ROWS.scenario.orderIndex,
      mimeType: 'application/pdf',
      fileName: '7_K4-a_szenario.pdf',
      pageCount: 3,
    });
    expect(wordRow.original.mimeType).toContain('wordprocessingml');
    expect(wordRow.original.title).not.toBe(pdfRow.original.title);
    expect(textRow.original).toMatchObject({
      documentType: 'THEORY',
      orderIndex: 0,
    });
  });
});

describe('runTransfer with a whole scenario', () => {
  const request = (
    mode: 'dry_run' | 'apply',
    extra: Partial<TransferRequest> = {}
  ): TransferRequest => ({
    runId: 'cccccccc-0000-4000-8000-000000000001',
    callerId: CREATOR_ID,
    mode,
    replaceFiles: [],
    publishOriginals: [],
    ...(mode === 'apply' ? { confirm: 'KFBM' } : {}),
    ...extra,
  });

  async function withScenario() {
    const files = await enablerFiles({ tree: true });
    const word = files.find(f => f.file.decision.docType === 'scenario')!;
    const pdfFile = scenarioPdf();
    const h = harness([...files, pdfFile]);
    return { h, files, word, pdfFile };
  }
  const exerciseRows = (h: Awaited<ReturnType<typeof withScenario>>['h']) =>
    h.db.tables.content_documents.filter(d => d.document_type === 'EXERCISE');

  it('shows the scenario in the dry run and does not touch the bucket', async () => {
    const { h, pdfFile } = await withScenario();
    const result = await runTransfer(
      h.deps,
      request('dry_run', { publishOriginals: [pdfFile.file.id] })
    );
    expect(result.ok && result.data.originals).toEqual({
      published: 1,
      refused: [],
    });
    expect(h.bucket.objects.size).toBe(0);
    expect(exerciseRows(h)).toHaveLength(0);
  });

  it('lays the whole scenario PDF down as a public exercise document at its enabler', async () => {
    const { h, pdfFile } = await withScenario();
    const ids = [pdfFile.file.id];
    await runTransfer(h.deps, request('dry_run', { publishOriginals: ids }));
    const result = await runTransfer(
      h.deps,
      request('apply', { publishOriginals: ids })
    );
    expect(result.ok && result.data.originals).toEqual({
      published: 1,
      refused: [],
    });
    const [path] = [...h.bucket.objects.keys()];
    expect(path).toMatch(
      new RegExp(`^${CREATOR_ID}/\\d+_K4-a_szenario\\.pdf$`)
    );
    const enabler = h.db.tables.enablers.find(e => e.code === 'K4-a')!;
    const rows = exerciseRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      enabler_id: enabler.id,
      use_case_id: null,
      title: 'Szenario K4-a (PDF)',
      document_type: 'EXERCISE',
      visibility: 'ALL',
      mime_type: 'application/pdf',
      storage_path: path,
      order_index: 100,
      uploaded_by_id: CREATOR_ID,
    });
    // the protocol names the file of the scenario
    const protocolRow = h.store.appliedRows.find(r => r.rowId === rows[0].id)!;
    expect(protocolRow.fileId).toBe(pdfFile.file.id);
  });

  it('lays the whole Word scenario down too, next to the PDF, each in its own row', async () => {
    const { h, word, pdfFile } = await withScenario();
    const ids = [word.file.id, pdfFile.file.id];
    await runTransfer(h.deps, request('dry_run', { publishOriginals: ids }));
    const result = await runTransfer(
      h.deps,
      request('apply', { publishOriginals: ids })
    );
    expect(result.ok && result.data.originals.published).toBe(2);
    expect(
      exerciseRows(h)
        .map(r => r.title)
        .sort()
    ).toEqual(['Szenario K4-a (PDF)', 'Szenario K4-a (Word)']);
    expect(h.bucket.objects.size).toBe(2);
  });

  it('writes nothing twice: a second round takes its copy out again', async () => {
    const { h, pdfFile } = await withScenario();
    const ids = [pdfFile.file.id];
    let now = 1_800_000_000_000;
    h.deps.clock = () => new Date((now += 1000));
    await runTransfer(h.deps, request('dry_run', { publishOriginals: ids }));
    await runTransfer(h.deps, request('apply', { publishOriginals: ids }));
    expect(h.bucket.objects.size).toBe(1);
    const stored = [...h.bucket.objects.keys()];
    h.store.state = { ...h.store.state, status: 'review' };
    await runTransfer(h.deps, request('dry_run', { publishOriginals: ids }));
    const again = await runTransfer(
      h.deps,
      request('apply', { publishOriginals: ids })
    );
    expect(again.ok && again.data.originals.published).toBe(0);
    expect(exerciseRows(h)).toHaveLength(1);
    expect([...h.bucket.objects.keys()]).toEqual(stored);
    expect(h.bucket.removed).toHaveLength(1);
  });

  it('meets the row the PDF import wrote: no second row, no copy kept', async () => {
    const { h, pdfFile } = await withScenario();
    // the plan items first (enabler and the rest), without originals
    await runTransfer(h.deps, request('dry_run'));
    await runTransfer(h.deps, request('apply'));
    const enabler = h.db.tables.enablers.find(e => e.code === 'K4-a')!;
    // what scripts/import/kfbm-documents.mjs writes for the scenario PDF of this enabler
    h.db.tables.content_documents.push({
      id: '00000000-0000-4000-9000-0000000000aa',
      enabler_id: enabler.id,
      use_case_id: null,
      course_id: null,
      organization_id: null,
      title: KIND_ROWS.scenario.title('K4-a'),
      description: null,
      document_type: KIND_ROWS.scenario.documentType,
      visibility: KIND_ROWS.scenario.visibility,
      file_name: 'Szenario_4a.pdf',
      file_size: 10,
      mime_type: 'application/pdf',
      storage_url: 'https://x.example/storage/v1/object/public/content/a.pdf',
      storage_path: 'preview/kfbm/K4-a/szenario/Szenario_4a.pdf',
      page_count: 1,
      order_index: KIND_ROWS.scenario.orderIndex,
      uploaded_by_id: CREATOR_ID,
    });
    const ids = [pdfFile.file.id];
    h.store.state = { ...h.store.state, status: 'review' };
    const dry = await runTransfer(
      h.deps,
      request('dry_run', { publishOriginals: ids })
    );
    expect(dry.ok && dry.data.status).toBe('ok');
    const applied = await runTransfer(
      h.deps,
      request('apply', { publishOriginals: ids })
    );
    expect(applied.ok && applied.data.originals.published).toBe(0);
    expect(exerciseRows(h)).toHaveLength(1);
    expect(exerciseRows(h)[0].storage_path).toBe(
      'preview/kfbm/K4-a/szenario/Szenario_4a.pdf'
    );
    expect(h.bucket.objects.size).toBe(0);
  });

  it('keeps the use case apart: its task and its model solution are not published', async () => {
    const files = await enablerFiles({ tree: true });
    const useCase = files.find(f => f.file.decision.docType === 'use_case')!;
    const ucPdf = useCasePdf();
    const h = harness([...files, ucPdf]);
    const ids = [useCase.file.id, ucPdf.file.id];
    const dry = await runTransfer(
      h.deps,
      request('dry_run', { publishOriginals: ids })
    );
    expect(dry.ok && dry.data.originals).toEqual({
      published: 0,
      refused: [
        expect.objectContaining({ code: 'NOT_AN_ENABLER_TEXT' }),
        expect.objectContaining({ code: 'NOT_AN_ENABLER_TEXT' }),
      ],
    });
    await runTransfer(h.deps, request('apply', { publishOriginals: ids }));
    expect(h.bucket.objects.size).toBe(0);
    const documents = h.db.tables.content_documents;
    // no model solution and no trainer-only row of the use case
    expect(
      documents.filter(d => d.document_type === 'TRAINER_SOLUTION')
    ).toEqual([]);
    expect(documents.filter(d => d.visibility === 'TRAINER_ONLY')).toEqual([]);
    expect(JSON.stringify(h.db.tables)).not.toContain(CANARY.useCaseSolution);
    expect(JSON.stringify(h.db.tables)).not.toContain(CANARY.criteria);
  });
});
