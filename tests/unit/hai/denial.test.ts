/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import de from '@/locales/de.json';
import en from '@/locales/en.json';
import {
  ACCESS_REASONS,
  ACCESS_REASON_KEYS,
  DENIAL_ACTION_NOT_FOUND_TEXT,
  DENIAL_ACTION_OCCUPATION_TEXT,
  DENIAL_ACTION_TRAINEE_ONLY_TEXT,
  DENIAL_ACTION_TRAINER_ONLY_TEXT,
  DENIAL_ACTION_UNAVAILABLE_TEXT,
  DENIAL_ALL_LOCKED_TEXT,
  DENIAL_BERUF_TEXT,
  DENIAL_CATEGORIES,
  DENIAL_KEYWORDS,
  DENIAL_LOESUNGSSCHUTZ_TEXT,
  DENIAL_MEANING,
  DENIAL_NEUTRAL_TEXT,
  DENIAL_NO_COURSE_TEXT,
  DENIAL_RECORD_NOT_FOUND_TEXT,
  DENIAL_TECHNICAL_TEXT,
  chatFailureKey,
  denialActionLockedText,
  denialAreaText,
  denialContinueText,
  denialLockedText,
  denialUnknownPageText,
  isDenialCategory,
  namesDenialReason,
  traineeSearchNotFoundLine,
  type DenialCategory,
} from '@/lib/hai/denial';

// The reasons of the HAI for a refusal that hangs on access. Every category has a
// text that says what does not work, why (the category in plain words) and what
// is possible instead, and no text carries a name, a title or a content of
// another occupation, a trainer area or another person.

const tDe = de as Record<string, string>;
const tEn = en as Record<string, string>;

const EXAMPLES = 'Dashboard, Quizze oder Berufsschule';

/** What a foreign-occupation fixture would show if a text leaked it. */
const FOREIGN = [
  'Reisekostenabrechnung',
  'Büromanagement',
  'Büroorganisation',
  'KfBM',
  'KFBM',
  'Fachinformatik',
  'FIAE',
  'Bestellsystem',
  'SQL Grundlagen',
  'Benutzerverwaltung',
  'Organisationen',
  'Mustermann',
  '/trainer',
  '/admin',
];

/** One fixed text per category of the pipeline, or the locale text of the interface. */
const TEXTS: Array<[DenialCategory, string, string]> = [
  ['ROLLE', 'trainer action for a trainee', DENIAL_ACTION_TRAINER_ONLY_TEXT],
  ['ROLLE', 'trainee action for a trainer', DENIAL_ACTION_TRAINEE_ONLY_TEXT],
  ['ROLLE', 'trainer area', denialAreaText('TRAINER', EXAMPLES)],
  ['ROLLE', 'administration', denialAreaText('ADMIN', EXAMPLES)],
  ['ROLLE', 'continue learning', denialContinueText(EXAMPLES)],
  ['BERUF', 'question about another occupation', DENIAL_BERUF_TEXT],
  ['BERUF', 'action outside the occupations', DENIAL_ACTION_OCCUPATION_TEXT],
  ['GESPERRT', 'locked enabler', denialLockedText('Enabler A', 'Enabler B')],
  ['GESPERRT', 'locked enabler without hint', denialLockedText('Enabler A')],
  [
    'GESPERRT',
    'locked enabler in an action',
    denialActionLockedText('Enabler A', 'Enabler B'),
  ],
  ['GESPERRT', 'everything locked', DENIAL_ALL_LOCKED_TEXT],
  ['LOESUNGSSCHUTZ', 'solution request', DENIAL_LOESUNGSSCHUTZ_TEXT],
  ['FREIGABE', 'no occupation released', DENIAL_NEUTRAL_TEXT],
  ['FREIGABE', 'no course released', DENIAL_NO_COURSE_TEXT],
  ['ORGANISATION_PLAN', 'plan (chat)', tDe['hai.denial.planRequired']],
  [
    'ORGANISATION_PLAN',
    'plan (action card)',
    tDe['hai.action.card.error.plan'],
  ],
  ['ORGANISATION_PLAN', 'plan (quiz)', tDe['hai.quiz.error.planRequired']],
  ['SCHALTER_AUS', 'voice off', tDe['hai.denial.voiceDisabled']],
  ['FREIGABE', 'awaiting release (chat)', tDe['hai.denial.awaitingActivation']],
  [
    'FREIGABE',
    'awaiting release (quiz)',
    tDe['hai.quiz.error.awaitingActivation'],
  ],
  [
    'ZUSTAENDIGKEIT',
    'trainer asks for a foreign trainee',
    traineeSearchNotFoundLine('Max'),
  ],
  [
    'ZUSTAENDIGKEIT',
    'action card, not responsible',
    tDe['hai.action.card.error.notResponsible'],
  ],
  ['UMFANG', 'record not found', DENIAL_RECORD_NOT_FOUND_TEXT],
  ['UMFANG', 'record of an action not found', DENIAL_ACTION_NOT_FOUND_TEXT],
  ['UMFANG', 'no quiz questions', tDe['hai.quiz.empty.no_content']],
];

describe('the categories', () => {
  it('are the nine of the order, each with a meaning and a keyword', () => {
    expect([...DENIAL_CATEGORIES]).toEqual([
      'ROLLE',
      'BERUF',
      'GESPERRT',
      'LOESUNGSSCHUTZ',
      'FREIGABE',
      'ORGANISATION_PLAN',
      'SCHALTER_AUS',
      'ZUSTAENDIGKEIT',
      'UMFANG',
    ]);
    for (const category of DENIAL_CATEGORIES) {
      expect(isDenialCategory(category)).toBe(true);
      expect(DENIAL_MEANING[category].length).toBeGreaterThan(10);
      expect(DENIAL_KEYWORDS[category]).toBeInstanceOf(RegExp);
    }
    expect(isDenialCategory('TECHNIK')).toBe(false);
    expect(isDenialCategory(undefined)).toBe(false);
  });

  it('are all covered by a fixed text or an interface text below', () => {
    for (const category of DENIAL_CATEGORIES) {
      expect(TEXTS.some(([c]) => c === category)).toBe(true);
    }
  });
});

describe.each(TEXTS)('%s: %s', (category, _name, text) => {
  it('exists and names the reason in plain words', () => {
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(40);
    expect(namesDenialReason(text, category)).toBe(true);
  });

  it('says what is possible instead or what to do next', () => {
    expect(text).toMatch(
      /stattdessen|gern|Bitte|bitte|Frage deinen Trainer|Wende dich|Nenne mir|Du kannst|kannst du|Schließe|Sobald|geht sie|Starte|zum Beispiel|Prüfe|Lade|lade|dann/
    );
  });

  it('is short, friendly and without a dash', () => {
    expect(text.length).toBeLessThanOrEqual(420);
    // no long or short dash as a mark of an aside (hyphens in words are fine)
    expect(text).not.toMatch(/\s[-–—]\s|[–—]/);
    // real umlauts, no replacements
    expect(text).not.toMatch(
      /Loesung|fuer |Zustaendigkeit|gehoert|Aufloesung|Pruefung|waehle/
    );
  });

  it('carries nothing of another occupation, a trainer area or another person', () => {
    for (const word of FOREIGN) {
      expect(text).not.toContain(word);
    }
    // no id and no path
    expect(text).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\/trainee\//i
    );
  });
});

describe('what the texts must never do', () => {
  it('does not give out a technical failure as a missing right', () => {
    for (const text of [
      DENIAL_TECHNICAL_TEXT,
      DENIAL_ACTION_UNAVAILABLE_TEXT,
      tDe['hai.action.card.error.unavailable'],
    ]) {
      expect(text).toContain('technische Störung');
      for (const category of DENIAL_CATEGORIES) {
        expect(namesDenialReason(text, category)).toBe(false);
      }
    }
  });

  it('does not give out a missing right as a technical failure', () => {
    for (const [, , text] of TEXTS) {
      expect(text).not.toContain('technische Störung');
    }
  });

  it('says "nothing found in your released content", never "there is nothing"', () => {
    for (const text of [
      DENIAL_RECORD_NOT_FOUND_TEXT,
      DENIAL_ACTION_NOT_FOUND_TEXT,
      tDe['hai.quiz.empty.no_content'],
      tDe['hai.quiz.empty.no_topic_match'],
      tDe['hai.quiz.error.notFound'],
    ]) {
      expect(text).toMatch(/das heißt aber nicht|nicht \(mehr\)|Zuständigkeit/);
      expect(text).not.toMatch(/es gibt (?:nichts|keine)/i);
    }
  });

  it('keeps the solution protection strict: no part of a solution', () => {
    expect(DENIAL_LOESUNGSSCHUTZ_TEXT).toContain('gebe ich nicht heraus');
    expect(DENIAL_LOESUNGSSCHUTZ_TEXT).toContain('Trainern vorbehalten');
    expect(DENIAL_LOESUNGSSCHUTZ_TEXT).toContain('nach dem bestandenen Quiz');
    expect(DENIAL_LOESUNGSSCHUTZ_TEXT).not.toMatch(/Schritt 1|Lösungsweg:/);
  });

  it('names an unknown page as no question of rights', () => {
    const text = denialUnknownPageText(EXAMPLES);
    expect(text).toContain('Diese Seite kenne ich nicht');
    expect(text).toContain('nichts mit deinen Rechten zu tun');
    for (const category of DENIAL_CATEGORIES) {
      expect(namesDenialReason(text, category)).toBe(false);
    }
  });

  it('shows only the titles it is given and nothing else of an enabler', () => {
    const text = denialLockedText('Titel Eins', 'Titel Zwei');
    expect(text).toContain('Titel Eins');
    expect(text).toContain('Titel Zwei');
    const bare = text.replaceAll('Titel Eins', '').replaceAll('Titel Zwei', '');
    expect(bare).not.toMatch(/[0-9]/);
  });

  it('names the area of a page roughly and nothing of the page', () => {
    expect(denialAreaText('TRAINER', EXAMPLES)).toContain('Trainerbereich');
    expect(denialAreaText('ADMIN', EXAMPLES)).toContain(
      'Verwaltungsbereich der Administratoren'
    );
  });
});

describe('the hints for the model', () => {
  it('map to a category each and carry no name or number', () => {
    expect(ACCESS_REASON_KEYS.length).toBe(Object.keys(ACCESS_REASONS).length);
    for (const key of ACCESS_REASON_KEYS) {
      const { category, note } = ACCESS_REASONS[key];
      expect(isDenialCategory(category)).toBe(true);
      expect(note.length).toBeGreaterThan(40);
      for (const word of FOREIGN) expect(note).not.toContain(word);
      expect(note).not.toMatch(/[0-9]/);
      expect(note).not.toMatch(/[–—]/);
    }
  });
});

describe('the keys of the interface texts', () => {
  const KEYS = [
    'hai.denial.planRequired',
    'hai.denial.awaitingActivation',
    'hai.denial.voiceDisabled',
    'hai.denial.rateLimited',
    'hai.denial.forbidden',
    'hai.denial.inputInvalid',
    'hai.action.card.error.role',
    'hai.action.card.error.occupation',
    'hai.action.card.error.locked',
    'hai.action.card.error.notResponsible',
    'hai.action.card.error.plan',
    'hai.action.card.error.awaitingActivation',
    'hai.quiz.error.planRequired',
    'hai.quiz.error.awaitingActivation',
    'hai.quiz.error.notAssigned',
  ];

  it.each(KEYS)('%s exists in German and English', key => {
    expect(typeof tDe[key]).toBe('string');
    expect(typeof tEn[key]).toBe('string');
    expect(tDe[key].length).toBeGreaterThan(30);
    expect(tEn[key].length).toBeGreaterThan(30);
    // no dash as a mark of an aside, in either language
    expect(tDe[key]).not.toMatch(/[–—]/);
    expect(tEn[key]).not.toMatch(/[–—]/);
  });

  it('are chosen for a failed chat call by status and stable code', () => {
    expect(chatFailureKey(403, 'VOICE_DISABLED')).toBe(
      'hai.denial.voiceDisabled'
    );
    expect(chatFailureKey(403, 'PRO_REQUIRED')).toBe('hai.denial.planRequired');
    expect(chatFailureKey(403, 'AWAITING_ACTIVATION')).toBe(
      'hai.denial.awaitingActivation'
    );
    expect(chatFailureKey(403)).toBe('hai.denial.forbidden');
    expect(chatFailureKey(429, 'RATE_LIMITED')).toBe('hai.denial.rateLimited');
    expect(chatFailureKey(400)).toBe('hai.denial.inputInvalid');
    // a failure of the server is never shown as a missing right
    for (const status of [500, 502, 503]) {
      expect(chatFailureKey(status)).toBe('hai.error.somethingWrong');
    }
    for (const status of [403, 429, 400, 500]) {
      for (const code of [undefined, 'VOICE_DISABLED', 'PRO_REQUIRED']) {
        expect(typeof tDe[chatFailureKey(status, code)]).toBe('string');
        expect(typeof tEn[chatFailureKey(status, code)]).toBe('string');
      }
    }
  });
});
