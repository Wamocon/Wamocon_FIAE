/**
 * @jest-environment node
 */

// Who may be taken to which document: the rules of the second line of defense in
// code (openableRows), the choice by file name (pickByKeys), the allow list for
// the link forms with ?document and the metrics (tokens only).

jest.mock('@/db', () => ({ __esModule: true, default: {} }));
jest.mock('@/db/haiDb', () => ({ __esModule: true, default: {} }));

import {
  openableRows,
  pickByKeys,
  type OpenableDocument,
} from '@/lib/hai/navigation/contentData';
import type { DocumentRow } from '@/lib/hai/documentQuery';
import {
  documentIdFromSearch,
  enablerIdFromSearch,
  isAllowedNavigationPath,
  pathOfEnabler,
  pathOfUseCase,
  trainerPathOfEnabler,
  trainerPathOfUseCase,
} from '@/lib/hai/navigation/targets';
import {
  metricKey,
  navigationCounters,
  recordNavigationOutcome,
  resetNavigationCounters,
} from '@/lib/hai/navigation/metrics';

const ID = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;

function row(overrides: Partial<DocumentRow>): DocumentRow {
  return {
    id: ID(1),
    title: 'Skript',
    fileName: 'Skript.pdf',
    mimeType: 'application/pdf',
    documentType: 'THEORY',
    visibility: 'ALL',
    enablerId: ID(2),
    enablerTitle: 'Enabler',
    useCaseId: null,
    useCaseTitle: null,
    courseId: null,
    courseTitle: null,
    courseYear: null,
    useCaseYears: null,
    useCaseStages: null,
    ...overrides,
  };
}

describe('openableRows: who may be taken to which document', () => {
  const rows = [
    row({ id: ID(1) }),
    row({
      id: ID(3),
      documentType: 'TRAINER_SOLUTION',
      visibility: 'TRAINER_ONLY',
      title: 'Musterlösung',
      fileName: 'Loesung.pdf',
    }),
    row({ id: ID(4), enablerId: null, courseId: ID(9), fileName: 'Kurs.pdf' }),
    row({
      id: ID(5),
      fileName: 'Text.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    row({ id: ID(6), visibility: 'TRAINER_ONLY', title: 'Intern' }),
  ];

  it('a trainee never gets a solution or a trainer-only file, whatever the query returned', () => {
    for (const enabled of [true, false]) {
      const ids = openableRows(rows, { level: 'TRAINEE' }, enabled).map(
        r => r.id
      );
      expect(ids).toEqual([ID(1)]);
    }
  });

  it('a file without an enabler or use case and a Word file are no link for anybody', () => {
    for (const level of ['TRAINEE', 'TRAINER', 'ADMIN'] as const) {
      const ids = openableRows(rows, { level }, true).map(r => r.id);
      expect(ids).not.toContain(ID(4));
      expect(ids).not.toContain(ID(5));
    }
  });

  it('a trainer gets a solution only while the owner switch of the index is on', () => {
    const on = openableRows(rows, { level: 'TRAINER' }, true).map(r => r.id);
    expect(on).toContain(ID(3));
    const off = openableRows(rows, { level: 'TRAINER' }, false).map(r => r.id);
    expect(off).not.toContain(ID(3));
    expect(off).toContain(ID(1));
    // an admin level is a trainer level
    expect(
      openableRows(rows, { level: 'ADMIN' }, false).map(r => r.id)
    ).not.toContain(ID(3));
  });
});

describe('pickByKeys', () => {
  const docs: OpenableDocument[] = [
    ['Szenario K14-i (PDF)', 'Szenario_14i_Datensicherung.pdf'],
    ['Szenario K10-h (PDF)', 'Szenario_10h_Beschaffung.pdf'],
    ['Skript 14', 'Skript_14.pdf'],
  ].map(([title, fileName], index) => ({
    id: ID(index + 1),
    title,
    fileName,
    documentType: 'EXERCISE',
    parentType: 'enabler' as const,
    parentId: ID(8),
    parentTitle: 'E',
    courseId: null,
  }));

  it('finds the file by a part of its name, the longest key decides', () => {
    expect(
      pickByKeys(docs, [{ key: 'szenario 14i', partial: true }]).map(d => d.id)
    ).toEqual([ID(1)]);
    expect(
      pickByKeys(docs, [{ key: 'szenario k10 h', partial: true }]).map(
        d => d.id
      )
    ).toEqual([ID(2)]);
  });

  it('a short piece of a name matches only a file with exactly that name', () => {
    expect(pickByKeys(docs, [{ key: 'szenario', partial: false }])).toEqual([]);
    expect(pickByKeys(docs, [{ key: 'szenario', partial: true }]).length).toBe(
      2
    );
  });
});

describe('the allow list for links with a document', () => {
  const E = ID(1);
  const D = ID(2);

  it('allows exactly the forms the platform builds', () => {
    for (const path of [
      pathOfEnabler(E, D),
      pathOfUseCase(E, D),
      trainerPathOfUseCase(E, D),
      trainerPathOfEnabler(ID(3), E, D),
      trainerPathOfEnabler(ID(3), E),
      `/trainee/enablers/${E}`,
    ]) {
      expect(isAllowedNavigationPath(path)).toBe(true);
    }
  });

  it.each([
    `/trainee/enablers/${E}?document=not-a-uuid`,
    `/trainee/enablers/${E}?document=${ID(2)}&x=1`,
    `/trainee/enablers/${E}?x=${ID(2)}`,
    `/trainee/enablers/${E}?document=${ID(2)}&document=${ID(3)}`,
    `/trainee/enablers/${E}?document=${ID(2)}#a`,
    `/trainee/enablers/${E}?document=${ID(2)}"><script>`,
    `/trainee/enablers/${E}?document=../../api/x`,
    `/trainee/enablers/${E}?document=${ID(2)}%00`,
    `/trainee/enablers/${E}/quiz?document=${ID(2)}`,
    `/trainee/modules/${E}?document=${ID(2)}`,
    `/trainer/use-cases/${E}?enabler=${ID(2)}`,
    `/trainer/content-management/${E}/edit?document=${ID(2)}`,
    `/trainer/content-management/${E}/edit?enabler=${ID(2)}&x=1`,
    `/trainer/content-management/${E}/edit?enabler=x`,
    `https://example.com/trainee/enablers/${E}?document=${ID(2)}`,
    `//evil.example/trainee/enablers/${E}?document=${ID(2)}`,
    `/trainee/enablers/${E}?document=${ID(2).toUpperCase()}&`,
  ])('refuses %s', path => {
    expect(isAllowedNavigationPath(path)).toBe(false);
  });

  it('builders return null for a bad id and never build another form', () => {
    expect(pathOfEnabler('x', D)).toBeNull();
    expect(pathOfEnabler(E, 'x')).toBeNull();
    expect(trainerPathOfEnabler('x', E)).toBeNull();
    expect(trainerPathOfUseCase(E, "1' OR 1=1")).toBeNull();
  });

  it('reads the parameters strictly: one known parameter, a uuid, nothing else', () => {
    expect(documentIdFromSearch(`document=${D}`)).toBe(D);
    expect(documentIdFromSearch(`document=${D.toUpperCase()}`)).toBe(D);
    expect(documentIdFromSearch(`document=${D}&enabler=${E}`)).toBe(D);
    expect(enablerIdFromSearch(`enabler=${E}&document=${D}`)).toBe(E);
    expect(documentIdFromSearch('document=abc')).toBeNull();
    expect(documentIdFromSearch(`document=${D}&evil=1`)).toBeNull();
    expect(documentIdFromSearch(`document=${D}&document=${E}`)).toBeNull();
    expect(documentIdFromSearch(`document=${D}'--`)).toBeNull();
    expect(documentIdFromSearch('')).toBeNull();
    expect(documentIdFromSearch(null)).toBeNull();
    expect(documentIdFromSearch(new URLSearchParams({ document: D }))).toBe(D);
  });
});

describe('the metrics hold tokens only', () => {
  beforeEach(() => {
    resetNavigationCounters();
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('counts a request without a page with its reason and never writes text', () => {
    recordNavigationOutcome({
      intent: 'unmatched',
      outcome: 'not_found',
      level: 'TRAINEE',
      voice: true,
      choices: true,
    });
    recordNavigationOutcome({
      intent: 'unmatched',
      outcome: 'not_found',
      level: 'TRAINEE',
      voice: true,
      choices: true,
    });
    expect(
      navigationCounters()['unmatched|not_found|TRAINEE|voice|cards']
    ).toBe(2);
    const line = String((console.info as jest.Mock).mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({
      event: 'hai.navigation',
      outcome: 'not_found',
      gap: true,
    });
    expect(Object.keys(JSON.parse(line)).sort()).toEqual(
      ['choices', 'event', 'gap', 'intent', 'level', 'outcome', 'voice'].sort()
    );
  });

  it('a request that reached a page is no gap', () => {
    recordNavigationOutcome({
      intent: 'course',
      outcome: 'offer',
      level: 'TRAINER',
      voice: false,
      choices: false,
    });
    const line = String((console.info as jest.Mock).mock.calls[0][0]);
    expect(JSON.parse(line).gap).toBe(false);
    expect(
      metricKey({
        intent: 'course',
        outcome: 'offer',
        level: 'TRAINER',
        voice: false,
        choices: false,
      })
    ).toBe('course|offer|TRAINER|text|nocards');
  });
});

describe('pickByKeys: a shorter piece of the name never opens another file', () => {
  const task: OpenableDocument = {
    id: ID(1),
    title: 'Aufgabe Bestellsystem',
    fileName: 'UC_1b_Bestellsystem.pdf',
    documentType: 'TRAINEE_QUESTION',
    parentType: 'use_case',
    parentId: ID(8),
    parentTitle: 'U',
    courseId: null,
  };

  it('"UC_1b_Bestellsystem_Musterloesung" does not open the task file UC_1b_Bestellsystem', () => {
    expect(
      pickByKeys(
        [task],
        [
          { key: 'uc 1b bestellsystem musterloesung', partial: true },
          { key: 'uc 1b bestellsystem', partial: false },
        ]
      )
    ).toEqual([]);
  });

  it('the file with exactly the longest name is still found', () => {
    expect(
      pickByKeys(
        [task],
        [
          { key: 'uc 1b bestellsystem', partial: true },
          { key: 'bestellsystem', partial: false },
        ]
      ).map(d => d.id)
    ).toEqual([ID(1)]);
  });
});
