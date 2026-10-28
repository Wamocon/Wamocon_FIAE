/**
 * @jest-environment node
 */
// The whole way of --from-word without LibreOffice and without a database: invented Word files ->
// the docx for the converter (word.ts) -> a stand-in converter that writes a PDF with the text of
// the docx -> the check of the PDF text -> cleaned metadata -> plan -> the engine of the PDF import
// against a database and a storage in memory. It proves the rules of the owner end to end: the
// scenario PDF is the whole scenario (solution part included) and public, the task PDF of a use case
// has no solution, the model solution is private, a second run adds nothing, files are replaced only
// with the switch.
import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it } from '@jest/globals';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { extractDocxParagraphs } from '@/lib/content-import/docx-paragraphs';
import { executeDocumentPlan } from '@/lib/content-import/documents/engine';
import { cleanPdfMetadata } from '@/lib/content-import/documents/pdf-clean';
import { buildDocumentPlan } from '@/lib/content-import/documents/plan';
import {
  CONTENT_BUCKET,
  SOLUTIONS_BUCKET,
} from '@/lib/content-import/documents/storage';
import type { ScannedPdf } from '@/lib/content-import/documents/types';
import {
  prepareWordDocument,
  wordPdfName,
  wordPdfPath,
  type WordSource,
} from '@/lib/content-import/documents/word';

import {
  CREATOR_ID,
  KFBM_CATALOG_ID,
  MemoryImportDb,
} from '../../../helpers/memoryImportDb';
import { MemoryStorage } from '../../../helpers/memoryStorage';
import {
  CANARY,
  docxFromBlocks,
  enablerBlocks,
  scenarioBlocks,
  useCaseBlocks,
} from '../../../helpers/uploadFixtures';

// the solution and the knowledge text of a scenario: public now, they stay in its PDF
const SCENARIO_WORDS = ['WOMBAT', 'LAMA'] as const;

const SUPABASE = 'https://proj.supabase.co';
const sha = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

/** The stand-in for the converter: a PDF with the lines of the docx, and the text of it. */
async function standInConvert(docx: Uint8Array) {
  const lines = (await extractDocxParagraphs(docx))
    .map(p => p.text)
    .filter(text => text.length > 0);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setAuthor('Erika Mustermann');
  const page = doc.addPage();
  lines.forEach((line, i) =>
    page.drawText(line.replace(/[^\x20-\xff]/g, '?'), {
      x: 20,
      y: 800 - i * 12,
      size: 8,
      font,
    })
  );
  return { bytes: await doc.save(), text: lines.join('\n') };
}

interface Made {
  scanned: ScannedPdf;
  bytes: Uint8Array;
  /** The text that the converter put into the PDF. */
  text: string;
}

async function makeAll(
  files: Array<{
    source: WordSource;
    blocks: Parameters<typeof docxFromBlocks>[0];
  }>
) {
  const made: Made[] = [];
  const skips: string[] = [];
  for (const file of files) {
    const result = await prepareWordDocument(
      file.source,
      await docxFromBlocks(file.blocks),
      {
        enablerKey: '4a',
        enablerCode: 'K4-a',
        strongSolutions: [],
        reviewedBareSolutionLine: false,
      }
    );
    if (!result.ok) {
      skips.push(result.code);
      continue;
    }
    for (const variant of result.variants) {
      const converted = await standInConvert(variant.docx);
      const problem = variant.check(converted.text);
      if (problem) {
        skips.push(problem);
        continue;
      }
      const cleaned = await cleanPdfMetadata(converted.bytes, variant.title);
      const rel = wordPdfPath(
        '04',
        'Koordination',
        variant.kind,
        wordPdfName(variant.kind, '4a') as string
      );
      made.push({
        bytes: cleaned.bytes,
        text: converted.text,
        scanned: {
          rel,
          size: cleaned.bytes.length,
          magicOk: true,
          sha256: sha(cleaned.bytes),
          pageCount: cleaned.pageCount,
          headText: converted.text.slice(0, 4000),
        },
      });
    }
  }
  return { made, skips };
}

async function seedTarget(db: MemoryImportDb) {
  const [course] = await db.insert('courses', [
    {
      training_catalog_id: KFBM_CATALOG_ID,
      code: 'K4',
      title: 'Kurs',
      created_by_id: CREATOR_ID,
      is_active: false,
      is_published: false,
    },
  ]);
  const [enabler] = await db.insert('enablers', [
    {
      course_id: course.id,
      training_catalog_id: KFBM_CATALOG_ID,
      code: 'K4-a',
      title: 'Enabler a',
      order_index: 1,
      description_text: 'Text',
      is_active: false,
    },
  ]);
  await db.insert('use_cases', [
    {
      course_id: course.id,
      training_catalog_id: KFBM_CATALOG_ID,
      enabler_id: enabler.id,
      code: 'K4-a',
      title: 'Use Case a',
      description_text: 'Text',
      order_index: 1,
      is_active: false,
    },
  ]);
}

describe('PDFs from Word through the engine of the PDF import', () => {
  let db: MemoryImportDb;
  let storage: MemoryStorage;
  let made: Made[];

  const run = (over: { overwriteFiles?: boolean; upload?: boolean } = {}) =>
    executeDocumentPlan(
      db,
      storage,
      buildDocumentPlan(made.map(m => m.scanned)),
      {
        createdBy: CREATOR_ID,
        write: true,
        upload: true,
        overwriteFiles: false,
        target: 'preview',
        supabaseUrl: SUPABASE,
        bytesOf: async item =>
          (made.find(m => m.scanned.rel === item.rel) as Made).bytes,
        ...over,
      }
    );

  beforeEach(async () => {
    db = new MemoryImportDb();
    storage = new MemoryStorage();
    await seedTarget(db);
    const result = await makeAll([
      { source: 'enabler', blocks: enablerBlocks({ code: '4a' }) },
      { source: 'scenario', blocks: scenarioBlocks({ code: '4a' }) },
      { source: 'usecase', blocks: useCaseBlocks({ code: '4a' }) },
    ]);
    made = result.made;
    expect(result.skips).toEqual([]);
  });

  it('makes the four PDFs, all accepted by the plan under the names of the convention', () => {
    const plan = buildDocumentPlan(made.map(m => m.scanned));
    expect(
      plan.items.map(i => `${i.kind}:${i.status}:${i.enablerCode}`).sort()
    ).toEqual([
      'enabler:ok:K4-a',
      'scenario:ok:K4-a',
      'usecase_solution:ok:K4-a',
      'usecase_task:ok:K4-a',
    ]);
    expect(plan.items.map(i => i.rel.split('/').pop()).sort()).toEqual(
      [
        '4a.pdf',
        'Szenario_4a.pdf',
        'UC_4a.pdf',
        'UC_4a_Musterlösung.pdf',
      ].sort()
    );
  });

  it('puts the files and the rows in the form of FIAE: the whole scenario public, the model solution of a use case private', async () => {
    const report = await run();
    expect(report.tables.content_documents.insert).toBe(4);
    expect(report.uploads).toEqual({ put: 4, replaced: 0 });
    const docs = db.tables.content_documents;
    const rowOf = (type: string) =>
      docs.find(d => d.document_type === type) as Record<string, any>;

    const scenario = rowOf('EXERCISE');
    expect(scenario).toMatchObject({
      title: 'Szenario K4-a (PDF)',
      visibility: 'ALL',
      file_name: 'Szenario_4a.pdf',
      order_index: 100,
    });
    const scenarioMade = made.find(m => m.scanned.rel.includes('Szenario_4a'))!;
    // the file in the public bucket is the whole scenario: situation, solution and knowledge
    const stored = storage.objects.get(
      `${CONTENT_BUCKET}/${scenario.storage_path}`
    )!;
    expect(sha(stored)).toBe(scenarioMade.scanned.sha256);
    expect(scenario.storage_url).toContain(`/public/${CONTENT_BUCKET}/`);
    expect(scenarioMade.text).toContain('Beispiel Technik');
    for (const word of SCENARIO_WORDS)
      expect(scenarioMade.text).toContain(word);
    expect(scenarioMade.text).toMatch(/L(ö|oe)sungsszenario|Fachwissen zur L/);

    const task = rowOf('TRAINEE_QUESTION');
    const taskMade = made.find(m => m.scanned.rel.endsWith('/UC_4a.pdf'))!;
    expect(task.visibility).toBe('ALL');
    expect(taskMade.text).toContain('Weg zum Ziel');
    expect(taskMade.text).not.toContain('Musterlösung');
    expect(taskMade.text).not.toContain('OKAPI');
    expect(task.storage_url).toContain(`/public/${CONTENT_BUCKET}/`);

    const solution = rowOf('TRAINER_SOLUTION');
    const solutionMade = made.find(m => m.scanned.rel.includes('Musterl'))!;
    expect(solution).toMatchObject({
      visibility: 'TRAINER_ONLY',
      title: 'Use Case K4-a: Musterlösung (PDF)',
    });
    expect(solution.storage_url).toBe(
      `private://${SOLUTIONS_BUCKET}/${solution.storage_path}`
    );
    expect(solutionMade.text).toContain('OKAPI');
    expect(
      [...storage.objects.keys()].filter(
        k => k.startsWith(`${CONTENT_BUCKET}/`) && k.includes('musterloesung')
      )
    ).toEqual([]);
    expect(
      storage.objects.has(`${SOLUTIONS_BUCKET}/${solution.storage_path}`)
    ).toBe(true);
    // the canary of the solution is in no public object name or row
    expect(
      JSON.stringify(docs.filter(d => d.visibility === 'ALL'))
    ).not.toContain(CANARY.useCaseSolution);
  });

  it('the author of the Word file is not in any stored file', async () => {
    await run();
    for (const bytes of storage.objects.values()) {
      expect(Buffer.from(bytes).toString('latin1')).not.toContain('Mustermann');
    }
  });

  it('a second run adds no row and no file, the switch replaces the files of its own rows', async () => {
    await run();
    const before = db.snapshot();
    const second = await run();
    expect(second.tables.content_documents).toEqual({
      insert: 0,
      update: 0,
      unchanged: 4,
    });
    expect(second.uploads).toEqual({ put: 0, replaced: 0 });
    expect(db.snapshot()).toBe(before);

    // a new Word version: a different file under the same name replaces the old one, with the switch
    const newer = await standInConvert(
      await docxFromBlocks([
        ...enablerBlocks({ code: '4a' }),
        { text: 'Neuer Absatz.' },
      ])
    );
    const index = made.findIndex(m => m.scanned.rel.endsWith('/4a.pdf'));
    made[index] = {
      ...made[index],
      bytes: newer.bytes,
      scanned: {
        ...made[index].scanned,
        sha256: sha(newer.bytes),
        size: newer.bytes.length,
      },
    };
    expect((await run()).uploads).toEqual({ put: 0, replaced: 0 });
    const third = await run({ overwriteFiles: true });
    expect(third.uploads).toEqual({ put: 4, replaced: 4 });
    expect(third.tables.content_documents.insert).toBe(0);
    const path = String(
      db.tables.content_documents.find(d => d.document_type === 'THEORY')!
        .storage_path
    );
    expect(sha(storage.objects.get(`${CONTENT_BUCKET}/${path}`)!)).toBe(
      sha(newer.bytes)
    );
  });

  it('a dry run and a check touch no storage', async () => {
    const dry = await run({ upload: false });
    expect(dry.uploads).toEqual({ put: 0, replaced: 0 });
    expect(storage.calls).toEqual([]);
  });
});

describe('what never becomes a PDF for the trainees (use case task)', () => {
  const context = {
    enablerKey: '4a',
    enablerCode: 'K4-a',
    strongSolutions: [],
    reviewedBareSolutionLine: false,
  };

  it('drops a task whose converted text shows the solution although the docx was cut', async () => {
    const result = await prepareWordDocument(
      'usecase',
      await docxFromBlocks(useCaseBlocks({ code: '4a' })),
      context
    );
    if (!result.ok) throw new Error('expected variants');
    const task = result.variants[0];
    expect(task.kind).toBe('usecase_task');
    // a converter that adds text of its own: the second layer catches it
    for (const leak of [
      `\n${CANARY.useCaseSolution}`,
      '\nMusterlösung\nText',
      '\nLösungsszenario\nText',
    ]) {
      const converted = await standInConvert(task.docx);
      expect(task.check(converted.text)).toBeNull();
      expect(task.check(converted.text + leak)).toBe('PDF_SOLUTION');
    }
  });

  it('gives no PDF at all for a use case that cannot be cut', async () => {
    const blocks = [
      ...useCaseBlocks({ code: '4a' }).slice(0, -2),
      // the solution heading is no line of its own: the parser finds no solution
      { text: `Musterlösung ${CANARY.useCaseSolution}` },
    ];
    const result = await prepareWordDocument(
      'usecase',
      await docxFromBlocks(blocks),
      context
    );
    expect(result.ok).toBe(false);
  });

  it('the scenario is the exception: its converted text may show a solution part', async () => {
    const result = await prepareWordDocument(
      'scenario',
      await docxFromBlocks(scenarioBlocks({ code: '4a' })),
      context
    );
    if (!result.ok) throw new Error('expected a variant');
    const converted = await standInConvert(result.variants[0].docx);
    for (const word of SCENARIO_WORDS) expect(converted.text).toContain(word);
    expect(result.variants[0].check(converted.text)).toBeNull();
  });
});
