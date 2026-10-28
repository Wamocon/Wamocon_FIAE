/**
 * @jest-environment node
 */
import { PgDialect } from 'drizzle-orm/pg-core';

// Golden set of the HAI, deterministic part (package KI5.4, docs/hai-golden-set.md).
//
// Every case of tests/unit/hai/golden/hai-golden-set.json runs through the real
// pipeline (processMessage and processMessageStream): the real persona
// builder, the real refusal logic, the real prompt builder and the real
// retrieval code of the pipeline. What is replaced is everything outside: the
// resolver of the access (it returns what the database would return, so the
// test shows that the pipeline takes the access from it and ignores the role
// the client claims, not that the database lookup itself is right: see
// retrievalAccess.test.ts), the database (an in-memory index that applies the
// contract of the SQL filter, which is tied to the real SQL below), the model
// (a fixed answer), the PageIndex (no PDF), the live data and the actions.
// No model is called.
//
// What this test can prove: what the model gets to see. A trainee never gets a
// trainer-only chunk (solution, assessment key, quiz answer, hint), nobody gets
// a chunk of an occupation that is not theirs, a question that names another
// occupation or has nothing to do with the occupation never reaches the model.
// What it cannot prove: how the model answers. That is the measurement at the
// end of this file (skipped unless HAI_GOLDEN_MODEL_RUN=yes).

jest.mock('@/db/haiDb', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
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
  fetchPageIndexContext: async (
    _query: string,
    _results: unknown,
    options: { catalogIds: string[]; audience: string }
  ) => {
    jest
      .requireActual('./golden/goldenHarness')
      .goldenState.pageIndexCalls.push({
        catalogIds: options.catalogIds,
        audience: options.audience,
      });
    return {
      pdfContext: '',
      documentsScanned: 0,
      relevantPages: 0,
      citations: [],
    };
  },
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
import { buildScopeCondition } from '@/lib/hai/vectorSearch';
import { documentAccessCondition } from '@/lib/hai/pageIndexService';
import { FOREIGN_OCCUPATION_TEXT, resolveHaiPersona } from '@/lib/hai/persona';
import {
  scoreAnswer,
  summarizeScores,
  type GoldenCase,
  type GoldenChunk,
  type CaseScore,
} from '@/lib/hai/goldenSet';
import {
  CATALOGS,
  ORG,
  USER,
  accessFor,
  canaryMap,
  fakeSearchWithContext,
  goldenState,
  loadGoldenSet,
  mayRead,
} from './golden/goldenHarness';

const set = loadGoldenSet();
const canaries = canaryMap(set);
const chunkById = new Map(set.index.map(chunk => [chunk.id, chunk]));
const dialect = new PgDialect();

const pipelines: Array<
  [string, (message: string, ctx: PipelineContext) => Promise<PipelineResult>]
> = [
  ['processMessage', (message, ctx) => processMessage(message, ctx)],
  [
    'processMessageStream',
    (message, ctx) => processMessageStream(message, ctx, () => undefined),
  ],
];

function contextFor(goldenCase: GoldenCase): PipelineContext {
  return {
    userId: USER,
    // what the client claims: the pipeline must not use it for access
    userRole: goldenCase.claimedRole ?? goldenCase.role,
  };
}

/** Persona of the person of a case, built like the loader builds it. */
function personaFor(goldenCase: GoldenCase) {
  const own = goldenCase.occupations.map(code => CATALOGS[code]);
  return resolveHaiPersona({
    catalogs: own,
    otherCatalogs: Object.values(CATALOGS).filter(c => !own.includes(c)),
    role: goldenCase.role,
  });
}

/** Everything of the index that the person of a case may NOT read. */
function unreadable(goldenCase: GoldenCase): GoldenChunk[] {
  return set.index.filter(chunk => !mayRead(goldenCase, chunk));
}

beforeEach(() => {
  jest.clearAllMocks();
  goldenState.index = set.index;
  goldenState.reset();
  goldenState.model = async () => 'Antwort';
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe.each(pipelines)('golden set through %s', (_name, run) => {
  it.each(set.cases.map(c => [c.id, c.expected.behavior, c] as const))(
    '%s (%s)',
    async (_id, behavior, goldenCase) => {
      goldenState.access = accessFor(goldenCase);
      const result = await run(goldenCase.question, contextFor(goldenCase));

      const prompt = goldenState.systemPrompts.at(-1) ?? '';
      const modelCalls = goldenState.systemPrompts.length;
      const citationIds = result.citations.map(c => c.title);

      // --- Always: nothing the person may not read reaches the model, the
      // citations or the response (derived from the index, not from the case)
      for (const chunk of unreadable(goldenCase)) {
        expect(prompt).not.toContain(chunk.canary);
        expect(prompt).not.toContain(chunk.text);
        expect(result.response).not.toContain(chunk.canary);
        expect(citationIds).not.toContain(chunk.id);
        expect(goldenState.returnedIds).not.toContain(chunk.id);
      }
      // --- What the case lists as forbidden
      for (const id of goldenCase.forbidden.sources) {
        const chunk = chunkById.get(id) as GoldenChunk;
        expect(prompt).not.toContain(chunk.canary);
        expect(result.response).not.toContain(chunk.canary);
        expect(citationIds).not.toContain(id);
      }
      for (const word of goldenCase.forbidden.words) {
        // case insensitive, like scoreAnswer
        expect(prompt.toLowerCase()).not.toContain(word.toLowerCase());
        expect(result.response.toLowerCase()).not.toContain(word.toLowerCase());
      }
      // --- The search had the access of the database, not the claimed role
      for (const call of [
        ...goldenState.searchCalls,
        ...goldenState.pageIndexCalls,
      ]) {
        expect(call.audience).toBe(
          goldenCase.role === 'TRAINER' ? 'trainer' : 'trainee'
        );
        expect(call.catalogIds).toEqual(
          goldenCase.occupations.map(code => CATALOGS[code].id)
        );
      }

      switch (behavior) {
        case 'refuse_offtopic':
          expect(result.intent).toBe('off_topic');
          expect(result.response).toBe(personaFor(goldenCase).refusalText);
          expect(modelCalls).toBe(0);
          expect(goldenState.searchCalls).toEqual([]);
          expect(goldenState.pageIndexCalls).toEqual([]);
          break;

        case 'refuse_other_occupation':
          if (goldenCase.expected.layer === 'pre_model') {
            // the neutral text, no retrieval, no model call, nothing named
            expect(result.response).toBe(FOREIGN_OCCUPATION_TEXT);
            expect(result.intent).toBe('off_topic');
            expect(modelCalls).toBe(0);
            expect(goldenState.searchCalls).toEqual([]);
            expect(goldenState.pageIndexCalls).toEqual([]);
          } else {
            // the model is asked, with a context that holds nothing of the
            // other occupation
            expect(result.response).not.toBe(FOREIGN_OCCUPATION_TEXT);
            expect(modelCalls).toBe(1);
            expect(goldenState.searchCalls).toHaveLength(1);
          }
          break;

        case 'refuse_solution':
          // a solution request is not caught by a keyword: the model is asked,
          // and what protects the solution is that the context has none
          expect(modelCalls).toBe(1);
          expect(goldenState.searchCalls).toHaveLength(1);
          expect(goldenState.searchCalls[0].audience).toBe('trainee');
          expect(
            goldenState.returnedIds.some(
              id => chunkById.get(id)?.visibility === 'trainer'
            )
          ).toBe(false);
          break;

        case 'answer':
          expect(modelCalls).toBe(1);
          expect(result.response).toBe('Antwort');
          for (const id of goldenCase.requiredSources ?? []) {
            expect(prompt).toContain((chunkById.get(id) as GoldenChunk).canary);
          }
          break;
      }
    }
  );
});

describe('the in-memory index follows the real SQL filter', () => {
  const rendered = (access: ReturnType<typeof accessFor>) => {
    const condition = buildScopeCondition(access);
    if (!condition) throw new Error('no condition');
    const query = dialect.sqlToQuery(condition);
    return { text: query.sql.replace(/\s+/g, ' '), params: query.params };
  };

  it.each(set.cases.map(c => [c.id, c] as const))(
    '%s: catalogs and visibility of buildScopeCondition',
    (_id, goldenCase) => {
      const access = { ...accessFor(goldenCase), organizationId: ORG };
      const { text, params } = rendered(access);
      const ids = goldenCase.occupations.map(code => CATALOGS[code].id);
      expect(params.slice(0, ids.length)).toEqual(ids);
      expect(text).toContain(
        `training_catalog_id IN (${ids.map((_, i) => `$${i + 1}::uuid`).join(', ')})`
      );
      // trainees: visibility all only; trainer level: no visibility filter
      if (goldenCase.role === 'TRAINEE') {
        expect(text).toContain("visibility = 'all'");
      } else {
        expect(text).not.toContain('visibility');
      }
    }
  );

  it('uses the audience of the database, an unknown audience is a trainee', () => {
    const odd = { ...accessFor(set.cases[0]), audience: 'TRAINER' as never };
    expect(rendered(odd).text).toContain("visibility = 'all'");
  });

  it('keeps the solution documents of the PageIndex from a trainee, not from a trainer', () => {
    const render = (audience: 'trainee' | 'trainer') =>
      dialect.sqlToQuery(
        documentAccessCondition({ audience, organizationId: null })
      ).sql;
    expect(render('trainee')).toContain("'TRAINER_SOLUTION'");
    expect(render('trainee')).toContain("'TRAINER_ONLY'");
    expect(render('trainer')).not.toContain('TRAINER_SOLUTION');
  });

  it('returns from the search exactly the chunks that mayRead allows, for every case', async () => {
    for (const goldenCase of set.cases) {
      goldenState.reset();
      const access = accessFor(goldenCase);
      await fakeSearchWithContext('frage', {}, access);
      const expected = set.index
        .filter(chunk => mayRead(goldenCase, chunk))
        .map(chunk => chunk.id);
      expect(goldenState.returnedIds.sort()).toEqual(expected.sort());
    }
  });
});

describe('the in-memory index of the golden set', () => {
  it('holds a task, a solution, an assessment key, a quiz and a hint per occupation', () => {
    for (const code of ['FIAE', 'KFBM'] as const) {
      const own = set.index.filter(chunk => chunk.catalog === code);
      expect(
        own.filter(c => c.visibility === 'trainer').length
      ).toBeGreaterThanOrEqual(4);
      expect(
        own.some(c => c.id.endsWith('uc-task') && c.visibility === 'all')
      ).toBe(true);
      expect(
        own.some(
          c => c.id.endsWith('uc-solution') && c.visibility === 'trainer'
        )
      ).toBe(true);
      expect(
        own.some(c => c.id.endsWith('scenario') && c.visibility === 'all')
      ).toBe(true);
    }
  });
});

// ============================================================================
// Persona and prompt: what the model is told, per case group
// ============================================================================

describe('persona and prompt of the cases', () => {
  const answered = set.cases.filter(
    c =>
      c.expected.behavior === 'answer' ||
      c.expected.behavior === 'refuse_solution'
  );

  it.each(answered.map(c => [c.id, c] as const))(
    '%s: the prompt carries the persona of the person only',
    async (_id, goldenCase) => {
      goldenState.access = accessFor(goldenCase);
      await processMessage(goldenCase.question, contextFor(goldenCase));
      const prompt = goldenState.systemPrompts.at(-1) as string;
      const persona = personaFor(goldenCase);
      expect(prompt).toContain(persona.refusalPrompt);
      // a trainee prompt of another occupation than FIAE has no trainer topics,
      // whatever the client claims (the FIAE prompt keeps today's text byte for
      // byte, trainer topics included: tests/unit/hai/persona.fiae-baseline.test.ts)
      if (goldenCase.role === 'TRAINEE' && !persona.showTrainerTopics) {
        expect(prompt).not.toContain('Notenuebersicht aller Azubis');
        expect(prompt).not.toContain('**Trainer (zusaetzlich):**');
      }
      // the other occupation is not named in the prompt of a single occupation
      if (goldenCase.occupations.length === 1) {
        const other =
          goldenCase.occupations[0] === 'FIAE'
            ? 'Büromanagement'
            : 'Fachinformatik';
        expect(prompt).not.toContain(other);
      }
    }
  );
});

// ============================================================================
// The leak the scoring must catch: a model that gives the solution away
// ============================================================================

describe('scoring a scripted model (no real model)', () => {
  it('rates a model that refuses where it should and answers where it may', () => {
    const scores: CaseScore[] = set.cases.map(c =>
      scoreAnswer(
        c,
        c.expected.behavior === 'answer'
          ? 'Hier ist die Erklärung zu deiner Frage mit allem, was du dafür brauchst.'
          : 'Das liegt leider außerhalb meines Fachgebiets, frag bitte deinen Trainer.',
        canaries
      )
    );
    const summary = summarizeScores(scores);
    expect(summary.violations).toEqual([]);
    expect(summary.total).toBe(set.cases.length);
  });

  it('catches a model that always repeats its context (every refusal case leaks)', () => {
    // The context of a trainee holds no solution, so a repeating model cannot
    // leak one. Give it the whole index to show that the scoring would notice.
    const everything = set.index.map(c => c.text).join('\n');
    const scores = set.cases
      .filter(c => c.expected.behavior === 'refuse_solution')
      .map(c => scoreAnswer(c, everything, canaries));
    const summary = summarizeScores(scores);
    expect(summary.leaks).toBe(scores.length);
    expect(summary.violations.join()).toMatch(/leaks/);
  });
});

// ============================================================================
// Measurement of the model (skipped by default, see docs/hai-golden-set.md)
// ============================================================================

const RUN_MODEL = process.env.HAI_GOLDEN_MODEL_RUN === 'yes';

(RUN_MODEL ? describe : describe.skip)(
  'golden set: measurement of the model answers (HAI_GOLDEN_MODEL_RUN=yes)',
  () => {
    it(
      'meets the thresholds',
      async () => {
        // The pipeline above stays as it is (access, persona, prompt, in-memory
        // index); only the model is the real one, through the provider chain
        // that the chat uses. This calls a model for every case: run it only
        // with the approval of the owner.
        const providers = jest.requireActual('@/lib/hai/providers');
        const scores: CaseScore[] = [];
        for (const goldenCase of set.cases) {
          goldenState.reset();
          goldenState.access = accessFor(goldenCase);
          goldenState.model = async systemPrompt => {
            const reply = await providers.chatWithFallback(
              systemPrompt,
              [],
              goldenCase.question,
              undefined,
              { maxOutputTokens: 1024, temperature: 0 }
            );
            return reply.text;
          };
          const result = await processMessage(
            goldenCase.question,
            contextFor(goldenCase)
          );
          scores.push(scoreAnswer(goldenCase, result.response, canaries));
        }
        const summary = summarizeScores(scores);
        // numbers and case ids only, never an answer text
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        expect(summary.violations).toEqual([]);
      },
      15 * 60 * 1000
    );
  }
);
