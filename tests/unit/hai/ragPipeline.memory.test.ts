/**
 * @jest-environment node
 */

// The memory in BOTH pipelines (processMessage and processMessageStream, the
// spoken turn included): without the switch HAI_MEMORY the system prompt and the
// result are the ones without memory and no repository is touched; with the
// switch the prompt carries the section "Gedächtnis" of the ONE occupation of the
// turn (after every protection rule), and a statement of the user becomes a
// question (at most one per conversation, never in a quiz round or a voice turn).
// The repositories are in memory, the model is a mock: no database, no model call.

const mockRepos: { users: any; globals: any } = { users: null, globals: null };
const mockResolveAccess = jest.fn();
const mockChat = jest.fn();
const mockSearch = jest.fn();

jest.mock('@/lib/hai/memory/repoDb', () => ({
  dbUserMemoryRepo: new Proxy(
    {},
    { get: (_target, prop) => (mockRepos.users as any)[prop] }
  ),
  dbGlobalMemoryRepo: new Proxy(
    {},
    { get: (_target, prop) => (mockRepos.globals as any)[prop] }
  ),
}));
jest.mock('@/lib/hai/memory/deriveData', () => ({
  loadDeriveInputs: async () => ({ topics: [], progress: null }),
}));
jest.mock('@/lib/hai/retrievalAccess', () => ({
  resolveRetrievalAccess: (userId: string, code?: string | null) =>
    mockResolveAccess(userId, code),
}));
jest.mock('@/lib/hai/personaAccess', () => {
  const persona = jest.requireActual('@/lib/hai/persona');
  return { loadHaiPersona: async () => persona.FIAE_PERSONA };
});
jest.mock('@/lib/hai/vectorSearch', () => ({
  searchWithContext: (...args: unknown[]) => mockSearch(...args),
}));
jest.mock('@/lib/hai/pageIndexService', () => ({
  fetchPageIndexContext: jest.fn().mockResolvedValue({
    pdfContext: '',
    documentsScanned: 0,
    relevantPages: 0,
    citations: [],
  }),
}));
jest.mock('@/lib/hai/providers', () => ({
  chatWithFallback: (...args: unknown[]) => mockChat(...args),
  getChatProvider: () => ({ isInitialized: () => true }),
  getEmbeddingProvider: () => ({ isInitialized: () => false }),
}));
jest.mock('@/lib/hai/dataContext', () => ({
  fetchDataContext: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/hai/actions', () => ({
  detectActionIntent: jest.fn().mockReturnValue(null),
  executeAction: jest.fn(),
}));

import {
  processMessage,
  processMessageStream,
  type PipelineContext,
} from '@/lib/hai/ragPipeline';
import { MEMORY_ENV } from '@/lib/hai/memory/config';
import { decideUserMemory } from '@/lib/hai/memory/memoryStore';
import {
  createGlobalRepo,
  createUserRepo,
  globalRow,
  userRow,
} from '../../helpers/memoryHaiRepo';

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const USER = '10000000-0000-4000-8000-000000000001';

const access = (catalogIds: string[] = [FIAE], audience = 'trainee') => ({
  catalogIds,
  audience,
  organizationId: null,
  userId: USER,
});

const context = (over: Partial<PipelineContext> = {}): PipelineContext => ({
  userId: USER,
  sessionId: 'session-1',
  userRole: 'TRAINEE',
  ...over,
});

const systemPromptOf = () => String(mockChat.mock.calls[0][0]);

let saved: string | undefined;

const seed = () =>
  createUserRepo([
    userRow({
      userId: USER,
      trainingCatalogId: FIAE,
      proposalKey: 'pref.length.short',
      content: 'Bevorzugt kurze, knappe Antworten.',
    }),
    userRow({
      userId: USER,
      trainingCatalogId: KFBM,
      proposalKey: 'pref.explain.examples',
      content: 'Versteht Erklärungen am besten mit Beispielen.',
    }),
  ]);

describe.each([
  [
    'processMessage',
    (message: string, ctx: PipelineContext) => processMessage(message, ctx),
  ],
  [
    'processMessageStream',
    (message: string, ctx: PipelineContext) =>
      processMessageStream(message, ctx, () => undefined),
  ],
])('%s and the memory', (_name, run) => {
  beforeEach(() => {
    jest.clearAllMocks();
    saved = process.env[MEMORY_ENV];
    delete process.env[MEMORY_ENV];
    mockRepos.users = seed();
    mockRepos.globals = createGlobalRepo([
      globalRow({ trainingCatalogId: FIAE, content: 'Hinweis für A.' }),
      globalRow({ trainingCatalogId: KFBM, content: 'Hinweis für B.' }),
      globalRow({ trainingCatalogId: null, content: 'Hinweis für alle.' }),
    ]);
    mockResolveAccess.mockResolvedValue(access());
    mockSearch.mockResolvedValue({ results: [], query: '', totalResults: 0 });
    mockChat.mockResolvedValue({ text: 'Antwort.', citations: [] });
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[MEMORY_ENV];
    else process.env[MEMORY_ENV] = saved;
  });

  describe('the switch HAI_MEMORY is off (the default)', () => {
    it('the prompt has no memory section and no repository is touched', async () => {
      const result = await run('Was ist ein Join in SQL?', context());
      expect(result.error).toBeUndefined();
      expect(systemPromptOf()).not.toContain('Gedächtnis');
      expect(systemPromptOf()).not.toContain('Hinweis für');
      expect(systemPromptOf()).not.toContain('kurze, knappe');
      expect(mockRepos.users.calls).toEqual([]);
      expect(result).not.toHaveProperty('memoryProposal');
    });

    it('the prompt is byte for byte the same with a full and with an empty memory', async () => {
      await run('Was ist ein Join in SQL?', context());
      const withEntries = systemPromptOf();
      jest.clearAllMocks();
      mockRepos.users = createUserRepo();
      mockRepos.globals = createGlobalRepo();
      mockChat.mockResolvedValue({ text: 'Antwort.', citations: [] });
      mockSearch.mockResolvedValue({ results: [], query: '', totalResults: 0 });
      await run('Was ist ein Join in SQL?', context());
      expect(systemPromptOf()).toBe(withEntries);
    });

    it('a statement about a preference stays unnoticed', async () => {
      const result = await run('Antworte bitte kürzer', context());
      expect(result).not.toHaveProperty('memoryProposal');
      expect(mockRepos.users.rows).toHaveLength(2);
    });
  });

  describe('the switch is on', () => {
    beforeEach(() => {
      process.env[MEMORY_ENV] = 'on';
    });

    it('the prompt carries the memory of the ONE occupation, as the last section', async () => {
      await run('Was ist ein Join in SQL?', context());
      const prompt = systemPromptOf();
      const section = prompt.slice(prompt.indexOf('## Gedächtnis'));
      expect(prompt).toContain('## Gedächtnis');
      expect(section).toContain('Bevorzugt kurze, knappe Antworten.');
      expect(section).toContain('Hinweis für A.');
      expect(section).toContain('Hinweis für alle.');
      // nothing of the other occupation
      expect(prompt).not.toContain('Versteht Erklärungen am besten');
      expect(prompt).not.toContain('Hinweis für B.');
      // after the protection rules, nothing of them changed
      expect(prompt.indexOf('## Zusatzregeln für Grenzfälle')).toBeLessThan(
        prompt.indexOf('## Gedächtnis')
      );
      expect(prompt.indexOf('gibst du an Azubis nie heraus')).toBeLessThan(
        prompt.indexOf('## Gedächtnis')
      );
      // the section is the last part of the prompt
      expect(prompt.endsWith(section)).toBe(true);
      expect(section.match(/## /g)).toHaveLength(1);
    });

    it('the memory of the other occupation is loaded when that one is the turn', async () => {
      mockResolveAccess.mockResolvedValue(access([KFBM]));
      await run('Was ist ein Join in SQL?', context());
      const prompt = systemPromptOf();
      expect(prompt).toContain(
        'Versteht Erklärungen am besten mit Beispielen.'
      );
      expect(prompt).toContain('Hinweis für B.');
      expect(prompt).not.toContain('Bevorzugt kurze, knappe Antworten.');
      expect(prompt).not.toContain('Hinweis für A.');
    });

    it('with several occupations and no choice only the shared entries for all', async () => {
      mockResolveAccess.mockResolvedValue(access([FIAE, KFBM]));
      await run('Was ist ein Join in SQL?', context());
      const prompt = systemPromptOf();
      expect(prompt).toContain('Hinweis für alle.');
      expect(prompt).not.toContain('Bevorzugt kurze, knappe Antworten.');
      expect(prompt).not.toContain('Versteht Erklärungen am besten');
      expect(prompt).not.toContain('Hinweis für A.');
    });

    it('the spoken turn gets the memory too, below the voice rules', async () => {
      await run('Was ist ein Join in SQL?', context({ voice: true }));
      const prompt = systemPromptOf();
      expect(prompt.indexOf('## Sprachassistent')).toBeGreaterThan(-1);
      expect(prompt.indexOf('## Sprachassistent')).toBeLessThan(
        prompt.indexOf('## Gedächtnis')
      );
    });

    it('the switch of the user (off) gives the prompt without memory', async () => {
      mockRepos.users.enabled.set(USER, false);
      await run('Was ist ein Join in SQL?', context());
      expect(systemPromptOf()).not.toContain('Gedächtnis');
      expect(systemPromptOf()).not.toContain('Hinweis für');
    });

    it('a failing memory never fails the turn', async () => {
      mockRepos.users.getEnabled = async () => {
        throw new Error('database down');
      };
      const warn = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const result = await run('Was ist ein Join in SQL?', context());
      warn.mockRestore();
      expect(result.response).toBe('Antwort.');
      expect(systemPromptOf()).not.toContain('Gedächtnis');
    });

    it('a statement of the user becomes a question with the proposal, stored as proposed', async () => {
      mockRepos.users = createUserRepo();
      const result = await run('Antworte bitte kürzer', context());
      expect(result.memoryProposal).toMatchObject({
        kind: 'preference',
        source: 'stated',
        content: 'Bevorzugt kurze, knappe Antworten.',
      });
      expect(mockRepos.users.rows).toHaveLength(1);
      expect(mockRepos.users.rows[0]).toMatchObject({
        status: 'proposed',
        trainingCatalogId: FIAE,
      });
      // the answer of the model is unchanged, the question comes as a card
      expect(result.response).toBe('Antwort.');

      // the next turn does not load it before the yes
      jest.clearAllMocks();
      mockChat.mockResolvedValue({ text: 'Antwort.', citations: [] });
      mockSearch.mockResolvedValue({ results: [], query: '', totalResults: 0 });
      await run('Was ist ein Join in SQL?', context());
      expect(systemPromptOf()).not.toContain('kurze, knappe');
      // after the yes it acts
      await decideUserMemory(mockRepos.users, {
        userId: USER,
        id: result.memoryProposal!.id,
        decision: 'confirm',
      });
      jest.clearAllMocks();
      mockChat.mockResolvedValue({ text: 'Antwort.', citations: [] });
      mockSearch.mockResolvedValue({ results: [], query: '', totalResults: 0 });
      await run('Was ist ein Join in SQL?', context());
      expect(systemPromptOf()).toContain('Bevorzugt kurze, knappe Antworten.');
    });

    it('at most one question per conversation', async () => {
      mockRepos.users = createUserRepo();
      mockRepos.users.askedSessions.add('session-1');
      const result = await run('Antworte bitte kürzer', context());
      expect(result).not.toHaveProperty('memoryProposal');
      expect(mockRepos.users.rows).toHaveLength(0);
    });

    it('never in the middle of a quiz round and never in a voice turn', async () => {
      mockRepos.users = createUserRepo();
      const inQuiz = await run(
        'Antworte bitte kürzer',
        context({ quizState: { active: true, topic: 'SQL' } })
      );
      expect(inQuiz).not.toHaveProperty('memoryProposal');
      const spoken = await run(
        'Antworte bitte kürzer',
        context({ voice: true })
      );
      expect(spoken).not.toHaveProperty('memoryProposal');
      expect(mockRepos.users.rows).toHaveLength(0);
    });

    it('an uncertain message gives no question', async () => {
      mockRepos.users = createUserRepo();
      const result = await run('Wie antworte ich kürzer?', context());
      expect(result).not.toHaveProperty('memoryProposal');
      expect(mockRepos.users.rows).toHaveLength(0);
    });
  });
});
