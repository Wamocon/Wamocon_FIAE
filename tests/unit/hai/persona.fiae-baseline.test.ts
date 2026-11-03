/**
 * @jest-environment node
 */
import { createHash } from 'crypto';

// FIAE keeps today's texts byte for byte (package H3). fiae-baseline.json was
// recorded with the prompt builders and the classifier BEFORE the persona work
// (full text for the plain prompt of every mode, a SHA-256 for every other
// combination, the intent for every message). If an intended change of the
// FIAE texts is made, record the baseline again; otherwise this test is the
// proof that the persona refactoring changed nothing.
//
// Recorded again on 03.11.2026 (decision of the owner, Niko: the prompt may be
// changed for FIAE trainees too, solution protection stays STRICT). What
// changed in the prompt, and why (golden set measurement with sokrates-fast,
// docs/hai-golden-set.md section 5):
//  - The fixed refusal sentence about the field ("Ablehnung (IMMER so, NIEMALS
//    weicher)") is out of the prompt of a question that passed the gate. The model
//    copied it where the question was a subject question (Netflix server, hotel
//    for the business trip, a comparison of two model solutions). The pipeline
//    sends that refusal text itself. In its place: "Diese Frage wurde bereits als
//    fachlich geprueft", an everyday word does not make a subject question off
//    topic. The borders of the occupation stay (a question of another occupation
//    gets "gehoert nicht zu deiner Ausbildung"), the golden set checks that.
//  - New section "Rolle der Person" right after the core: the role comes from
//    the server and is never asked for (the model asked "Trainer oder Azubi?").
//  - New section "Was geschuetzt ist und was nicht": solutions are protected,
//    scenarios, tasks, theory and examples are not; a request without a clear
//    reference gets a short question with a suggestion.
//  - The sentence on the claimed role ends with "du fragst nie danach".
// The strict rules for trainees ("Zusatzregeln fuer Grenzfaelle") are the same.

jest.mock('@/lib/hai/providers', () => ({
  chatWithFallback: jest.fn(),
  getChatProvider: () => ({ isInitialized: () => true }),
  getEmbeddingProvider: () => ({ isInitialized: () => false }),
}));
jest.mock('@/lib/hai/retrievalAccess', () => ({
  resolveRetrievalAccess: jest.fn(),
}));
jest.mock('@/lib/hai/personaAccess', () => ({ loadHaiPersona: jest.fn() }));
jest.mock('@/lib/hai/vectorSearch', () => ({ searchWithContext: jest.fn() }));
jest.mock('@/lib/hai/pageIndexService', () => ({
  fetchPageIndexContext: jest.fn(),
}));
jest.mock('@/lib/hai/dataContext', () => ({ fetchDataContext: jest.fn() }));
jest.mock('@/lib/hai/actions', () => ({
  detectActionIntent: jest.fn(),
  executeAction: jest.fn(),
}));

import * as prompts from '@/lib/hai/prompts';
import { classifyIntent } from '@/lib/hai/ragPipeline';
import { FIAE_PERSONA, resolveHaiPersona } from '@/lib/hai/persona';
import baseline from './fixtures/fiae-baseline.json';
import {
  CLASSIFIER_MESSAGES,
  QUIZ_STATES,
  promptCases,
} from './fixtures/fiaeMatrix';

const sha = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('hex');

const fiaeCatalog = {
  id: '00000000-0000-4000-8000-000000000001',
  code: 'FIAE',
  title: 'Fachinformatiker Anwendungsentwicklung',
  settings: {},
};

describe('FIAE texts stay byte-identical', () => {
  const withPersona = (persona: typeof FIAE_PERSONA) =>
    promptCases().map(({ name, ctx }) => ({
      name,
      text: prompts.buildSystemPrompt({ ...ctx, persona }),
    }));

  it.each([
    ['without a persona (default)', undefined],
    ['with the FIAE persona', FIAE_PERSONA],
    [
      'resolved for a FIAE trainee',
      resolveHaiPersona({ catalogs: [fiaeCatalog], role: 'TRAINEE' }),
    ],
    [
      'resolved for a FIAE trainer',
      resolveHaiPersona({ catalogs: [fiaeCatalog], role: 'TRAINER' }),
    ],
  ])('every system prompt matches the baseline %s', (_label, persona) => {
    const results = persona
      ? withPersona(persona as typeof FIAE_PERSONA)
      : promptCases().map(({ name, ctx }) => ({
          name,
          text: prompts.buildSystemPrompt(ctx),
        }));
    expect(results.length).toBe(Object.keys(baseline.hashes).length);
    for (const { name, text } of results) {
      if (name.endsWith('/plain')) {
        expect(text).toBe((baseline.full as Record<string, string>)[name]);
      }
      expect(sha(text)).toBe((baseline.hashes as Record<string, string>)[name]);
    }
  });

  it('keeps greeting, refusal, error, quiz and code prompts', () => {
    expect(prompts.getGreetingPrompt()).toBe(baseline.greeting);
    expect(prompts.getGreetingPrompt(FIAE_PERSONA)).toBe(baseline.greeting);
    expect(prompts.getOffTopicResponse()).toBe(baseline.offTopic);
    expect(prompts.getOffTopicResponse(FIAE_PERSONA)).toBe(baseline.offTopic);
    expect(prompts.getTechnicalErrorMessage()).toBe(baseline.technicalError);
    expect(prompts.getQuizGenerationPrompt('SQL', 'easy')).toBe(
      baseline.quizEasy
    );
    expect(prompts.getQuizGenerationPrompt('SQL', 'medium', 3)).toBe(
      baseline.quizMedium
    );
    expect(prompts.getQuizGenerationPrompt('SQL', 'hard')).toBe(
      baseline.quizHard
    );
    expect(
      prompts.getQuizGenerationPrompt('SQL', 'hard', 5, FIAE_PERSONA)
    ).toBe(baseline.quizHard);
    expect(prompts.getCodeExplanationPrompt('TypeScript')).toBe(baseline.code);
  });

  it('keeps the intent of every message', () => {
    const resolved = resolveHaiPersona({
      catalogs: [fiaeCatalog],
      role: 'TRAINEE',
    });
    CLASSIFIER_MESSAGES.forEach((message, i) => {
      QUIZ_STATES.forEach((quizState, j) => {
        const expected = (baseline.classifier as Record<string, string>)[
          `${i}|${j}`
        ];
        expect(classifyIntent(message, quizState)).toBe(expected);
        expect(classifyIntent(message, quizState, resolved)).toBe(expected);
      });
    });
  });

  it('ignores settings.hai for FIAE, like the branding', () => {
    const persona = resolveHaiPersona({
      catalogs: [
        {
          ...fiaeCatalog,
          settings: {
            hai: {
              occupation_name: 'Etwas anderes',
              refusal_text: 'Nein danke',
              code_help: false,
            },
          },
        },
      ],
      role: 'TRAINEE',
    });
    expect(persona.refusalText).toBe(FIAE_PERSONA.refusalText);
    expect(persona.codeHelp).toBe(true);
    expect(persona.source).toBe('fiae-default');
  });
});
