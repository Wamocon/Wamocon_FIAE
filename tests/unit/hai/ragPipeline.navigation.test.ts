/**
 * @jest-environment node
 */

// Agent layer: a request to go to a page is answered by the server with a
// navigation offer, in the blocking and in the streaming path. No model call,
// no write. The persona gate (another occupation, no scope) and the action step
// come first, the level of the person comes from the access of the database
// (never from the claimed role). A clear command ("Öffne ...") is carried out
// right away (the offer carries `auto`, the text says "Ich öffne ..."), a
// question for the way ("Wo finde ich ...") stays an offer: typed with the hint
// at the button, spoken with "Soll ich sie öffnen?".

const mockDetect = jest.fn();
const mockChat = jest.fn();
const mockEnablers = jest.fn();
const mockLock = jest.fn();
const mockNext = jest.fn();

jest.mock('@/lib/hai/actions', () => ({
  detectActionIntent: (...args: unknown[]) => mockDetect(...args),
  executeAction: jest.fn(),
}));
jest.mock('@/lib/hai/providers', () => ({
  chatWithFallback: (...args: unknown[]) => mockChat(...args),
  getChatProvider: () => ({ isInitialized: () => true }),
  getEmbeddingProvider: () => ({ isInitialized: () => false }),
}));
const mockAccess = jest.fn();
jest.mock('@/lib/hai/retrievalAccess', () => ({
  resolveRetrievalAccess: (userId: string) => mockAccess(userId),
}));
jest.mock('@/lib/hai/personaAccess', () => {
  const persona = jest.requireActual('@/lib/hai/persona');
  const fiae = {
    id: '00000000-0000-4000-8000-000000000001',
    code: 'FIAE',
    title: 'Fachinformatiker Anwendungsentwicklung',
    settings: {},
  };
  const kfbm = {
    id: '00000000-0000-4000-8000-000000000002',
    code: 'KFBM',
    title: 'Kaufleute für Büromanagement',
    settings: {},
  };
  return {
    loadHaiPersona: async (access: { catalogIds: string[] } | null) =>
      access
        ? persona.resolveHaiPersona({
            catalogs: access.catalogIds.includes(fiae.id) ? [fiae] : [kfbm],
            otherCatalogs: access.catalogIds.includes(fiae.id)
              ? [kfbm]
              : [fiae],
          })
        : persona.NEUTRAL_PERSONA,
  };
});
jest.mock('@/lib/hai/vectorSearch', () => ({
  searchWithContext: jest.fn().mockResolvedValue({ results: [] }),
}));
jest.mock('@/lib/hai/pageIndexService', () => ({
  fetchPageIndexContext: jest
    .fn()
    .mockResolvedValue({ pdfContext: '', citations: [] }),
}));
jest.mock('@/lib/hai/dataContext', () => ({
  fetchDataContext: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/hai/navigation/data', () => ({
  loadTraineeEnablers: (...args: unknown[]) => mockEnablers(...args),
  loadTraineeUseCases: jest.fn().mockResolvedValue([]),
  loadEnablerLock: (...args: unknown[]) => mockLock(...args),
  loadNextStepEntries: (...args: unknown[]) => mockNext(...args),
}));

import {
  processMessage,
  processMessageStream,
  type PipelineContext,
  type PipelineResult,
} from '@/lib/hai/ragPipeline';
import { DENIAL_BERUF_TEXT } from '@/lib/hai/denial';

const USER = '10000000-0000-4000-8000-000000000001';
const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const E1 = '20000000-0000-4000-8000-000000000001';

const traineeAccess = (catalogId = FIAE) => ({
  catalogIds: [catalogId],
  audience: 'trainee' as const,
  organizationId: 'org-1',
  userId: USER,
});
const trainerAccess = () => ({
  catalogIds: [FIAE],
  audience: 'trainer' as const,
  organizationId: 'org-1',
  userId: USER,
});

function ctx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return { userId: USER, userRole: 'TRAINEE', ...overrides };
}

const paths: Array<
  [string, (message: string, c: PipelineContext) => Promise<PipelineResult>]
> = [
  ['processMessage', (message, c) => processMessage(message, c)],
  [
    'processMessageStream',
    (message, c) => processMessageStream(message, c, () => undefined),
  ],
];

describe.each(paths)('HAI navigation through %s', (_name, run) => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockDetect.mockReturnValue(null);
    mockChat.mockResolvedValue({ text: 'Antwort des Modells', citations: [] });
    mockAccess.mockResolvedValue(traineeAccess());
    mockEnablers.mockResolvedValue([
      {
        id: E1,
        title: 'Enabler 3: SQL Grundlagen',
        code: '3',
        courseId: 'c1',
        courseTitle: 'Datenbanken',
      },
    ]);
    mockLock.mockResolvedValue({
      locked: false,
      lockedByTitle: null,
      hasActiveQuiz: true,
    });
  });

  it('answers a question for the way with an offer and no model call, no write', async () => {
    const result = await run('wo finde ich meine Berichte', ctx());

    expect(mockChat).not.toHaveBeenCalled();
    expect(result.intent).toBe('navigation');
    expect(result.navigationOffer).toEqual({
      path: '/trainee/activity-reports',
      label: 'Ausbildungsnachweis',
      reason:
        'Dort führst du dein Berichtsheft mit den wöchentlichen Tätigkeitsnachweisen.',
    });
    expect(result.pendingAction).toBeUndefined();
    expect(result.actionResult).toBeUndefined();
    expect(result.citations).toEqual([]);
    // typed: the hint at the button, no question, the person taps
    expect(result.response).toContain('Mit Öffnen gelangst du direkt dorthin.');
    expect(result.response).not.toContain('Soll ich sie öffnen?');
  });

  it('asks "Soll ich sie öffnen?" for a spoken question for the way', async () => {
    const result = await run(
      'wo finde ich meine berichte',
      ctx({ voice: true })
    );
    expect(result.navigationOffer?.path).toBe('/trainee/activity-reports');
    expect(result.navigationOffer?.auto).toBeUndefined();
    expect(result.response.endsWith('Soll ich sie öffnen?')).toBe(true);
    expect(result.response).not.toContain('Mit Öffnen');
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('carries out a clear command: the offer is marked auto and the text says "Ich öffne ...", typed and spoken', async () => {
    for (const voice of [false, true]) {
      const result = await run(
        'öffne meine Berichte',
        ctx(voice ? { voice: true } : {})
      );
      expect(mockChat).not.toHaveBeenCalled();
      expect(result.intent).toBe('navigation');
      expect(result.navigationOffer).toEqual({
        path: '/trainee/activity-reports',
        label: 'Ausbildungsnachweis',
        reason:
          'Dort führst du dein Berichtsheft mit den wöchentlichen Tätigkeitsnachweisen.',
        auto: true,
      });
      // no question and no hint at a button: the page is opened
      expect(result.response).toBe('Ich öffne die Seite Ausbildungsnachweis.');
      expect(result.pendingAction).toBeUndefined();
      expect(result.actionResult).toBeUndefined();
    }
  });

  it('keeps "zeig mir" an offer: it is no clear command', async () => {
    const result = await run('zeig mir meine Berufsschule', ctx());
    expect(result.navigationOffer?.path).toBe('/trainee/school');
    expect(result.navigationOffer?.auto).toBeUndefined();
    expect(result.response).toContain('Mit Öffnen gelangst du direkt dorthin.');
  });

  it('sends the text of the answer through the chunk callback in the streaming path', async () => {
    const chunks: string[] = [];
    const result = await processMessageStream(
      'öffne meine Berichte',
      ctx(),
      c => chunks.push(c)
    );
    expect(chunks.join('')).toBe(result.response);
  });

  it('finds an enabler of the own scope and takes the catalogs from the access', async () => {
    const result = await run('bring mich zum Quiz von Enabler 3', ctx());
    expect(result.navigationOffer?.path).toBe(`/trainee/enablers/${E1}`);
    expect(result.navigationOffer?.auto).toBe(true);
    expect(mockEnablers).toHaveBeenCalledWith(USER, [FIAE]);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('with a chosen occupation the targets still follow all occupations, the chosen one first', async () => {
    // the access was narrowed to FIAE, the full list of the person is next to it
    mockAccess.mockResolvedValue({
      ...traineeAccess(),
      allowedCatalogIds: [FIAE, KFBM],
    });
    await run('bring mich zum Quiz von Enabler 3', ctx());
    // the chosen occupation is asked first, then all of the person
    expect(mockEnablers).toHaveBeenNthCalledWith(1, USER, [FIAE]);
    expect(mockEnablers.mock.calls.length).toBe(1);
    // a miss in the chosen occupation goes on to all occupations
    mockEnablers.mockReset();
    mockEnablers.mockImplementation(async (_user: string, ids: string[]) =>
      ids.length > 1
        ? [
            {
              id: E1,
              title: 'Enabler 3: SQL Grundlagen',
              code: '3',
              courseId: 'course-1',
              courseTitle: 'Datenbanken',
            },
          ]
        : []
    );
    const result = await run('bring mich zum Quiz von Enabler 3', ctx());
    expect(mockEnablers).toHaveBeenNthCalledWith(1, USER, [FIAE]);
    expect(mockEnablers).toHaveBeenNthCalledWith(2, USER, [FIAE, KFBM]);
    expect(result.navigationOffer?.path).toBe(`/trainee/enablers/${E1}`);
  });

  it('opens a locked enabler like its page shows it: title and material, never the quiz', async () => {
    mockLock.mockResolvedValue({
      locked: true,
      lockedByTitle: 'Enabler 2: Datenmodell',
      hasActiveQuiz: true,
    });
    const result = await run('öffne Enabler 3', ctx());
    expect(result.navigationOffer?.path).toBe(`/trainee/enablers/${E1}`);
    expect(result.navigationOffer?.path).not.toContain('quiz');
    expect(result.response).toContain('Titel und Material kannst du lesen');
    expect(result.response).toContain('Quizze und Abgabe sind noch zu');
    expect(mockChat).not.toHaveBeenCalled();
    // the quiz of a locked enabler stays closed: title, reason, no link
    const quiz = await run('bring mich zum Quiz von Enabler 3', ctx());
    expect(quiz.navigationOffer).toBeUndefined();
    expect(quiz.response).toContain('gesperrt');
  });

  it('computes "Weiter lernen" with the plan of the person', async () => {
    mockNext.mockResolvedValue([
      {
        enablerId: E1,
        title: 'SQL Grundlagen',
        courseTitle: 'Datenbanken',
        stage: 1,
        chapter: 1,
        orderIndex: 1,
        completed: false,
        locked: false,
      },
    ]);
    const result = await run(
      'wo geht es weiter',
      ctx({
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
      })
    );
    expect(result.navigationOffer?.path).toBe(`/trainee/enablers/${E1}`);
    // a question for the way: an offer, not carried out
    expect(result.navigationOffer?.auto).toBeUndefined();
    expect(result.response).toContain(
      'Weiter geht es mit dem Enabler SQL Grundlagen.'
    );
    expect(result.response).toContain('(Phase 1)');
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('carries out "Ich will weiterlernen" with the reason of the step', async () => {
    mockNext.mockResolvedValue([
      {
        enablerId: E1,
        title: 'SQL Grundlagen',
        courseTitle: 'Datenbanken',
        stage: 1,
        chapter: 1,
        orderIndex: 1,
        completed: false,
        locked: false,
      },
    ]);
    const result = await run('ich will weiterlernen', ctx());
    expect(result.navigationOffer?.path).toBe(`/trainee/enablers/${E1}`);
    expect(result.navigationOffer?.auto).toBe(true);
    expect(result.response).toContain('Ich öffne den Enabler SQL Grundlagen.');
    expect(result.response).toContain('Das ist dein nächster freigeschalteter');
  });

  it('never carries out a page that was refused: a command to the quiz of a locked enabler or a trainer page gives no offer', async () => {
    mockLock.mockResolvedValue({
      locked: true,
      lockedByTitle: null,
      hasActiveQuiz: true,
    });
    const locked = await run('öffne das Quiz von Enabler 3', ctx());
    expect(locked.navigationOffer).toBeUndefined();
    const trainerPage = await run('öffne die Auszubildenden', ctx());
    expect(trainerPage.navigationOffer).toBeUndefined();
    expect(trainerPage.response).toContain('für deine Rolle nicht freigegeben');
  });

  it('refuses the page of the trainer area to a trainee, even if the client claims to be a trainer', async () => {
    const result = await run(
      'bring mich zu den Auszubildenden',
      ctx({ userRole: 'TRAINER' })
    );
    expect(result.navigationOffer).toBeUndefined();
    expect(result.response).toContain(
      'Diese Seite kann ich dir nicht öffnen, weil sie zum'
    );
    expect(result.response).toContain('für deine Rolle nicht freigegeben');
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('does not raise a trainee to an admin level through the flag of the context', async () => {
    const result = await run(
      'öffne die Organisationen',
      ctx({ isAdmin: true })
    );
    expect(result.navigationOffer).toBeUndefined();
    expect(result.response).toContain(
      'Diese Seite kann ich dir nicht öffnen, weil sie zum'
    );
    expect(result.response).toContain('für deine Rolle nicht freigegeben');
  });

  it('gives the trainer level its pages and an admin level the admin pages', async () => {
    mockAccess.mockResolvedValue(trainerAccess());
    const trainer = await run(
      'bring mich zu den Auszubildenden',
      ctx({ userRole: 'TRAINER' })
    );
    expect(trainer.navigationOffer?.path).toBe('/trainer/trainees');
    expect(trainer.navigationOffer?.auto).toBe(true);
    const noAdmin = await run(
      'öffne die Benutzerverwaltung',
      ctx({ userRole: 'TRAINER' })
    );
    expect(noAdmin.navigationOffer).toBeUndefined();
    const admin = await run(
      'öffne die Benutzerverwaltung',
      ctx({ userRole: 'TRAINER', isAdmin: true })
    );
    expect(admin.navigationOffer?.path).toBe('/trainer/admin/users');
  });

  it('stops a request that names another occupation at the persona gate', async () => {
    const result = await run(
      'Öffne mir die Seite der KfBM Auszubildenden',
      ctx()
    );
    expect(result.response).toBe(DENIAL_BERUF_TEXT);
    expect(result.navigationOffer).toBeUndefined();
    expect(mockEnablers).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('offers nothing to a person without a scope', async () => {
    mockAccess.mockResolvedValue(null);
    const result = await run('öffne meine Berichte', ctx());
    expect(result.intent).toBe('off_topic');
    expect(result.navigationOffer).toBeUndefined();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('lets a write win: a detected action is a proposal, not a navigation', async () => {
    mockDetect.mockReturnValue({
      type: 'create_activity_report',
      confidence: 0.9,
      parameters: {},
      requiresConfirmation: true,
    });
    const result = await run('öffne meine Berichte und erstelle einen', ctx());
    expect(result.intent).toBe('action');
    expect(result.pendingAction?.type).toBe('create_activity_report');
    expect(result.navigationOffer).toBeUndefined();
  });

  it('never turns a navigation into a write: the result carries no pending action', async () => {
    for (const message of [
      'öffne meine Berichte',
      'öffne Enabler 3',
      'wo geht es weiter',
      'bring mich zum Quiz von Enabler 3',
    ]) {
      mockNext.mockResolvedValue([]);
      const result = await run(message, ctx());
      expect(result.pendingAction).toBeUndefined();
      expect(result.actionResult).toBeUndefined();
    }
  });

  it('answers "cannot check now" and offers nothing when a lookup fails', async () => {
    mockEnablers.mockRejectedValue(new Error('db down'));
    const result = await run('öffne Enabler 3', ctx());
    expect(result.navigationOffer).toBeUndefined();
    // a technical failure is said as such, never as a missing right
    expect(result.response).toBe(
      'Das kann ich gerade nicht prüfen, weil eine technische Störung vorliegt und nicht, weil dir etwas fehlt. Bitte versuche es später noch einmal.'
    );
    expect(result.response).not.toMatch(/Rolle|freigegeben|Berechtigung/);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('leaves every other message to the model, with the guidance rules in the prompt', async () => {
    const result = await run('Was ist Normalisierung?', ctx());
    expect(result.navigationOffer).toBeUndefined();
    expect(mockChat).toHaveBeenCalledTimes(1);
    const prompt = mockChat.mock.calls[0][0] as string;
    expect(prompt).toContain('## Führung durch die Plattform');
    expect(prompt).toContain('Erfinde keine Links, Pfade oder Adressen');
  });
});
