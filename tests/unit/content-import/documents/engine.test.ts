import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it } from '@jest/globals';

import { ImportAbort } from '@/lib/content-import/apply/db';
import {
  executeDocumentPlan,
  type DocumentRunOptions,
} from '@/lib/content-import/documents/engine';
import { buildDocumentPlan } from '@/lib/content-import/documents/plan';
import {
  CONTENT_BUCKET,
  SOLUTIONS_BUCKET,
} from '@/lib/content-import/documents/storage';
import type { ScannedPdf } from '@/lib/content-import/documents/types';

import {
  CREATOR_ID,
  KFBM_CATALOG_ID,
  MemoryImportDb,
} from '../../../helpers/memoryImportDb';
import { MemoryStorage } from '../../../helpers/memoryStorage';

const K4 =
  '04 - Koordinations- und Organisationsaufgaben übernehmen (§ 4 Abs. 2 Nr. 4)';
const SUPABASE = 'https://proj.supabase.co';

const pdf = (text: string) =>
  new Uint8Array(Buffer.from(`%PDF-1.7\n${text}\n%%EOF`));
const sha = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

type Source = { scanned: ScannedPdf; bytes: Uint8Array };

function source(rel: string, heading: string, pages = 4): Source {
  const bytes = pdf(rel);
  return {
    bytes,
    scanned: {
      rel,
      size: bytes.length,
      magicOk: true,
      sha256: sha(bytes),
      pageCount: pages,
      headText: heading,
    },
  };
}

/** The four documents of enabler 4a, the text of 4b, and 4c, 4z. */
function sources(): Source[] {
  return [
    source(`${K4}/Enabler/4a_Titel.pdf`, '4a) Titel', 17),
    source(`${K4}/Szenarien/Szenario_4a_Titel.pdf`, 'Szenario 4a) Titel', 2),
    source(`${K4}/Use-Cases/UC_4a_Titel.pdf`, '4a) Titel', 7),
    source(
      `${K4}/Use-Cases_Musterlösung/UC_4a_Titel_Musterlösung.pdf`,
      '4a) Titel',
      11
    ),
    source(`${K4}/Enabler/4b_Zweites.pdf`, '4b) Zweites'),
    source(`${K4}/Use-Cases/UC_4c_Drittes.pdf`, '4c) Drittes'),
    source(`${K4}/Enabler/4z_Fehlt.pdf`, '4z) Fehlt'),
  ];
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
  const enablers: Record<string, string> = {};
  for (const letter of ['a', 'b', 'c']) {
    const [row] = await db.insert('enablers', [
      {
        course_id: course.id,
        training_catalog_id: KFBM_CATALOG_ID,
        code: `K4-${letter}`,
        title: `Enabler ${letter}`,
        order_index: 1,
        description_text: 'Text',
        is_active: false,
      },
    ]);
    enablers[letter] = String(row.id);
  }
  // the use case hangs on the enabler: 4a and 4c have one, 4b has none
  for (const letter of ['a', 'c']) {
    await db.insert('use_cases', [
      {
        course_id: course.id,
        training_catalog_id: KFBM_CATALOG_ID,
        enabler_id: enablers[letter],
        code: `K4-${letter}`,
        title: `Use Case ${letter}`,
        description_text: 'Text',
        order_index: 1,
        is_active: false,
      },
    ]);
  }
  return enablers;
}

describe('executeDocumentPlan', () => {
  let db: MemoryImportDb;
  let storage: MemoryStorage;
  let all: Source[];
  let options: DocumentRunOptions;
  const plan = () => buildDocumentPlan(all.map(s => s.scanned));

  beforeEach(async () => {
    db = new MemoryImportDb();
    storage = new MemoryStorage();
    all = sources();
    await seedTarget(db);
    options = {
      createdBy: CREATOR_ID,
      write: true,
      upload: true,
      overwriteFiles: false,
      target: 'preview',
      supabaseUrl: SUPABASE,
      bytesOf: async item =>
        (all.find(s => s.scanned.rel === item.rel) as Source).bytes,
    };
  });

  const docs = () => db.tables.content_documents;
  const row = (type: string, parent: 'enabler_id' | 'use_case_id') =>
    docs().find(d => d.document_type === type && d[parent] != null) as Record<
      string,
      any
    >;

  it('a check compares only: no row, no object, no read of a file', async () => {
    let reads = 0;
    const report = await executeDocumentPlan(db, storage, plan(), {
      ...options,
      write: false,
      upload: false,
      bytesOf: async () => {
        reads += 1;
        return pdf('x');
      },
    });
    expect(report.tables.content_documents).toEqual({
      insert: 6,
      update: 0,
      unchanged: 0,
    });
    expect(docs()).toHaveLength(0);
    expect(storage.calls).toEqual([]);
    expect(reads).toBe(0);
    expect(report.wrote).toBe(false);
  });

  it('a dry run writes the rows (the job rolls them back) and touches no storage', async () => {
    const report = await executeDocumentPlan(db, storage, plan(), {
      ...options,
      upload: false,
    });
    expect(report.wrote).toBe(true);
    expect(docs()).toHaveLength(6);
    expect(storage.calls).toEqual([]);
    expect(report.uploads).toEqual({ put: 0, replaced: 0 });
  });

  it('an apply copies the files and writes the rows in the form of FIAE', async () => {
    const report = await executeDocumentPlan(db, storage, plan(), options);
    expect(report.tables.content_documents.insert).toBe(6);
    expect(report.uploads).toEqual({ put: 6, replaced: 0 });

    // the enabler text: THEORY / ALL, public bucket
    const theory = row('THEORY', 'enabler_id');
    expect(theory).toMatchObject({
      title: 'Enabler K4-a: Lehrtext (Original PDF)',
      visibility: 'ALL',
      mime_type: 'application/pdf',
      file_name: '4a_Titel.pdf',
      page_count: 17,
      organization_id: null,
      uploaded_by_id: CREATOR_ID,
      course_id: null,
      use_case_id: null,
      order_index: 0,
    });
    expect(theory.storage_path).toBe('preview/kfbm/K4-a/enabler/4a_Titel.pdf');
    expect(theory.storage_url).toBe(
      `${SUPABASE}/storage/v1/object/public/${CONTENT_BUCKET}/preview/kfbm/K4-a/enabler/4a_Titel.pdf`
    );

    // the scenario: what FIAE uses for a scenario, EXERCISE / ALL
    const scenario = row('EXERCISE', 'enabler_id');
    expect(scenario).toMatchObject({
      title: 'Szenario K4-a (PDF)',
      visibility: 'ALL',
      order_index: 100,
      page_count: 2,
    });
    expect(scenario.storage_path).toContain('/szenario/');

    // the task of the use case: TRAINEE_QUESTION / ALL
    const task = row('TRAINEE_QUESTION', 'use_case_id');
    expect(task).toMatchObject({
      title: 'Use Case K4-a: Aufgabe (PDF)',
      visibility: 'ALL',
      enabler_id: null,
    });
    expect(task.storage_url).toContain(`/public/${CONTENT_BUCKET}/`);

    // the model solution: TRAINER_SOLUTION / TRAINER_ONLY, never in the public bucket
    const solution = row('TRAINER_SOLUTION', 'use_case_id');
    expect(solution).toMatchObject({
      title: 'Use Case K4-a: Musterlösung (PDF)',
      visibility: 'TRAINER_ONLY',
      file_name: 'UC_4a_Titel_Musterlösung.pdf',
    });
    expect(solution.storage_path).toBe(
      'preview/kfbm/K4-a/musterloesung/UC_4a_Titel_Musterloesung.pdf'
    );
    expect(solution.storage_url).toBe(
      `private://${SOLUTIONS_BUCKET}/${solution.storage_path}`
    );
    expect(solution.storage_url).not.toMatch(/^https?:/);

    // where the files are
    expect(storage.objects.size).toBe(6);
    expect(
      [...storage.objects.keys()].filter(k => k.includes('/K4-a/')).sort()
    ).toEqual(
      [
        `${CONTENT_BUCKET}/${theory.storage_path}`,
        `${CONTENT_BUCKET}/${scenario.storage_path}`,
        `${CONTENT_BUCKET}/${task.storage_path}`,
        `${SOLUTIONS_BUCKET}/${solution.storage_path}`,
      ].sort()
    );
    expect(
      [...storage.objects.keys()].filter(
        k => k.startsWith(`${CONTENT_BUCKET}/`) && k.includes('musterloesung')
      )
    ).toEqual([]);
    expect(new Set([...storage.contentTypes.values()])).toEqual(
      new Set(['application/pdf'])
    );
  });

  it('the local target uses its own path prefix', async () => {
    await executeDocumentPlan(db, storage, plan(), {
      ...options,
      target: 'local',
      supabaseUrl: 'http://127.0.0.1:54321',
    });
    const paths = docs().map(d => String(d.storage_path));
    expect(paths.every(p => p.startsWith('kfbm/K4-'))).toBe(true);
    expect(paths.some(p => p.startsWith('preview/'))).toBe(false);
  });

  it('a second apply adds no row and no object', async () => {
    await executeDocumentPlan(db, storage, plan(), options);
    const before = db.snapshot();
    const callsBefore = storage.calls.length;
    const report = await executeDocumentPlan(db, storage, plan(), options);
    expect(report.tables.content_documents).toEqual({
      insert: 0,
      update: 0,
      unchanged: 6,
    });
    expect(report.uploads).toEqual({ put: 0, replaced: 0 });
    expect(db.snapshot()).toBe(before);
    expect(
      storage.calls.slice(callsBefore).filter(c => c.startsWith('put'))
    ).toEqual([]);
  });

  it('leaves an existing row of the same text alone, also when its file is another one (the original of the upload)', async () => {
    const [enabler] = await db.select('enablers', { code: 'K4-a' });
    await db.insert('content_documents', [
      {
        enabler_id: enabler.id,
        title: 'Enabler K4-a: Lehrtext (Original PDF)',
        document_type: 'THEORY',
        visibility: 'ALL',
        file_name: '1761600000000_K4-a_lehrtext.pdf',
        mime_type: 'application/pdf',
        storage_url: `${SUPABASE}/storage/v1/object/public/content/preview/u/1761600000000_K4-a_lehrtext.pdf`,
        storage_path: 'preview/u/1761600000000_K4-a_lehrtext.pdf',
        order_index: 0,
      },
    ]);
    const report = await executeDocumentPlan(db, storage, plan(), options);
    expect(report.tables.content_documents).toEqual({
      insert: 5,
      update: 0,
      unchanged: 1,
    });
    expect(
      [...storage.objects.keys()].some(k => k.includes('/K4-a/enabler/'))
    ).toBe(false);
  });

  it('stops before the first write when an object is there without its row', async () => {
    storage.objects.set(
      `${CONTENT_BUCKET}/preview/kfbm/K4-a/szenario/Szenario_4a_Titel.pdf`,
      pdf('older')
    );
    await expect(
      executeDocumentPlan(db, storage, plan(), options)
    ).rejects.toMatchObject({ code: 'CONFLICTS' });
    expect(docs()).toHaveLength(0);
    expect(storage.calls.filter(c => c.startsWith('put'))).toEqual([]);
  });

  it('replaces such an object only with the switch', async () => {
    const key = `${CONTENT_BUCKET}/preview/kfbm/K4-a/szenario/Szenario_4a_Titel.pdf`;
    storage.objects.set(key, pdf('older'));
    const report = await executeDocumentPlan(db, storage, plan(), {
      ...options,
      overwriteFiles: true,
    });
    expect(report.uploads).toEqual({ put: 6, replaced: 1 });
    expect(storage.calls).toContain(`put ${key} upsert=true`);
    expect(storage.objects.get(key)).toEqual(
      all.find(s => s.scanned.rel.includes('Szenario_4a'))?.bytes
    );
  });

  it('skips an enabler or a use case that the target does not have, and says so', async () => {
    const report = await executeDocumentPlan(db, storage, plan(), options);
    expect(report.skipped.map(s => [s.enablerCode, s.kind, s.code])).toEqual([
      ['K4-z', 'enabler', 'ENABLER_MISSING'],
    ]);
    // 4b has an enabler but no use case: its enabler text is taken
    expect(
      docs().some(d => String(d.storage_path).includes('/K4-b/enabler/'))
    ).toBe(true);
    // 4c has a use case and a task file, but no solution file: the task is taken
    expect(
      docs().some(d => String(d.storage_path).includes('/K4-c/aufgabe/'))
    ).toBe(true);
  });

  it('names a use case that is missing for a task or a solution', async () => {
    all.push(
      source(`${K4}/Use-Cases/UC_4b_Zweites.pdf`, '4b) Zweites'),
      source(
        `${K4}/Use-Cases_Musterlösung/UC_4b_Zweites_Musterlösung.pdf`,
        '4b) Zweites'
      )
    );
    const report = await executeDocumentPlan(db, storage, plan(), options);
    expect(
      report.skipped
        .filter(s => s.enablerCode === 'K4-b')
        .map(s => [s.kind, s.code])
        .sort()
    ).toEqual([
      ['usecase_solution', 'USE_CASE_MISSING'],
      ['usecase_task', 'USE_CASE_MISSING'],
    ]);
  });

  it('takes the files out again when a later copy fails, and writes no row', async () => {
    storage.failPutAt = 3;
    await expect(
      executeDocumentPlan(db, storage, plan(), options)
    ).rejects.toThrow('storage put failed');
    expect(storage.objects.size).toBe(0);
    expect(docs()).toHaveLength(0);
  });

  it('takes the files out again when the rows cannot be written', async () => {
    const failing = Object.create(db) as MemoryImportDb;
    failing.insert = async (table, rows) => {
      if (table === 'content_documents') throw new Error('insert broke');
      return db.insert(table, rows);
    };
    await expect(
      executeDocumentPlan(failing, storage, plan(), options)
    ).rejects.toThrow('insert broke');
    expect(storage.objects.size).toBe(0);
  });

  it('lists what it created, so a failed commit can take the files out', async () => {
    const created: Array<{ bucket: string; path: string }> = [];
    await executeDocumentPlan(db, storage, plan(), { ...options, created });
    expect(created).toHaveLength(6);
    expect(created.filter(c => c.bucket === SOLUTIONS_BUCKET)).toHaveLength(1);
  });

  it('stops when a file changed between the plan and the copy', async () => {
    const changed = options.bytesOf;
    await expect(
      executeDocumentPlan(db, storage, plan(), {
        ...options,
        bytesOf: async item => {
          const bytes = await changed(item);
          return item.rel.includes('Szenario_4a') ? pdf('other') : bytes;
        },
      })
    ).rejects.toMatchObject({ code: 'FILE_CHANGED' });
    expect(storage.objects.size).toBe(0);
    expect(docs()).toHaveLength(0);
  });

  it('is a conflict when a row exists with another visibility', async () => {
    const [useCase] = await db.select('use_cases', { code: 'K4-a' });
    await db.insert('content_documents', [
      {
        use_case_id: useCase.id,
        title: 'Use Case K4-a: Musterlösung (PDF)',
        document_type: 'TRAINER_SOLUTION',
        visibility: 'ALL',
        file_name: 'x.pdf',
        storage_url: 'https://x.test/a.pdf',
      },
    ]);
    await expect(
      executeDocumentPlan(db, storage, plan(), options)
    ).rejects.toMatchObject({ code: 'CONFLICTS' });
    expect(storage.objects.size).toBe(0);
  });

  it('stops without the catalog, without enablers and for an unknown author', async () => {
    const empty = new MemoryImportDb();
    await expect(
      executeDocumentPlan(empty, storage, plan(), options)
    ).rejects.toMatchObject({ code: 'NO_ENABLERS' });
    empty.catalogs = [];
    await expect(
      executeDocumentPlan(empty, storage, plan(), options)
    ).rejects.toMatchObject({ code: 'NO_CATALOG' });
    await expect(
      executeDocumentPlan(db, storage, plan(), {
        ...options,
        createdBy: '99999999-0000-4000-8000-0000000000ff',
      })
    ).rejects.toBeInstanceOf(ImportAbort);
  });

  it('takes only files with the status ok', async () => {
    all.push(
      source(`${K4}/Szenarien/4c.pdf`, 'Szenario 4c) X'),
      source(`${K4}/Enabler/4d_Titel.pdf`, '4e) Falsch')
    );
    await executeDocumentPlan(db, storage, plan(), options);
    expect(docs().some(d => d.file_name === '4c.pdf')).toBe(false);
    expect(docs().some(d => String(d.file_name).startsWith('4d_'))).toBe(false);
  });

  it('refuses a url that is no https project for a write to the Preview', async () => {
    await expect(
      executeDocumentPlan(db, storage, plan(), {
        ...options,
        supabaseUrl: null,
      })
    ).rejects.toMatchObject({ code: 'NO_STORAGE_URL' });
  });
});
