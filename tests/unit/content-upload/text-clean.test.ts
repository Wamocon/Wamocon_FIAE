/**
 * @jest-environment node
 */
// The cleaning that comes first, before any check of an excerpt: if the marker
// of a solution can be hidden by an invisible character or a look-alike letter,
// every later check is worth nothing.
import { describe, expect, it } from '@jest/globals';

import {
  foldConfusables,
  sanitizeExcerptText,
} from '@/lib/content-upload/text-clean';

describe('sanitizeExcerptText', () => {
  it('normalizes to NFKC: ligatures, full width letters, composed umlauts', () => {
    expect(sanitizeExcerptText('ﬁnden')).toBe('finden');
    expect(sanitizeExcerptText('Ｒｉｃｈｔｉｇｅ Ａｎｔｗｏｒｔ')).toBe(
      'Richtige Antwort'
    );
    expect(sanitizeExcerptText('Lo\u0308sung')).toBe('Lösung');
    expect(sanitizeExcerptText('①②')).toBe('12');
  });

  it('removes zero width characters, soft hyphens, bidi marks and format characters', () => {
    expect(sanitizeExcerptText('Rich\u200btige\u200c Ant\u2060wort')).toBe(
      'Richtige Antwort'
    );
    expect(sanitizeExcerptText('Kurz\u00adbegründung')).toBe('Kurzbegründung');
    expect(sanitizeExcerptText('a\u202eb\u202cc\u2066d\u2069e')).toBe('abcde');
    expect(sanitizeExcerptText('a\ufeffb\u061cc\u180ed')).toBe('abcd');
    expect(sanitizeExcerptText('a\u2064b\u206fc')).toBe('abc');
    expect(sanitizeExcerptText('a\ufe0fb\ufe00c')).toBe('abc');
    expect(sanitizeExcerptText('a\u{e0041}\u{e007f}b')).toBe('ab');
  });

  it('removes the characters that are ignorable by default and marks that no letter takes', () => {
    for (const mark of [
      '\u{34f}',
      '\u{3164}',
      '\u{ffa0}',
      '\u{2800}',
      '\u{e0100}',
      '\u{17b4}',
      '\u{180b}',
      '\u{301}',
      '\u{36f}',
    ]) {
      expect(sanitizeExcerptText(`Rich${mark}tige Antwort`)).toBe(
        'Richtige Antwort'
      );
    }
    // a mark that a letter takes is composed, not removed
    expect(sanitizeExcerptText('Lo\u{308}sung')).toBe('Lösung');
  });

  it('removes control characters but keeps tab and line breaks', () => {
    expect(sanitizeExcerptText('a\u0000b\u0007c\u001fd\u007fe\u0085f')).toBe(
      'abcdef'.replace('f', '\nf')
    );
    expect(sanitizeExcerptText('a\tb\nc')).toBe('a\tb\nc');
  });

  it('unifies line breaks and drops heading markers like sanitizePromptData', () => {
    expect(sanitizeExcerptText('# A\r\n## B\rC')).toBe('A\nB\nC');
    expect(sanitizeExcerptText('  ### eingerückt')).toBe('  eingerückt');
  });

  it('is idempotent', () => {
    for (const sample of [
      'Rich\u200btige Ａntwort',
      '# x\r\n\u202ey',
      'Lo\u0308sung ﬁ ①',
      '',
      'schon sauber',
      'a\u0000\u0085b',
    ]) {
      const once = sanitizeExcerptText(sample);
      expect(sanitizeExcerptText(once)).toBe(once);
    }
  });

  it('keeps ordinary text, umlauts, sharp s and punctuation', () => {
    const text = 'Größe, Öl und Äpfel für 5 € (§ 4 Abs. 2)';
    expect(sanitizeExcerptText(text)).toBe(text);
  });
});

describe('foldConfusables', () => {
  it('maps look-alike Cyrillic and Greek letters to Latin ones', () => {
    // А (Cyrillic) in "Аntwort", о and е in "Lösung" spelled with Cyrillic о
    expect(foldConfusables('Richtige Аntwort')).toBe('Richtige Antwort');
    expect(foldConfusables('Lоsung')).toBe('Losung');
    expect(foldConfusables('Kurzbеgründung')).toBe('Kurzbegründung');
    expect(foldConfusables('Οο')).toBe('Oo');
  });

  it('takes accents off letters but keeps the German umlauts', () => {
    expect(foldConfusables('Kurzbegr\u{301}ündung')).toBe('Kurzbegründung');
    expect(foldConfusables('Richt\u{ed}ge Antw\u{f3}rt')).toBe(
      'Richtige Antwort'
    );
    expect(foldConfusables('Lösung Äpfel Über ß')).toBe('Lösung Äpfel Über ß');
    expect(foldConfusables('\u{301}x')).toBe('x');
  });

  it('leaves Latin text unchanged', () => {
    expect(foldConfusables('Richtige Antwort ß ä')).toBe(
      'Richtige Antwort ß ä'
    );
  });
});
