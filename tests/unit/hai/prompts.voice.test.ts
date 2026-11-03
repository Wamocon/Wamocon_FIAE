/**
 * @jest-environment node
 */
import { FIAE_PERSONA, resolveHaiPersona } from '@/lib/hai/persona';
import * as prompts from '@/lib/hai/prompts';
import { FIAE_CATALOG, KFBM_CATALOG } from './fixtures/kfbmPersona';

// Voice assistant and day companion (WMCNL-2907): the section is added only when
// the question was spoken, it comes before the borderline rules (they keep the last
// word), and it changes the way of speaking, not the content rules.

const kfbm = (role: 'TRAINEE' | 'TRAINER') =>
  resolveHaiPersona({
    catalogs: [KFBM_CATALOG],
    otherCatalogs: [FIAE_CATALOG],
    role,
  });

describe('the voice section of the system prompt', () => {
  it('is not there without the switch: the prompt stays as it was', () => {
    for (const persona of [FIAE_PERSONA, kfbm('TRAINEE')]) {
      const plain = prompts.buildSystemPrompt({
        mode: 'general',
        persona,
        userRole: 'TRAINEE',
      });
      const off = prompts.buildSystemPrompt({
        mode: 'general',
        persona,
        userRole: 'TRAINEE',
        voice: false,
      });
      expect(off).toBe(plain);
      expect(plain).not.toContain('Sprachassistent (Tagesbegleiter)');
    }
  });

  it('is the only difference when the question was spoken', () => {
    const base = {
      mode: 'general' as const,
      persona: FIAE_PERSONA,
      userRole: 'TRAINEE' as const,
    };
    const plain = prompts.buildSystemPrompt(base);
    const spoken = prompts.buildSystemPrompt({ ...base, voice: true });
    expect(spoken).toContain(prompts.buildVoiceRules('TRAINEE'));
    // the parts of the prompt are joined by a blank line
    expect(
      spoken.replace(`${prompts.buildVoiceRules('TRAINEE')}\n\n`, '')
    ).toBe(plain);
  });

  it('asks for short, markup-free answers with at most one question', () => {
    const rules = prompts.buildVoiceRules('TRAINEE');
    expect(rules).toMatch(/höchstens vier Sätze/);
    expect(rules).toMatch(/Kein Markdown/);
    expect(rules).toMatch(/Emojis, Links/);
    expect(rules).toMatch(/Code liest du nicht vor/);
    expect(rules).toMatch(/Höchstens eine Frage je Antwort/);
  });

  it('asks for a short first sentence that answers the question (the voice starts with it)', () => {
    const rules = prompts.buildVoiceRules('TRAINEE');
    expect(rules).toMatch(/Der erste Satz hat höchstens zwölf Wörter/);
    expect(rules).toMatch(/beantwortet die Frage in der Sache/);
    expect(rules).toMatch(/ohne Vorspann/);
    // the rule is for the voice only: the prompt of a typed question has none
    const typed = prompts.buildSystemPrompt({
      mode: 'general',
      persona: FIAE_PERSONA,
      userRole: 'TRAINEE',
    });
    expect(typed).not.toMatch(/höchstens zwölf Wörter/);
  });

  it('describes the day companion: at most three points, one question, no invented dates', () => {
    const rules = prompts.buildVoiceRules('TRAINEE');
    expect(rules).toMatch(/Tagesbegleiter/);
    expect(rules).toMatch(/höchstens drei Punkte/);
    expect(rules).toMatch(/genau einer Frage/);
    expect(rules).toMatch(/Aktuelle Plattform-Daten/);
    expect(rules).toMatch(/Erfinde keine Termine, Fristen oder Noten/);
  });

  it('keeps the limits of the learning techniques: no voice or mood analysis, no diagnoses', () => {
    expect(prompts.buildVoiceRules('TRAINEE')).toMatch(
      /Keine Einschätzung von Stimme, Tonfall oder Stimmung/
    );
  });

  it.each(['TRAINEE', 'TRAINER'] as const)(
    'comes before the borderline rules, which keep the last word (%s)',
    role => {
      const prompt = prompts.buildSystemPrompt({
        mode: 'general',
        persona: kfbm(role),
        userRole: role,
        voice: true,
      });
      const voiceAt = prompt.indexOf('## Sprachassistent (Tagesbegleiter)');
      const rulesAt = prompt.lastIndexOf('## Zusatzregeln für Grenzfälle');
      expect(voiceAt).toBeGreaterThan(-1);
      expect(rulesAt).toBeGreaterThan(voiceAt);
      expect(prompt).toContain(prompts.buildVoiceRules(role));
    }
  );

  it('tells a trainer that spoken solutions are allowed and a trainee that they stay forbidden', () => {
    const trainer = prompts.buildVoiceRules('TRAINER');
    expect(trainer).toMatch(/Der Nutzer ist Trainer/);
    expect(trainer).toMatch(/Lehne das nicht ab/);
    expect(trainer).not.toMatch(/Sprechen macht nichts lockerer/);
    for (const role of ['TRAINEE', undefined] as const) {
      const other = prompts.buildVoiceRules(role);
      expect(other).toMatch(/Sprechen macht nichts lockerer/);
      expect(other).not.toMatch(/Der Nutzer ist Trainer/);
    }
  });
});
