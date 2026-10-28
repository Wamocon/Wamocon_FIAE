import { shortenText, splitSentences } from '@/lib/content-import/short-text';

// Invented texts only. Nothing here comes from an original document.
const TEXT =
  'Erfundene Firma Alpha liefert Bürostühle an Kunden in der Region. ' +
  'Der Vertrieb, z. B. über Fachhändler, läuft seit dem 14. November des Vorjahres. ' +
  'Nach Abs. 2 Nr. 5 der erfundenen Verordnung gilt eine Frist von 30 Tagen. ' +
  'Zum Schluss prüft die Leitung (d. h. Frau Beta) die Zahlen!';

describe('splitSentences', () => {
  it('splits at sentence ends and not at abbreviations, ordinals or numbered items', () => {
    expect(splitSentences(TEXT)).toEqual([
      'Erfundene Firma Alpha liefert Bürostühle an Kunden in der Region.',
      'Der Vertrieb, z. B. über Fachhändler, läuft seit dem 14. November des Vorjahres.',
      'Nach Abs. 2 Nr. 5 der erfundenen Verordnung gilt eine Frist von 30 Tagen.',
      'Zum Schluss prüft die Leitung (d. h. Frau Beta) die Zahlen!',
    ]);
  });

  it('splits after a closing quote and after a number at the end of a sentence', () => {
    expect(
      splitSentences(
        'Sie sagte „Das passt.“ Danach ging es im Jahr 2024. Alle blieben.'
      )
    ).toEqual([
      'Sie sagte „Das passt.“',
      'Danach ging es im Jahr 2024.',
      'Alle blieben.',
    ]);
  });

  it('returns an empty list for empty text and one sentence for text without an end', () => {
    expect(splitSentences('   ')).toEqual([]);
    expect(splitSentences('Nur ein Satz ohne Punkt')).toEqual([
      'Nur ein Satz ohne Punkt',
    ]);
  });
});

describe('shortenText', () => {
  it('returns a text that fits unchanged, with normalized white space', () => {
    expect(shortenText('Ein  kurzer\nSatz.', 100)).toBe('Ein kurzer Satz.');
  });

  it('keeps whole sentences up to the limit', () => {
    const out = shortenText(TEXT, 150);
    expect(out).toBe(
      'Erfundene Firma Alpha liefert Bürostühle an Kunden in der Region. ' +
        'Der Vertrieb, z. B. über Fachhändler, läuft seit dem 14. November des Vorjahres.'
    );
    expect(out.length).toBeLessThanOrEqual(150);
  });

  it('never cuts a word and never exceeds the limit, whatever the limit is', () => {
    const words = new Set(TEXT.split(/\s+/));
    for (let max = 20; max <= TEXT.length; max += 7) {
      const out = shortenText(TEXT, max);
      expect(out.length).toBeLessThanOrEqual(max);
      expect(out.length).toBeGreaterThan(0);
      const body = out.endsWith('…') ? out.slice(0, -1) : out;
      for (const word of body.split(/\s+/)) {
        expect(words.has(word)).toBe(true);
      }
    }
  });

  it('cuts a first sentence that is too long at a word and marks the cut', () => {
    const long =
      'Dieser erfundene Satz ist so lang, dass er allein schon das Limit sprengt und deshalb gekürzt werden muss.';
    const out = shortenText(long, 60);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(long.startsWith(out.slice(0, -1))).toBe(true);
    // the cut falls between two words
    expect(long.charAt(out.length - 1)).toBe(' ');
    // no comma or bracket is left dangling before the mark
    expect(out).not.toMatch(/[,;:(-]…$/);
  });

  it('is idempotent', () => {
    for (const max of [30, 60, 90, 150, 400]) {
      const once = shortenText(TEXT, max);
      expect(shortenText(once, max)).toBe(once);
    }
  });

  it('returns an empty string for empty input', () => {
    expect(shortenText('  \n ', 100)).toBe('');
  });
});

describe('shortenText: edge cases', () => {
  it('does not split after more German abbreviations', () => {
    expect(
      splitSentences(
        'Siehe Abb. 3 im Text. Nächster Satz folgt, vgl. Tab. 2 dort.'
      )
    ).toEqual([
      'Siehe Abb. 3 im Text.',
      'Nächster Satz folgt, vgl. Tab. 2 dort.',
    ]);
  });

  it('cuts a single word that is longer than the limit between characters, never in a surrogate pair', () => {
    const word = '😀'.repeat(40);
    const out = shortenText(word, 11);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(11);
    // no lone surrogate: the text survives a round trip through UTF-8
    expect(Buffer.from(out, 'utf8').toString('utf8')).toBe(out);
    expect(shortenText(out, 11)).toBe(out);
  });

  it('splits a very long text with many abbreviations in linear time', () => {
    const started = Date.now();
    splitSentences('B. A. '.repeat(15000));
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
