/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';

// Navigation cases of the agent layer (tests/unit/hai/golden/hai-navigation-cases.json),
// run through the real pipeline (processMessage and processMessageStream, typed
// and spoken). Replaced: the access of the database, the persona loader, the
// data layer of the navigation and the model (it must never be called).

const mockChat = jest.fn();
const mockEnablers = jest.fn();
const mockLock = jest.fn();
const mockNext = jest.fn();

jest.mock('@/lib/hai/actions', () => ({
  detectActionIntent: jest.fn().mockReturnValue(null),
  executeAction: jest.fn(),
}));
jest.mock('@/lib/hai/providers', () => ({
  chatWithFallback: (...args: unknown[]) => mockChat(...args),
  getChatProvider: () => ({ isInitialized: () => true }),
  getEmbeddingProvider: () => ({ isInitialized: () => false }),
}));
const mockAccess = jest.fn();
jest.mock('@/lib/hai/retrievalAccess', () => ({
  resolveRetrievalAccess: () => mockAccess(),
}));
jest.mock('@/lib/hai/personaAccess', () => {
  const persona = jest.requireActual('@/lib/hai/persona');
  const catalogs = {
    '00000000-0000-4000-8000-000000000001': {
      id: '00000000-0000-4000-8000-000000000001',
      code: 'FIAE',
      title: 'Fachinformatiker Anwendungsentwicklung',
      settings: {},
    },
    '00000000-0000-4000-8000-000000000002': {
      id: '00000000-0000-4000-8000-000000000002',
      code: 'KFBM',
      title: 'Kaufleute für Büromanagement',
      settings: {},
    },
  } as Record<string, { id: string }>;
  return {
    loadHaiPersona: async (access: { catalogIds: string[] } | null) => {
      if (!access) return persona.NEUTRAL_PERSONA;
      const own = access.catalogIds.map(id => catalogs[id]);
      return persona.resolveHaiPersona({
        catalogs: own,
        otherCatalogs: Object.values(catalogs).filter(c => !own.includes(c)),
      });
    },
  };
});
jest.mock('@/lib/hai/vectorSearch', () => ({ searchWithContext: jest.fn() }));
jest.mock('@/lib/hai/pageIndexService', () => ({
  fetchPageIndexContext: jest.fn(),
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
import { isAllowedNavigationPath } from '@/lib/hai/navigation/targets';

interface NavigationCase {
  id: string;
  level: 'TRAINEE' | 'TRAINER';
  occupation: 'FIAE' | 'KFBM';
  question: string;
  lock: { locked: boolean; lockedByTitle: string | null } | null;
  expected: {
    kind: 'denied' | 'locked' | 'not_found' | 'offer';
    path?: string;
  };
  forbiddenWords: string[];
}

const set = JSON.parse(
  fs.readFileSync(
    path.join(
      process.cwd(),
      'tests',
      'unit',
      'hai',
      'golden',
      'hai-navigation-cases.json'
    ),
    'utf-8'
  )
) as { cases: NavigationCase[] };

const USER = '10000000-0000-4000-8000-000000000001';
const CATALOG = {
  FIAE: '00000000-0000-4000-8000-000000000001',
  KFBM: '00000000-0000-4000-8000-000000000002',
};
const E1 = '20000000-0000-4000-8000-000000000001';
const NOT_FOUND =
  'Dazu finde ich in deinem Lernstoff keinen passenden Eintrag. Nenne mir bitte die Nummer oder den genauen Namen.';

const pipelines: Array<
  [string, (message: string, ctx: PipelineContext) => Promise<PipelineResult>]
> = [
  ['processMessage', (message, ctx) => processMessage(message, ctx)],
  [
    'processMessageStream',
    (message, ctx) => processMessageStream(message, ctx, () => undefined),
  ],
];

describe.each(
  pipelines.flatMap(([name, run]) =>
    [false, true].map(
      voice => [`${name}, ${voice ? 'spoken' : 'typed'}`, run, voice] as const
    )
  )
)('navigation cases through %s', (_name, run, voice) => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockChat.mockResolvedValue({ text: 'Antwort', citations: [] });
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
  });

  it.each(set.cases.map(c => [c.id, c.expected.kind, c] as const))(
    '%s (%s)',
    async (_id, kind, c) => {
      mockAccess.mockResolvedValue({
        catalogIds: [CATALOG[c.occupation]],
        audience: c.level === 'TRAINER' ? 'trainer' : 'trainee',
        organizationId: 'org-1',
        userId: USER,
      });
      // the data layer returns the records of the own occupation only
      mockEnablers.mockResolvedValue(
        c.occupation === 'FIAE'
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
      mockLock.mockResolvedValue(
        c.lock
          ? { ...c.lock, hasActiveQuiz: true }
          : { locked: false, lockedByTitle: null, hasActiveQuiz: true }
      );

      const result = await run(c.question, {
        userId: USER,
        userRole: c.level,
        ...(voice ? { voice: true } : {}),
      });

      // never a model call, never a write
      expect(mockChat).not.toHaveBeenCalled();
      expect(result.pendingAction).toBeUndefined();
      expect(result.actionResult).toBeUndefined();
      expect(result.intent).toBe('navigation');

      for (const word of c.forbiddenWords) {
        expect(result.response).not.toContain(word);
        expect(JSON.stringify(result.navigationOffer ?? {})).not.toContain(
          word
        );
      }

      switch (kind) {
        case 'denied':
          expect(result.navigationOffer).toBeUndefined();
          expect(result.response).toContain(
            'Diese Seite kann ich dir nicht öffnen.'
          );
          break;
        case 'locked':
          expect(result.navigationOffer).toBeUndefined();
          expect(result.response).toContain('gesperrt');
          break;
        case 'not_found':
          expect(result.navigationOffer).toBeUndefined();
          // the same text as for a record that does not exist
          expect(result.response).toBe(NOT_FOUND);
          break;
        case 'offer':
          expect(result.navigationOffer?.path).toBe(c.expected.path);
          expect(isAllowedNavigationPath(result.navigationOffer?.path)).toBe(
            true
          );
          // spoken: asks, typed: points at the button
          expect(result.response.endsWith('Soll ich sie öffnen?')).toBe(voice);
          expect(result.response.includes('Mit Öffnen')).toBe(!voice);
          break;
      }
    }
  );
});

describe('the navigation cases', () => {
  it('are few, have unique ids and cover refusal, locked, not found and an offer', () => {
    const ids = set.cases.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(set.cases.length).toBeLessThanOrEqual(12);
    for (const kind of ['denied', 'locked', 'not_found', 'offer']) {
      expect(set.cases.some(c => c.expected.kind === kind)).toBe(true);
    }
    expect(set.cases.some(c => c.level === 'TRAINER')).toBe(true);
    expect(set.cases.some(c => c.occupation === 'KFBM')).toBe(true);
  });
});
