/**
 * @jest-environment node
 */
// Similarity of two documents with a different hash: word shingles on a
// normalized text and the Jaccard measure. Deterministic, linear, bounded.
import { describe, expect, it } from '@jest/globals';

import {
  DEFAULT_SIMILARITY,
  findSimilarDocuments,
  fingerprintOf,
  jaccardOf,
  normalizeForSimilarity,
} from '@/lib/content-upload/classify/similarity';

/** A long invented text of distinct sentences, made from a seed. */
function longText(seed: string, sentences = 60): string {
  const out: string[] = [];
  for (let i = 0; i < sentences; i += 1) {
    out.push(
      `Satz ${i} von ${seed} behandelt das erfundene Thema ${seed}${i} und nennt Beispiel ${i * 7 + seed.length} im Betrieb ${seed}.`
    );
  }
  return out.join(' ');
}

describe('normalizeForSimilarity', () => {
  it('lower cases, drops punctuation and collapses white space', () => {
    expect(normalizeForSimilarity('  Ein, TEST!\n\tZwei.  ')).toEqual([
      'ein',
      'test',
      'zwei',
    ]);
  });

  it('treats the Unicode forms and invisible characters alike', () => {
    expect(normalizeForSimilarity('Für')).toEqual(
      normalizeForSimilarity('Für')
    );
    expect(normalizeForSimilarity('Ne​tz­werk')).toEqual(['netzwerk']);
    expect(normalizeForSimilarity('ＡＢＣ')).toEqual(['abc']);
  });

  it('keeps umlauts, digits and the sharp s', () => {
    expect(normalizeForSimilarity('Straße 12 ÄÖÜ')).toEqual([
      'straße',
      '12',
      'äöü',
    ]);
  });

  it('gives nothing for empty or odd input', () => {
    expect(normalizeForSimilarity('')).toEqual([]);
    expect(normalizeForSimilarity('...')).toEqual([]);
    expect(normalizeForSimilarity(undefined as unknown as string)).toEqual([]);
  });
});

describe('fingerprintOf and jaccardOf', () => {
  it('gives 1 for the same text, whatever its spelling', () => {
    const a = fingerprintOf(longText('alpha'));
    const b = fingerprintOf(
      longText('alpha').toUpperCase().replace(/ /g, '  \n')
    );
    expect(a && b && jaccardOf(a, b)).toBe(1);
  });

  it('gives a value near 0 for unrelated texts', () => {
    const a = fingerprintOf(longText('alpha'));
    const b = fingerprintOf(longText('omega'));
    expect(a && b && jaccardOf(a, b)).toBeLessThan(0.1);
  });

  it('gives a high value when one sentence of sixty changes', () => {
    const base = longText('alpha');
    const changed = base.replace('Satz 30 von alpha', 'Ein ganz anderer Satz');
    const a = fingerprintOf(base);
    const b = fingerprintOf(changed);
    const value = a && b ? jaccardOf(a, b) : 0;
    expect(value).toBeGreaterThan(0.9);
    expect(value).toBeLessThan(1);
  });

  it('gives a lower value when a tenth of the text changes', () => {
    const base = longText('alpha');
    const sentences = base.split('. ');
    const changed = sentences
      .map((s, i) =>
        i % 10 === 0 ? `Völlig neuer Satz Nummer ${i} ohne Bezug` : s
      )
      .join('. ');
    const a = fingerprintOf(base);
    const b = fingerprintOf(changed);
    expect(a && b && jaccardOf(a, b)).toBeLessThan(
      DEFAULT_SIMILARITY.threshold
    );
  });

  it('is symmetric', () => {
    const a = fingerprintOf(longText('alpha'));
    const b = fingerprintOf(longText('alpha').replace('Satz 3 ', 'Satz drei '));
    expect(a && b && jaccardOf(a, b)).toBe(a && b && jaccardOf(b, a));
  });

  it('knows no fingerprint for a text without words', () => {
    expect(fingerprintOf('')).toBeNull();
    expect(fingerprintOf(' ... ')).toBeNull();
  });

  it('compares short texts as a whole', () => {
    const a = fingerprintOf('nur drei Worte');
    const b = fingerprintOf('Nur drei, Worte!');
    const c = fingerprintOf('ganz andere Worte');
    expect(a && b && jaccardOf(a, b)).toBe(1);
    expect(a && c && jaccardOf(a, c)).toBe(0);
  });

  it('cuts a text above the limit and says so', () => {
    const huge = fingerprintOf('wort '.repeat(100_000) + 'ende', {
      maxChars: 10_000,
    });
    expect(huge?.truncated).toBe(true);
    const normal = fingerprintOf('ein kurzer text mit sechs worten');
    expect(normal?.truncated).toBe(false);
  });

  it('keeps the number of shingles of one document bounded', () => {
    const many = fingerprintOf(longText('alpha', 4000), {
      maxShingles: 500,
      maxChars: 5_000_000,
    });
    expect(many?.hashes.length).toBeLessThanOrEqual(500);
  });
});

describe('findSimilarDocuments', () => {
  const docs = [
    { id: 'a', text: longText('alpha') },
    { id: 'b', text: longText('alpha').replace('Satz 30 von alpha', 'Anders') },
    { id: 'c', text: longText('omega') },
    { id: 'd', text: longText('omega').replace('Satz 10 von omega', 'Neu') },
    { id: 'e', text: longText('sigma') },
  ];

  it('finds the pairs above the threshold and groups them', () => {
    const result = findSimilarDocuments(docs);
    expect(result.pairs.map(p => [p.a, p.b])).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(
      result.pairs.every(p => p.jaccard >= DEFAULT_SIMILARITY.threshold)
    ).toBe(true);
    expect(result.groups).toEqual([
      { id: 'sim:a', members: ['a', 'b'], maxJaccard: expect.any(Number) },
      { id: 'sim:c', members: ['c', 'd'], maxJaccard: expect.any(Number) },
    ]);
    expect(result.truncated).toBe(false);
  });

  it('does not depend on the order of the input', () => {
    const forward = findSimilarDocuments(docs);
    const backward = findSimilarDocuments([...docs].reverse());
    expect(backward).toEqual(forward);
  });

  it('joins a chain of pairs into one group', () => {
    const base = longText('kette', 90);
    const sentences = base.split('. ');
    const make = (drop: number) =>
      sentences.filter((_, i) => i !== drop).join('. ');
    const result = findSimilarDocuments(
      [
        { id: 'x1', text: base },
        { id: 'x2', text: make(5) },
        {
          id: 'x3',
          text: make(5)
            .split('. ')
            .filter((_, i) => i !== 60)
            .join('. '),
        },
      ],
      { threshold: 0.9 }
    );
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].members).toEqual(['x1', 'x2', 'x3']);
  });

  it('honors a threshold that is given', () => {
    const loose = findSimilarDocuments(docs, { threshold: 0.2 });
    const strict = findSimilarDocuments(docs, { threshold: 0.999 });
    expect(loose.pairs.length).toBeGreaterThanOrEqual(2);
    expect(strict.pairs).toEqual([]);
  });

  it('ignores documents without words and exact copies of one text only once per pair', () => {
    const result = findSimilarDocuments([
      { id: 'a', text: '' },
      { id: 'b', text: '...' },
      { id: 'c', text: longText('alpha') },
      { id: 'd', text: longText('alpha') },
    ]);
    expect(result.pairs).toEqual([{ a: 'c', b: 'd', jaccard: 1 }]);
  });

  it('is bounded in the number of documents and says so', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `d${String(i).padStart(2, '0')}`,
      text: longText(`s${i}`, 10),
    }));
    const result = findSimilarDocuments(many, { maxDocuments: 10 });
    expect(result.truncated).toBe(true);
    expect(result.processed).toBe(10);
  });

  it('finds the pair among hundreds of documents and stays fast', () => {
    const many: Array<{ id: string; text: string }> = [];
    for (let i = 0; i < 400; i += 1) {
      many.push({
        id: `n${String(i).padStart(3, '0')}`,
        text: longText(`doc${i}`, 25),
      });
    }
    many.push({
      id: 'zz1',
      text: longText('doc77', 25).replace('Satz 3 von doc77', 'Eine Änderung'),
    });
    const start = Date.now();
    const result = findSimilarDocuments(many);
    expect(Date.now() - start).toBeLessThan(8000);
    expect(result.pairs.map(p => [p.a, p.b])).toEqual([['n077', 'zz1']]);
  });

  it('does not form pairs from boilerplate that every document shares', () => {
    const boilerplate =
      'Dieser erfundene Briefkopf steht auf jeder Seite jeder Datei der Firma. '.repeat(
        3
      );
    const many = Array.from({ length: 80 }, (_, i) => ({
      id: `b${String(i).padStart(2, '0')}`,
      text: boilerplate + longText(`eigen${i}`, 6),
    }));
    expect(findSimilarDocuments(many).pairs).toEqual([]);
  });

  it('groups a large cluster of identical texts instead of dropping it', () => {
    const text = longText('kopie');
    const many = Array.from({ length: 100 }, (_, i) => ({
      id: `k${String(i).padStart(3, '0')}`,
      text,
    }));
    const result = findSimilarDocuments(many);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].members).toHaveLength(100);
  });

  it('says so when the candidate pairs hit their limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `m${String(i).padStart(2, '0')}`,
      text: longText('gleich'),
    }));
    const result = findSimilarDocuments(many, { maxCandidates: 5 });
    expect(result.truncated).toBe(true);
  });

  it('cuts the words of a text that grows when it is cleaned', () => {
    const print = fingerprintOf('ﷺ '.repeat(60_000), {
      maxChars: 400_000,
      maxTokens: 1000,
    });
    expect(print?.truncated).toBe(true);
    expect(print?.tokens).toBeLessThanOrEqual(1000);
  });

  it('does not let a character that is invisible split a word', () => {
    const a = fingerprintOf(longText('alpha'));
    const b = fingerprintOf(longText('alpha').replace(/ /g, ' ͏️\u{E0041}'));
    expect(a && b && jaccardOf(a, b)).toBe(1);
    expect(normalizeForSimilarity('Ne͏tz؜werk')).toEqual(['netzwerk']);
  });

  it('takes a fingerprint that was built before and keeps the same answer', () => {
    const text = longText('alpha');
    const plain = findSimilarDocuments([
      { id: 'a', text },
      { id: 'b', text },
    ]);
    const print = fingerprintOf(text);
    const given = findSimilarDocuments([
      { id: 'a', text: '', print },
      { id: 'b', text: '', print },
    ]);
    expect(given).toEqual(plain);
  });

  it('keeps the first of a repeated id by text, whatever the order', () => {
    const one = [
      { id: 'a', text: longText('alpha') },
      { id: 'a', text: longText('omega') },
      { id: 'b', text: longText('alpha') },
    ];
    expect(findSimilarDocuments([...one].reverse())).toEqual(
      findSimilarDocuments(one)
    );
  });

  it('survives odd input', () => {
    expect(findSimilarDocuments([]).pairs).toEqual([]);
    expect(
      findSimilarDocuments([
        { id: 'a', text: undefined as unknown as string },
        { id: 'a', text: 'doppelte kennung' },
      ]).pairs
    ).toEqual([]);
  });
});

describe('the threshold', () => {
  it('lies between the values of copies and of siblings in the invented set', () => {
    // copies of one document with small edits stay above, a document of the
    // same template with other content stays far below
    const base = longText('vorlage', 60);
    const copy = base.replace('Satz 59 von vorlage', 'Letzter Satz');
    const sibling = longText('vorlage', 60).replace(/vorlage/g, 'schwester');
    const a = fingerprintOf(base)!;
    expect(jaccardOf(a, fingerprintOf(copy)!)).toBeGreaterThanOrEqual(
      DEFAULT_SIMILARITY.threshold
    );
    expect(jaccardOf(a, fingerprintOf(sibling)!)).toBeLessThan(
      DEFAULT_SIMILARITY.threshold
    );
  });
});
