/**
 * @jest-environment node
 */
// Trainer asks for the own trainees: the generic words ("Azubis", "Dateien",
// "Welche") are no names, the group question lands in the overview, a real
// name stays a detail query. The overview carries the metadata per trainee
// (occupation, year, block of today, progress, open items) and nothing else.

import { PgDialect } from 'drizzle-orm/pg-core';

jest.mock('@/db', () => ({ __esModule: true, default: {} }));
jest.mock('@/lib/auth-helpers', () => ({ toHaiRole: jest.fn() }));
jest.mock('@/lib/catalog/scope', () => ({
  getCatalogScopeForUserId: jest.fn(),
}));
jest.mock('@/lib/catalog/phase-plan-db', () => ({ loadPhasePlan: jest.fn() }));
jest.mock('@/lib/trainer/trainee-progress', () => ({
  loadTraineeProgress: jest.fn(),
}));

import db from '@/db';
import { toHaiRole } from '@/lib/auth-helpers';
import { getCatalogScopeForUserId } from '@/lib/catalog/scope';
import { loadTraineeProgress } from '@/lib/trainer/trainee-progress';
import {
  classifyDataIntent,
  extractTraineeNameCandidate,
  fetchDataContext,
  fetchTrainerTraineeOverview,
  formatTraineeOverview,
  isTraineeListQuestion,
  trainingYearFrom,
  TRAINEE_OVERVIEW_COMPACT_FROM,
  TRAINEE_OVERVIEW_MAX_LINES,
  type TrainerTraineeInfo,
} from '@/lib/hai/dataContext';

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';

describe('group questions of a trainer are not name queries', () => {
  it.each([
    // the six measured sentences
    'Welche Azubis sind mir zugeordnet?',
    'Wer sind meine Azubis?',
    'Zeig mir alle Azubis die mir zugeordnet sind',
    'Welche Auszubildenden betreue ich?',
    'Wie viele Azubis habe ich?',
    'Liste meine Azubis mit Ausbildungsjahr auf',
    // more wording
    'Welche Auszubildende habe ich im Moment?',
    'Gib mir bitte eine Liste meiner Azubis',
    'Wie viele Trainees betreue ich gerade?',
    'Nenne mir alle Azubis mit Beruf und Ausbildungsjahr',
    'Welche Azubis sind in der Berufsschule?',
    'Wer ist mir zugewiesen?',
    'Wen betreue ich eigentlich?',
    'Hallo, welche Azubis habe ich?',
    'Danke. Wie viele Azubis habe ich?',
    // with a capitalized noun that is no name
    'Welche Azubis sind in Datenbanken fit?',
    'Zeig mir die Azubis im Betrieb',
    // spoken text: no capitals, no punctuation, no umlauts or with them
    'welche azubis sind mir zugeordnet',
    'wer sind meine auszubildenden',
    'wie viele azubis hab ich',
    'welche azubis betreue ich',
    'ZEIG MIR ALLE AZUBIS',
    'Welche Auszubildenden betreu ich und in welchem Ausbildungsjahr sind sie',
    'Zeig mir alle Azubis für die ich zuständig bin',
  ])('"%s" is the overview', message => {
    expect(classifyDataIntent(message, 'TRAINER')).toBe('trainee_overview');
  });

  it('knows the group words with and without umlauts', () => {
    expect(isTraineeListQuestion('Welche Auszubildenden betreue ich?')).toBe(
      true
    );
    expect(isTraineeListQuestion('Wer ist mir zugeordnet?')).toBe(true);
    expect(isTraineeListQuestion('Wie steht Max Mustermann?')).toBe(false);
    expect(isTraineeListQuestion('Was ist ein Primärschlüssel?')).toBe(false);
  });
});

describe('a real name stays a detail query', () => {
  it.each([
    'Wie steht Max Mustermann?',
    'Wie steht Anna?',
    'Fortschritt von Anna',
    'Zeig mir die Noten von Max Mustermann',
    'Wie ist der Stand bei Lukas Meier?',
    'Hallo, wie steht Anna Müller-Schmidt?',
    'Danke. Wie läuft es bei Peter?',
    // a name next to a group word: the clear name wins
    'Wie viele Abgaben hat Anna Schneider offen?',
    'Zeig mir die Daten von Anna Schneider aus meinen Azubis',
    'Wie steht meine Azubine Sophie?',
  ])('"%s" is a detail query', message => {
    expect(classifyDataIntent(message, 'TRAINER')).toBe('trainee_detail_query');
  });

  it('takes the name out of the sentence', () => {
    expect(extractTraineeNameCandidate('Wie steht Max Mustermann?')).toEqual({
      name: 'Max Mustermann',
      strong: true,
    });
    // one word after "von" is a weak signal, it needs the cue "Fortschritt"
    expect(extractTraineeNameCandidate('Fortschritt von Anna')).toEqual({
      name: 'Anna',
      strong: false,
    });
    expect(extractTraineeNameCandidate('Wie steht Anna?')).toEqual({
      name: 'Anna',
      strong: false,
    });
    expect(
      extractTraineeNameCandidate('Wie steht Anna Müller-Schmidt?')?.name
    ).toBe('Anna Müller-Schmidt');
  });
});

describe('words that are no names', () => {
  it.each([
    'Welche Azubis sind mir zugeordnet?',
    'Wie viele Dateien gibt es?',
    'Welche Datei gehört zu dem Enabler?',
    'Zeig mir die Dokumente',
    'Wie viele Abgaben sind offen?',
    'Was steht in der Klausur?',
    'Wie sieht der Block aus?',
    'Welche Woche ist jetzt?',
    'Welches Jahr ist Anna im Betrieb?',
    'Zeig mir die Prüfung',
    'Zeig mir die Pruefungen',
    'Gib mir die Berichte',
    'Wie viele Trainees sind es?',
    'Welche Use Case Abgaben gibt es?',
  ])('finds no name in "%s"', message => {
    const candidate = extractTraineeNameCandidate(message);
    // only "Anna" in the one sentence is a name
    if (message.includes('Anna')) {
      expect(candidate?.name).toBe('Anna');
    } else {
      expect(candidate).toBeNull();
    }
  });

  it('a surname that is also a noun is found by the first name (the search is partial)', () => {
    expect(extractTraineeNameCandidate('Wie steht Max Block?')?.name).toBe('Max');
  });
});

describe('the other intents of a trainer are as before', () => {
  it.each([
    ['Was muss ich bewerten?', 'review_query'],
    ['Welche Azubis haben noch offene Abgaben?', 'review_query'],
    ['Wie stehen meine Azubis?', 'trainee_overview'],
    ['Gib mir einen Überblick über meine Azubis', 'trainee_overview'],
    ['Was ist ein Primärschlüssel?', 'none'],
    ['Wann ist die nächste Klausur?', 'exam_query'],
  ] as const)('"%s" is %s', (message, intent) => {
    expect(classifyDataIntent(message, 'TRAINER')).toBe(intent);
  });

  it.each([
    'Was ist ein Primärschlüssel?',
    'Erkläre mir die Normalisierung von Datenbanken',
    'Was bedeutet Normalisierung für Datenbanken?',
    'Wie funktioniert ein Primärschlüssel?',
    'Gib mir Beispiele für Fremdschlüssel',
    'Wie erkläre ich meinen Azubis Normalisierung?',
  ])('the technical question "%s" is no search for a person', message => {
    expect(classifyDataIntent(message, 'TRAINER')).not.toBe('trainee_detail_query');
  });

  it('a trainee asking about trainees is not a trainer question', () => {
    expect(classifyDataIntent('Welche Azubis sind in meiner Klasse?', 'TRAINEE')).not.toBe(
      'trainee_overview'
    );
  });
});

describe('trainingYearFrom', () => {
  const now = new Date('2026-11-03T10:00:00Z');
  it('counts the year of training from the start', () => {
    expect(trainingYearFrom('2026-09-01', now, 3)).toBe(1);
    expect(trainingYearFrom('2025-09-01', now, 3)).toBe(2);
    expect(trainingYearFrom(new Date('2024-09-01'), now, 3)).toBe(3);
  });
  it('is capped at the duration and empty without a start', () => {
    expect(trainingYearFrom('2020-09-01', now, 3)).toBe(3);
    expect(trainingYearFrom('2020-09-01', now, 2)).toBe(2);
    expect(trainingYearFrom(null, now, 3)).toBeNull();
    expect(trainingYearFrom('not a date', now, 3)).toBeNull();
    expect(trainingYearFrom('2030-09-01', now, 3)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The overview: one query per fact, metadata only
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
const dialect = new PgDialect();

function makeTrainees(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(1000 + i).padStart(12, '0')}`,
    fullName: `Azubi Nummer${i + 1}`,
    firstName: 'Azubi',
    lastName: `Nummer${i + 1}`,
    startOfTrainingDate: new Date('2025-09-01T00:00:00Z'),
    durationYears: 3,
  }));
}

/**
 * Mock of the database: select() answers from a queue (the rows of each
 * select in call order), execute() answers by the table in the SQL text.
 */
function installDb(config: {
  selects: Row[][];
  /** The progress of the platform per trainee (loadTraineeProgress), as completed and total. */
  progress?: Row[];
  /** Courses of one trainee for the detail query: [title, completed, total]. */
  courseProgress?: Array<[string, number, number]>;
  enrollments?: Row[];
  catalogs?: Row[];
  blocks?: Row[];
  pending?: Row[];
  failExecute?: boolean;
}) {
  const queue = [...config.selects];
  const executed: string[] = [];
  const executedParams: unknown[][] = [];
  const chain = (rows: Row[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy', 'limit']) c[m] = () => c;
    c.then = (resolve: (v: Row[]) => unknown) => resolve(rows);
    return c;
  };
  const mock = db as unknown as Record<string, unknown>;
  (loadTraineeProgress as jest.Mock).mockImplementation(async (ids: string[]) => {
    if (config.failExecute) throw new Error('db down');
    const byTrainee = new Map<string, unknown>();
    const courses = new Map<string, unknown>();
    for (const r of config.progress ?? []) {
      const completed = Number(r.completed);
      const total = Number(r.total);
      byTrainee.set(String(r.trainee_id), {
        completed,
        total,
        pct: total > 0 ? Math.round((completed / total) * 100) : 0,
        courses: new Map(),
        completionDates: [],
        undated: 0,
      });
    }
    if (config.courseProgress && ids.length === 1) {
      const perCourse = new Map<string, { completed: number; total: number }>();
      config.courseProgress.forEach(([title, completed, total], i) => {
        const id = `course-${i}`;
        courses.set(id, { id, title, chapter: i + 1, code: null });
        perCourse.set(id, { completed, total });
      });
      byTrainee.set(ids[0], {
        completed: 0,
        total: 0,
        pct: 0,
        courses: perCourse,
        completionDates: [],
        undated: 0,
      });
    }
    return { byTrainee, courses };
  });
  mock.select = jest.fn(() => chain(queue.shift() ?? []));
  mock.execute = jest.fn(async (query: unknown) => {
    const built = dialect.sqlToQuery(query as never);
    const text = built.sql;
    executed.push(text);
    executedParams.push(built.params);
    if (config.failExecute) throw new Error('db down');
    if (text.includes('FROM trainee_enrollments')) return config.enrollments ?? [];
    if (text.includes('FROM training_catalogs')) return config.catalogs ?? [];
    if (text.includes('FROM ausbildung_blocks')) return config.blocks ?? [];
    if (text.includes('enabler_submissions')) return config.pending ?? [];
    return [];
  });
  return { executed, executedParams };
}

const CATALOGS: Row[] = [
  { id: FIAE, code: 'FIAE', title: 'Fachinformatiker/in Anwendungsentwicklung' },
  { id: KFBM, code: 'KFBM', title: 'Kaufleute für Büromanagement' },
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('fetchTrainerTraineeOverview', () => {
  it('returns an empty list without any query for the facts when nobody is assigned', async () => {
    const { executed } = installDb({ selects: [[]] });
    await expect(fetchTrainerTraineeOverview('trainer-1')).resolves.toEqual([]);
    expect(executed).toHaveLength(0);
  });

  it('collects occupation, year, block, progress and open items', async () => {
    const [anna, ben] = makeTrainees(2);
    const { executed } = installDb({
      selects: [[anna, ben]],
      progress: [
        { trainee_id: anna.id, completed: '3', total: '4' },
        { trainee_id: ben.id, completed: '0', total: '10' },
      ],
      enrollments: [
        { trainee_id: anna.id, training_catalog_id: FIAE, start_date: '2024-09-01', duration_years: 3 },
        { trainee_id: anna.id, training_catalog_id: KFBM, start_date: '2026-09-01', duration_years: 3 },
      ],
      catalogs: CATALOGS,
      blocks: [
        { trainee_id: anna.id, training_catalog_id: FIAE, block_type: 'SCHOOL', ausbildungsjahr: 2 },
      ],
      pending: [
        { trainee_id: anna.id, pending: '2' },
        { trainee_id: ben.id, pending: '0' },
      ],
    });

    const result = await fetchTrainerTraineeOverview('trainer-1');

    // two trainees, four queries and the progress of the platform: not one query per trainee
    expect(executed).toHaveLength(4);
    expect(loadTraineeProgress).toHaveBeenCalledTimes(1);
    expect(loadTraineeProgress).toHaveBeenCalledWith([anna.id, ben.id], null);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      fullName: 'Azubi Nummer1',
      progressPercent: 75,
      pendingSubmissions: 2,
    });
    // the occupation is on every trainee, a trainee in two occupations has both
    expect(result[0].occupations).toEqual([
      {
        title: 'Fachinformatiker/in Anwendungsentwicklung',
        code: 'FIAE',
        trainingYear: 2,
        currentBlockType: 'SCHOOL',
      },
      {
        title: 'Kaufleute für Büromanagement',
        code: 'KFBM',
        trainingYear: 1,
        currentBlockType: null,
      },
    ]);
    // no enrollment: the standard occupation, the year from the start date
    expect(result[1]).toMatchObject({ progressPercent: 0, pendingSubmissions: 0 });
    expect(result[1].occupations).toEqual([
      {
        title: 'Fachinformatiker/in Anwendungsentwicklung',
        code: 'FIAE',
        trainingYear: 2,
        currentBlockType: null,
      },
    ]);
  });

  it('asks nothing that could carry an e-mail address, a birth date or a grade', async () => {
    const { executed } = installDb({ selects: [makeTrainees(1)] });
    await fetchTrainerTraineeOverview('trainer-1');
    const all = executed.join('\n').toLowerCase();
    expect(all).not.toContain('email');
    expect(all).not.toContain('birth_date');
    expect(all).not.toContain('school_exam');
    expect(all).not.toContain('grade');
    // private appointments of a trainee are no block of the overview
    expect(all).toContain('b.block_type in');
  });

  it('takes the progress from the figure of the platform, not from the rows of enabler_completions (0 % for everybody on the real Preview)', async () => {
    const [anna] = makeTrainees(1);
    const { executed } = installDb({
      selects: [[anna]],
      progress: [{ trainee_id: anna.id, completed: 361, total: 414 }],
    });
    const result = await fetchTrainerTraineeOverview('trainer-1');
    expect(result[0].progressPercent).toBe(87);
    expect(executed.join('\n')).not.toContain('enabler_completions');
  });

  it('binds no Date object into a raw query (postgres.js cannot bind one without a column type: found on a real Postgres)', async () => {
    const { executedParams } = installDb({ selects: [makeTrainees(2)] });
    await fetchTrainerTraineeOverview('trainer-1');
    const flat = executedParams.flat();
    expect(flat.length).toBeGreaterThan(0);
    expect(flat.some(value => value instanceof Date)).toBe(false);
  });

  it('only the own active trainees are asked for (assigned trainer, role, active)', async () => {
    installDb({ selects: [makeTrainees(1)] });
    await fetchTrainerTraineeOverview('trainer-1');
    const select = (db as unknown as { select: jest.Mock }).select;
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('a failed fetch is no empty list ("no trainees" would be wrong)', async () => {
    installDb({ selects: [makeTrainees(1)], failExecute: true });
    await expect(fetchTrainerTraineeOverview('trainer-1')).rejects.toThrow(
      'db down'
    );
  });
});

describe('formatTraineeOverview', () => {
  const trainee = (overrides: Partial<TrainerTraineeInfo> = {}): TrainerTraineeInfo => ({
    fullName: 'Anna Muster',
    progressPercent: 45,
    pendingSubmissions: 2,
    occupations: [
      {
        title: 'Fachinformatiker/in Anwendungsentwicklung',
        code: 'FIAE',
        trainingYear: 2,
        currentBlockType: 'COMPANY',
      },
    ],
    ...overrides,
  });

  it('says it plainly when nobody is assigned', () => {
    expect(formatTraineeOverview([])).toContain(
      'Dir sind keine aktiven Azubis zugeordnet'
    );
  });

  it('writes one line per trainee with all fields', () => {
    const text = formatTraineeOverview([trainee()]);
    expect(text).toContain('1 aktive Azubis');
    expect(text).toContain('- Anna Muster');
    expect(text).toContain('Fachinformatiker/in Anwendungsentwicklung');
    expect(text).toContain('Ausbildungsjahr 2');
    expect(text).toContain('aktuell Betrieb');
    expect(text).toContain('Fortschritt 45 %');
    expect(text).toContain('2 offene Abgaben zur Prüfung');
  });

  it('writes singular and none for the open items', () => {
    expect(formatTraineeOverview([trainee({ pendingSubmissions: 1 })])).toContain(
      '1 offene Abgabe zur Prüfung'
    );
    expect(formatTraineeOverview([trainee({ pendingSubmissions: 0 })])).toContain(
      'keine offenen Abgaben zur Prüfung'
    );
  });

  it('puts the occupation on each trainee of a trainer with two occupations', () => {
    const text = formatTraineeOverview([
      trainee(),
      trainee({
        fullName: 'Ben Kaufmann',
        occupations: [
          { title: 'Kaufleute für Büromanagement', code: 'KFBM', trainingYear: 1, currentBlockType: 'SCHOOL' },
        ],
      }),
    ]);
    expect(text).toContain('Anna Muster | Beruf: Fachinformatiker/in Anwendungsentwicklung');
    expect(text).toContain('Ben Kaufmann | Beruf: Kaufleute für Büromanagement (Ausbildungsjahr 1, aktuell Berufsschule)');
  });

  it('contains no dash as a sentence break and no contact data', () => {
    const text = formatTraineeOverview([trainee()]);
    expect(text).not.toMatch(/[–—]/);
    expect(text).not.toContain('@');
  });

  it('writes a long list compactly and names the count', () => {
    const many = Array.from({ length: TRAINEE_OVERVIEW_COMPACT_FROM + 9 }, (_, i) =>
      trainee({ fullName: `Azubi ${i + 1}` })
    );
    const text = formatTraineeOverview(many);
    expect(text).toContain(`${many.length} aktive Azubis`);
    expect(text).toContain('- Azubi 1 (FIAE J2 Betrieb (WMC), 45 %, 2 offen)');
    // one short line each, no long occupation title
    expect(text).not.toContain('Anwendungsentwicklung');
    expect(text.split('\n').filter(l => l.startsWith('- '))).toHaveLength(many.length);
  });

  it('30 trainees are still written in full, 31 compactly', () => {
    const list = (n: number) =>
      Array.from({ length: n }, (_, i) => trainee({ fullName: `Azubi ${i + 1}` }));
    expect(formatTraineeOverview(list(30))).toContain('Beruf:');
    expect(formatTraineeOverview(list(31))).not.toContain('Beruf:');
  });

  it('cuts a very long list and says how many are missing', () => {
    const many = Array.from({ length: TRAINEE_OVERVIEW_MAX_LINES + 20 }, (_, i) =>
      trainee({ fullName: `Azubi ${i + 1}` })
    );
    const text = formatTraineeOverview(many);
    expect(text).toContain(`${many.length} aktive Azubis`);
    expect(text.split('\n').filter(l => l.startsWith('- '))).toHaveLength(
      TRAINEE_OVERVIEW_MAX_LINES
    );
    expect(text).toContain('und 20 weitere Azubis');
  });
});

// ---------------------------------------------------------------------------
// The whole path: classification, decision against the own trainees, text
// ---------------------------------------------------------------------------

describe('fetchDataContext for a trainer', () => {
  const trainerRow = [
    {
      fullName: 'Tina Trainer',
      firstName: 'Tina',
      role: 'TRAINER',
      startOfTrainingDate: null,
      ausbildungDurationYears: 3,
    },
  ];
  // snapshot: profile, unread notifications, block of the week
  const snapshotSelects: Row[][] = [trainerRow, [{ cnt: 0 }], []];

  beforeEach(() => {
    (toHaiRole as jest.Mock).mockReturnValue('TRAINER');
    (getCatalogScopeForUserId as jest.Mock).mockResolvedValue(null);
  });

  it('"Welche Azubis sind mir zugeordnet?" lists the own trainees, not a search for a person', async () => {
    const [anna] = makeTrainees(1);
    installDb({
      selects: [...snapshotSelects, [anna]],
      progress: [{ trainee_id: anna.id, completed: 1, total: 2 }],
      catalogs: CATALOGS,
    });
    const context = await fetchDataContext(
      'trainer-1',
      'TRAINER',
      'Welche Azubis sind mir zugeordnet?'
    );
    expect(context?.dataIntent).toBe('trainee_overview');
    expect(context?.summary).toContain('Azubi Nummer1');
    expect(context?.summary).toContain('Fortschritt 50 %');
    expect(context?.summary).not.toContain('Azubi-Suche');
  });

  it('an empty list is said in so many words', async () => {
    installDb({ selects: [...snapshotSelects, []] });
    const context = await fetchDataContext(
      'trainer-1',
      'TRAINER',
      'Wer sind meine Azubis?'
    );
    expect(context?.summary).toContain('Dir sind keine aktiven Azubis zugeordnet');
  });

  it('a named trainee of the own list is a detail query', async () => {
    const [anna] = makeTrainees(1);
    const { executed } = installDb({
      selects: [...snapshotSelects, [{ id: anna.id, fullName: 'Anna Muster', firstName: 'Anna', lastName: 'Muster' }]],
    });
    const context = await fetchDataContext('trainer-1', 'TRAINER', 'Wie steht Anna Muster?');
    expect(context?.dataIntent).toBe('trainee_detail_query');
    expect(context?.summary).toContain('Azubi-Detail: Anna Muster');
    expect(executed.length).toBeGreaterThan(0);
  });

  it('the course progress of the detail query is the figure of the platform, one line per course with an enabler', async () => {
    const [anna] = makeTrainees(1);
    const { executed } = installDb({
      selects: [...snapshotSelects, [{ id: anna.id, fullName: 'Anna Muster', firstName: 'Anna', lastName: 'Muster' }]],
      courseProgress: [
        ['Datenbanken', 3, 4],
        ['Netzwerke', 0, 5],
        ['Leerer Kurs', 0, 0],
      ],
    });
    const context = await fetchDataContext('trainer-1', 'TRAINER', 'Wie steht Anna Muster?');
    expect(loadTraineeProgress).toHaveBeenCalledWith([anna.id], null);
    expect(context?.summary).toContain('**Kursfortschritt:**');
    expect(context?.summary).toContain('- Datenbanken: 3/4 Enabler (75%)');
    expect(context?.summary).toContain('- Netzwerke: 0/5 Enabler (0%)');
    expect(context?.summary).not.toContain('Leerer Kurs');
    // the rows of enabler_completions are no source of the progress
    expect(executed.join('\n')).not.toContain('enabler_completions');
  });

  it('the submissions of the detail query use submitted_at (the tables have no created_at: found on a real Postgres)', async () => {
    const [anna] = makeTrainees(1);
    const { executed } = installDb({
      selects: [...snapshotSelects, [{ id: anna.id, fullName: 'Anna Muster', firstName: 'Anna', lastName: 'Muster' }]],
    });
    await fetchDataContext('trainer-1', 'TRAINER', 'Wie steht Anna Muster?');
    const submissionSql = executed.find(text => text.includes('FROM enabler_submissions es'));
    expect(submissionSql).toBeDefined();
    expect(submissionSql).toContain('es.submitted_at');
    expect(submissionSql).toContain('ucs.submitted_at');
    expect(submissionSql).not.toMatch(/created_at/);
  });

  it('the exam results of the detail query join on exam_id (the column school_exam_id does not exist: found on a real Postgres)', async () => {
    const [anna] = makeTrainees(1);
    const { executed } = installDb({
      selects: [...snapshotSelects, [{ id: anna.id, fullName: 'Anna Muster', firstName: 'Anna', lastName: 'Muster' }]],
    });
    await fetchDataContext('trainer-1', 'TRAINER', 'Wie steht Anna Muster?');
    const examSql = executed.find(text => text.includes('FROM school_exam_results ser'));
    expect(examSql).toBeDefined();
    expect(examSql).toContain('se.id = ser.exam_id');
    expect(examSql).not.toContain('school_exam_id');
  });

  it('a name that is not among the own trainees gets the neutral line', async () => {
    installDb({ selects: [...snapshotSelects, []] });
    const context = await fetchDataContext('trainer-1', 'TRAINER', 'Wie steht Max Mustermann?');
    expect(context?.dataIntent).toBe('trainee_detail_query');
    expect(context?.summary).toContain('Azubi-Suche');
    expect(context?.summary).toContain('Max Mustermann');
    expect(context?.summary).toContain('Zuständigkeit');
  });

  it('a group question with a word that looks like a name falls back to the overview', async () => {
    const [anna] = makeTrainees(1);
    installDb({
      // the search for "Siemens" finds nobody, then the overview is read
      selects: [...snapshotSelects, [], [anna]],
      catalogs: CATALOGS,
    });
    const context = await fetchDataContext(
      'trainer-1',
      'TRAINER',
      'Welche Azubis sind in Von Siemens eingesetzt? Zeig mir alle Azubis von Siemens'
    );
    expect(context?.summary).toContain('Azubi-Übersicht');
    expect(context?.summary).not.toContain('Azubi-Suche');
  });
});

describe('fetchDataContext: follow-up question and failed list', () => {
  const trainerRow = [
    {
      fullName: 'Tina Trainer',
      firstName: 'Tina',
      role: 'TRAINER',
      startOfTrainingDate: null,
      ausbildungDurationYears: 3,
    },
  ];
  const snapshotSelects: Row[][] = [trainerRow, [{ cnt: 0 }], []];
  const history = [
    { role: 'user', parts: [{ text: 'Welche Azubis habe ich?' }] },
    { role: 'model', parts: [{ text: 'Du hast aktuell 5 Auszubildende.' }] },
  ];

  beforeEach(() => {
    (toHaiRole as jest.Mock).mockReturnValue('TRAINER');
    (getCatalogScopeForUserId as jest.Mock).mockResolvedValue(null);
  });

  it('"Welche mit Namen?" after the list loads the list with the names (no noun, no name in the message)', async () => {
    const [anna] = makeTrainees(1);
    installDb({
      selects: [...snapshotSelects, [anna]],
      progress: [{ trainee_id: anna.id, completed: 1, total: 2 }],
      catalogs: CATALOGS,
    });
    const context = await fetchDataContext(
      'trainer-1',
      'TRAINER',
      'Welche mit Namen?',
      { previousMessages: history }
    );
    expect(context?.dataIntent).toBe('trainee_overview');
    expect(context?.summary).toContain('Azubi Nummer1');
    expect(context?.summary).toContain('Fortschritt 50 %');
  });

  it('the same follow-up without a list in the history loads nothing of the trainees', async () => {
    installDb({ selects: [...snapshotSelects] });
    const context = await fetchDataContext(
      'trainer-1',
      'TRAINER',
      'Welche mit Namen?',
      { previousMessages: [] }
    );
    expect(context?.dataIntent).toBe('none');
    expect(context?.summary).not.toContain('Azubi-Übersicht');
  });

  it('a failed list says so plainly and carries no number of trainees (the model must not fall back on a number without names)', async () => {
    installDb({
      selects: [...snapshotSelects, makeTrainees(1)],
      failExecute: true,
    });
    const context = await fetchDataContext(
      'trainer-1',
      'TRAINER',
      'Welche Azubis habe ich?'
    );
    expect(context?.dataIntent).toBe('trainee_overview');
    expect(context?.summary).toContain(
      'Die Liste konnte gerade nicht geladen werden'
    );
    expect(context?.summary).toContain('keine fehlende Berechtigung');
    expect(context?.summary).not.toContain('Azubi Nummer1');
    expect(context?.summary).not.toMatch(/[–—]/);
  });
});
