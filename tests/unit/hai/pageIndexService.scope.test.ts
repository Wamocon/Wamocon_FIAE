/**
 * @jest-environment node
 */
import { PgDialect } from 'drizzle-orm/pg-core';

// PageIndex scope (package H1): a trainee never gets TRAINER_SOLUTION or
// TRAINER_ONLY documents, nobody reads documents of another occupation or
// organization, and a citation carries the storage URL only for documents that
// trainees may see (the bucket is public). The real SQL runs in the smoke test
// against a local database; here the SQL is rendered and the logic around it
// (URL rule, fail closed) is tested with rows the mock returns.

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
  documentAccessCondition,
  fetchPageIndexContext,
  type PageIndexOptions,
} from '@/lib/hai/pageIndexService';

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'b0000000-0000-4000-8000-00000000000b';
const ENABLER = '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0001';
const COURSE = '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0002';

const dialect = new PgDialect();
function sqlOf(call: number) {
  const query = dialect.sqlToQuery(mockExecute.mock.calls[call][0]);
  return { text: query.sql.replace(/\s+/g, ' '), params: query.params };
}
function calls() {
  return mockExecute.mock.calls.map((_c, i) => sqlOf(i));
}

function options(extra: Partial<PageIndexOptions> = {}): PageIndexOptions {
  return {
    catalogIds: [FIAE],
    audience: 'trainee',
    organizationId: ORG,
    currentEnablerId: ENABLER,
    currentCourseId: COURSE,
    ...extra,
  };
}

const theoryRow = {
  id: 'doc-theory',
  title: 'Theorie',
  file_name: 'theorie.pdf',
  storage_url: 'https://bucket.example/theorie.pdf',
  document_type: 'THEORY',
  visibility: 'ALL',
  enabler_id: ENABLER,
  enabler_title: 'Enabler',
  course_year: null,
};
const solutionRow = {
  id: 'doc-solution',
  title: 'Loesung',
  file_name: 'loesung.pdf',
  storage_url: 'https://bucket.example/loesung.pdf',
  document_type: 'TRAINER_SOLUTION',
  visibility: 'TRAINER_ONLY',
  use_case_id: 'uc-1',
  use_case_title: 'Use Case',
  year: null,
  training_stage: null,
};
const questionRow = {
  ...solutionRow,
  id: 'doc-question',
  title: 'Aufgabe',
  file_name: 'aufgabe.pdf',
  storage_url: 'https://bucket.example/aufgabe.pdf',
  document_type: 'TRAINEE_QUESTION',
  visibility: 'ALL',
};

function pdfWith(text: string) {
  return {
    success: true,
    pages: [{ page: 1, text, charCount: text.length }],
    totalPages: 1,
    totalCharacters: text.length,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  clearPageIndexCache();
  mockExecute.mockResolvedValue([]);
  mockExtract.mockResolvedValue(pdfWith('Normalisierung Datenbank Schema'));
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('documentAccessCondition', () => {
  const render = (opts: Parameters<typeof documentAccessCondition>[0]) => {
    const query = dialect.sqlToQuery(documentAccessCondition(opts));
    return { text: query.sql.replace(/\s+/g, ' '), params: query.params };
  };

  it('excludes solutions and trainer-only documents for trainees', () => {
    const { text } = render({ audience: 'trainee', organizationId: ORG });
    expect(text).toContain(
      "cd.document_type IS DISTINCT FROM 'TRAINER_SOLUTION'"
    );
    expect(text).toContain("cd.visibility IS DISTINCT FROM 'TRAINER_ONLY'");
  });

  it('does not exclude anything by type for trainer level', () => {
    const { text } = render({ audience: 'trainer', organizationId: ORG });
    expect(text).not.toContain('TRAINER_SOLUTION');
    expect(text).not.toContain('TRAINER_ONLY');
  });

  it('allows own organization and platform documents only', () => {
    const own = render({ audience: 'trainee', organizationId: ORG });
    expect(own.text).toContain(
      '(cd.organization_id IS NULL OR cd.organization_id = $1::uuid)'
    );
    expect(own.params).toEqual([ORG]);
    const none = render({ audience: 'trainer', organizationId: null });
    expect(none.text).toBe('cd.organization_id IS NULL');
  });

  it('treats a malformed organization id as no organization', () => {
    const { text } = render({ audience: 'trainee', organizationId: 'x; drop' });
    expect(text).not.toContain('organization_id =');
  });
});

describe('fetchPageIndexContext: scope of the SQL', () => {
  it('reads nothing without a catalog scope (fail closed)', async () => {
    const result = await fetchPageIndexContext(
      'frage',
      [],
      options({ catalogIds: [] })
    );
    expect(result).toMatchObject({ pdfContext: '', citations: [] });
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('joins the catalog of the enabler and of the use case', async () => {
    await fetchPageIndexContext('frage', [], options({ catalogIds: [KFBM] }));
    const [enablerQuery, useCaseQuery] = calls();
    expect(enablerQuery.text).toContain(
      'JOIN enablers e ON cd.enabler_id = e.id'
    );
    expect(enablerQuery.text).toContain('e.training_catalog_id IN ($');
    expect(enablerQuery.params).toContain(KFBM);
    expect(enablerQuery.params).not.toContain(FIAE);
    expect(useCaseQuery.text).toContain('uc.training_catalog_id IN ($');
    expect(useCaseQuery.params).toContain(KFBM);
  });

  it('keeps ids from the client inside the catalog join', async () => {
    // current enabler and course come from the client; they only reach the
    // query next to the catalog condition
    await fetchPageIndexContext('frage', [], options());
    for (const query of calls()) {
      expect(query.text).toMatch(/training_catalog_id IN \(\$\d+::uuid\)/);
    }
  });

  it('excludes trainer documents for trainees in both queries', async () => {
    await fetchPageIndexContext('frage', [], options());
    for (const query of calls()) {
      expect(query.text).toContain(
        "cd.document_type IS DISTINCT FROM 'TRAINER_SOLUTION'"
      );
      expect(query.text).toContain(
        "cd.visibility IS DISTINCT FROM 'TRAINER_ONLY'"
      );
      expect(query.text).toContain('cd.organization_id IS NULL OR');
    }
  });

  it('asks for the question PDFs of use cases for trainees, never for the solutions', async () => {
    await fetchPageIndexContext('frage', [], options());
    const useCaseQuery = calls()[1];
    expect(useCaseQuery.params).toContain('TRAINEE_QUESTION');
    expect(useCaseQuery.params).not.toContain('TRAINER_SOLUTION');
  });

  it('asks for the solution PDFs of use cases for trainer level', async () => {
    await fetchPageIndexContext('frage', [], options({ audience: 'trainer' }));
    const [enablerQuery, useCaseQuery] = calls();
    expect(useCaseQuery.params).toContain('TRAINER_SOLUTION');
    expect(enablerQuery.text).not.toContain('IS DISTINCT FROM');
    expect(useCaseQuery.text).toContain('uc.training_catalog_id IN ($');
  });

  it('drops malformed ids from the client instead of failing', async () => {
    await fetchPageIndexContext(
      'frage',
      [],
      options({ currentEnablerId: 'not-a-uuid', currentCourseId: "x'); --" })
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('takes enabler and course ids from the vector results as well', async () => {
    const result = {
      id: 'v1',
      sourceType: 'enabler',
      sourceId: '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0009',
      chunkIndex: 0,
      content: 'x',
      similarity: 0.9,
      metadata: { courseId: '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0008' },
    };
    await fetchPageIndexContext(
      'frage',
      [result],
      options({ currentEnablerId: undefined, currentCourseId: undefined })
    );
    const [enablerQuery, useCaseQuery] = calls();
    expect(enablerQuery.params).toContain(result.sourceId);
    expect(useCaseQuery.params).toContain(result.metadata.courseId);
  });
});

describe('fetchPageIndexContext: citations and URLs', () => {
  it('gives a theory document a URL and a page citation', async () => {
    mockExecute.mockResolvedValueOnce([theoryRow]).mockResolvedValueOnce([]);
    const result = await fetchPageIndexContext('Normalisierung', [], options());
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({
      documentId: 'doc-theory',
      pageNumber: 1,
      storageUrl: 'https://bucket.example/theorie.pdf',
    });
    expect(result.pdfContext).toContain('Theorie');
  });

  it('gives a trainee-visible use case question PDF a URL', async () => {
    mockExecute.mockResolvedValueOnce([]).mockResolvedValueOnce([questionRow]);
    const result = await fetchPageIndexContext('Normalisierung', [], options());
    expect(result.citations[0].storageUrl).toBe(
      'https://bucket.example/aufgabe.pdf'
    );
  });

  it('gives a trainer solution a citation without any URL', async () => {
    mockExecute.mockResolvedValueOnce([]).mockResolvedValueOnce([solutionRow]);
    const result = await fetchPageIndexContext(
      'Normalisierung',
      [],
      options({ audience: 'trainer' })
    );
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].documentTitle).toBe('Loesung');
    expect(result.citations[0].storageUrl).toBeUndefined();
    // the text is still read for the trainer
    expect(mockExtract).toHaveBeenCalledWith(
      'https://bucket.example/loesung.pdf'
    );
  });

  it('gives a TRAINER_ONLY theory document no URL either', async () => {
    mockExecute
      .mockResolvedValueOnce([
        { ...theoryRow, id: 'doc-trainer-only', visibility: 'TRAINER_ONLY' },
      ])
      .mockResolvedValueOnce([]);
    const result = await fetchPageIndexContext(
      'Normalisierung',
      [],
      options({ audience: 'trainer' })
    );
    expect(result.citations[0].storageUrl).toBeUndefined();
  });

  it('never puts a storage URL of a hidden document into the context text', async () => {
    mockExecute.mockResolvedValueOnce([]).mockResolvedValueOnce([solutionRow]);
    const result = await fetchPageIndexContext(
      'Normalisierung',
      [],
      options({ audience: 'trainer' })
    );
    expect(result.pdfContext).not.toContain('https://bucket.example');
  });
});

describe('fetchPageIndexContext: robustness', () => {
  it('returns an empty context when no document matches', async () => {
    const result = await fetchPageIndexContext('frage', [], options());
    expect(result).toEqual({
      pdfContext: '',
      documentsScanned: 0,
      relevantPages: 0,
      citations: [],
    });
  });

  it('survives a failing query and a failing PDF', async () => {
    mockExecute
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce([questionRow]);
    mockExtract.mockRejectedValue(new Error('pdf broken'));
    const result = await fetchPageIndexContext('Normalisierung', [], options());
    expect(result.citations).toEqual([]);
  });

  it('skips documents outside the training scope', async () => {
    mockExecute
      .mockResolvedValueOnce([{ ...theoryRow, course_year: 3 }])
      .mockResolvedValueOnce([]);
    const result = await fetchPageIndexContext('Normalisierung', [], {
      ...options(),
      trainingScope: {
        applies: true,
        durationYears: 3,
        planLabel: '3 Jahre',
        currentAusbildungsjahr: 1,
        currentPhase: 1,
        allowedAusbildungsjahre: [1],
        allowedComponentPhases: [1, 3],
        phaseMonthRange: { startMonth: 1, endMonth: 18 },
      },
    });
    expect(result.citations).toEqual([]);
  });
});
