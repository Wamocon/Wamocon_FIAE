/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../helpers/mockDb';
import { mockCatalogScope } from '../../helpers/mockNext';

// Day companion: what the data context loads for "Was steht für mich an?". The
// day holds real data of the trainee, the progress with the next step per
// occupation (the chosen one first), the existing parts (appointments,
// reports, feedback, notifications) and a concrete statement for every empty
// area, never a general "no data".

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';

const catalogs = [
  { id: FIAE, code: 'FIAE', title: 'Fachinformatiker Anwendungsentwicklung' },
  { id: KFBM, code: 'KFBM', title: 'Kaufleute für Büromanagement' },
];

type Entry = {
  enablerId: string;
  title: string;
  courseTitle: string;
  stage: number | null;
  chapter: number | null;
  orderIndex: number;
  completed: boolean;
  locked: boolean;
};

function entry(overrides: Partial<Entry> & { enablerId: string }): Entry {
  return {
    title: `Enabler ${overrides.enablerId}`,
    courseTitle: 'Datenbanken',
    stage: 1,
    chapter: 1,
    orderIndex: 1,
    completed: false,
    locked: false,
    ...overrides,
  };
}

const trainee = {
  fullName: 'Azubi Eins',
  firstName: 'Azubi',
  role: 'TRAINEE',
  startOfTrainingDate: new Date(2026, 7, 1),
  ausbildungDurationYears: 3,
};

async function load(options: {
  allowed?: string[];
  entries?: Record<string, Entry[] | Error>;
  tables?: Record<string, any>;
}) {
  jest.resetModules();
  const mock = createTableDb({
    profiles: [trainee],
    trainingCatalogs: catalogs,
    ...options.tables,
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    toHaiRole: (role?: string | null) =>
      role === 'TRAINER' || role === 'ADMIN' ? 'TRAINER' : 'TRAINEE',
  }));
  jest.doMock('@/lib/catalog/phase-plan-db', () => ({
    __esModule: true,
    loadPhasePlan: async () => null,
  }));
  const allowed = options.allowed ?? [FIAE];
  mockCatalogScope({
    allowedCatalogIds: allowed,
    activeCatalogId: allowed[0],
    selected: false,
  });
  const loadNextStepEntries = jest.fn(async (...args: unknown[]) => {
    const catalogIds = args[1] as string[];
    const found = (options.entries ?? {})[catalogIds[0]] ?? [];
    if (found instanceof Error) throw found;
    return found;
  });
  jest.doMock('@/lib/hai/navigation/data', () => ({
    __esModule: true,
    loadNextStepEntries,
  }));
  const { fetchDataContext } = await import('@/lib/hai/dataContext');
  return { fetchDataContext, loadNextStepEntries };
}

describe('the day of a trainee', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('holds the progress and the next step in the data block', async () => {
    const { fetchDataContext } = await load({
      entries: {
        [FIAE]: [
          entry({ enablerId: 'a', title: 'SQL Grundlagen', completed: true }),
          entry({
            enablerId: 'b',
            title: 'Joins',
            completed: true,
            orderIndex: 2,
          }),
          entry({
            enablerId: 'c',
            title: 'Normalisierung',
            completed: true,
            orderIndex: 3,
          }),
          entry({ enablerId: 'd', title: 'Transaktionen', orderIndex: 4 }),
        ],
      },
    });
    const ctx = await fetchDataContext(
      'u1',
      'TRAINEE',
      'Was steht für mich an?'
    );

    expect(ctx?.dataIntent).toBe('day_briefing');
    const summary = ctx?.summary ?? '';
    expect(summary).toContain('**Fortschritt und nächster Schritt:**');
    expect(summary).toContain(
      'Fachinformatiker Anwendungsentwicklung: 3 von 4 Enablern abgeschlossen (75%)'
    );
    expect(summary).toContain('Nächster Schritt: Enabler "Transaktionen"');
    // one occupation: no "je Beruf", no mark of a chosen one
    expect(summary).not.toContain('je Beruf');
    expect(summary).not.toContain('gewählter Beruf');
    // the existing parts stay
    expect(summary).toContain('Aktuelle Phase');
    expect(summary).toContain('Taetigkeitsnachweise gesamt');
    expect(summary).toContain('Ungelesene Benachrichtigungen');
  });

  it('shows the progress per occupation, the chosen one first', async () => {
    const entries = {
      [FIAE]: [
        entry({ enablerId: 'f1', title: 'SQL', completed: true }),
        entry({ enablerId: 'f2', title: 'Joins', orderIndex: 2 }),
      ],
      [KFBM]: [
        entry({
          enablerId: 'k1',
          title: 'Buchführung',
          courseTitle: 'Rechnungswesen',
        }),
      ],
    };
    const { fetchDataContext } = await load({
      allowed: [FIAE, KFBM],
      entries,
    });

    const chosen = await fetchDataContext(
      'u1',
      'TRAINEE',
      'Was steht für mich an?',
      {
        preferredCatalogCode: 'kfbm',
      }
    );
    const summary = chosen?.summary ?? '';
    expect(summary).toContain('**Fortschritt und nächster Schritt je Beruf:**');
    const kfbmAt = summary.indexOf(
      'Kaufleute für Büromanagement (gewählter Beruf): 0 von 1'
    );
    const fiaeAt = summary.indexOf(
      'Fachinformatiker Anwendungsentwicklung: 1 von 2'
    );
    expect(kfbmAt).toBeGreaterThan(-1);
    expect(fiaeAt).toBeGreaterThan(kfbmAt);
    expect(summary).toContain('Nächster Schritt: Enabler "Buchführung"');
    expect(summary).toContain('Nächster Schritt: Enabler "Joins"');

    // without a choice the order of the access stays, nothing is marked
    const plain = await fetchDataContext(
      'u1',
      'TRAINEE',
      'Was steht für mich an?'
    );
    const plainSummary = plain?.summary ?? '';
    expect(plainSummary.indexOf('Fachinformatiker')).toBeLessThan(
      plainSummary.indexOf('Kaufleute')
    );
    expect(plainSummary).not.toContain('gewählter Beruf');
  });

  it('ignores a chosen occupation the person does not have (only the order, never access)', async () => {
    const { fetchDataContext, loadNextStepEntries } = await load({
      allowed: [FIAE],
      entries: { [FIAE]: [entry({ enablerId: 'f1', title: 'SQL' })] },
    });
    const ctx = await fetchDataContext(
      'u1',
      'TRAINEE',
      'Was steht für mich an?',
      {
        preferredCatalogCode: 'KFBM',
      }
    );
    expect(ctx?.summary).toContain('Fachinformatiker Anwendungsentwicklung');
    expect(ctx?.summary).not.toContain('Kaufleute');
    // only the catalogs of the person are asked
    const asked = loadNextStepEntries.mock.calls.map(
      c => (c[1] as string[])[0]
    );
    expect(asked).toEqual([FIAE]);
  });

  it('takes the phase plan into account for the next step', async () => {
    const { fetchDataContext } = await load({
      entries: {
        [FIAE]: [
          entry({
            enablerId: 'p1',
            title: 'Phase eins',
            stage: 1,
            completed: true,
          }),
          entry({
            enablerId: 'p2',
            title: 'Phase zwei',
            stage: 2,
            orderIndex: 2,
          }),
        ],
      },
    });
    const ctx = await fetchDataContext(
      'u1',
      'TRAINEE',
      'Was steht für mich an?',
      {
        trainingScope: { currentPhase: 1, allowedComponentPhases: [1] },
      }
    );
    expect(ctx?.summary).toContain('Nächster Schritt: Enabler "Phase zwei"');
    expect(ctx?.summary).toContain('erst später beginnt');
  });

  it('names what is empty concretely instead of "no data"', async () => {
    const { fetchDataContext } = await load({
      entries: { [FIAE]: [entry({ enablerId: 'a', title: 'SQL' })] },
      tables: { notifications: [] },
    });
    const ctx = await fetchDataContext(
      'u1',
      'TRAINEE',
      'Was steht für mich an?'
    );
    const summary = ctx?.summary ?? '';
    expect(summary).toContain('**Leere Bereiche');
    expect(summary).toContain(
      'Für heute und die nächsten 14 Tage sind keine Termine eingetragen'
    );
    expect(summary).toContain('keine Abgaben und damit keine Rückmeldungen');
    expect(summary).not.toContain('keine Daten vor');
    // progress exists, so the whole day is not "empty"
    expect(summary).not.toContain('liegt aktuell nichts vor');
  });

  it('says honestly that nothing is there and suggests a step', async () => {
    const { fetchDataContext } = await load({ entries: {} });
    const ctx = await fetchDataContext(
      'u1',
      'TRAINEE',
      'Was steht für mich an?'
    );
    const summary = ctx?.summary ?? '';
    expect(summary).toContain(
      'noch kein Kurs mit Enablern für dich freigeschaltet'
    );
    expect(summary).toContain('liegt aktuell nichts vor');
    expect(summary).toContain('zum Beispiel weiter lernen');
    expect(summary).not.toContain('keine Daten vor');
  });

  it('says so when the progress could not be loaded, it is no "nothing there"', async () => {
    const { fetchDataContext } = await load({
      entries: { [FIAE]: new Error('db down') },
    });
    const ctx = await fetchDataContext(
      'u1',
      'TRAINEE',
      'Was steht für mich an?'
    );
    const summary = ctx?.summary ?? '';
    expect(summary).toContain(
      '**Fortschritt:** Konnte gerade nicht geladen werden.'
    );
    expect(summary).not.toContain('liegt aktuell nichts vor');
  });

  it('does not load any progress for a question that is none of the day', async () => {
    const { fetchDataContext, loadNextStepEntries } = await load({
      entries: { [FIAE]: [entry({ enablerId: 'a' })] },
    });
    const ctx = await fetchDataContext(
      'u1',
      'TRAINEE',
      'Was ist ein Primärschlüssel?'
    );
    expect(ctx?.dataIntent).toBe('none');
    expect(loadNextStepEntries).not.toHaveBeenCalled();
  });

  it('gives a trainer the reviews, not the progress of a trainee', async () => {
    const { fetchDataContext, loadNextStepEntries } = await load({
      tables: { profiles: [{ ...trainee, role: 'TRAINER' }] },
    });
    const ctx = await fetchDataContext(
      't1',
      'TRAINER',
      'Was steht für mich an?'
    );
    expect(ctx?.dataIntent).toBe('day_briefing');
    expect(ctx?.summary).not.toContain('Fortschritt und nächster Schritt');
    expect(loadNextStepEntries).not.toHaveBeenCalled();
  });
});
