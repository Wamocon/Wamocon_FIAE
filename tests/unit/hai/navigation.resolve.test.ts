/**
 * @jest-environment node
 */

// The resolver of the navigation: rights per level, occupation separation, the
// locked enabler, "Weiter lernen". The database layer (data.ts) is replaced, the
// test shows what the resolver does with what that layer returns. The queries
// themselves are tested in navigation.data.test.ts.

const mockEnablers = jest.fn();
const mockUseCases = jest.fn();
const mockLock = jest.fn();
const mockNext = jest.fn();
jest.mock('@/lib/hai/navigation/data', () => ({
  loadTraineeEnablers: (...args: unknown[]) => mockEnablers(...args),
  loadTraineeUseCases: (...args: unknown[]) => mockUseCases(...args),
  loadEnablerLock: (...args: unknown[]) => mockLock(...args),
  loadNextStepEntries: (...args: unknown[]) => mockNext(...args),
}));

import { detectNavigationIntent } from '@/lib/hai/navigation/intent';
import {
  resolveNavigation,
  type NavigationScope,
} from '@/lib/hai/navigation/resolve';
import { isAllowedNavigationPath } from '@/lib/hai/navigation/targets';

const USER = '10000000-0000-4000-8000-000000000001';
const FIAE = '00000000-0000-4000-8000-000000000001';
const E1 = '20000000-0000-4000-8000-000000000001';
const E2 = '20000000-0000-4000-8000-000000000002';
const U1 = '30000000-0000-4000-8000-000000000001';

function scope(overrides: Partial<NavigationScope> = {}): NavigationScope {
  return { userId: USER, level: 'TRAINEE', catalogIds: [FIAE], ...overrides };
}

async function run(message: string, s: NavigationScope = scope()) {
  const intent = detectNavigationIntent(message);
  if (!intent) throw new Error(`no navigation intent in: ${message}`);
  return resolveNavigation(intent, s);
}

const candidate = (id: string, title: string, code: string | null = null) => ({
  id,
  title,
  code,
  courseId: 'course-1',
  courseTitle: 'Datenbanken',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockEnablers.mockResolvedValue([
    candidate(E1, 'Enabler 3: SQL Grundlagen', '3'),
    candidate(E2, 'Normalisierung', '4'),
  ]);
  mockUseCases.mockResolvedValue([candidate(U1, 'Bestellsystem', '2')]);
  mockLock.mockResolvedValue({
    locked: false,
    lockedByTitle: null,
    hasActiveQuiz: true,
  });
});

describe('static pages', () => {
  it('offers the page for the level with a label and a reason', async () => {
    const outcome = await run('öffne meine Berichte');
    expect(outcome.kind).toBe('offer');
    expect(outcome.offer).toEqual({
      path: '/trainee/activity-reports',
      label: 'Ausbildungsnachweis',
      reason:
        'Dort führst du dein Berichtsheft mit den wöchentlichen Tätigkeitsnachweisen.',
    });
    expect(outcome.text).toBe(
      'Ich habe die Seite Ausbildungsnachweis für dich. Dort führst du dein Berichtsheft mit den wöchentlichen Tätigkeitsnachweisen.'
    );
    expect(mockEnablers).not.toHaveBeenCalled();
  });

  it('sends the same words to a different page for the trainer level', async () => {
    const trainer = await run(
      'öffne die Berichte',
      scope({ level: 'TRAINER' })
    );
    expect(trainer.offer?.path).toBe('/trainer/activity-reports');
    const calendar = await run(
      'öffne den Kalender',
      scope({ level: 'TRAINER' })
    );
    expect(calendar.offer?.path).toBe('/trainer/calendar');
  });

  it('every offer path is on the allow list', async () => {
    for (const level of ['TRAINEE', 'TRAINER', 'ADMIN'] as const) {
      for (const message of [
        'öffne das Dashboard',
        'öffne den Kalender',
        'öffne die Berufsschule',
        'öffne mein Profil',
        'öffne die Quizze',
      ]) {
        const outcome = await run(message, scope({ level }));
        expect(isAllowedNavigationPath(outcome.offer?.path)).toBe(true);
      }
    }
  });
});

describe('rights per level', () => {
  it.each([
    ['bring mich zu den Auszubildenden', 'TRAINEE'],
    ['geh zu den offenen Bewertungen', 'TRAINEE'],
    ['öffne die Inhaltsverwaltung', 'TRAINEE'],
    ['öffne die Organisationen', 'TRAINEE'],
    ['öffne die Benutzerverwaltung', 'TRAINEE'],
    ['öffne die Organisationen', 'TRAINER'],
    ['öffne die Benutzerverwaltung', 'TRAINER'],
  ] as const)(
    'refuses "%s" for %s without an offer',
    async (message, level) => {
      const outcome = await run(message, scope({ level }));
      expect(outcome.kind).toBe('denied');
      expect(outcome.offer).toBeUndefined();
      expect(outcome.text).toContain('Diese Seite kann ich dir nicht öffnen.');
      // no path, no hint at the page that exists for others
      expect(outcome.text).not.toMatch(
        /\/trainer|\/admin|Organisationen|Benutzer/
      );
    }
  );

  it('refuses a trainee the page of the trainees with a friendly offer of own pages', async () => {
    const outcome = await run('bring mich zu den Auszubildenden');
    expect(outcome.text).toContain(
      'zum Beispiel Dashboard, Ausbildungsnachweis oder Berufsschule'
    );
  });

  it('gives the admin levels the admin pages and the trainer pages', async () => {
    expect(
      (await run('öffne die Organisationen', scope({ level: 'ADMIN' }))).offer
        ?.path
    ).toBe('/trainer/admin/organizations');
    expect(
      (await run('öffne die Benutzerverwaltung', scope({ level: 'ADMIN' })))
        .offer?.path
    ).toBe('/trainer/admin/users');
    expect(
      (await run('bring mich zu den Auszubildenden', scope({ level: 'ADMIN' })))
        .offer?.path
    ).toBe('/trainer/trainees');
  });

  it('gives the trainer the trainer pages and the statistics on the dashboard', async () => {
    const trainees = await run(
      'bring mich zu den Auszubildenden',
      scope({ level: 'TRAINER' })
    );
    expect(trainees.offer?.path).toBe('/trainer/trainees');
    const reviews = await run(
      'geh zu den offenen Bewertungen',
      scope({ level: 'TRAINER' })
    );
    expect(reviews.offer?.path).toBe('/trainer/reviews');
    const stats = await run('geh zur Statistik', scope({ level: 'TRAINER' }));
    expect(stats.offer?.path).toBe('/trainer/dashboard');
    const adminStats = await run(
      'geh zur Statistik',
      scope({ level: 'ADMIN' })
    );
    expect(adminStats.offer?.path).toBe('/trainer/admin/content-stats');
  });

  it('sends a trainer who asks for an enabler or a use case to the content management', async () => {
    for (const message of [
      'öffne Enabler 3',
      'öffne den Use Case Bestellsystem',
    ]) {
      const outcome = await run(message, scope({ level: 'TRAINER' }));
      expect(outcome.offer?.path).toBe('/trainer/content-management');
    }
    expect(mockEnablers).not.toHaveBeenCalled();
    expect(mockUseCases).not.toHaveBeenCalled();
  });

  it('keeps "weiter lernen" for trainees', async () => {
    const outcome = await run('wo geht es weiter', scope({ level: 'TRAINER' }));
    expect(outcome.kind).toBe('denied');
    expect(mockNext).not.toHaveBeenCalled();
  });
});

describe('enablers and use cases by number or name', () => {
  it('finds an enabler by number and builds the path from its id only', async () => {
    const outcome = await run('öffne Enabler 3');
    expect(outcome.kind).toBe('offer');
    expect(outcome.offer).toEqual({
      path: `/trainee/enablers/${E1}`,
      label: 'Enabler 3: SQL Grundlagen',
      reason: 'Das ist der Enabler im Kurs Datenbanken.',
    });
    expect(mockEnablers).toHaveBeenCalledWith(USER, [FIAE]);
  });

  it('finds an enabler by name and a use case by name', async () => {
    expect((await run('öffne den Enabler Normalisierung')).offer?.path).toBe(
      `/trainee/enablers/${E2}`
    );
    expect((await run('zeig mir den Use Case Bestellsystem')).offer?.path).toBe(
      `/trainee/use-cases/${U1}`
    );
  });

  it('leads to the page of the enabler for its quiz', async () => {
    const outcome = await run('bring mich zum Quiz von Enabler 3');
    expect(outcome.offer).toEqual({
      path: `/trainee/enablers/${E1}`,
      label: 'Quiz zu Enabler 3: SQL Grundlagen',
      reason: 'Die Quizze findest du auf der Seite des Enablers.',
    });
  });

  it('says so when the enabler has no quiz, without an offer', async () => {
    mockLock.mockResolvedValue({
      locked: false,
      lockedByTitle: null,
      hasActiveQuiz: false,
    });
    const outcome = await run('bring mich zum Quiz von Enabler 3');
    expect(outcome.kind).toBe('nothing');
    expect(outcome.offer).toBeUndefined();
    expect(outcome.text).toBe(
      'Zum Enabler Enabler 3: SQL Grundlagen gibt es noch kein Quiz.'
    );
  });

  it('asks for the exact name when several records fit', async () => {
    mockEnablers.mockResolvedValue([
      candidate(E1, 'SQL Grundlagen'),
      candidate(E2, 'SQL Joins'),
    ]);
    const outcome = await run('öffne den Enabler SQL');
    expect(outcome.kind).toBe('ambiguous');
    expect(outcome.offer).toBeUndefined();
    expect(outcome.text).toContain('SQL Grundlagen oder SQL Joins');
  });
});

describe('occupation separation and unknown records', () => {
  it('hands the catalogs of the person to the loader and compares nothing else', async () => {
    const KFBM = '00000000-0000-4000-8000-000000000002';
    await run('öffne Enabler 3', scope({ catalogIds: [KFBM] }));
    expect(mockEnablers).toHaveBeenCalledWith(USER, [KFBM]);
    await run(
      'öffne den Use Case Bestellsystem',
      scope({ catalogIds: [KFBM] })
    );
    expect(mockUseCases).toHaveBeenCalledWith(USER, [KFBM]);
  });

  it('answers a record of another occupation like one that does not exist', async () => {
    // the loader returns nothing of the other occupation: the same answer for both
    mockEnablers.mockResolvedValue([candidate(E2, 'Normalisierung')]);
    const foreign = await run('öffne den Enabler Reisekostenabrechnung');
    const missing = await run('öffne den Enabler Gibtesnicht');
    expect(foreign.kind).toBe('not_found');
    expect(foreign.text).toBe(missing.text);
    expect(foreign.offer).toBeUndefined();
    // the text names neither the record nor an occupation
    expect(foreign.text).not.toMatch(
      /Reisekosten|KfBM|Fachinformatik|Büromanagement/i
    );
  });

  it('answers a number that no record of the person has with not found', async () => {
    const outcome = await run('öffne Enabler 99');
    expect(outcome.kind).toBe('not_found');
    expect(outcome.text).toContain(
      'Nenne mir bitte die Nummer oder den genauen Namen'
    );
  });

  it('is not found when the order of work knows no active enabler', async () => {
    mockLock.mockResolvedValue(null);
    expect((await run('öffne Enabler 3')).kind).toBe('not_found');
  });

  it('uses no id of the message: a uuid in the text is no record', async () => {
    const outcome = await run(`öffne den Enabler ${E2}`);
    expect(outcome.kind).toBe('not_found');
  });
});

describe('a locked enabler (order of work)', () => {
  it('gets the title and the hint, never a link', async () => {
    mockLock.mockResolvedValue({
      locked: true,
      lockedByTitle: 'Enabler 2: Datenmodell',
      hasActiveQuiz: true,
    });
    const outcome = await run('öffne Enabler 3');
    expect(outcome.kind).toBe('locked');
    expect(outcome.offer).toBeUndefined();
    expect(outcome.text).toBe(
      'Der Enabler Enabler 3: SQL Grundlagen ist noch gesperrt. Schließe zuerst Enabler 2: Datenmodell ab.'
    );
    expect(outcome.text).not.toContain('/trainee');
  });

  it('gives no link to the quiz of a locked enabler either', async () => {
    mockLock.mockResolvedValue({
      locked: true,
      lockedByTitle: null,
      hasActiveQuiz: true,
    });
    const outcome = await run('bring mich zum Quiz von Enabler 3');
    expect(outcome.kind).toBe('locked');
    expect(outcome.offer).toBeUndefined();
    expect(outcome.text).toBe(
      'Der Enabler Enabler 3: SQL Grundlagen ist für dich gesperrt.'
    );
  });

  it('writes the titles as plain text', async () => {
    mockEnablers.mockResolvedValue([
      candidate(E1, 'Enabler **3** [x](http://evil.example)', '3'),
    ]);
    mockLock.mockResolvedValue({
      locked: true,
      lockedByTitle: '[a](b)',
      hasActiveQuiz: true,
    });
    const outcome = await run('öffne Enabler 3');
    expect(outcome.text).not.toMatch(/[*\[\]()]|:\/\//);
  });
});

describe('"Weiter lernen"', () => {
  const next = (overrides = {}) => ({
    enablerId: E2,
    title: 'Normalisierung',
    courseTitle: 'Datenbanken',
    stage: 1,
    chapter: 1,
    orderIndex: 2,
    completed: false,
    locked: false,
    ...overrides,
  });
  const plan = { currentPhase: 1, allowedStages: [1, 3] };

  it('offers the next open enabler with the reason in one sentence', async () => {
    mockNext.mockResolvedValue([
      next({ enablerId: E1, title: 'SQL', completed: true }),
      next(),
    ]);
    const outcome = await run('wo geht es weiter', scope({ plan }));
    expect(outcome.kind).toBe('offer');
    expect(outcome.offer).toEqual({
      path: `/trainee/enablers/${E2}`,
      label: 'Normalisierung',
      reason:
        'Das ist dein nächster freigeschalteter Enabler im Kurs Datenbanken (Phase 1), den du noch nicht abgeschlossen hast.',
    });
    expect(outcome.text).toBe(
      'Weiter geht es mit dem Enabler Normalisierung. Das ist dein nächster freigeschalteter Enabler im Kurs Datenbanken (Phase 1), den du noch nicht abgeschlossen hast.'
    );
    expect(mockNext).toHaveBeenCalledWith(USER, [FIAE]);
  });

  it('points to the dashboard when everything is done', async () => {
    mockNext.mockResolvedValue([next({ completed: true })]);
    const outcome = await run('wo geht es weiter', scope({ plan }));
    expect(outcome.kind).toBe('offer');
    expect(outcome.offer?.path).toBe('/trainee/dashboard');
    expect(outcome.text).toContain(
      'Du hast alle freigeschalteten Enabler abgeschlossen.'
    );
  });

  it('says that nothing is open without an offer', async () => {
    mockNext.mockResolvedValue([next({ locked: true })]);
    const locked = await run('wo geht es weiter', scope({ plan }));
    expect(locked.kind).toBe('nothing');
    expect(locked.offer).toBeUndefined();
    mockNext.mockResolvedValue([]);
    const none = await run('wo geht es weiter', scope({ plan }));
    expect(none.kind).toBe('nothing');
    expect(none.offer).toBeUndefined();
  });
});

describe('fail closed', () => {
  it('throws when a lookup fails: the caller offers nothing', async () => {
    mockEnablers.mockRejectedValue(new Error('db down'));
    await expect(run('öffne Enabler 3')).rejects.toThrow('db down');
  });

  it('never offers a path that is not on the allow list', async () => {
    mockEnablers.mockResolvedValue([candidate('not-a-uuid', 'SQL Grundlagen')]);
    const outcome = await run('öffne den Enabler SQL Grundlagen');
    expect(outcome.kind).toBe('unavailable');
    expect(outcome.offer).toBeUndefined();
  });
});
