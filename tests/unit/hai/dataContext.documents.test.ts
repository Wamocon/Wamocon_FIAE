/**
 * @jest-environment node
 */
// The data intent "document_query": recognized before the other intents (also
// before the name search of a trainer), answered from the database with the
// access of the turn, neutral without an access.

import { PgDialect } from 'drizzle-orm/pg-core';

const mockExecute = jest.fn();
jest.mock('@/db', () => ({ __esModule: true, default: {} }));
jest.mock('@/db/haiDb', () => ({
  __esModule: true,
  default: { execute: (...args: unknown[]) => mockExecute(...args) },
}));
jest.mock('@/lib/auth-helpers', () => ({ toHaiRole: jest.fn() }));
jest.mock('@/lib/catalog/scope', () => ({
  getCatalogScopeForUserId: jest.fn(),
}));
jest.mock('@/lib/catalog/phase-plan-db', () => ({ loadPhasePlan: jest.fn() }));

import db from '@/db';
import { toHaiRole } from '@/lib/auth-helpers';
import { getCatalogScopeForUserId } from '@/lib/catalog/scope';
import { classifyDataIntent, fetchDataContext } from '@/lib/hai/dataContext';

const FIAE = '00000000-0000-4000-8000-000000000001';
const dialect = new PgDialect();

describe('classifyDataIntent: files', () => {
  it.each([
    'Welche Dateien hat dieser Enabler?',
    'Wie heißt die Datei zu Use Case 3?',
    'Gibt es einen Anhang?',
    'Welche Unterlagen gibt es?',
    'Was steht in Datenbank_Grundlagen.pdf?',
    'welche dateien hat dieser kurs',
  ])('"%s" is document_query for both roles', message => {
    expect(classifyDataIntent(message, 'TRAINEE')).toBe('document_query');
    expect(classifyDataIntent(message, 'TRAINER')).toBe('document_query');
  });

  it('a trainer asking for the files is not asking for a person called "Dateien"', () => {
    expect(
      classifyDataIntent(
        'Welche Dateien hat der Enabler Normalisierung?',
        'TRAINER'
      )
    ).toBe('document_query');
  });

  it.each([
    ['Welche Abgaben sind offen?', 'submission_query'],
    // a question about submissions is no question about the files of the content
    ['Welche Dateien muss ich abgeben?', 'none'],
    ['Wann habe ich Berufsschule?', 'calendar_query'],
    ['Wie ist mein Fortschritt?', 'progress_query'],
    ['Was ist ein Primärschlüssel?', 'none'],
    ['Was steht heute an?', 'day_briefing'],
  ])('"%s" stays %s', (message, intent) => {
    expect(classifyDataIntent(message, 'TRAINEE')).toBe(intent);
  });
});

describe('fetchDataContext: document_query', () => {
  const snapshotSelects = [
    [
      {
        fullName: 'Tina Trainee',
        firstName: 'Tina',
        role: 'TRAINEE',
        startOfTrainingDate: null,
        ausbildungDurationYears: 3,
      },
    ],
    [{ cnt: 0 }],
    [],
  ];

  function installDb(documents: Array<Record<string, unknown>>) {
    const queue = [...snapshotSelects];
    const chain = (rows: unknown[]) => {
      const c: Record<string, unknown> = {};
      for (const m of ['from', 'where', 'orderBy', 'limit']) c[m] = () => c;
      c.then = (resolve: (v: unknown[]) => unknown) => resolve(rows);
      return c;
    };
    (db as unknown as Record<string, unknown>).select = jest.fn(() =>
      chain(queue.shift() ?? [])
    );
    (db as unknown as Record<string, unknown>).execute = jest.fn(
      async () => []
    );
    mockExecute.mockImplementation(async (query: unknown) => {
      const text = dialect.sqlToQuery(query as never).sql;
      if (text.includes("'enabler' AS type")) return [];
      return documents;
    });
  }

  const documentRow = (extra: Record<string, unknown> = {}) => ({
    id: 'doc-1',
    title: 'Theorie',
    file_name: 'Normalisierung_Theorie.pdf',
    mime_type: 'application/pdf',
    document_type: 'THEORY',
    visibility: 'ALL',
    enabler_id: '3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0001',
    enabler_title: 'Normalisierung',
    ...extra,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (toHaiRole as jest.Mock).mockReturnValue('TRAINEE');
    (getCatalogScopeForUserId as jest.Mock).mockResolvedValue(null);
  });

  it('answers from the database with the access of the turn', async () => {
    installDb([documentRow()]);
    const context = await fetchDataContext(
      'user-1',
      'TRAINEE',
      'Welche Dateien hat dieser Enabler?',
      {
        documentAccess: { catalogIds: [FIAE], audience: 'trainee' },
        page: {
          enablerIds: ['3a0e4e4c-9f1e-4f3e-9c55-2f6a9d6a0001'],
          useCaseIds: [],
          courseIds: [],
        },
      }
    );
    expect(context?.dataIntent).toBe('document_query');
    expect(context?.summary).toContain('**Dateien:** 1 Datei gefunden.');
    expect(context?.summary).toContain('Normalisierung_Theorie.pdf');
  });

  it('a named PDF is handed on for its pages', async () => {
    installDb([documentRow()]);
    const context = await fetchDataContext(
      'user-1',
      'TRAINEE',
      'Was steht in Normalisierung_Theorie.pdf?',
      { documentAccess: { catalogIds: [FIAE], audience: 'trainee' } }
    );
    expect(context?.documentIds).toEqual(['doc-1']);
  });

  it('a list hands on no document ids', async () => {
    installDb([
      documentRow(),
      documentRow({ id: 'doc-2', file_name: 'B.pdf' }),
    ]);
    const context = await fetchDataContext(
      'user-1',
      'TRAINEE',
      'Welche Dateien gibt es?',
      { documentAccess: { catalogIds: [FIAE], audience: 'trainee' } }
    );
    expect(context?.documentIds).toBeUndefined();
  });

  it('is neutral without an access and asks no document query', async () => {
    installDb([documentRow()]);
    const context = await fetchDataContext(
      'user-1',
      'TRAINEE',
      'Welche Dateien gibt es?',
      {}
    );
    expect(context?.summary).toContain(
      'keine passende Datei in deinen freigegebenen Inhalten'
    );
    expect(context?.summary).not.toContain('Normalisierung_Theorie.pdf');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('a trainee does not get a solution file, even if the database returned it', async () => {
    installDb([
      documentRow({
        id: 'doc-sol',
        title: 'Musterlösung',
        file_name: 'Loesung.pdf',
        document_type: 'TRAINER_SOLUTION',
      }),
    ]);
    const context = await fetchDataContext(
      'user-1',
      'TRAINEE',
      'Welche Dateien hat dieser Enabler?',
      { documentAccess: { catalogIds: [FIAE], audience: 'trainee' } }
    );
    expect(context?.summary).not.toContain('Loesung.pdf');
    expect(context?.summary).not.toContain('Musterlösung');
    expect(context?.summary).toContain('keine passende Datei');
  });
});
