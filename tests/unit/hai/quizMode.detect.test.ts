/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import { detectQuizModeRequest } from '@/lib/hai/quizMode/detect';
import { quizModeStartFor } from '@/lib/hai/quizMode/start';

// Behavior under test: src/lib/hai/quizMode/detect.ts and start.ts. A request
// to be quizzed is recognized by patterns, never by the model. A question
// about the word, a pasted text or an ordinary question is no request.

const ENABLER = '20000000-0000-4000-8000-000000000001';

describe('detectQuizModeRequest: requests', () => {
  it.each([
    'Frag mich ab',
    'frag mich bitte ab',
    'Frag mich zu SQL ab',
    'Frage mich ab',
    'Fragst du mich zu Joins ab?',
    'Kannst du mich abfragen?',
    'Kannst du mich zu Netzwerken abfragen',
    'Ich möchte mich abfragen lassen',
    'Quiz mich',
    'Quiz mich zu diesem Enabler',
    'Quizze mich zu Primärschlüsseln',
    'Teste mich',
    'Teste mich zu SQL',
    'Prüf mich mal',
    'Hör mich ab',
    'Teste mein Wissen',
    'Starte ein Quiz',
    'Mach ein Quiz mit mir',
    'Lass uns ein Quiz machen',
    'Quiz-Modus starten',
    'Starte den Quiz-Modus',
    'Quiz-Modus',
    '/quiz SQL',
  ])('recognizes "%s"', message => {
    expect(detectQuizModeRequest(message)).not.toBeNull();
  });
});

describe('detectQuizModeRequest: no request', () => {
  it.each([
    'Was ist ein Quiz?',
    'Wie funktioniert der Quiz-Modus?',
    'Wie kann ich mich abfragen lassen?',
    'Wo finde ich die Quizfragen?',
    'Bring mich zum Quiz von Enabler 3',
    'Starte das Quiz von Enabler 3',
    'Mach das Quiz von Enabler 3 auf',
    'Öffne das Quiz vom Enabler SQL Grundlagen',
    'Was ist ein Primärschlüssel?',
    'Erkläre mir SQL Joins',
    'Hallo',
    'Ich habe morgen eine Prüfung',
    'Gib mir die Lösung zur Quizfrage',
    'Welche Antwort ist bei der Quizfrage richtig?',
    '',
    '   ',
  ])('does not take "%s" for one', message => {
    expect(detectQuizModeRequest(message)).toBeNull();
  });

  it('ignores a long text and a value that is no text', () => {
    expect(detectQuizModeRequest(`Frag mich ab ${'x'.repeat(300)}`)).toBeNull();
    expect(detectQuizModeRequest(undefined)).toBeNull();
    expect(detectQuizModeRequest(42)).toBeNull();
  });
});

describe('detectQuizModeRequest: topic and enabler', () => {
  it.each([
    ['Frag mich zu SQL ab', 'SQL'],
    ['Frag mich bitte zu Joins ab', 'Joins'],
    ['Quiz mich zu Primärschlüsseln', 'Primärschlüsseln'],
    ['Teste mich zum Thema Netzwerke', 'Netzwerke'],
    ['Frag mich zu der Normalisierung ab', 'Normalisierung'],
    ['Quiz mich über Datenbankdesign', 'Datenbankdesign'],
    ['/quiz SQL Grundlagen', 'SQL Grundlagen'],
    ['Frag mich zu SQL Grundlagen ab!', 'SQL Grundlagen'],
  ])('takes the topic of "%s"', (message, topic) => {
    expect(detectQuizModeRequest(message)).toEqual({
      topic,
      thisEnabler: false,
    });
  });

  it.each([
    'Frag mich ab',
    'Quiz mich',
    'Frag mich zu allem ab',
    'Teste mich gemischt',
  ])('has no topic in "%s"', message => {
    expect(detectQuizModeRequest(message)?.topic ?? null).toBeNull();
    expect(detectQuizModeRequest(message)?.thisEnabler).toBe(false);
  });

  it.each([
    'Quiz mich zu diesem Enabler',
    'Frag mich zu diesem Thema ab',
    'Teste mich zum aktuellen Kapitel',
  ])('means the open enabler in "%s"', message => {
    expect(detectQuizModeRequest(message)).toEqual({
      topic: null,
      thisEnabler: true,
    });
  });

  it('cuts the topic at the limit', () => {
    const request = detectQuizModeRequest(
      `Frag mich zu ${'abc '.repeat(25)}ab`
    );
    expect(request?.topic?.length).toBeLessThanOrEqual(80);
  });
});

describe('quizModeStartFor', () => {
  it('is null for an ordinary message', () => {
    expect(quizModeStartFor('Was ist ein JOIN?', {})).toBeNull();
  });

  it('starts for the open enabler without a topic, and names it', () => {
    const start = quizModeStartFor('Quiz mich', {
      currentEnablerId: ENABLER,
      enablerTitle: 'SQL Grundlagen',
    });
    expect(start?.quizMode).toEqual({ topic: null, enablerId: ENABLER });
    expect(start?.response).toContain('„SQL Grundlagen“');
    expect(start?.response).toContain('Übung ohne Wertung');
  });

  it('starts for the open enabler when the person says "diesen Enabler"', () => {
    const start = quizModeStartFor('Quiz mich zu diesem Enabler', {
      currentEnablerId: ENABLER,
    });
    expect(start?.quizMode).toEqual({ topic: null, enablerId: ENABLER });
    expect(start?.response).toContain('diesem Enabler');
  });

  it('prefers a named topic to the open enabler: mixed, narrowed by the topic', () => {
    const start = quizModeStartFor('Frag mich zu Netzwerken ab', {
      currentEnablerId: ENABLER,
      enablerTitle: 'SQL Grundlagen',
    });
    expect(start?.quizMode).toEqual({ topic: 'Netzwerken', enablerId: null });
    expect(start?.response).toContain('„Netzwerken“');
  });

  it('starts mixed outside an enabler', () => {
    const start = quizModeStartFor('Frag mich zu SQL ab', {});
    expect(start?.quizMode).toEqual({ topic: 'SQL', enablerId: null });
    const mixed = quizModeStartFor('Quiz mich', {});
    expect(mixed?.quizMode).toEqual({ topic: null, enablerId: null });
    expect(mixed?.response).toContain('gemischt');
  });

  it('never uses a dash as a mark in the text', () => {
    for (const message of ['Quiz mich', 'Frag mich zu SQL ab']) {
      const text = quizModeStartFor(message, {
        currentEnablerId: ENABLER,
        enablerTitle: 'X',
      })?.response as string;
      expect(text).not.toMatch(/[–—]| - /);
    }
  });
});
