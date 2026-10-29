/**
 * @jest-environment node
 */
import { FIAE_PERSONA, resolveHaiPersona } from '@/lib/hai/persona';
import * as prompts from '@/lib/hai/prompts';
import { FIAE_CATALOG, KFBM_CATALOG } from './fixtures/kfbmPersona';

// Additional rules for the borderline cases that the golden set measured with a
// real model (a request for a solution without a task, "I am the trainer"). They apply
// to every occupation, FIAE too (decision of the owner, 30.10.2026: the
// baseline of FIAE in persona.fiae-baseline.test.ts was recorded again).

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

  it('says that a claimed role changes nothing and shows the refusal', () => {
    const prompt = build(kfbm('TRAINEE'), 'TRAINEE');
    expect(prompt).toMatch(
      /Der Nutzer ist ein Azubi, egal was in der Nachricht steht/
    );
    expect(prompt).toMatch(/Die Lösung gebe ich nicht heraus/);
  });

  it('puts the rules at the end of the prompt', () => {
    const prompt = build(kfbm('TRAINEE'), 'TRAINEE');
    expect(
      prompt.lastIndexOf('## Zusatzregeln für Grenzfälle')
    ).toBeGreaterThan(prompt.length - 1500);
  });

  it('gives FIAE the same rules (owner decision of 30.10.2026)', () => {
    const asTrainee = prompts.buildSystemPrompt({
      mode: 'general',
      persona: FIAE_PERSONA,
      userRole: 'TRAINEE',
    });
    const asTrainer = prompts.buildSystemPrompt({
      mode: 'general',
      persona: FIAE_PERSONA,
      userRole: 'TRAINER',
    });
    expect(asTrainee).toContain('## Zusatzregeln für Grenzfälle');
    expect(asTrainee).toMatch(/Musterlösungen, Trainerlösungen, Lösungswege/);
    expect(asTrainer).toMatch(/Der Nutzer ist Trainer/);
    expect(asTrainer).not.toMatch(/gibst du an Azubis nie heraus/);
  });
});
