/**
 * @jest-environment node
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { writeFileSync } from 'node:fs';

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
import { resolveHaiPersona } from '@/lib/hai/persona';
import {
  ACCESS_REASONS,
  DENIAL_BERUF_TEXT,
  DENIAL_LOESUNGSSCHUTZ_TEXT,
  namesDenialReason,
} from '@/lib/hai/denial';
import {
  SOLUTION_REFUSAL_TEXT,
  isSolutionRequest,
} from '@/lib/hai/solutionRequest';
import {
  askAgainOnServerFailure,
  mergeRuns,
  parseRepeat,
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

function contextFor(goldenCase: GoldenCase, voice = false): PipelineContext {
  return {
    userId: USER,
    // what the client claims: the pipeline must not use it for access
    userRole: goldenCase.claimedRole ?? goldenCase.role,
    // the spoken way (voice assistant, WMCNL-2907): same pipeline, same guards
    ...(voice ? { voice: true } : {}),
  };
}

// every case runs typed and spoken: the voice assistant changes the way of speaking,
// never the access (acceptance criterion of WMCNL-2907)
const modes = [
  ['typed', false],
  ['spoken', true],
] as const;
const pipelinesByMode = modes.flatMap(([mode, voice]) =>
  pipelines.map(([name, run]) => [`${name}, ${mode}`, run, voice] as const)
);

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

describe.each(pipelinesByMode)('golden set through %s', (_name, run, voice) => {
  it.each(set.cases.map(c => [c.id, c.expected.behavior, c] as const))(
    '%s (%s)',
    async (_id, behavior, goldenCase) => {
      goldenState.access = accessFor(goldenCase);
      const result = await run(
        goldenCase.question,
        contextFor(goldenCase, voice)
      );

      const prompt = goldenState.systemPrompts.at(-1) ?? '';
      const modelCalls = goldenState.systemPrompts.length;
      const citationIds = result.citations.map(c => c.title);

      // --- The voice section is in the prompt of a spoken question and only there
      if (modelCalls > 0) {
        const section = '## Sprachassistent (Tagesbegleiter)';
        if (voice) expect(prompt).toContain(section);
        else expect(prompt).not.toContain(section);
      }

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
            expect(result.response).toBe(DENIAL_BERUF_TEXT);
            // "the reason is named": the fixed text says why, in plain words
            if (goldenCase.expected.reason) {
              expect(
                namesDenialReason(result.response, goldenCase.expected.reason)
              ).toBe(true);
            }
            expect(result.intent).toBe('off_topic');
            expect(modelCalls).toBe(0);
            expect(goldenState.searchCalls).toEqual([]);
            expect(goldenState.pageIndexCalls).toEqual([]);
          } else {
            // the model is asked, with a context that holds nothing of the
            // other occupation
            expect(result.response).not.toBe(DENIAL_BERUF_TEXT);
            expect(modelCalls).toBe(1);
            expect(goldenState.searchCalls).toHaveLength(1);
          }
          break;

        case 'refuse_solution':
          if (isSolutionRequest(goldenCase.question)) {
            // an explicit request is refused by the fixed check: the fixed
            // text, no retrieval, no model call
            expect(result.response).toBe(SOLUTION_REFUSAL_TEXT);
            // "the reason is named": the fixed text says why, in plain words
            if (goldenCase.expected.reason) {
              expect(
                namesDenialReason(result.response, goldenCase.expected.reason)
              ).toBe(true);
            }
            expect(result.intent).toBe('question');
            expect(modelCalls).toBe(0);
            expect(goldenState.searchCalls).toEqual([]);
            expect(goldenState.pageIndexCalls).toEqual([]);
            break;
          }
          // any other request for a solution is not caught by a keyword: the
          // model is asked, and what protects the solution is that the context
          // has none
          expect(modelCalls).toBe(1);
          // "the reason is named": the prompt carries the access reason of the
          // category, so the model can name it (and the later measurement
          // checks the answer with scoreAnswer)
          if (goldenCase.expected.reason) {
            const notes = Object.values(ACCESS_REASONS)
              .filter(r => r.category === goldenCase.expected.reason)
              .map(r => r.note);
            expect(prompt).toContain('## Begründung bei Zugriffsgrenzen');
            expect(notes.some(note => prompt.includes(note))).toBe(true);
          }
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
      // model solutions of the private bucket: open only for a trainer with the
      // permission, closed in the SQL for everyone else
      const open =
        access.audience === 'trainer' && !!access.includeTrainerSolutions;
      expect(text.includes("metadata->>'trainerSolution'")).toBe(!open);
    }
  );

  it('closes the model solutions in the SQL for a trainer while the switch is off', () => {
    const trainerCase = set.cases.find(c => c.id === 'SP-34') as GoldenCase;
    goldenState.trainerSolutionsOn = false;
    const off = rendered(accessFor(trainerCase));
    expect(off.text).toContain("metadata->>'trainerSolution'");
    goldenState.trainerSolutionsOn = true;
    const on = rendered(accessFor(trainerCase));
    expect(on.text).not.toContain("metadata->>'trainerSolution'");
  });

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

// ============================================================================
// Trainer solutions: model solutions of the private bucket
// ============================================================================

describe('trainer solutions (model solutions of the private bucket)', () => {
  const PDF_ID = 'kfbm-pdf-solution';
  const pdfChunk = chunkById.get(PDF_ID) as GoldenChunk;
  const trainerAnswers = set.cases.filter(c =>
    c.requiredSources?.includes(PDF_ID)
  );

  it('is in the index as a private solution at trainer level', () => {
    expect(pdfChunk.privateSolution).toBe(true);
    expect(pdfChunk.visibility).toBe('trainer');
    expect(pdfChunk.catalog).toBe('KFBM');
    expect(trainerAnswers.length).toBeGreaterThanOrEqual(3);
  });

  describe.each(pipelines)('through %s', (_name, run) => {
    it.each(trainerAnswers.map(c => [c.id, c] as const))(
      '%s: a trainer of the occupation gets it, and the result is marked',
      async (_id, goldenCase) => {
        goldenState.access = accessFor(goldenCase);
        const result = await run(goldenCase.question, contextFor(goldenCase));
        expect(goldenState.systemPrompts.at(-1)).toContain(pdfChunk.canary);
        expect(result.usedTrainerSolutions).toBe(true);
        // the note that it is trainer knowledge is in the context
        expect(goldenState.systemPrompts.at(-1)).toMatch(
          /Musterlösung, nur für Trainer/
        );
      }
    );

    it.each(trainerAnswers.map(c => [c.id, c] as const))(
      '%s: with the switch off nobody gets it, not even the trainer',
      async (_id, goldenCase) => {
        goldenState.trainerSolutionsOn = false;
        goldenState.access = accessFor(goldenCase);
        const result = await run(goldenCase.question, contextFor(goldenCase));
        expect(goldenState.systemPrompts.at(-1)).not.toContain(pdfChunk.canary);
        expect(result.response).not.toContain(pdfChunk.canary);
        expect(result.usedTrainerSolutions).toBeUndefined();
        expect(goldenState.returnedIds).not.toContain(PDF_ID);
      }
    );

    it('never gives it to a trainee, whatever the request claims, switch on', async () => {
      const claims: Array<GoldenCase['claimedRole']> = ['TRAINER', 'TRAINEE'];
      for (const goldenCase of set.cases.filter(
        c => c.role === 'TRAINEE' && c.occupations.includes('KFBM')
      )) {
        for (const claimedRole of claims) {
          goldenState.reset();
          goldenState.access = accessFor(goldenCase);
          const result = await run(goldenCase.question, {
            ...contextFor(goldenCase),
            userRole: claimedRole,
          });
          for (const prompt of goldenState.systemPrompts) {
            expect(prompt).not.toContain(pdfChunk.canary);
            expect(prompt).not.toContain('PDFSOL');
          }
          expect(result.response).not.toContain('PDFSOL');
          expect(JSON.stringify(result.citations)).not.toContain(PDF_ID);
          expect(result.usedTrainerSolutions).toBeUndefined();
          expect(goldenState.returnedIds).not.toContain(PDF_ID);
        }
      }
    });

    it('never gives it to a trainer of another occupation', async () => {
      for (const goldenCase of set.cases.filter(
        c => c.role === 'TRAINER' && !c.occupations.includes('KFBM')
      )) {
        goldenState.reset();
        goldenState.access = accessFor(goldenCase);
        const result = await run(goldenCase.question, contextFor(goldenCase));
        for (const prompt of goldenState.systemPrompts) {
          expect(prompt).not.toContain(pdfChunk.canary);
        }
        expect(result.usedTrainerSolutions).toBeUndefined();
        expect(goldenState.returnedIds).not.toContain(PDF_ID);
      }
    });

    it('survives a search that returns it to the wrong person (second guard of the pipeline)', async () => {
      const trainee = set.cases.find(c => c.id === 'SP-26') as GoldenCase;
      goldenState.reset();
      goldenState.access = accessFor(trainee);
      // SP-26 asks for the model solution outright, which the fixed detection
      // answers before search and model. The guard behind the search is only
      // reached by a question that gets through to the model.
      const question =
        'Wie läuft die Reisekostenabrechnung im Unternehmen ab? Erkläre mir das Vorgehen.';
      // a broken filter: the search hands the chunk to a trainee
      const leaky = jest.requireActual('./golden/goldenHarness');
      const spy = jest
        .spyOn(leaky, 'fakeSearchWithContext')
        .mockImplementation(async (query: unknown) => ({
          results: [
            {
              id: PDF_ID,
              sourceType: 'document',
              sourceId: PDF_ID,
              chunkIndex: 0,
              content: pdfChunk.text,
              similarity: 0.99,
              metadata: { title: PDF_ID, trainerSolution: true },
            },
          ],
          query,
          totalResults: 1,
        }));
      try {
        const result = await run(question, contextFor(trainee));
        expect(goldenState.systemPrompts.length).toBeGreaterThan(0);
        expect(goldenState.systemPrompts.at(-1)).not.toContain(pdfChunk.canary);
        expect(result.response).not.toContain(pdfChunk.canary);
        expect(JSON.stringify(result.citations)).not.toContain(PDF_ID);
      } finally {
        spy.mockRestore();
      }
    });
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
  // the cases that reach the model (an explicit solution request of a trainee
  // ends before the model, see solutionRequest.ts)
  const answered = set.cases.filter(
    c =>
      (c.expected.behavior === 'answer' ||
        c.expected.behavior === 'refuse_solution') &&
      !(c.role === 'TRAINEE' && isSolutionRequest(c.question))
  );

  it.each(answered.map(c => [c.id, c] as const))(
    '%s: the prompt carries the persona of the person only',
    async (_id, goldenCase) => {
      goldenState.access = accessFor(goldenCase);
      await processMessage(goldenCase.question, contextFor(goldenCase));
      const prompt = goldenState.systemPrompts.at(-1) as string;
      const persona = personaFor(goldenCase);
      // the prompt of a question that passed the gate carries no fixed refusal
      // sentence (the model copied it where the question was a subject question,
      // golden set 03.11.2026); the pipeline sends that text itself
      expect(prompt).not.toContain(persona.refusalPrompt);
      expect(prompt).toContain(
        'Diese Frage wurde bereits als fachlich geprüft'
      );
      // the role comes from the server, whatever the client claims
      expect(prompt).toContain(
        goldenCase.role === 'TRAINER'
          ? 'Die Person ist ein Ausbilder (Trainer).'
          : 'Die Person ist ein Auszubildender (Azubi).'
      );
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
    // a refusal with a reason names it, like the fixed texts of the pipeline
    const refusal = (c: GoldenCase) =>
      c.expected.reason === 'BERUF'
        ? DENIAL_BERUF_TEXT
        : c.expected.reason === 'LOESUNGSSCHUTZ'
          ? DENIAL_LOESUNGSSCHUTZ_TEXT
          : 'Das liegt leider außerhalb meines Fachgebiets, frag bitte deinen Trainer.';
    const scores: CaseScore[] = set.cases.map(c =>
      scoreAnswer(
        c,
        c.expected.behavior === 'answer'
          ? 'Hier ist die Erklärung zu deiner Frage mit allem, was du dafür brauchst.'
          : refusal(c),
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
        // Optional: HAI_GOLDEN_CASES=SP-09,EX-01 runs only these cases and
        // HAI_GOLDEN_DUMP=<file> writes question, answer and issues of every case
        // run to that file (the texts of the set are invented, nothing real).
        // Without both the run is the full measurement and prints ids only.
        const only = (process.env.HAI_GOLDEN_CASES ?? '')
          .split(',')
          .map(id => id.trim())
          .filter(Boolean);
        const dump: Record<string, unknown> = {};
        // HAI_GOLDEN_REPEAT=<n> (default 1) runs every case n times. A case
        // passes only if ALL runs pass (a model that is right two times in three
        // is not reliable); the output names the passed runs per case.
        const repeat = parseRepeat(process.env.HAI_GOLDEN_REPEAT);
        const passedRuns: Record<string, number> = {};
        const startedAt = Date.now();
        let modelRuns = 0;
        let emptyReplies = 0;
        const emptyRetries = Math.max(
          0,
          Math.floor(Number(process.env.HAI_GOLDEN_EMPTY_RETRIES ?? 2)) || 0
        );
        for (const goldenCase of set.cases) {
          if (only.length > 0 && !only.includes(goldenCase.id)) continue;
          const runs: Array<{
            score: CaseScore;
            answer: string;
          }> = [];
          for (let run = 0; run < repeat; run += 1) {
            goldenState.reset();
            goldenState.access = accessFor(goldenCase);
            goldenState.model = async systemPrompt => {
              modelRuns += 1;
              const ask = () =>
                providers.chatWithFallback(
                  systemPrompt,
                  [],
                  goldenCase.question,
                  undefined,
                  { maxOutputTokens: 1024, temperature: 0 }
                );
              // An EMPTY reply is a failure of the server (a busy host answers
              // nothing for minutes), not an answer of the model: ask again,
              // up to HAI_GOLDEN_EMPTY_RETRIES times (default 2), and count them.
              // The provider does not return an empty text, it THROWS (kind
              // empty, turned into a ChatUnavailableError by the chain): that
              // case counts too (the old loop only looked at a returned text and
              // never ran, emptyRepliesAskedAgain stayed 0).
              const { reply, askedAgain, failure } =
                await askAgainOnServerFailure(
                  ask,
                  emptyRetries,
                  () => new Promise(resolve => setTimeout(resolve, 10_000))
                );
              emptyReplies += askedAgain;
              // what remains is handled like in the product: the pipeline turns
              // the error into an empty text with the key of the message
              if (failure) throw failure;
              return reply?.text ?? '';
            };
            const result = await processMessage(
              goldenCase.question,
              // HAI_GOLDEN_VOICE=yes measures the spoken way (voice assistant)
              contextFor(goldenCase, process.env.HAI_GOLDEN_VOICE === 'yes')
            );
            runs.push({
              score: scoreAnswer(goldenCase, result.response, canaries),
              answer: result.response,
            });
          }
          const score = mergeRuns(runs.map(r => r.score));
          scores.push(score);
          passedRuns[goldenCase.id] = score.passedRuns;
          // the answer of the first failing run, else of the first run
          const shown = runs.find(r => !r.score.pass) ?? runs[0];
          dump[goldenCase.id] = {
            question: goldenCase.question,
            expected: goldenCase.expected.behavior,
            pass: score.pass,
            issues: score.issues,
            answer: shown.answer,
            ...(repeat > 1
              ? {
                  passedRuns: score.passedRuns,
                  runs: runs.map(r => ({
                    pass: r.score.pass,
                    issues: r.score.issues,
                    answer: r.answer,
                  })),
                }
              : {}),
          };
        }
        const seconds = Math.round((Date.now() - startedAt) / 1000);
        if (process.env.HAI_GOLDEN_DUMP) {
          writeFileSync(
            process.env.HAI_GOLDEN_DUMP,
            JSON.stringify(dump, null, 2),
            'utf8'
          );
        }
        const summary = summarizeScores(scores);
        // numbers and case ids only, never an answer text
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        process.stdout.write(
          `${JSON.stringify(
            {
              repeat,
              // cases that did not pass in every run: the runs that passed
              passedRunsOfCasesNotAlwaysPassing: Object.fromEntries(
                Object.entries(passedRuns).filter(([, n]) => n < repeat)
              ),
              passedRuns,
              modelCalls: modelRuns,
              // empty replies of the server that were asked again
              emptyRepliesAskedAgain: emptyReplies,
              seconds,
              secondsPerModelCall:
                modelRuns > 0 ? Math.round((seconds / modelRuns) * 10) / 10 : 0,
            },
            null,
            2
          )}\n`
        );
        // a run of selected cases is a diagnosis, the thresholds are for the full set
        if (only.length === 0) expect(summary.violations).toEqual([]);
      },
      // 85 cases against a shared server take longer than 15 minutes when it is busy; after the
      // limit Jest tears the environment down and the cases that follow fail for that reason only
      Number(process.env.HAI_GOLDEN_TIMEOUT_MIN ?? 90) * 60 * 1000
    );
  }
);
