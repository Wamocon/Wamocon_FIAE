/**
 * @jest-environment node
 */
import { PgDialect } from 'drizzle-orm/pg-core';

// PageIndex for a file the question named: the pages come through the existing
// PageIndex way, the ids are checked again against the occupations, the
// organization and the audience, and a file without a keyword hit still gives
// its first pages.

const mockExecute = jest.fn();
const mockExtract = jest.fn();

jest.mock('@/db/haiDb', () => ({
  __esModule: true,
  default: { execute: (...args: unknown[]) => mockExecute(...args) },
}));
jest.mock('@/lib/hai/pdfExtractor', () => ({
  extractTextByPage: (url: string) => mockExtract(url),
}));

import {
  clearPageIndexCache,
  fetchPageIndexContext,
  type PageIndexOptions,
} from '@/lib/hai/pageIndexService';

const FIAE = '00000000-0000-4000-8000-000000000001';
const ORG = 'b0000000-0000-4000-8000-00000000000b';
const DOC = '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a00d1';
const dialect = new PgDialect();
const sqlOf = (call: number) => {
  const q = dialect.sqlToQuery(mockExecute.mock.calls[call][0]);
  return { text: q.sql.replace(/\s+/g, ' '), params: q.params };
};

const options = (extra: Partial<PageIndexOptions> = {}): PageIndexOptions => ({
  catalogIds: [FIAE],
  audience: 'trainee',
  organizationId: ORG,
  documentIds: [DOC],
  ...extra,
});

const namedRow = {
  id: DOC,
  title: 'Datenbank Grundlagen',
  file_name: 'Datenbank_Grundlagen.pdf',
  storage_url: 'https://bucket.example/db.pdf',
  document_type: 'THEORY',
  visibility: 'ALL',
  enabler_id: 'e-1',
  enabler_title: 'Normalisierung',
  use_case_id: null,
  use_case_title: null,
};

function pdf(pages: string[]) {
  return {
    success: true,
    pages: pages.map((text, i) => ({
      page: i + 1,
      text,
      charCount: text.length,
    })),
    totalPages: pages.length,
    totalCharacters: pages.join('').length,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  clearPageIndexCache();
  mockExecute.mockResolvedValue([]);
  mockExtract.mockResolvedValue(
    pdf(['Seite eins Inhalt', 'Seite zwei Inhalt'])
  );
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('fetchPageIndexContext with documentIds', () => {
  it('reads the named file first, with the access conditions of every other query', async () => {
    mockExecute.mockResolvedValueOnce([namedRow]);
    await fetchPageIndexContext('Was steht in der Datei?', [], options());
    const named = sqlOf(0);
    expect(named.params).toContain(DOC);
    expect(named.text).toContain('cd.id IN (');
    // the catalog of every linked record, the organization, the audience
    expect(named.text).toContain('e.training_catalog_id IN (');
    expect(named.text).toContain('uc.training_catalog_id IN (');
    expect(named.text).toContain('co.training_catalog_id IN (');
    expect(named.params).toContain(FIAE);
    expect(named.text).toContain(
      "cd.document_type IS DISTINCT FROM 'TRAINER_SOLUTION'"
    );
    expect(named.text).toContain(
      "cd.visibility IS DISTINCT FROM 'TRAINER_ONLY'"
    );
    expect(named.text).toContain('cd.organization_id IS NULL OR');
    expect(named.params).toContain(ORG);
    // a file without a link matches nobody
    expect(named.text).toContain(
      'cd.enabler_id IS NOT NULL OR cd.use_case_id IS NOT NULL'
    );
  });

  it('a trainer query does not exclude trainer files, a trainee query does', async () => {
    await fetchPageIndexContext('frage', [], options({ audience: 'trainer' }));
    expect(sqlOf(0).text).not.toContain('TRAINER_SOLUTION');
    mockExecute.mockClear();
    await fetchPageIndexContext('frage', [], options({ audience: 'trainee' }));
    expect(sqlOf(0).text).toContain('TRAINER_SOLUTION');
  });

  it('gives the first pages of a named file that has no keyword hit', async () => {
    mockExecute.mockResolvedValueOnce([namedRow]);
    const result = await fetchPageIndexContext('Worum geht es?', [], options());
    expect(mockExtract).toHaveBeenCalledWith('https://bucket.example/db.pdf');
    expect(result.pdfContext).toContain('Seite eins Inhalt');
    expect(result.pdfContext).toContain('Seite zwei Inhalt');
    expect(result.citations.map(c => c.documentId)).toEqual([DOC, DOC]);
    expect(result.citations[0].storageUrl).toBe(
      'https://bucket.example/db.pdf'
    );
  });

  it('gives no URL in the citation of a file that trainees may not see', async () => {
    mockExecute.mockResolvedValueOnce([
      { ...namedRow, document_type: 'TRAINER_SOLUTION' },
    ]);
    const result = await fetchPageIndexContext(
      'Worum geht es?',
      [],
      options({ audience: 'trainer' })
    );
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations.every(c => c.storageUrl === undefined)).toBe(true);
  });

  it('reads nothing without a catalog scope, even with document ids (fail closed)', async () => {
    const result = await fetchPageIndexContext(
      'frage',
      [],
      options({ catalogIds: [] })
    );
    expect(result.pdfContext).toBe('');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('drops malformed ids before the query', async () => {
    await fetchPageIndexContext(
      'frage',
      [],
      options({
        documentIds: ["x'; drop table", 'nope'],
        currentEnablerId: undefined,
      })
    );
    // no named query: no valid id, no enabler, no course
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('without document ids the first query is the old one', async () => {
    await fetchPageIndexContext(
      'frage',
      [],
      options({
        documentIds: undefined,
        currentEnablerId: '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0001',
      })
    );
    expect(sqlOf(0).text).toContain('JOIN enablers e ON cd.enabler_id = e.id');
    expect(sqlOf(0).text).not.toContain('cd.id IN (');
  });
});
