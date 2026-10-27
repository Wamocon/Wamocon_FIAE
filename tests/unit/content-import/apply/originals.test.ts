import { ImportAbort } from '@/lib/content-import/apply/db';
import {
  enablerOriginalRow,
  executePlan,
  type RunOptions,
} from '@/lib/content-import/apply/engine';
import { findRowLeaks } from '@/lib/content-import/apply/guard';
import { buildImportPlan } from '@/lib/content-import/apply/plan';
import type { EnablerOriginal } from '@/lib/content-import/apply/types';

import { CREATOR_ID, MemoryImportDb } from '../../../helpers/memoryImportDb';
import { loadDecisions, sampleTree } from './fixtures';

// The operation of the upload for the original of an enabler text
// (docs/ki-upload-konzept.md 8.5): a new document row THEORY/ALL at the enabler.
// Left out, the engine behaves as before (engine.test.ts).

const NOW = new Date('2026-10-26T12:00:00Z');
const plan = () => buildImportPlan(sampleTree(), loadDecisions(), { now: NOW });
const options = (patch: Partial<RunOptions> = {}): RunOptions => ({
  createdBy: CREATOR_ID,
  updateExisting: false,
  write: true,
  activate: false,
  scenarioSolutions: false,
  ...patch,
});

const original = (patch: Partial<EnablerOriginal> = {}): EnablerOriginal => ({
  enablerCode: 'K6.2-d',
  title: 'Enabler K6.2-d: Lehrtext (Original PDF)',
  fileName: '1234567890_K6.2-d_lehrtext.pdf',
  fileSize: 4096,
  mimeType: 'application/pdf',
  storageUrl:
    'https://x.example/storage/v1/object/public/content/p/1234567890_K6.2-d_lehrtext.pdf',
  storagePath: 'p/1234567890_K6.2-d_lehrtext.pdf',
  pageCount: 3,
  ...patch,
});

const theoryRows = (db: MemoryImportDb) =>
  db.tables.content_documents.filter(d => d.document_type === 'THEORY');

describe('executePlan: originals of enabler texts', () => {
  it('writes one THEORY/ALL row with the data of the file, at the enabler', async () => {
    const db = new MemoryImportDb();
    const report = await executePlan(
      db,
      plan(),
      options({ enablerOriginals: [original()] })
    );
    const [row] = theoryRows(db);
    const enabler = db.tables.enablers.find(e => e.code === 'K6.2-d')!;
    expect(row).toMatchObject({
      enabler_id: enabler.id,
      use_case_id: null,
      document_type: 'THEORY',
      visibility: 'ALL',
      file_name: '1234567890_K6.2-d_lehrtext.pdf',
      file_size: 4096,
      mime_type: 'application/pdf',
      storage_path: 'p/1234567890_K6.2-d_lehrtext.pdf',
      page_count: 3,
      uploaded_by_id: CREATOR_ID,
    });
    expect(String(row.storage_url)).toContain('/content/p/');
    expect(report.tables.content_documents.insert).toBe(
      db.count('content_documents')
    );
  });

  it('is idempotent: the second run adds nothing and keeps the stored file', async () => {
    const db = new MemoryImportDb();
    await executePlan(db, plan(), options({ enablerOriginals: [original()] }));
    const second = await executePlan(
      db,
      plan(),
      options({
        enablerOriginals: [
          original({
            storagePath: 'p/other.pdf',
            storageUrl: 'https://x/other',
          }),
        ],
      })
    );
    expect(theoryRows(db)).toHaveLength(1);
    expect(theoryRows(db)[0].storage_path).toBe(
      'p/1234567890_K6.2-d_lehrtext.pdf'
    );
    expect(second.tables.content_documents.insert).toBe(0);
  });

  it('writes nothing for the original when the run only compares', async () => {
    const db = new MemoryImportDb();
    const report = await executePlan(
      db,
      plan(),
      options({ write: false, enablerOriginals: [original()] })
    );
    expect(db.totalRows()).toBe(0);
    expect(report.tables.content_documents.insert).toBeGreaterThan(0);
  });

  it('two originals of one enabler (Word and PDF) are two rows', async () => {
    const db = new MemoryImportDb();
    await executePlan(
      db,
      plan(),
      options({
        enablerOriginals: [
          original(),
          original({ title: 'Enabler K6.2-d: Lehrtext (Original Word)' }),
        ],
      })
    );
    expect(theoryRows(db)).toHaveLength(2);
  });

  it('an enabler that is in neither the plan nor the database is a conflict, nothing is written', async () => {
    const db = new MemoryImportDb();
    try {
      await executePlan(
        db,
        plan(),
        options({ enablerOriginals: [original({ enablerCode: 'K6.2-z' })] })
      );
      throw new Error('expected an abort');
    } catch (error) {
      expect(error).toBeInstanceOf(ImportAbort);
      expect((error as ImportAbort).code).toBe('CONFLICTS');
      expect((error as ImportAbort).conflicts[0]).toMatchObject({
        table: 'content_documents',
      });
    }
    expect(db.totalRows()).toBe(0);
  });

  it('the original of an enabler that exists already hangs on that enabler', async () => {
    const db = new MemoryImportDb();
    await executePlan(db, plan(), options());
    const before = db.count('content_documents');
    await executePlan(db, plan(), options({ enablerOriginals: [original()] }));
    expect(db.count('content_documents')).toBe(before + 1);
  });

  it('a solution marker in the title or the file name is refused by the guard, nothing is written', async () => {
    const db = new MemoryImportDb();
    for (const patch of [
      { title: 'Musterlösung: Lehrtext' },
      { fileName: 'Richtige Antwort: B.pdf' },
    ]) {
      await expect(
        executePlan(
          db,
          plan(),
          options({ enablerOriginals: [original(patch)] })
        )
      ).rejects.toMatchObject({ code: 'SOLUTION_LEAK' });
    }
    expect(db.totalRows()).toBe(0);
  });

  it('the row of an original passes the row guard only as a theory document of an enabler', () => {
    const row = enablerOriginalRow(original(), 'enabler-1', CREATOR_ID);
    expect(findRowLeaks({ content_documents: [row] }, [])).toEqual([]);
    expect(
      findRowLeaks({ content_documents: [{ ...row, enabler_id: null }] }, [])
    ).toEqual(['content_documents THEORY row names no enabler']);
    expect(
      findRowLeaks({ content_documents: [{ ...row, use_case_id: 'u' }] }, [])
    ).toEqual(['content_documents THEORY row belongs to a use case']);
    expect(
      findRowLeaks(
        { content_documents: [{ ...row, visibility: 'TRAINER_ONLY' }] },
        []
      )
    ).toEqual(['content_documents row has an unexpected type or visibility']);
  });

  it('behaves as before without originals', async () => {
    const withOption = new MemoryImportDb();
    const without = new MemoryImportDb();
    await executePlan(withOption, plan(), options({ enablerOriginals: [] }));
    await executePlan(without, plan(), options());
    expect(withOption.snapshot()).toBe(without.snapshot());
  });
});
