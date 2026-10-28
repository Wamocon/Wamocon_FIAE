/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync, writeFileSync, cpSync } from 'fs';
import os from 'os';
import path from 'path';

import { chunkDocument } from '@/lib/hai/chunker';
import {
  cardIndexText,
  cardSourceId,
  deliverableCards,
} from '@/lib/hai/learningTechniques/cards';
import {
  LEARNING_TECHNIQUES_DIR,
  loadLearningTechniqueCards,
} from '@/lib/hai/learningTechniques/loader';
import {
  DRAFT_STATUS,
  parseLearningTechniqueCard,
  validateCardSet,
  type LearningTechniqueCard,
} from '@/lib/hai/learningTechniques/schema';
import { isUuid } from '@/lib/hai/vectorSearch';

jest.mock('@/db/haiDb', () => ({ __esModule: true, default: {} }));
jest.mock('@/lib/hai/providers', () => ({
  getEmbeddingProvider: () => ({ isInitialized: () => false }),
}));

const CARD_DIR = path.join(process.cwd(), LEARNING_TECHNIQUES_DIR);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('the card files of the repository', () => {
  const cards = loadLearningTechniqueCards(CARD_DIR);

  it('are 10 to 15 valid cards ranked 1..n', () => {
    expect(cards.length).toBeGreaterThanOrEqual(10);
    expect(cards.length).toBeLessThanOrEqual(15);
    expect(cards.map(c => c.rank)).toEqual(cards.map((_, i) => i + 1));
  });

  it('rank by effectiveness: high, then moderate, then low', () => {
    const levels = cards.map(c => c.effectiveness);
    const order = { hoch: 0, mittel: 1, niedrig: 2 };
    for (let i = 1; i < levels.length; i++) {
      expect(order[levels[i]]).toBeGreaterThanOrEqual(order[levels[i - 1]]);
    }
  });

  it('carry the rating of Dunlosky et al. 2013 for the ten techniques', () => {
    const rated = Object.fromEntries(
      cards
        .filter(c => c.dunlosky)
        .map(c => [c.dunlosky!.technique, c.dunlosky!.utility])
    );
    expect(rated).toEqual({
      'Practice testing': 'high',
      'Distributed practice': 'high',
      'Elaborative interrogation': 'moderate',
      'Self-explanation': 'moderate',
      'Interleaved practice': 'moderate',
      Summarization: 'low',
      'Highlighting and underlining': 'low',
      'Keyword mnemonic': 'low',
      'Imagery use for text learning': 'low',
      Rereading: 'low',
    });
  });

  it('are all drafts: no card is released by default', () => {
    for (const card of cards) {
      expect(card.review.reviewed).toBe(false);
      expect(card.review.status).toBe(DRAFT_STATUS);
      expect(card.review.reviewedBy).toBeNull();
      expect(card.review.reviewedAt).toBeNull();
      // what was checked and what was not is recorded on every card
      expect(card.review.checked.length).toBeGreaterThan(20);
      expect(card.review.notChecked.length).toBeGreaterThan(20);
    }
    expect(deliverableCards(cards)).toEqual([]);
  });

  it('name the source and have one example for FIAE and one for KfBM', () => {
    for (const card of cards) {
      expect(card.source.citation).toContain('Dunlosky');
      expect(card.source.citation).toContain('2013');
      expect(card.examples.FIAE.length).toBeGreaterThan(20);
      expect(card.examples.KFBM.length).toBeGreaterThan(20);
    }
  });

  it('use no dash as a punctuation mark in the texts', () => {
    // house rule: commas and full stops, no long or short dash between clauses
    const json = JSON.stringify(
      cards.map(c => ({ ...c, source: { ...c.source, citation: '' } }))
    );
    expect(json).not.toMatch(/[–—]/);
    expect(json).not.toMatch(/ - /);
  });

  it('index as exactly one chunk of at most 2000 characters each', () => {
    for (const card of cards) {
      const text = cardIndexText(card, cards.length);
      expect(text.length).toBeLessThanOrEqual(1900);
      const chunks = chunkDocument(text, `Lerntechnik: ${card.title}`, {
        maxChunkSize: 500,
        overlap: 50,
        preserveParagraphs: true,
        preserveSentences: true,
      });
      expect(chunks).toHaveLength(1);
    }
  });

  it('give every card a stable uuid source id, different per card', () => {
    const ids = cards.map(c => cardSourceId(c.id));
    expect(new Set(ids).size).toBe(cards.length);
    ids.forEach(id => expect(isUuid(id)).toBe(true));
    // never changes: the rows of a card are found again on the next run
    expect(cardSourceId('abrufuebung')).toBe(
      '2f4f0427-5d53-58b7-aeba-2190097c5f3a'
    );
  });

  it('write rank, effectiveness and title into the index text', () => {
    const text = cardIndexText(cards[0], cards.length);
    expect(text).toContain(`Rang 1 von ${cards.length}`);
    expect(text).toContain('Nutzen: hoch');
    expect(text).toContain('Beispiel Fachinformatik (FIAE):');
    expect(text).toContain('Beispiel Büromanagement (KfBM):');
    expect(text).toContain('Quelle: Dunlosky');
  });
});

describe('the release gate', () => {
  const cards = loadLearningTechniqueCards(CARD_DIR);

  function released(card: LearningTechniqueCard): LearningTechniqueCard {
    const copy = clone(card);
    copy.review = {
      ...copy.review,
      reviewed: true,
      status: 'Freigegeben',
      reviewedBy: 'Niko',
      reviewedAt: '2026-11-02',
    };
    return copy;
  }

  it('delivers only cards that a human released', () => {
    const mixed = [released(cards[0]), cards[1], released(cards[2])];
    expect(deliverableCards(mixed).map(c => c.id)).toEqual([
      cards[0].id,
      cards[2].id,
    ]);
  });

  it('refuses a released card without name and date', () => {
    const card = clone(cards[0]);
    card.review.reviewed = true;
    card.review.status = 'Freigegeben';
    expect(() => parseLearningTechniqueCard(card)).toThrow(/reviewedBy/);
  });

  it('refuses a released card that still has the draft status', () => {
    const card = released(cards[0]);
    card.review.status = DRAFT_STATUS;
    expect(() => parseLearningTechniqueCard(card)).toThrow(/Freigegeben/);
  });

  it('refuses an unreleased card that carries a reviewer', () => {
    const card = clone(cards[0]);
    card.review.reviewedBy = 'Niko';
    expect(() => parseLearningTechniqueCard(card)).toThrow(/no reviewedBy/);
  });

  it('refuses a release date that is not a real date', () => {
    const card = released(cards[0]);
    card.review.reviewedAt = '2026-13-45';
    expect(() => parseLearningTechniqueCard(card)).toThrow(/real date/);
  });

  it('accepts a properly released card', () => {
    expect(() => parseLearningTechniqueCard(released(cards[0]))).not.toThrow();
  });
});

describe('the schema', () => {
  const cards = loadLearningTechniqueCards(CARD_DIR);
  const base = () => clone(cards[0]);

  it.each([
    ['unknown field', (c: any) => (c.extra = 1), /extra|Unrecognized/i],
    ['bad id', (c: any) => (c.id = 'Bad Id'), /id/],
    ['two steps', (c: any) => (c.steps = ['a', 'b']), /steps/],
    ['empty example', (c: any) => (c.examples.KFBM = ''), /examples/],
    ['control character', (c: any) => (c.what = 'a\u0007b'), /control/],
    ['too few keywords', (c: any) => (c.keywords = ['a']), /keywords/],
    ['bad date', (c: any) => (c.review.reviewedAt = 'morgen'), /reviewedAt/],
  ])('refuses %s', (_name, mutate, message) => {
    const card = base();
    mutate(card);
    expect(() => parseLearningTechniqueCard(card, 'x')).toThrow(message);
  });

  it('refuses a rating that contradicts the effectiveness', () => {
    const card = base();
    card.effectiveness = 'niedrig';
    expect(() => parseLearningTechniqueCard(card)).toThrow(/does not match/);
  });

  it('refuses an own application without a base card', () => {
    const card = clone(cards.find(c => !c.dunlosky)!);
    delete card.basedOn;
    expect(() => parseLearningTechniqueCard(card)).toThrow(/base card/);
  });

  it('refuses a set with a duplicate id, a gap or a wrong order', () => {
    const duplicate = clone(cards);
    duplicate[1].id = duplicate[0].id;
    expect(() => validateCardSet(duplicate)).toThrow(/Duplicate/);

    const gap = clone(cards);
    gap[3].rank = 40;
    expect(() => validateCardSet(gap)).toThrow(/without a gap/);

    const order = clone(cards);
    order[0].effectiveness = 'niedrig';
    expect(() => validateCardSet(order)).toThrow(/lower effectiveness/);

    expect(() => validateCardSet(cards.slice(0, 5))).toThrow(/10 to 15/);
  });

  it('refuses the example of the other occupation', () => {
    const set = clone(cards);
    set[0].examples.FIAE =
      'Du nennst die Pflichtangaben einer Rechnung aus dem Kopf.';
    expect(() => validateCardSet(set)).toThrow(/other occupation/);
  });

  it('refuses a card that is based on itself', () => {
    const set = clone(cards);
    const own = set.find(c => c.basedOn)!;
    own.basedOn = own.id;
    expect(() => validateCardSet(set)).toThrow(/itself/);
  });

  it('refuses a base card that does not exist', () => {
    const set = clone(cards);
    const own = set.find(c => c.basedOn)!;
    own.basedOn = 'gibt-es-nicht';
    expect(() => validateCardSet(set)).toThrow(/unknown card/);
  });
});

describe('the loader', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hai-cards-'));
    cpSync(CARD_DIR, dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('refuses a file that is not JSON', () => {
    writeFileSync(path.join(dir, '99-kaputt.json'), '{ nope', 'utf8');
    expect(() => loadLearningTechniqueCards(dir)).toThrow(/not valid JSON/);
  });

  it('refuses a file whose name does not carry rank and id', () => {
    const cards = loadLearningTechniqueCards(dir);
    writeFileSync(
      path.join(dir, '77-falsch.json'),
      JSON.stringify({ ...cards[0], id: 'andere-karte', rank: 1 }),
      'utf8'
    );
    expect(() => loadLearningTechniqueCards(dir)).toThrow(/must be named/);
  });

  it('ignores files that are not JSON files', () => {
    writeFileSync(path.join(dir, 'README.md'), '# nichts', 'utf8');
    expect(loadLearningTechniqueCards(dir).length).toBeGreaterThanOrEqual(10);
  });
});
