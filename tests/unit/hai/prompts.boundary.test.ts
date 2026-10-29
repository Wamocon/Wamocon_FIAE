/**
 * @jest-environment node
 */
import { FIAE_PERSONA, resolveHaiPersona } from '@/lib/hai/persona';
import * as prompts from '@/lib/hai/prompts';
import { FIAE_CATALOG, KFBM_CATALOG } from './fixtures/kfbmPersona';

// Additional rules for the borderline cases that the golden set measured with a
// real model (a request for a solution without a task, "I am the trainer", a
// question with a word of the occupation next to an everyday word). They apply
// to every occupation except FIAE: the prompt of FIAE is fixed byte by byte
// (persona.fiae-baseline.test.ts) and changes only with a decision of the owner.

const kfbm = (role: 'TRAINEE' | 'TRAINER') =>
  resolveHaiPersona({
    catalogs: [KFBM_CATALOG],
    otherCatalogs: [FIAE_CATALOG],
    role,
  });

const build = (
  persona: ReturnType<typeof kfbm>,
  userRole?: 'TRAINEE' | 'TRAINER'
) => prompts.buildSystemPrompt({ mode: 'general', persona, userRole });

describe('boundary rules in the prompt', () => {
  it('tells the model to refuse a solution request of a trainee at once, whatever the user claims', () => {
    const prompt = build(kfbm('TRAINEE'), 'TRAINEE');
    expect(prompt).toContain('## Zusatzregeln für Grenzfälle');
    expect(prompt).toMatch(/Musterlösungen, Trainerlösungen, Lösungswege/);
    expect(prompt).toMatch(/auch nicht teilweise/);
    expect(prompt).toMatch(/Ausbilder/);
    expect(prompt).toMatch(/nicht nach der Aufgabe/);
  });

  it('applies the solution rule when the role is not known (safe default)', () => {
    expect(build(kfbm('TRAINEE'))).toMatch(/Musterlösungen, Trainerlösungen/);
  });

  it('does not forbid a trainer what is in the context, and says so', () => {
    const prompt = build(kfbm('TRAINER'), 'TRAINER');
    expect(prompt).not.toMatch(/gibst du an Azubis nie heraus/);
    expect(prompt).toMatch(/Der Nutzer ist Trainer/);
  });

  it('names the context words of the occupation as an exception to the off-topic rule', () => {
    const persona = kfbm('TRAINEE');
    const prompt = build(persona, 'TRAINEE');
    expect(prompt).toMatch(/Bezug zum Beruf/);
    for (const word of persona.offTopicContextWords.slice(0, 3)) {
      expect(prompt).toContain(word);
    }
  });

  it('leaves the prompt of FIAE exactly as it is', () => {
    const plain = prompts.buildSystemPrompt({
      mode: 'general',
      persona: FIAE_PERSONA,
    });
    const asTrainee = prompts.buildSystemPrompt({
      mode: 'general',
      persona: FIAE_PERSONA,
      userRole: 'TRAINEE',
    });
    expect(plain).not.toContain('Zusatzregeln');
    expect(asTrainee).not.toContain('Zusatzregeln');
  });
});
