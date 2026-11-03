/**
 * @jest-environment node
 */

// Report of the client (chat of a trainer in the preview): "Welche Azubis habe
// ich?", "Welche mit Namen?", "Du kannst mich doch durch das System führen" ended
// in "keine Namen", foreign source cards and "ich kann nicht navigieren".
//
// Through processMessage and processMessageStream, with a mock model:
//  - the list of the own trainees and its short follow-up (no noun, no name) load
//    the live data of the list, with no knowledge search and no source cards,
//    and the answer carries the card "Auszubildende" (built by the server),
//  - a knowledge question keeps its search and its sources, and has no card,
//  - a request without a new target ("bring mich dahin", "du navigierst", "ja")
//    is resolved against the history by the server: exactly one page is opened,
//    none or several are asked back, no model call, no write,
//  - a trainee never gets a page of the trainer area.

const mockDetect = jest.fn();
const mockChat = jest.fn();
const mockSearch = jest.fn();
const mockFetchData = jest.fn();
const mockAccess = jest.fn();

jest.mock('@/lib/hai/actions', () => ({
  detectActionIntent: (...args: unknown[]) => mockDetect(...args),
  executeAction: jest.fn(),
}));
jest.mock('@/lib/hai/providers', () => ({
  chatWithFallback: (...args: unknown[]) => mockChat(...args),
  getChatProvider: () => ({ isInitialized: () => true }),
  getEmbeddingProvider: () => ({ isInitialized: () => false }),
}));
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
  return {
    loadHaiPersona: async (access: unknown) =>
      access
        ? persona.resolveHaiPersona({ catalogs: [fiae], otherCatalogs: [] })
        : persona.NEUTRAL_PERSONA,
  };
});
jest.mock('@/lib/hai/vectorSearch', () => ({
  searchWithContext: (...args: unknown[]) => mockSearch(...args),
}));
jest.mock('@/lib/hai/pageIndexService', () => ({
  fetchPageIndexContext: jest
    .fn()
    .mockResolvedValue({ pdfContext: '', citations: [] }),
}));
jest.mock('@/lib/hai/dataContext', () => ({
  fetchDataContext: (...args: unknown[]) => mockFetchData(...args),
}));
jest.mock('@/lib/hai/navigation/data', () => ({
  loadTraineeEnablers: jest.fn().mockResolvedValue([]),
  loadTraineeUseCases: jest.fn().mockResolvedValue([]),
  loadEnablerLock: jest.fn(),
  loadNextStepEntries: jest.fn().mockResolvedValue([]),
}));

import {
  processMessage,
  processMessageStream,
  type PipelineContext,
  type PipelineResult,
} from '@/lib/hai/ragPipeline';
import { resolveDataIntent } from '@/lib/hai/dataIntent';

const USER = '10000000-0000-4000-8000-000000000001';
const FIAE = '00000000-0000-4000-8000-000000000001';

const trainerAccess = () => ({
  catalogIds: [FIAE],
  audience: 'trainer' as const,
  organizationId: 'org-1',
  userId: USER,
});
const traineeAccess = () => ({
  catalogIds: [FIAE],
  audience: 'trainee' as const,
  organizationId: 'org-1',
  userId: USER,
});

type Message = { role: 'user' | 'model'; parts: { text: string }[] };
const user = (text: string): Message => ({ role: 'user', parts: [{ text }] });
const model = (text: string): Message => ({ role: 'model', parts: [{ text }] });

function ctx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return { userId: USER, userRole: 'TRAINER', ...overrides };
}

/** The chat of the report, up to the question of the person in step four. */
const REPORT_HISTORY: Message[] = [
  user('Welche Azubis habe ich?'),
  model('Du hast aktuell 5 Auszubildende in deiner Übersicht.'),
  user('Welche mit Namen?'),
  model('Dazu liegen mir aktuell keine Daten vor.'),
  user('Wieso kannst du darauf nicht zugreifen?'),
  model('Ich habe nur Zugriff auf Aktuelle Plattform-Daten, die Anzahl.'),
];

const TRAINEES_OFFER = {
  path: '/trainer/trainees',
  label: 'Auszubildende',
  reason: 'Dort siehst du deine Auszubildenden mit ihrem Fortschritt.',
};

const KNOWLEDGE_HIT = {
  id: 'chunk-1',
  chunkIndex: 0,
  content: 'Normalisierung teilt Tabellen in kleinere Einheiten.',
  similarity: 0.82,
  sourceType: 'enabler',
  sourceId: 'e-1',
  metadata: { title: 'Normalisierung' },
};

const paths: Array<
  [string, (message: string, c: PipelineContext) => Promise<PipelineResult>]
> = [
  ['processMessage', (message, c) => processMessage(message, c)],
  [
    'processMessageStream',
    (message, c) => processMessageStream(message, c, () => undefined),
  ],
];

describe.each(paths)(
  'HAI trainer, trainees and guidance through %s',
  (_n, run) => {
    beforeEach(() => {
      jest.clearAllMocks();
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      jest.spyOn(console, 'log').mockImplementation(() => undefined);
      mockDetect.mockReturnValue(null);
      mockChat.mockResolvedValue({
        text: 'Antwort des Modells',
        citations: [],
      });
      mockAccess.mockResolvedValue(trainerAccess());
      mockSearch.mockResolvedValue({ results: [KNOWLEDGE_HIT] });
      // the live data follows the real classification, with the history
      mockFetchData.mockImplementation(
        async (
          _userId: string,
          role: 'TRAINER' | 'TRAINEE',
          message: string,
          options: { previousMessages?: Message[] }
        ) => {
          const dataIntent = resolveDataIntent(
            message,
            role,
            options.previousMessages
          );
          return {
            summary: `LIVE-DATEN ${dataIntent}`,
            tokenEstimate: 1,
            dataIntent,
          };
        }
      );
    });

    const systemPrompt = () => String(mockChat.mock.calls[0][0]);

    describe('the list of the own trainees', () => {
      it.each([
        'Welche Azubis habe ich?',
        'Zeig mir meine Azubis',
        'Wer sind meine Azubis?',
        'welche azubis habe ich',
      ])(
        '%s: live data, no knowledge search, no source cards, card "Auszubildende"',
        async message => {
          const result = await run(message, ctx());

          expect(mockSearch).not.toHaveBeenCalled();
          expect(mockChat).toHaveBeenCalledTimes(1);
          expect(systemPrompt()).toContain('LIVE-DATEN trainee_overview');
          expect(systemPrompt()).not.toContain('Normalisierung teilt Tabellen');
          expect(result.citations).toEqual([]);
          expect(result.intent).toBe('question');
          expect(result.navigationOffer).toEqual(TRAINEES_OFFER);
          // a card to tap, no command
          expect(result.navigationOffer?.auto).toBeUndefined();
          expect(result.response).toBe('Antwort des Modells');
        }
      );

      it('"Welche mit Namen?" after the list loads the list again (the history goes to the live data)', async () => {
        const result = await run(
          'Welche mit Namen?',
          ctx({ previousMessages: REPORT_HISTORY.slice(0, 2) })
        );

        expect(mockFetchData).toHaveBeenCalledTimes(1);
        expect(mockFetchData.mock.calls[0][3].previousMessages).toHaveLength(2);
        expect(systemPrompt()).toContain('LIVE-DATEN trainee_overview');
        expect(mockSearch).not.toHaveBeenCalled();
        expect(result.citations).toEqual([]);
        expect(result.navigationOffer).toEqual(TRAINEES_OFFER);
      });

      it.each([
        'Wer genau?',
        'Mit Namen bitte',
        'Alle anzeigen',
        'Und wie viele davon sind in der Schule?',
      ])('the follow-up "%s" is the list again', async message => {
        const result = await run(
          message,
          ctx({ previousMessages: REPORT_HISTORY.slice(0, 2) })
        );
        expect(systemPrompt()).toContain('LIVE-DATEN trainee_overview');
        expect(mockSearch).not.toHaveBeenCalled();
        expect(result.navigationOffer?.path).toBe('/trainer/trainees');
      });

      it('the same follow-up without a list in the history is a normal question: search and sources stay', async () => {
        const result = await run('Welche mit Namen?', ctx());
        expect(mockSearch).toHaveBeenCalledTimes(1);
        expect(result.navigationOffer).toBeUndefined();
      });

      it('an admin level gets the same card (the page of the trainer area)', async () => {
        const result = await run(
          'Welche Azubis habe ich?',
          ctx({ isAdmin: true })
        );
        expect(result.navigationOffer?.path).toBe('/trainer/trainees');
      });

      it('a trainee who asks for "Azubis" gets no card and keeps the search', async () => {
        mockAccess.mockResolvedValue(traineeAccess());
        const result = await run(
          'Welche Azubis habe ich?',
          ctx({ userRole: 'TRAINEE' })
        );
        expect(result.navigationOffer).toBeUndefined();
        expect(mockSearch).toHaveBeenCalledTimes(1);
      });
    });

    describe('sources: unchanged for knowledge questions', () => {
      it('a knowledge question keeps search and source cards, no card to a page', async () => {
        const result = await run('Was ist Normalisierung?', ctx());
        expect(mockSearch).toHaveBeenCalledTimes(1);
        expect(systemPrompt()).toContain('Normalisierung teilt Tabellen');
        expect(result.citations).toHaveLength(1);
        expect(result.citations[0]).toMatchObject({
          sourceType: 'enabler',
          title: 'Normalisierung',
        });
        expect(result.navigationOffer).toBeUndefined();
      });

      it.each([
        'Welche Aufgaben gebe ich meinen Azubis zu Joins?',
        'Welche Fragen kann ich meinem Azubi stellen?',
        'Erkläre mir, wie ich meinen Azubis Normalisierung beibringe',
        'Prüfe diesen SQL-Befehl',
      ])(
        'a question with the word "Azubi" that asks for knowledge keeps its search: %s',
        async message => {
          const result = await run(message, ctx());
          expect(mockSearch).toHaveBeenCalledTimes(1);
          expect(result.citations).toHaveLength(1);
          expect(result.navigationOffer).toBeUndefined();
        }
      );

      it('the detail of an own trainee is a live answer: the knowledge sources are dropped', async () => {
        mockFetchData.mockResolvedValue({
          summary: '**Azubi-Detail: Anna Muster**\nKursfortschritt: 1/2',
          tokenEstimate: 1,
          dataIntent: 'trainee_detail_query',
        });
        const result = await run('Wie steht Anna Muster?', ctx());
        expect(result.citations).toEqual([]);
        expect(systemPrompt()).toContain('Azubi-Detail: Anna Muster');
        expect(systemPrompt()).not.toContain('Normalisierung teilt Tabellen');
      });

      it('a name that is not found keeps the search (it was no person)', async () => {
        mockFetchData.mockResolvedValue({
          summary: 'Azubi-Suche: keine Person gefunden',
          tokenEstimate: 1,
          dataIntent: 'trainee_detail_query',
        });
        const result = await run('Zeig mir das Szenario Kundenanfrage', ctx());
        expect(result.citations).toHaveLength(1);
      });
    });

    describe('guidance by the platform: no model, no write', () => {
      it('"Du kannst mich doch durch das System führen" opens the page the talk was about (the chat of the report)', async () => {
        const result = await run(
          'Ja aber du kannst mich doch durch das System führen?!',
          ctx({ previousMessages: REPORT_HISTORY })
        );

        expect(mockChat).not.toHaveBeenCalled();
        expect(result.intent).toBe('navigation');
        expect(result.navigationOffer).toEqual({
          ...TRAINEES_OFFER,
          auto: true,
        });
        expect(result.response).toBe('Ich öffne die Seite Auszubildende.');
        expect(result.pendingAction).toBeUndefined();
        expect(result.actionResult).toBeUndefined();
      });

      it('"du navigierst" after that answer still opens the same page', async () => {
        const result = await run(
          'Nein du gehst durch das System, also du navigierst und nicht ich!',
          ctx({
            previousMessages: [
              ...REPORT_HISTORY,
              user('Ja aber du kannst mich doch durch das System führen?!'),
              model('Ich öffne die Seite Auszubildende.'),
            ],
          })
        );
        expect(mockChat).not.toHaveBeenCalled();
        expect(result.navigationOffer).toEqual({
          ...TRAINEES_OFFER,
          auto: true,
        });
      });

      it.each([
        'dann bring mich dahin',
        'führ mich hin',
        'öffne die Seite',
        'Kannst du mich dahin bringen?',
      ])('"%s" after a list of trainees opens the page', async message => {
        const result = await run(
          message,
          ctx({ previousMessages: REPORT_HISTORY.slice(0, 2) })
        );
        expect(mockChat).not.toHaveBeenCalled();
        expect(result.navigationOffer?.path).toBe('/trainer/trainees');
        expect(result.navigationOffer?.auto).toBe(true);
      });

      it('a spoken request is answered the same, without a question to the person', async () => {
        const result = await run(
          'dann bring mich da hin bitte',
          ctx({ previousMessages: REPORT_HISTORY.slice(0, 2), voice: true })
        );
        expect(result.navigationOffer?.path).toBe('/trainer/trainees');
        expect(result.response).toBe('Ich öffne die Seite Auszubildende.');
      });

      it('"wie komme ich dahin" stays an offer with the button, no command', async () => {
        const result = await run(
          'und wie komme ich dahin',
          ctx({ previousMessages: REPORT_HISTORY.slice(0, 2) })
        );
        expect(result.navigationOffer?.path).toBe('/trainer/trainees');
        expect(result.navigationOffer?.auto).toBeUndefined();
        expect(result.response).toContain(
          'Mit Öffnen gelangst du direkt dorthin.'
        );
      });

      it('a "ja" right after an answer that offered a page opens it', async () => {
        const result = await run(
          'ja',
          ctx({
            previousMessages: [
              user('Zeig mir meine Azubis'),
              model('Gehe zum Menüpunkt Auszubildende, dort siehst du alle.'),
            ],
          })
        );
        expect(mockChat).not.toHaveBeenCalled();
        expect(result.navigationOffer?.path).toBe('/trainer/trainees');
      });

      it('a "ja" after any other answer goes to the model as usual', async () => {
        const result = await run(
          'ja',
          ctx({
            previousMessages: [
              user('Was ist ein Join?'),
              model(
                'Ein Join verbindet Tabellen. Soll ich ein Beispiel zeigen?'
              ),
            ],
          })
        );
        expect(mockChat).toHaveBeenCalledTimes(1);
        expect(result.navigationOffer).toBeUndefined();
      });

      it('a "ja" in a quiz round is the answer of the quiz', async () => {
        await run(
          'ja',
          ctx({
            previousMessages: [
              user('Zeig mir meine Azubis'),
              model('Gehe zum Menüpunkt Auszubildende.'),
            ],
            quizState: { active: true, topic: 'SQL', currentQuestion: 1 },
          })
        );
        expect(mockChat).toHaveBeenCalledTimes(1);
      });

      it('no page in the history: asks where, with examples of the role, no card', async () => {
        const result = await run('führ mich hin', ctx());
        expect(mockChat).not.toHaveBeenCalled();
        expect(result.intent).toBe('navigation');
        expect(result.navigationOffer).toBeUndefined();
        expect(result.response).toContain('wohin soll ich dich führen');
        expect(result.response).toContain(
          'Auszubildende, Offene Bewertungen oder Dashboard'
        );
      });

      it('two pages in the history: asks which one, names both', async () => {
        const result = await run(
          'dann bring mich dahin',
          ctx({
            previousMessages: [
              user('Wo sehe ich meinen Stand?'),
              model('Im Dashboard oder im Ausbildungsnachweis.'),
            ],
          })
        );
        expect(mockChat).not.toHaveBeenCalled();
        expect(result.navigationOffer).toBeUndefined();
        expect(result.response).toContain('Dashboard');
        expect(result.response).toContain('Ausbildungsnachweis');
      });

      it('a new target in the request is never replaced by the history', async () => {
        const result = await run(
          'öffne die Berufsschule',
          ctx({ previousMessages: REPORT_HISTORY.slice(0, 2) })
        );
        expect(result.navigationOffer?.path).toBe('/trainer/school');
      });
    });

    describe('a trainee never gets a page of the trainer area', () => {
      beforeEach(() => {
        mockAccess.mockResolvedValue(traineeAccess());
      });
      const asTrainee = (overrides: Partial<PipelineContext> = {}) =>
        ctx({ userRole: 'TRAINEE', ...overrides });

      it('"bring mich dahin" after a page of the trainee opens that page', async () => {
        const result = await run(
          'dann bring mich dahin',
          asTrainee({
            previousMessages: [
              user('Zeig mir meine Berufsschule'),
              model('Ich habe die Seite Berufsschule für dich.'),
            ],
          })
        );
        expect(result.navigationOffer?.path).toBe('/trainee/school');
        expect(result.navigationOffer?.auto).toBe(true);
      });

      it('the list of trainees in the history is a page of the trainer area: refused for the role, no path', async () => {
        const result = await run(
          'dann bring mich dahin',
          asTrainee({ previousMessages: REPORT_HISTORY.slice(0, 2) })
        );
        expect(mockChat).not.toHaveBeenCalled();
        expect(result.navigationOffer).toBeUndefined();
        expect(result.response).toContain('Trainerbereich');
        expect(result.response).not.toContain('/trainer');
      });

      it('a page of the trainer area named in the history is refused for the role, no path', async () => {
        const result = await run(
          'öffne die Seite',
          asTrainee({
            previousMessages: [
              user('Wo ist die Inhaltsverwaltung?'),
              model('Die Inhaltsverwaltung gehört zum Trainerbereich.'),
            ],
          })
        );
        expect(mockChat).not.toHaveBeenCalled();
        expect(result.navigationOffer).toBeUndefined();
        expect(result.response).toContain('Trainerbereich');
      });

      it('none of the answers carries a path of the trainer area', async () => {
        for (const message of [
          'führ mich hin',
          'dann bring mich dahin',
          'öffne die Seite',
          'ja',
          'du navigierst',
        ]) {
          const result = await run(
            message,
            asTrainee({ previousMessages: REPORT_HISTORY })
          );
          expect(result.navigationOffer?.path ?? '').not.toMatch(/^\/trainer/);
          expect(result.response).not.toContain('/trainer/');
        }
      });
    });

    describe('a person without a scope', () => {
      it('gets no guidance from the history (the persona gate answers first)', async () => {
        mockAccess.mockResolvedValue(null);
        const result = await run(
          'dann bring mich dahin',
          ctx({ previousMessages: REPORT_HISTORY.slice(0, 2) })
        );
        expect(result.navigationOffer).toBeUndefined();
      });
    });
  }
);
