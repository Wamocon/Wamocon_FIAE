/**
 * @jest-environment node
 */
import { FIAE_PERSONA } from '@/lib/hai/persona';
import * as prompts from '@/lib/hai/prompts';

// Day companion in the chat (typed or spoken): the section "Tageslage" is added
// only for a day question with live data, it names the rules of the answer and
// never changes the prompt of any other question.

const SECTION = '## Tageslage (Tagesbegleiter)';
const DATA = '**Fortschritt:** 3 von 4 Enablern abgeschlossen';

const base = {
  mode: 'general' as const,
  persona: FIAE_PERSONA,
  userRole: 'TRAINEE' as const,
};

describe('the day section of the system prompt', () => {
  it('leaves the prompt as it was without the flag', () => {
    const plain = prompts.buildSystemPrompt({ ...base, liveDataContext: DATA });
    const off = prompts.buildSystemPrompt({
      ...base,
      liveDataContext: DATA,
      dayBriefing: false,
    });
    expect(off).toBe(plain);
    expect(plain).not.toContain(SECTION);
  });

  it('comes after the data block and names the rules of the answer', () => {
    const prompt = prompts.buildSystemPrompt({
      ...base,
      liveDataContext: DATA,
      dayBriefing: true,
    });
    expect(prompt.indexOf(SECTION)).toBeGreaterThan(
      prompt.indexOf('## Aktuelle Plattform-Daten')
    );
    expect(prompt).toContain('höchstens drei Punkte');
    expect(prompt).toContain('Rückmeldung zu einer Abgabe');
    expect(prompt).toContain(
      'Fortschritt je Beruf, den gewählten Beruf zuerst'
    );
    expect(prompt).toContain('"Für heute sind keine Termine eingetragen"');
    expect(prompt).toContain('nie pauschal "keine Daten"');
    expect(prompt).toContain('zum Beispiel weiter lernen');
    expect(prompt).toContain('genau einer Frage');
    expect(prompt).toContain('Erfinde nichts');
    // the borderline rules keep the last word
    expect(
      prompt.lastIndexOf('## Zusatzregeln für Grenzfälle')
    ).toBeGreaterThan(prompt.indexOf(SECTION));
  });

  it('drops the hint "nothing found in the knowledge base" for a day question', () => {
    const day = prompts.buildSystemPrompt({
      ...base,
      liveDataContext: DATA,
      dayBriefing: true,
    });
    const other = prompts.buildSystemPrompt({ ...base, liveDataContext: DATA });
    expect(day).not.toContain('## Hinweis zur Wissensdatenbank');
    expect(other).toContain('## Hinweis zur Wissensdatenbank');
  });

  it('is not added when the data could not be loaded', () => {
    const prompt = prompts.buildSystemPrompt({ ...base, dayBriefing: true });
    expect(prompt).not.toContain(SECTION);
    expect(prompt).toContain('Es konnten KEINE Live-Daten');
  });

  it('speaks of reviews for a trainer and of progress for a trainee', () => {
    const trainer = prompts.buildDayBriefingRules('TRAINER');
    const trainee = prompts.buildDayBriefingRules('TRAINEE');
    expect(trainer).toContain('offene Bewertungen');
    expect(trainer).not.toContain('Fortschritt je Beruf');
    expect(trainee).toContain('Fortschritt je Beruf');
    expect(trainee).toContain('abgelehnter oder fehlender Ausbildungsnachweis');
  });

  it('does not tell a speaker to point to the platform for what the HAI knows', () => {
    const rules = prompts.buildVoiceRules('TRAINEE');
    expect(rules).toContain('benenne konkret und kurz, was fehlt');
    expect(rules).not.toContain('verweise auf die Plattform.');
  });
});
