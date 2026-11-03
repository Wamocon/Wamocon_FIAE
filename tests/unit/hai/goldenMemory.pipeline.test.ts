/**
 * @jest-environment node
 */

// Golden set of the HAI, memory cases, deterministic part (docs/hai-gedaechtnis.md).
//
// The cases of tests/unit/hai/golden/hai-golden-set.json that carry a "memory"
// (MEM-01 to MEM-08) run through the real pipeline (processMessage and
// processMessageStream, typed and spoken) TWICE: once without the switch
// HAI_MEMORY (the baseline) and once with it, the memory seeded as confirmed or
// approved entries. What this proves, without any model call:
//  - the gate before the model, the occupation gate and the solution protection
//    answer exactly as without memory (same fixed text, same number of model
//    calls, same search, same citations),
//  - the prompt with memory is the prompt without memory plus ONE section at the
//    end, nothing above it changes,
//  - an entry that asks for more than style (a solution, a role, another
//    occupation) never reaches the prompt, an entry of the other occupation of the
//    same person is never loaded, a valid style entry is there.
// How the model answers is not measured here (that is the run of the golden set
// with a model, HAI_GOLDEN_MODEL_RUN, which this test never starts).

const mockRepos: { users: any; globals: any } = { users: null, globals: null };

jest.mock('@/db/haiDb', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
}));
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
  resolveRetrievalAccess: async () =>
    jest.requireActual('./golden/goldenHarness').goldenState.access,
}));
jest.mock('@/lib/hai/personaAccess', () => {
  const persona = jest.requireActual('@/lib/hai/persona');
  const harness = jest.requireActual('./golden/goldenHarness');
  const all = [harness.CATALOGS.FIAE, harness.CATALOGS.KFBM];
  return {
    loadHaiPersona: async (
      access: { catalogIds: string[]; audience: string } | null
    ) => {
      if (!access) return persona.NEUTRAL_PERSONA;
      const own = access.catalogIds.map(id => all.find(c => c.id === id));
      return persona.resolveHaiPersona({
        catalogs: own,
        otherCatalogs: all.filter(c => !access.catalogIds.includes(c.id)),
        role: access.audience === 'trainer' ? 'TRAINER' : 'TRAINEE',
      });
    },
  };
});
jest.mock('@/lib/hai/vectorSearch', () => ({
  ...jest.requireActual('@/lib/hai/vectorSearch'),
  searchWithContext: (...args: unknown[]) =>
    jest.requireActual('./golden/goldenHarness').fakeSearchWithContext(...args),
}));
jest.mock('@/lib/hai/pageIndexService', () => ({
  ...jest.requireActual('@/lib/hai/pageIndexService'),
  fetchPageIndexContext: async () => ({
    pdfContext: '',
    documentsScanned: 0,
    relevantPages: 0,
    citations: [],
  }),
}));
jest.mock('@/lib/hai/providers', () => ({
  chatWithFallback: async (systemPrompt: string) => {
    const state = jest.requireActual('./golden/goldenHarness').goldenState;
    state.systemPrompts.push(systemPrompt);
    return { text: await state.model(systemPrompt), citations: [] };
  },
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
  type PipelineResult,
} from '@/lib/hai/ragPipeline';
import type { GoldenCase } from '@/lib/hai/goldenSet';
import { MEMORY_ENV, USER_MEMORY_MAX_CHARS } from '@/lib/hai/memory/config';
import { checkMemoryContent } from '@/lib/hai/memory/text';
import {
  CATALOGS,
  USER,
  accessFor,
  goldenState,
  loadGoldenSet,
} from './golden/goldenHarness';
import {
  createGlobalRepo,
  createUserRepo,
  globalRow,
  userRow,
} from '../../helpers/memoryHaiRepo';

const set = loadGoldenSet();
const memoryCases = set.cases.filter(c => c.memory !== undefined);

const pipelines: Array<
  [string, (message: string, ctx: PipelineContext) => Promise<PipelineResult>]
> = [
  ['processMessage', (message, ctx) => processMessage(message, ctx)],
  [
    'processMessageStream',
    (message, ctx) => processMessageStream(message, ctx, () => undefined),
  ],
];
const modes = [
  ['typed', false],
  ['spoken', true],
] as const;
const runs = modes.flatMap(([mode, voice]) =>
  pipelines.map(([name, run]) => [`${name}, ${mode}`, run, voice] as const)
);

const otherCode = (goldenCase: GoldenCase) =>
  goldenCase.occupations[0] === 'FIAE' ? 'KFBM' : 'FIAE';

/** The entries of a case as the database would hold them (confirmed, approved). */
function seed(goldenCase: GoldenCase) {
  const own = CATALOGS[goldenCase.occupations[0]].id;
  const other = CATALOGS[otherCode(goldenCase)].id;
  const memory = goldenCase.memory ?? {};
  mockRepos.users = createUserRepo([
    ...(memory.user ?? []).map((content, i) =>
      userRow({
        userId: USER,
        trainingCatalogId: own,
        proposalKey: `golden.own.${i}`,
        content,
      })
    ),
    ...(memory.otherOccupation ?? []).map((content, i) =>
      userRow({
        userId: USER,
        trainingCatalogId: other,
        proposalKey: `golden.other.${i}`,
        content,
      })
    ),
  ]);
  mockRepos.globals = createGlobalRepo(
    (memory.global ?? []).map(content =>
      globalRow({ trainingCatalogId: own, content })
    )
  );
}

async function runCase(
  goldenCase: GoldenCase,
  run: (message: string, ctx: PipelineContext) => Promise<PipelineResult>,
  voice: boolean,
  memoryOn: boolean
) {
  goldenState.reset();
  goldenState.access = accessFor(goldenCase);
  seed(goldenCase);
  if (memoryOn) process.env[MEMORY_ENV] = 'on';
  else delete process.env[MEMORY_ENV];
  const result = await run(goldenCase.question, {
    userId: USER,
    sessionId: 'golden-session',
    userRole: goldenCase.claimedRole ?? goldenCase.role,
    ...(voice ? { voice: true } : {}),
  });
  return {
    result,
    prompt: goldenState.systemPrompts.at(-1) ?? '',
    modelCalls: goldenState.systemPrompts.length,
    searchCalls: JSON.stringify(goldenState.searchCalls),
    returned: [...goldenState.returnedIds],
  };
}

let saved: string | undefined;
beforeEach(() => {
  jest.clearAllMocks();
  saved = process.env[MEMORY_ENV];
  goldenState.index = set.index;
  goldenState.reset();
  goldenState.model = async () => 'Antwort';
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  if (saved === undefined) delete process.env[MEMORY_ENV];
  else process.env[MEMORY_ENV] = saved;
});

describe('the memory cases of the golden set', () => {
  it('there are 6 to 10 of them: a wish for solutions, a claimed role, another occupation', () => {
    expect(memoryCases.length).toBeGreaterThanOrEqual(6);
    expect(memoryCases.length).toBeLessThanOrEqual(10);
    expect(memoryCases.map(c => c.id)).toEqual(
      expect.arrayContaining(['MEM-01', 'MEM-03', 'MEM-05', 'MEM-07'])
    );
    expect(memoryCases.some(c => c.claimedRole !== undefined)).toBe(true);
    expect(memoryCases.some(c => c.memory?.otherOccupation)).toBe(true);
    expect(
      memoryCases.some(c => c.memory?.user?.some(t => /musterl/i.test(t)))
    ).toBe(true);
  });
});

describe.each(runs)('memory cases through %s', (_name, run, voice) => {
  it.each(memoryCases.map(c => [c.id, c] as const))(
    '%s: the gate and the prompt',
    async (_id, goldenCase) => {
      const baseline = await runCase(goldenCase, run, voice, false);
      const withMemory = await runCase(goldenCase, run, voice, true);

      // --- the gate answers as without memory
      expect(withMemory.result.response).toBe(baseline.result.response);
      expect(withMemory.result.intent).toBe(baseline.result.intent);
      expect(withMemory.result.citations).toEqual(baseline.result.citations);
      expect(withMemory.modelCalls).toBe(baseline.modelCalls);
      expect(withMemory.searchCalls).toBe(baseline.searchCalls);
      expect(withMemory.returned).toEqual(baseline.returned);
      // no question of the memory in these turns (no statement of a preference)
      expect(withMemory.result).not.toHaveProperty('memoryProposal');

      // --- the baseline never knows the memory
      expect(baseline.prompt).not.toContain('## Gedächtnis');

      const memory = goldenCase.memory!;
      const validOwn = (memory.user ?? []).filter(
        t => checkMemoryContent(t, USER_MEMORY_MAX_CHARS).ok
      );
      const validGlobal = (memory.global ?? []).filter(
        t => checkMemoryContent(t, 400, { derived: true }).ok
      );

      if (withMemory.modelCalls === 0) {
        // refused before the model: nothing of the memory is built at all
        expect(withMemory.prompt).toBe('');
        return;
      }

      const expectsSection = validOwn.length + validGlobal.length > 0;
      if (expectsSection) {
        // the prompt with memory is the prompt without memory plus one section
        expect(withMemory.prompt.startsWith(baseline.prompt)).toBe(true);
        const section = withMemory.prompt.slice(baseline.prompt.length);
        expect(section).toMatch(/^\n\n## Gedächtnis/);
        expect(withMemory.prompt.endsWith(section)).toBe(true);
        for (const text of [...validOwn, ...validGlobal]) {
          expect(section).toContain(text);
        }
        // every protection rule of the baseline is above the section, unchanged
        expect(baseline.prompt).toContain('## Zusatzregeln für Grenzfälle');
      } else {
        // nothing valid is left: byte for byte the prompt without memory
        expect(withMemory.prompt).toBe(baseline.prompt);
      }

      // --- what must never reach the prompt
      const discarded = [
        ...(memory.user ?? []).filter(t => !validOwn.includes(t)),
        ...(memory.global ?? []).filter(t => !validGlobal.includes(t)),
        // the other occupation of the same person is never loaded
        ...(memory.otherOccupation ?? []),
      ];
      for (const text of discarded) {
        expect(withMemory.prompt).not.toContain(text);
      }
      for (const word of goldenCase.forbidden.words) {
        expect(withMemory.prompt.toLowerCase()).not.toContain(
          word.toLowerCase()
        );
      }
    }
  );

  it('the entries that ask for a solution or a role are all discarded by the check', () => {
    for (const goldenCase of memoryCases) {
      const wishes = (goldenCase.memory?.user ?? []).filter(t =>
        /musterl|lösung|richtigen antworten|trainer/i.test(t)
      );
      for (const text of wishes) {
        expect({
          id: goldenCase.id,
          text,
          ok: checkMemoryContent(text, USER_MEMORY_MAX_CHARS).ok,
        }).toEqual({ id: goldenCase.id, text, ok: false });
      }
    }
  });
});
