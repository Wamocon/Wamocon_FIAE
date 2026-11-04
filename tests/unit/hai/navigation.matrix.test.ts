/**
 * @jest-environment node
 */

// The coverage matrix of the navigation: every page of the platform has a target
// or a reason, and every target gives for every role a page or a reasoned answer,
// never a free text of the model. Tables over all targets and roles with at least
// three phrasings per target, and the content (course, enabler, use case, scenario,
// document) for a trainee of FIAE, of KfBM, of both, a trainer and an admin.

import fs from 'node:fs';
import path from 'node:path';

type Candidate = {
  id: string;
  title: string;
  code: string | null;
  courseId: string;
  courseTitle: string;
  catalog: string;
};

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const COURSE_F = '40000000-0000-4000-8000-0000000000f1';
const COURSE_K = '40000000-0000-4000-8000-0000000000a1';
const E_F = '20000000-0000-4000-8000-0000000000f1';
const E_K = '20000000-0000-4000-8000-000000000051';
const U_F = '30000000-0000-4000-8000-0000000000f1';
const D_SC = '50000000-0000-4000-8000-0000000000f1';

const enablers: Candidate[] = [
  {
    id: E_F,
    title: 'Datensicherung und Wiederherstellung',
    code: 'K14-i',
    courseId: COURSE_F,
    courseTitle: 'Netzwerke',
    catalog: FIAE,
  },
  {
    id: E_K,
    title: 'Buchführung Einführung',
    code: null,
    courseId: COURSE_K,
    courseTitle: 'Kaufmännisch',
    catalog: KFBM,
  },
];
const useCases: Candidate[] = [
  {
    id: U_F,
    title: 'Bestellsystem',
    code: null,
    courseId: COURSE_F,
    courseTitle: 'Netzwerke',
    catalog: FIAE,
  },
];
const courseList: Candidate[] = [
  {
    id: COURSE_F,
    title: 'Netzwerke',
    code: 'HB-C1',
    courseId: COURSE_F,
    courseTitle: 'Netzwerke',
    catalog: FIAE,
  },
  {
    id: COURSE_K,
    title: 'Kaufmännisch',
    code: null,
    courseId: COURSE_K,
    courseTitle: 'Kaufmännisch',
    catalog: KFBM,
  },
];

const inCatalogs = (list: Candidate[], ids: readonly string[]) =>
  list.filter(c => ids.includes(c.catalog));

const mockDocsOf = jest.fn();
const mockDocsByName = jest.fn();
jest.mock('@/lib/hai/navigation/data', () => ({
  loadTraineeEnablers: async (_u: string, ids: string[]) =>
    inCatalogs(enablers, ids),
  loadTraineeUseCases: async (_u: string, ids: string[]) =>
    inCatalogs(useCases, ids),
  loadEnablerLock: async () => ({
    locked: false,
    lockedByTitle: null,
    hasActiveQuiz: true,
  }),
  loadNextStepEntries: async () => [],
}));
jest.mock('@/lib/hai/navigation/contentData', () => ({
  loadTrainerEnablers: async (ids: string[]) => inCatalogs(enablers, ids),
  loadTrainerUseCases: async (ids: string[]) => inCatalogs(useCases, ids),
  loadCourses: async (_u: string, _l: string, ids: string[]) =>
    inCatalogs(courseList, ids),
  findDocumentsOf: (...args: unknown[]) => mockDocsOf(...args),
  findDocumentsByName: (...args: unknown[]) => mockDocsByName(...args),
  enablerHasScenarioPdf: async () => false,
}));

import { detectNavigationIntent } from '@/lib/hai/navigation/intent';
import {
  resolveNavigation,
  type NavigationScope,
} from '@/lib/hai/navigation/resolve';
import {
  STATIC_TARGET_IDS,
  STATIC_TARGETS,
  isAllowedNavigationPath,
  type NavigationLevel,
  type StaticTargetId,
} from '@/lib/hai/navigation/targets';
import {
  PAGE_INVENTORY,
  inventoryExceptions,
} from '@/lib/hai/navigation/pageInventory';

const LEVELS: NavigationLevel[] = ['TRAINEE', 'TRAINER', 'ADMIN'];

function scope(
  level: NavigationLevel,
  catalogIds: string[],
  overrides: Partial<NavigationScope> = {}
): NavigationScope {
  return { userId: 'u1', level, catalogIds, direct: true, ...overrides };
}

async function run(message: string, s: NavigationScope) {
  const intent = detectNavigationIntent(message);
  if (!intent) throw new Error(`no request recognized in: ${message}`);
  return resolveNavigation(intent, s);
}

// ---------------------------------------------------------------------------
// the pages of src/app against the inventory
// ---------------------------------------------------------------------------

function routesOfApp(): string[] {
  const root = path.join(process.cwd(), 'src', 'app');
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'api') continue;
        walk(full);
      } else if (entry.name === 'page.tsx') {
        const route =
          '/' +
          path.relative(root, dir).split(path.sep).filter(Boolean).join('/');
        found.push(route === '/' ? '/' : route);
      }
    }
  };
  walk(root);
  return found.sort();
}

describe('every page of the platform has a target or a reason', () => {
  const routes = routesOfApp();

  it('lists every page of src/app in the inventory, and nothing else', () => {
    expect(Object.keys(PAGE_INVENTORY).sort()).toEqual(routes);
  });

  it('gives every exception a reason', () => {
    for (const { route, reason } of inventoryExceptions()) {
      expect(reason.length).toBeGreaterThan(20);
      expect(route.startsWith('/')).toBe(true);
    }
  });

  it('points every target of the inventory at a real target with this route', () => {
    for (const [route, entry] of Object.entries(PAGE_INVENTORY)) {
      if ('target' in entry) {
        const definition = STATIC_TARGETS[entry.target];
        expect(definition).toBeDefined();
        const paths = Object.values(definition).map(t => t.path.split('?')[0]);
        expect(paths).toContain(route);
      }
    }
  });

  it('keeps every static target on a route of the inventory', () => {
    for (const id of STATIC_TARGET_IDS) {
      for (const target of Object.values(STATIC_TARGETS[id])) {
        expect(Object.keys(PAGE_INVENTORY)).toContain(
          target.path.split('?')[0]
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// every static target for every role, three phrasings each
// ---------------------------------------------------------------------------

const PHRASES: Record<StaticTargetId, [string, string, string]> = {
  dashboard: [
    'Öffne das Dashboard',
    'Bring mich zur Startseite',
    'Geh zum Dashboard',
  ],
  activity_reports: [
    'Öffne den Ausbildungsnachweis',
    'Geh zum Berichtsheft',
    'Bring mich zu den Berichten',
  ],
  school: [
    'Öffne die Berufsschule',
    'Geh zur Schule',
    'Bring mich zur Berufsschule',
  ],
  calendar: [
    'Öffne den Blockkalender',
    'Geh zum Kalender',
    'Bring mich zum Kalender',
  ],
  profile: ['Öffne mein Profil', 'Geh zum Profil', 'Bring mich zum Profil'],
  quizzes: [
    'Öffne die Quizze',
    'Geh zu den Quizzen',
    'Bring mich zu den Quizzen',
  ],
  courses: ['Öffne meine Kurse', 'Geh zum Lernen', 'Bring mich zu den Kursen'],
  trainer_feedback: [
    'Öffne das Ausbilder-Feedback',
    'Geh zum Feedback',
    'Bring mich zur Rückmeldung',
  ],
  trainees: [
    'Öffne die Auszubildenden',
    'Geh zu den Azubis',
    'Bring mich zur Azubiliste',
  ],
  reviews: [
    'Öffne die offenen Bewertungen',
    'Geh zu den Reviews',
    'Bring mich zur Prüfliste',
  ],
  content_management: [
    'Öffne die Inhaltsverwaltung',
    'Geh zur Kursverwaltung',
    'Bring mich zur Modulverwaltung',
  ],
  statistics: [
    'Öffne die Statistik',
    'Geh zur Inhaltsstatistik',
    'Bring mich zur Auswertung',
  ],
  organizations: [
    'Öffne die Organisationen',
    'Geh zu den Mandanten',
    'Bring mich zur Organisation',
  ],
  users: [
    'Öffne die Benutzerverwaltung',
    'Geh zu den Benutzern',
    'Bring mich zur Nutzerverwaltung',
  ],
  evaluations: [
    'Öffne die Wochenbewertung',
    'Geh zu den Wochenbewertungen',
    'Bring mich zur Leistungsbewertung',
  ],
  certificate: [
    'Öffne das Arbeitszeugnis',
    'Geh zum Azubi-Arbeitszeugnis',
    'Bring mich zum Zeugnis',
  ],
  content_upload: [
    'Öffne den Inhalts-Import',
    'Geh zum Inhaltsimport',
    'Bring mich zum Content-Upload',
  ],
  hai_admin: [
    'Öffne die HAI-Verwaltung',
    'Geh zur HAI Verwaltung',
    'Bring mich zur HAI-Admin Seite',
  ],
  hai_memory: [
    'Öffne das HAI-Gedächtnis',
    'Geh zum HAI Gedächtnis',
    'Bring mich zur Gedächtnisverwaltung',
  ],
};

describe('every static target, every role, three phrasings', () => {
  const rows = STATIC_TARGET_IDS.flatMap(id =>
    LEVELS.flatMap(level =>
      PHRASES[id].map(phrase => [id, level, phrase] as const)
    )
  );

  it('has at least three phrasings for every target', () => {
    for (const id of STATIC_TARGET_IDS) {
      expect(new Set(PHRASES[id]).size).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(rows)(
    '%s as %s: "%s" gives the page of the role or a reasoned answer',
    async (id, level, phrase) => {
      const outcome = await run(phrase, scope(level, [FIAE]));
      const own =
        STATIC_TARGETS[id][level] ??
        (level === 'ADMIN' ? STATIC_TARGETS[id].TRAINER : undefined);
      if (own) {
        // the role has the page: it is opened (a command). A trainer who asks for
        // the courses gets the content management as an offer (a substitute)
        const substitute = id === 'courses' && level !== 'TRAINEE';
        expect(outcome.kind).toBe('offer');
        expect(outcome.offer?.path).toBe(own.path);
        expect(isAllowedNavigationPath(outcome.offer?.path)).toBe(true);
        expect(outcome.offer?.auto).toBe(substitute ? undefined : true);
      } else {
        // the role has no such page: a clear answer with the reason, no card
        // pretending to open it, and never the word "no right" for a page of its own
        expect(outcome.kind).toBe('denied');
        expect(outcome.offer).toBeUndefined();
        expect(outcome.text.length).toBeGreaterThan(40);
      }
    }
  );
});

// ---------------------------------------------------------------------------
// content for every role and occupation
// ---------------------------------------------------------------------------

describe('courses, enablers and use cases for every role and occupation', () => {
  const trainee = (catalogs: string[]) => scope('TRAINEE', catalogs);

  it('opens the course by title for a trainee of FIAE, not for one of KfBM', async () => {
    const fiae = await run('Öffne den Kurs Netzwerke', trainee([FIAE]));
    expect(fiae.offer?.path).toBe(`/trainee/modules/${COURSE_F}`);
    const kfbm = await run('Öffne den Kurs Netzwerke', trainee([KFBM]));
    expect(kfbm.kind).toBe('not_found');
    expect(kfbm.offer).toBeUndefined();
    expect(JSON.stringify(kfbm)).not.toContain('Netzwerke');
  });

  it('opens a course by its code, with a trainee of both occupations', async () => {
    const both = await run('Öffne den Kurs HB-C1', trainee([FIAE, KFBM]));
    expect(both.offer?.path).toBe(`/trainee/modules/${COURSE_F}`);
    const kfbm = await run(
      'Öffne den Kurs Kaufmännisch',
      trainee([FIAE, KFBM])
    );
    expect(kfbm.offer?.path).toBe(`/trainee/modules/${COURSE_K}`);
  });

  it('opens the course of a trainer in the editor of the course', async () => {
    for (const level of ['TRAINER', 'ADMIN'] as const) {
      const outcome = await run(
        'Öffne den Kurs Netzwerke',
        scope(level, [FIAE])
      );
      expect(outcome.offer?.path).toBe(
        `/trainer/content-management/${COURSE_F}/edit`
      );
    }
  });

  it('opens an enabler by code and title for the trainee and for the trainer', async () => {
    const byCode = await run('Öffne den Enabler K14-i', trainee([FIAE]));
    expect(byCode.offer?.path).toBe(`/trainee/enablers/${E_F}`);
    const trainer = await run(
      'Öffne den Enabler Datensicherung',
      scope('TRAINER', [FIAE])
    );
    expect(trainer.offer?.path).toBe(
      `/trainer/content-management/${COURSE_F}/edit?enabler=${E_F}`
    );
    const useCase = await run(
      'Öffne den Use Case Bestellsystem',
      scope('TRAINER', [FIAE])
    );
    expect(useCase.offer?.path).toBe(`/trainer/use-cases/${U_F}`);
  });

  it('never opens an enabler of the other occupation, with the neutral answer', async () => {
    const outcome = await run('Öffne den Enabler Buchführung', trainee([FIAE]));
    expect(outcome.kind).toBe('not_found');
    expect(outcome.offer).toBeUndefined();
    expect(outcome.choices).toBeUndefined();
  });

  it('suggests the nearest records as cards, at most three, and never auto', async () => {
    const outcome = await run(
      'Öffne den Enabler Datensicherungen',
      trainee([FIAE])
    );
    expect(outcome.kind).toBe('not_found');
    expect(outcome.choices?.length).toBeLessThanOrEqual(3);
    expect(outcome.choices?.[0].path).toBe(`/trainee/enablers/${E_F}`);
    expect(outcome.choices?.every(c => c.auto === undefined)).toBe(true);
  });

  it('never leaves a command to open something without an answer of the platform', async () => {
    for (const level of LEVELS) {
      const outcome = await run('Öffne die Kantine', scope(level, [FIAE]));
      expect(outcome.kind).toBe('not_found');
      expect(outcome.text).not.toMatch(/keine Berechtigung|nicht öffnen/);
      expect(outcome.choices?.length).toBeGreaterThan(0);
      expect(outcome.choices?.length).toBeLessThanOrEqual(3);
      for (const card of outcome.choices ?? []) {
        expect(isAllowedNavigationPath(card.path)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// documents
// ---------------------------------------------------------------------------

const doc = (
  id: string,
  title: string,
  documentType: string | null,
  parent: 'enabler' | 'use_case' = 'enabler'
) => ({
  id,
  title,
  fileName: `${title}.pdf`,
  documentType,
  parentType: parent,
  parentId: parent === 'enabler' ? E_F : U_F,
  parentTitle: parent === 'enabler' ? 'Datensicherung' : 'Bestellsystem',
  courseId: COURSE_F,
});
const D = (n: number) => `50000000-0000-4000-8000-00000000000${n}`;

describe('documents for every role', () => {
  beforeEach(() => {
    mockDocsOf.mockReset();
    mockDocsByName.mockReset();
  });

  it('opens the single scenario of an enabler in the reader of the trainee', async () => {
    mockDocsOf.mockResolvedValue([
      doc(D_SC, 'Szenario K14-i (PDF)', 'EXERCISE'),
      doc(D(2), 'Lehrtext', 'THEORY'),
    ]);
    const outcome = await run(
      'Öffne das Szenario zu Enabler Datensicherung',
      scope('TRAINEE', [FIAE])
    );
    expect(outcome.kind).toBe('offer');
    expect(outcome.offer?.path).toBe(
      `/trainee/enablers/${E_F}?document=${D_SC}`
    );
    expect(outcome.offer?.auto).toBe(true);
    expect(outcome.text).toBe('Ich öffne das Szenario Szenario K14-i PDF.');
  });

  it('opens it in the editor of the course for a trainer', async () => {
    mockDocsOf.mockResolvedValue([
      doc(D_SC, 'Szenario K14-i (PDF)', 'EXERCISE'),
    ]);
    const outcome = await run(
      'Öffne das Szenario zu Enabler Datensicherung',
      scope('TRAINER', [FIAE])
    );
    expect(outcome.offer?.path).toBe(
      `/trainer/content-management/${COURSE_F}/edit?enabler=${E_F}&document=${D_SC}`
    );
  });

  it('asks with cards when two or three documents fit, never more than three', async () => {
    mockDocsOf.mockResolvedValue([
      doc(D(1), 'Szenario Teil 1', 'EXERCISE'),
      doc(D(2), 'Szenario Teil 2', 'EXERCISE'),
      doc(D(3), 'Szenario Teil 3', 'EXERCISE'),
    ]);
    const outcome = await run(
      'Öffne das Szenario zu Enabler Datensicherung',
      scope('TRAINEE', [FIAE])
    );
    expect(outcome.kind).toBe('ambiguous');
    expect(outcome.offer).toBeUndefined();
    expect(outcome.choices).toHaveLength(3);
    expect(outcome.choices?.every(c => c.auto === undefined)).toBe(true);
  });

  it('points at the page of the enabler when more than three documents fit', async () => {
    mockDocsOf.mockResolvedValue(
      [1, 2, 3, 4, 5].map(n => doc(D(n), `Szenario Teil ${n}`, 'EXERCISE'))
    );
    const outcome = await run(
      'Öffne das Szenario zu Enabler Datensicherung',
      scope('TRAINEE', [FIAE])
    );
    expect(outcome.kind).toBe('offer');
    expect(outcome.offer?.path).toBe(`/trainee/enablers/${E_F}`);
    expect(outcome.text).toContain('5 Dateien');
  });

  it('filters the kind: a scenario is an exercise, a teaching text is theory', async () => {
    mockDocsOf.mockResolvedValue([
      doc(D(1), 'Szenario Teil 1', 'EXERCISE'),
      doc(D(2), 'Lehrtext Sicherung', 'THEORY'),
    ]);
    const theory = await run(
      'Öffne den Lehrtext zu Enabler Datensicherung',
      scope('TRAINEE', [FIAE])
    );
    expect(theory.offer?.path).toBe(
      `/trainee/enablers/${E_F}?document=${D(2)}`
    );
  });

  it('opens a use case task in the reader of the trainee and on the page of the trainer', async () => {
    mockDocsOf.mockResolvedValue([
      doc(D(4), 'Aufgabe Bestellsystem', 'TRAINEE_QUESTION', 'use_case'),
    ]);
    const trainee = await run(
      'Öffne die Aufgabe zum Use Case Bestellsystem',
      scope('TRAINEE', [FIAE])
    );
    expect(trainee.offer?.path).toBe(
      `/trainee/use-cases/${U_F}?document=${D(4)}`
    );
    const trainer = await run(
      'Öffne die Aufgabe zum Use Case Bestellsystem',
      scope('TRAINER', [FIAE])
    );
    expect(trainer.offer?.path).toBe(
      `/trainer/use-cases/${U_F}?document=${D(4)}`
    );
  });

  it('opens a document by its file name', async () => {
    mockDocsByName.mockResolvedValue([doc(D(1), 'Szenario_14i', 'EXERCISE')]);
    const outcome = await run(
      'Öffne das Dokument Szenario_14i',
      scope('TRAINEE', [FIAE])
    );
    expect(outcome.offer?.path).toBe(
      `/trainee/enablers/${E_F}?document=${D(1)}`
    );
    expect(mockDocsByName).toHaveBeenCalledTimes(1);
  });

  it('gives the same neutral answer for a file that does not exist and one that is not allowed', async () => {
    mockDocsByName.mockResolvedValue([]);
    const missing = await run(
      'Öffne das Dokument Gibtsnicht_1',
      scope('TRAINEE', [FIAE])
    );
    const protectedFile = await run(
      'Öffne das Dokument UC_1b_Musterloesung',
      scope('TRAINEE', [FIAE])
    );
    for (const outcome of [missing, protectedFile]) {
      expect(outcome.kind).toBe('nothing');
      expect(outcome.offer).toBeUndefined();
      expect(outcome.text).toContain(
        'keine passende Datei in deinen freigegebenen Inhalten'
      );
      expect(outcome.text).not.toMatch(/Schutz|Trainer|Lösung|Berechtigung/);
    }
    // only the name the person said, nothing from the database, differs
    expect(missing.text.replace(/"[^"]*"/, '')).toBe(
      protectedFile.text.replace(/"[^"]*"/, '')
    );
  });

  it('uses the enabler of the page for "diese Datei" and asks when there is none', async () => {
    mockDocsOf.mockResolvedValue([doc(D(1), 'Skript', 'THEORY')]);
    const onPage = await run(
      'Öffne diese Datei',
      scope('TRAINEE', [FIAE], { contextParent: { type: 'enabler', id: E_F } })
    );
    expect(onPage.offer?.path).toBe(
      `/trainee/enablers/${E_F}?document=${D(1)}`
    );
    const none = await run('Öffne diese Datei', scope('TRAINEE', [FIAE]));
    expect(none.kind).toBe('ambiguous');
    expect(none.text).toContain('Welche Datei meinst du?');
    // a page of the other occupation is not taken
    const foreign = await run(
      'Öffne diese Datei',
      scope('TRAINEE', [KFBM], { contextParent: { type: 'enabler', id: E_F } })
    );
    expect(foreign.kind).toBe('ambiguous');
  });

  it('uses the record of the last turns for "das PDF dazu"', async () => {
    mockDocsOf.mockResolvedValue([doc(D(1), 'Skript', 'THEORY')]);
    const outcome = await run(
      'Öffne das PDF dazu',
      scope('TRAINEE', [FIAE], {
        historyParent: {
          type: 'enabler',
          ref: { name: 'datensicherung' },
        },
      })
    );
    expect(outcome.offer?.path).toBe(
      `/trainee/enablers/${E_F}?document=${D(1)}`
    );
  });
});
