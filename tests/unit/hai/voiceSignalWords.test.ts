import { describe, it, expect } from '@jest/globals';
import {
  SIGNAL_WORDS,
  classifySignal,
  foldText,
  haltAtStart,
  speechWords,
} from '@/lib/hai/voice/signalWords';
import { isStopCommand } from '@/lib/hai/voice/speech';

// The signal words of the voice mode: halt words at the START of an utterance (also on
// the provisional text), end and microphone-off commands as whole short utterances, and
// nothing in the middle of a sentence. The word lists live in one file.

describe('foldText', () => {
  it('folds case, umlauts, sharp s, accents and punctuation', () => {
    expect(foldText('Hör auf!')).toBe('hoer auf');
    expect(foldText('HÖR AUF.')).toBe('hoer auf');
    expect(foldText('hoer   auf')).toBe('hoer auf');
    expect(foldText('Tschüss, bis später!')).toBe('tschuess bis spaeter');
    expect(foldText('Straße')).toBe('strasse');
    expect(foldText('Café…')).toBe('cafe');
    expect(foldText('  ...  ')).toBe('');
  });
});

describe('halt words at the start', () => {
  // the nine words of the order, in spelling variants (case, punctuation, umlauts)
  it.each([
    'Stopp',
    'stopp!',
    'STOPP.',
    'Stop',
    'stop,',
    'Halt',
    'Halt!',
    'halt stopp doch',
    'Warte',
    'warte mal',
    'Warte, ich muss kurz nachdenken',
    'Moment',
    'Moment mal',
    'moment bitte',
    'Ruhe',
    'Ruhe bitte!',
    'Hör auf',
    'hör auf!',
    'Hoer auf',
    'HÖR AUF',
    'Hör bitte auf',
    'Abbrechen',
    'abbrechen!',
    'Pause',
    'Pause bitte.',
    'Stopp, stopp, stopp',
    'Moment mal, was ist ein Fremdschlüssel?',
  ])('stops at the start: "%s"', text => {
    expect(haltAtStart(text)).not.toBeNull();
  });

  it.each([
    // a halt word in the middle of a sentence, or only a similar word
    'das war nicht der Stopp',
    'wir halten das fest',
    'Halte durch',
    'Haltestelle am Bahnhof',
    'Stoppuhr starten',
    'Ich brauche eine Pause von der Arbeit',
    'Was bedeutet Stopp bei einem Netzplan?',
    'Kannst du kurz warten?',
    'Das ist ein wichtiger Moment',
    'Einen Moment bitte',
    'Er hat die Ruhe weg',
    'Wie funktioniert ein Abbruch der Transaktion?',
    'Erkläre mir den Unterschied zwischen stop und halt',
    'Was ist ein Primärschlüssel?',
    '',
    '   ',
    '...',
  ])('does not stop: "%s"', text => {
    expect(haltAtStart(text)).toBeNull();
  });

  it('works on a provisional text that is still growing (the first words are enough)', () => {
    expect(haltAtStart('Stopp')).toEqual({ kind: 'halt', pure: true });
    expect(haltAtStart('Moment mal ich wollte')).toEqual({
      kind: 'halt',
      pure: false,
    });
    expect(haltAtStart('Hör')).toBeNull();
    expect(haltAtStart('Hör auf')).toEqual({ kind: 'halt', pure: true });
  });

  it('says whether the whole utterance is just the command or a question follows', () => {
    expect(haltAtStart('Stopp')?.pure).toBe(true);
    expect(haltAtStart('Moment mal')?.pure).toBe(true);
    expect(haltAtStart('Warte einen Moment bitte')?.pure).toBe(true);
    expect(haltAtStart('halt stopp doch')?.pure).toBe(true);
    expect(haltAtStart('Stopp, erkläre mir den JOIN')?.pure).toBe(false);
    expect(haltAtStart('Moment mal, was ist ein Fremdschlüssel?')?.pure).toBe(
      false
    );
  });
});

describe('classifySignal: finished utterances', () => {
  it.each([
    'Gespräch beenden',
    'gespraech beenden',
    'Gespräch beenden, bitte',
    'Sprachmodus beenden',
    'Beenden',
    'beenden!',
    'Tschüss',
    'tschüss!',
    'Tschuess',
    'Tschüs',
    'Auf Wiedersehen',
    'auf wiedersehen, hai',
    'Danke, das war es.',
    "Das war's",
    'Ok, das war alles',
  ])('ends the conversation: "%s"', text => {
    expect(classifySignal(text)).toEqual({ kind: 'end', pure: true });
  });

  it.each([
    'Beenden wir das Kapitel?',
    'Wie beende ich eine Transaktion in SQL?',
    'Ich möchte das Gespräch mit dem Ausbilder beenden',
    'Tschüss sagt man zum Abschied',
    'Das war nicht das Ende',
    'Auf Wiedersehen und bis morgen in der Schule',
  ])('is no end command: "%s"', text => {
    expect(classifySignal(text)?.kind).not.toBe('end');
  });

  it.each(['Mikrofon aus', 'Mikrofon ausschalten', 'mikrofon aus, bitte'])(
    'switches the microphone off: "%s"',
    text => {
      expect(classifySignal(text)).toEqual({ kind: 'micOff', pure: true });
    }
  );

  it.each([
    'Das Mikrofon ist aus',
    'Schalte das Mikrofon im Konferenzraum aus',
    'Mikrofon aus der Kiste holen und anschließen',
  ])('is no microphone command: "%s"', text => {
    expect(classifySignal(text)?.kind).not.toBe('micOff');
  });

  it('a halt word is a halt, an ordinary sentence is nothing', () => {
    expect(classifySignal('Stopp')).toEqual({ kind: 'halt', pure: true });
    expect(classifySignal('Hör auf!')).toEqual({ kind: 'halt', pure: true });
    expect(classifySignal('Was ist ein Primärschlüssel?')).toBeNull();
    expect(classifySignal('')).toBeNull();
    // a long utterance that only begins with a halt word is a question, not a command
    expect(
      classifySignal(
        'Stopp erkläre mir bitte noch einmal ganz genau den Unterschied zwischen den Schlüsseln'
      )
    ).toBeNull();
  });

  it('the old stop command keeps working through isStopCommand, and Stopp no longer ends', () => {
    expect(isStopCommand('Tschüss')).toBe(true);
    expect(isStopCommand('Gespräch beenden')).toBe(true);
    expect(isStopCommand('Stopp')).toBe(false);
  });
});

describe('the word lists', () => {
  it('are in one place, German first, and extendable', () => {
    expect(Object.keys(SIGNAL_WORDS)[0]).toBe('de');
    expect(SIGNAL_WORDS.de.halt).toEqual(
      expect.arrayContaining([
        'Stopp',
        'Stop',
        'Halt',
        'Warte',
        'Moment',
        'Ruhe',
        'Hör auf',
        'Abbrechen',
        'Pause',
      ])
    );
    expect(SIGNAL_WORDS.de.end).toEqual(
      expect.arrayContaining([
        'Gespräch beenden',
        'Beenden',
        'Tschüss',
        'Auf Wiedersehen',
      ])
    );
    expect(SIGNAL_WORDS.de.micOff).toContain('Mikrofon aus');
  });

  it('the English list works when it is asked for, German alone does not know it', () => {
    expect(haltAtStart('wait', ['de'])).toBeNull();
    expect(haltAtStart('wait', ['en'])).toEqual({ kind: 'halt', pure: true });
    expect(classifySignal('Goodbye', ['en'])?.kind).toBe('end');
    expect(classifySignal('Goodbye', ['de'])).toBeNull();
    // both together
    expect(classifySignal('Stopp', ['de', 'en'])?.kind).toBe('halt');
    expect(classifySignal('Mute', ['de', 'en'])?.kind).toBe('micOff');
  });
});

describe('speechWords', () => {
  it('keeps words of at least two letters or digits', () => {
    expect(speechWords('Ja, a 12 ... b')).toEqual(['ja', '12']);
    expect(speechWords(' . ')).toEqual([]);
  });
});
