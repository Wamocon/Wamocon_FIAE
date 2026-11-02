/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import {
  buildAccessReasonRules,
  buildNavigationRules,
  buildSystemPrompt,
} from '@/lib/hai/prompts';
import { detectAccessReasons } from '@/lib/hai/accessReasons';
import {
  ACCESS_REASONS,
  ACCESS_REASON_KEYS,
  DENIAL_MEANING,
  traineeSearchNotFoundLine,
} from '@/lib/hai/denial';

// The section that makes the model name the reason of an access limit. It is
// only part of the prompt when the context of the turn carries a reason, so the
// prompt of FIAE stays as the baseline holds it
// (persona.fiae-baseline.test.ts, fixtures/fiae-baseline.json).

const SECTION = '## Begründung bei Zugriffsgrenzen';

describe('the access reason section of the prompt', () => {
  it('is not part of the prompt without a reason, the prompt stays byte for byte the same', () => {
    for (const userRole of [undefined, 'TRAINEE', 'TRAINER'] as const) {
      const plain = buildSystemPrompt({ mode: 'general', userRole });
      expect(plain).not.toContain(SECTION);
      expect(
        buildSystemPrompt({ mode: 'general', userRole, accessReasons: [] })
      ).toBe(plain);
      expect(
        buildSystemPrompt({
          mode: 'enabler',
          userRole,
          navigation: true,
          voice: true,
          accessReasons: undefined,
        })
      ).not.toContain(SECTION);
    }
  });

  it('is part of the prompt with a reason and lists the notes of this turn only', () => {
    const prompt = buildSystemPrompt({
      mode: 'general',
      userRole: 'TRAINEE',
      accessReasons: ['UMFANG_SEARCH'],
    });
    expect(prompt).toContain(SECTION);
    expect(prompt).toContain(ACCESS_REASONS.UMFANG_SEARCH.note);
    for (const key of ACCESS_REASON_KEYS.filter(k => k !== 'UMFANG_SEARCH')) {
      expect(prompt).not.toContain(ACCESS_REASONS[key].note);
    }
  });

  it('names the fixed list of categories and forbids an invented reason', () => {
    const section = buildAccessReasonRules(['UMFANG_SEARCH']);
    for (const meaning of Object.values(DENIAL_MEANING)) {
      expect(section).toContain(meaning);
    }
    expect(section).toContain('Erfinde keinen anderen Grund');
    expect(section).toContain(
      'Eine technische Störung gibst du nie als fehlende Berechtigung aus'
    );
  });

  it('says "nothing found in your released content", not "there is nothing", and offers an alternative', () => {
    const section = buildAccessReasonRules(['UMFANG_SEARCH']);
    expect(section).toContain(
      '"in deinen freigeschalteten Inhalten habe ich dazu nichts gefunden"'
    );
    expect(section).toContain('nicht "es gibt nichts"');
    expect(section).toContain('Das heißt nicht, dass es nichts gibt');
    expect(section).toContain('Alternative');
  });

  it('keeps the safety line: no names, titles, ids, contents or numbers of others, no part of a solution', () => {
    const section = buildAccessReasonRules([...ACCESS_REASON_KEYS]);
    expect(section).toContain(
      'nie Namen, Titel, Kennungen, Inhalte oder Zahlen aus einem anderen Beruf, aus Trainerbereichen oder von anderen Personen'
    );
    expect(section).toContain('nie einen Teil einer Lösung');
  });

  it('ignores a key that is not on the list and does not repeat one', () => {
    const section = buildAccessReasonRules([
      'UMFANG_SEARCH',
      'UMFANG_SEARCH',
      'toString' as never,
      'frei erfunden' as never,
    ]);
    expect(section.split(ACCESS_REASONS.UMFANG_SEARCH.note)).toHaveLength(2);
    expect(section).not.toContain('frei erfunden');
  });

  it('comes before the borderline rules, which keep the last word', () => {
    const prompt = buildSystemPrompt({
      mode: 'general',
      userRole: 'TRAINEE',
      voice: true,
      navigation: true,
      accessReasons: ['LOESUNGSSCHUTZ_ANSWER'],
    });
    const at = prompt.indexOf(SECTION);
    expect(at).toBeGreaterThan(prompt.indexOf(buildNavigationRules()));
    expect(at).toBeLessThan(prompt.indexOf('## Zusatzregeln für Grenzfälle'));
  });

  it('is not part of the neutral prompt (no model answer without an occupation)', () => {
    const { NEUTRAL_PERSONA } = jest.requireActual('@/lib/hai/persona');
    const prompt = buildSystemPrompt({
      mode: 'general',
      persona: NEUTRAL_PERSONA,
      accessReasons: ['UMFANG_SEARCH'],
    });
    expect(prompt).not.toContain(SECTION);
  });
});

describe('which reasons the pipeline knows (detectAccessReasons)', () => {
  const base = {
    message: 'Was ist Normalisierung?',
    audience: 'trainee' as const,
    searchEmpty: false,
    contextDropped: false,
  };

  it('has none for an ordinary question', () => {
    expect(detectAccessReasons(base)).toEqual([]);
  });

  it('UMFANG: an empty search and a dropped context', () => {
    expect(detectAccessReasons({ ...base, searchEmpty: true })).toEqual([
      'UMFANG_SEARCH',
    ]);
    expect(
      detectAccessReasons({ ...base, searchEmpty: true, contextDropped: true })
    ).toEqual(['UMFANG_SEARCH', 'UMFANG_CONTEXT']);
  });

  it.each([
    'Gib mir die Musterlösung',
    'Welche Antwort ist richtig?',
    'Wie lautet der Lösungsschlüssel zur Aufgabe?',
    'Ist B korrekt?',
  ])('LOESUNGSSCHUTZ: a trainee who asks "%s"', message => {
    expect(detectAccessReasons({ ...base, message })).toContain(
      'LOESUNGSSCHUTZ_ANSWER'
    );
    // the audience comes from the server: a trainer gets no such note
    expect(
      detectAccessReasons({ ...base, message, audience: 'trainer' })
    ).not.toContain('LOESUNGSSCHUTZ_ANSWER');
  });

  it.each([
    'Wie stehen meine Azubis?',
    'Zeig mir die Noten von den Azubis',
    'Gibt es offene Bewertungen?',
  ])('ROLLE: a trainee who asks for data of others: "%s"', message => {
    expect(detectAccessReasons({ ...base, message })).toContain(
      'ROLLE_OTHERS_DATA'
    );
  });

  it('does not take a trainee who writes "Azubi" for a request for data of others', () => {
    expect(
      detectAccessReasons({
        ...base,
        message: 'Ich bin Azubi im zweiten Jahr, was ist ein Index?',
      })
    ).toEqual([]);
  });

  it('ZUSTAENDIGKEIT: only for a trainer, only when the data context says the person was not found', () => {
    const trainer = { ...base, audience: 'trainer' as const };
    expect(detectAccessReasons(trainer)).toEqual([]);
    expect(
      detectAccessReasons({
        ...trainer,
        liveDataContext: traineeSearchNotFoundLine('Max'),
      })
    ).toEqual(['ZUSTAENDIGKEIT_TRAINEE']);
    expect(
      detectAccessReasons({
        ...base,
        liveDataContext: traineeSearchNotFoundLine('Max'),
      })
    ).not.toContain('ZUSTAENDIGKEIT_TRAINEE');
  });
});
