/**
 * @jest-environment node
 */
import {
  berlinDay,
  berlinHour,
  dayStartDue,
  dayStartMessage,
  isStopCommand,
  markDayStart,
  nextSpeechPieces,
  splitSentences,
  toSpeakableText,
  voiceSupport,
} from '@/lib/hai/voice/speech';

// Helpers of the voice assistant (WMCNL-2907): what is read aloud, in which pieces, the start
// of the day, the stop command, the support of the browser.

describe('toSpeakableText', () => {
  it('drops markup, links, source marks, code and emojis', () => {
    const text = [
      '## Heute',
      '- **Prüfung** am Freitag [1]',
      '- Abgabe zum *Use Case* (Quelle: Enabler 3)',
      'Mehr dazu unter https://example.test/seite und [hier](https://example.test).',
      '```sql',
      'select 1;',
      '```',
      'Viel Erfolg! 🦈',
    ].join('\n');
    const spoken = toSpeakableText(text);
    expect(spoken).toBe(
      'Heute Prüfung am Freitag Abgabe zum Use Case Mehr dazu unter und hier. Viel Erfolg!'
    );
    expect(spoken).not.toMatch(/[*#`\[\]|]|https?:/);
  });

  it('leaves snake_case words and plain numbers alone', () => {
    expect(
      toSpeakableText('Die Tabelle hai_embeddings hat 3072 Spalten.')
    ).toBe('Die Tabelle hai_embeddings hat 3072 Spalten.');
  });

  it('reads a table row as short pieces', () => {
    expect(toSpeakableText('| Fach | Note |\n|---|---|\n| SQL | 2 |')).toBe(
      'Fach, Note SQL, 2'
    );
  });
});

describe('splitSentences', () => {
  it('finds finished sentences and keeps the growing end as the rest', () => {
    const r = splitSentences(
      'Heute steht die Abgabe zum Use Case an. Danach kommt die Berufsschule am Nachmittag. Und dann'
    );
    expect(r.sentences).toEqual([
      'Heute steht die Abgabe zum Use Case an.',
      'Danach kommt die Berufsschule am Nachmittag.',
    ]);
    expect(r.rest).toBe('Und dann');
  });

  it('does not end a sentence at an abbreviation or after a number', () => {
    const r = splitSentences(
      'Die Prüfung ist z. B. am 3. Mai im Raum zwei. Danach folgt die Besprechung der Ergebnisse.'
    );
    expect(r.sentences[0]).toBe(
      'Die Prüfung ist z. B. am 3. Mai im Raum zwei.'
    );
    expect(r.sentences).toHaveLength(1);
  });

  it('never calls the end of the text a finished sentence (it may grow)', () => {
    expect(splitSentences('Das ist ein vollständiger Satz mit Punkt.')).toEqual(
      {
        sentences: [],
        rest: 'Das ist ein vollständiger Satz mit Punkt.',
      }
    );
  });

  it('joins very short pieces with the next one', () => {
    const r = splitSentences(
      'Ja. Die Abgabe ist am Freitag fällig und braucht noch einen Abschnitt. Weiter'
    );
    expect(r.sentences[0]).toBe(
      'Ja. Die Abgabe ist am Freitag fällig und braucht noch einen Abschnitt.'
    );
  });
});

describe('nextSpeechPieces', () => {
  const full =
    'Heute steht die Abgabe zum Use Case an. Danach kommt die Berufsschule am Nachmittag. Womit möchten Sie beginnen?';

  it('reads only finished sentences while the answer streams, each one once', () => {
    const streaming = full.slice(0, 95);
    const first = nextSpeechPieces(streaming, 0, false);
    expect(first).toEqual([
      'Heute steht die Abgabe zum Use Case an.',
      'Danach kommt die Berufsschule am Nachmittag.',
    ]);
    expect(nextSpeechPieces(streaming, first.length, false)).toEqual([]);
  });

  it('reads the rest when the answer is final', () => {
    expect(nextSpeechPieces(full, 2, true)).toEqual([
      'Womit möchten Sie beginnen?',
    ]);
  });

  it('reads a single sentence answer when it is final', () => {
    expect(
      nextSpeechPieces('Es steht heute nichts Besonderes an.', 0, true)
    ).toEqual(['Es steht heute nichts Besonderes an.']);
  });
});

describe('the start of the day', () => {
  it('greets by time of day and asks for the day at a glance', () => {
    expect(dayStartMessage(8)).toBe('Guten Morgen, was steht heute an?');
    expect(dayStartMessage(13)).toBe('Guten Tag, was steht heute an?');
    expect(dayStartMessage(19)).toBe('Guten Abend, was steht heute an?');
  });

  it('counts the day and the hour in Berlin, not in UTC', () => {
    // 23:30 UTC on 31 October is already 1 November, 00:30 in Berlin (winter time)
    const late = new Date('2026-10-31T23:30:00Z');
    expect(berlinDay(late)).toBe('2026-11-01');
    expect(berlinHour(late)).toBe(0);
  });

  it('is due once a day and person', () => {
    const store: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    };
    const monday = new Date('2026-11-02T07:00:00Z');
    expect(dayStartDue(storage, 'u1', monday)).toBe(true);
    markDayStart(storage, 'u1', monday);
    expect(dayStartDue(storage, 'u1', monday)).toBe(false);
    expect(dayStartDue(storage, 'u2', monday)).toBe(true);
    expect(dayStartDue(storage, 'u1', new Date('2026-11-03T07:00:00Z'))).toBe(
      true
    );
  });

  it('is due when the storage fails or is missing', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(dayStartDue(broken, 'u1', new Date())).toBe(true);
    expect(() => markDayStart(broken, 'u1', new Date())).not.toThrow();
    expect(dayStartDue(null, 'u1', new Date())).toBe(true);
  });
});

describe('isStopCommand', () => {
  it.each([
    'Stopp',
    'stopp!',
    'Sprachmodus beenden',
    'Gespräch beenden, bitte',
    'Danke, das war es.',
    'Tschüss',
  ])('ends the conversation: "%s"', utterance => {
    expect(isStopCommand(utterance)).toBe(true);
  });

  it.each([
    '',
    'Was bedeutet Stopp bei einem Netzplan?',
    'Wie beende ich eine Transaktion in SQL?',
    'Erkläre mir den Unterschied zwischen stop und halt in der Programmierung',
  ])('keeps a question going: "%s"', utterance => {
    expect(isStopCommand(utterance)).toBe(false);
  });
});

describe('voiceSupport', () => {
  it('reads what the browser offers', () => {
    expect(voiceSupport(null)).toEqual({
      recognition: false,
      synthesis: false,
    });
    expect(
      voiceSupport({
        webkitSpeechRecognition: function () {},
        speechSynthesis: {},
      } as never)
    ).toEqual({ recognition: true, synthesis: true });
    expect(voiceSupport({ speechSynthesis: {} } as never)).toEqual({
      recognition: false,
      synthesis: true,
    });
  });
});
