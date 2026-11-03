import { renderCondition } from '../../../../helpers/mockDb';
import {
  FILE_CHECK_SAMPLE,
  checkDocumentFiles,
  type FileExistence,
} from '@/lib/catalog/content-check/file-check';

const CATALOG = '00000000-0000-4000-8000-0000000000aa';
const HOST = 'https://project.example.supabase.co';
const addr = (file: string) =>
  `${HOST}/storage/v1/object/public/content/kfbm/${file}`;

type Rows = Record<string, unknown[]>;

/** A database double: answers by the marker comment of the statement. */
function fakeDb(rows: Rows) {
  const seen: { name: string; sql: string; params: unknown[] }[] = [];
  const execute = jest.fn(async (statement: unknown) => {
    const rendered = renderCondition(statement);
    const name = /\/\* cc:(\w+) \*\//.exec(rendered.sql)?.[1] ?? '?';
    seen.push({ name, ...rendered });
    return rows[name] ?? [];
  });
  return { db: { execute } as never, execute, seen };
}

const doc = (n: number, file: string, total = 3) => ({
  id: `d${n}`,
  title: `Dokument ${n}`,
  storage_url: addr(file),
  total,
});

/** A storage with the given existing paths; the asked paths are recorded. */
function storageOf(
  existing: string[],
  unknown: string[] = []
): FileExistence & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    exists: async path => {
      asked.push(path);
      if (unknown.includes(path)) return 'unknown';
      return existing.includes(path);
    },
  };
}

const deps = (storage: FileExistence | null, over = {}) => ({
  storage: () => storage,
  supabaseUrl: HOST,
  ...over,
});

describe('checkDocumentFiles', () => {
  it('answers null for a catalog that does not exist and reads nothing else', async () => {
    const { db, execute } = fakeDb({ file_catalog: [] });
    expect(await checkDocumentFiles(db, CATALOG, deps(null))).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('draws a random sample of at most 50 documents of this catalog, bound as a parameter', async () => {
    const { db, seen } = fakeDb({ file_catalog: [{ code: 'TEST' }] });
    await checkDocumentFiles(db, CATALOG, deps(storageOf([])));
    const sample = seen.find(s => s.name === 'file_sample');
    expect(sample).toBeDefined();
    expect(sample!.sql).toMatch(/order by random\(\)/);
    expect(sample!.sql).toMatch(/limit/);
    expect(sample!.params).toContain(CATALOG);
    expect(sample!.params).toContain(FILE_CHECK_SAMPLE);
    expect(sample!.sql).toMatch(/organization_id is null/);
    // never more than 50, whatever the caller asks
    const big = fakeDb({ file_catalog: [{ code: 'TEST' }] });
    await checkDocumentFiles(
      big.db,
      CATALOG,
      deps(storageOf([]), { sample: 5000 })
    );
    expect(big.seen.find(s => s.name === 'file_sample')!.params).toContain(
      FILE_CHECK_SAMPLE
    );
  });

  it('an empty sample is a result without findings', async () => {
    const { db } = fakeDb({
      file_catalog: [{ code: 'TEST' }],
      file_sample: [],
    });
    const result = await checkDocumentFiles(db, CATALOG, deps(storageOf([])));
    expect(result).toMatchObject({
      catalogCode: 'TEST',
      sampleSize: 0,
      checked: 0,
      missing: 0,
      findings: [],
    });
    expect(typeof result!.durationMs).toBe('number');
  });

  it('reports the missing files as an error with the titles, never the path', async () => {
    const { db } = fakeDb({
      file_catalog: [{ code: 'TEST' }],
      file_sample: [
        doc(1, 'a.pdf', 1200),
        doc(2, 'gone.pdf', 1200),
        doc(3, 'also-gone.pdf', 1200),
      ],
    });
    const storage = storageOf(['kfbm/a.pdf']);
    const result = await checkDocumentFiles(db, CATALOG, deps(storage));
    expect(result).toMatchObject({
      totalWithFile: 1200,
      sampleSize: 3,
      checked: 3,
      missing: 2,
      unknown: 0,
    });
    expect(result!.findings).toHaveLength(1);
    const finding = result!.findings[0];
    expect(finding).toMatchObject({
      rule: 'document.storage.missing',
      severity: 'error',
      source: 'script',
      category: 'document',
    });
    expect(finding.summary).toBe('2 Dokumente haben keine Datei im Speicher.');
    expect(finding.details).toContain('3 von 1200');
    expect(finding.refs.map(r => r.label).sort()).toEqual([
      'Dokument 2',
      'Dokument 3',
    ]);
    const text = JSON.stringify(result);
    expect(text).not.toContain('gone.pdf');
    expect(text).not.toContain('storage/v1');
  });

  it('asks only for existence and with the path inside the bucket', async () => {
    const { db } = fakeDb({
      file_catalog: [{ code: 'TEST' }],
      file_sample: [doc(1, 'a.pdf')],
    });
    const storage = storageOf(['kfbm/a.pdf']);
    await checkDocumentFiles(db, CATALOG, deps(storage));
    expect(storage.asked).toEqual(['kfbm/a.pdf']);
  });

  it('all present: no finding', async () => {
    const { db } = fakeDb({
      file_catalog: [{ code: 'TEST' }],
      file_sample: [doc(1, 'a.pdf'), doc(2, 'b.pdf')],
    });
    const result = await checkDocumentFiles(
      db,
      CATALOG,
      deps(storageOf(['kfbm/a.pdf', 'kfbm/b.pdf']))
    );
    expect(result).toMatchObject({ checked: 2, missing: 0, findings: [] });
  });

  it('a storage that cannot answer is unknown, not missing', async () => {
    const { db } = fakeDb({
      file_catalog: [{ code: 'TEST' }],
      file_sample: [doc(1, 'a.pdf'), doc(2, 'b.pdf')],
    });
    const result = await checkDocumentFiles(
      db,
      CATALOG,
      deps(storageOf(['kfbm/a.pdf'], ['kfbm/b.pdf']))
    );
    expect(result).toMatchObject({ checked: 1, missing: 0, unknown: 1 });
    expect(result!.findings).toEqual([]);
    expect(result!.notes.join(' ')).toContain('keine Antwort');
  });

  it('an external address and an unsafe path are not asked', async () => {
    const { db } = fakeDb({
      file_catalog: [{ code: 'TEST' }],
      file_sample: [
        {
          id: 'x',
          title: 'Link',
          storage_url: 'https://example.com/a.mp4',
          total: 2,
        },
        {
          id: 'y',
          title: 'Unsafe',
          storage_url: addr('..%2f..%2fx'),
          total: 2,
        },
      ],
    });
    const storage = storageOf([]);
    const result = await checkDocumentFiles(db, CATALOG, deps(storage));
    expect(storage.asked).toEqual([]);
    expect(result).toMatchObject({ external: 1, unknown: 1, checked: 0 });
    expect(result!.notes.join(' ')).toContain('außerhalb des Speichers');
  });

  it('without storage access nothing is checked and the note says so', async () => {
    const { db } = fakeDb({
      file_catalog: [{ code: 'TEST' }],
      file_sample: [doc(1, 'a.pdf')],
    });
    const result = await checkDocumentFiles(db, CATALOG, deps(null));
    expect(result).toMatchObject({ checked: 0, unknown: 1, findings: [] });
    expect(result!.notes.join(' ')).toContain('nicht eingerichtet');
  });

  it('stops starting questions at the time limit and says so', async () => {
    const { db } = fakeDb({
      file_catalog: [{ code: 'TEST' }],
      file_sample: [doc(1, 'a.pdf'), doc(2, 'b.pdf'), doc(3, 'c.pdf')],
    });
    // the clock jumps past the limit after the sample was read
    let calls = 0;
    const now = () => (calls++ < 1 ? 0 : 10_000);
    const result = await checkDocumentFiles(
      db,
      CATALOG,
      deps(storageOf([]), { now, timeLimitMs: 1000 })
    );
    expect(result!.notChecked).toBe(3);
    expect(result!.checked).toBe(0);
    expect(result!.notes.join(' ')).toContain('Zeitlimit');
    expect(result!.durationMs).toBeGreaterThan(0);
  });

  it('names the duration of the run', async () => {
    const { db } = fakeDb({
      file_catalog: [{ code: 'TEST' }],
      file_sample: [doc(1, 'a.pdf')],
    });
    let t = 1000;
    const result = await checkDocumentFiles(
      db,
      CATALOG,
      deps(storageOf(['kfbm/a.pdf']), { now: () => (t += 250) })
    );
    expect(result!.durationMs).toBeGreaterThan(0);
    expect(result!.generatedAt).toBe(new Date(1250).toISOString());
  });

  it('names at most 20 documents and keeps the count of all', async () => {
    const sample = Array.from({ length: 30 }, (_, i) =>
      doc(i, `g${i}.pdf`, 500)
    );
    const { db } = fakeDb({
      file_catalog: [{ code: 'TEST' }],
      file_sample: sample,
    });
    const result = await checkDocumentFiles(db, CATALOG, deps(storageOf([])));
    const finding = result!.findings[0];
    expect(finding.refs).toHaveLength(20);
    expect(finding.summary).toBe('30 Dokumente haben keine Datei im Speicher.');
    expect(finding.details).toContain('die ersten 20');
  });
});
