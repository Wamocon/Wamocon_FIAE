import {
  OFFICIAL_LEARNING_FIELDS,
  officialLearningField,
} from '@/lib/content-import/learning-fields/official';

describe('official descriptions of the learning fields', () => {
  it('has one description per learning field', () => {
    for (const field of OFFICIAL_LEARNING_FIELDS) {
      expect(typeof field.description).toBe('string');
      expect(field.description.length).toBeGreaterThan(0);
    }
  });

  it('is the Zielformulierung: one sentence in the form of the framework curriculum', () => {
    for (const field of OFFICIAL_LEARNING_FIELDS) {
      expect(field.description).toMatch(
        /^Die Schülerinnen und Schüler (besitzen|verfügen über) die Kompetenz, .+\.$/
      );
      // exactly one sentence, no abbreviation dot inside
      expect(field.description.match(/\. /g)).toBeNull();
    }
  });

  it('has the length of a short description like the FIAE ones', () => {
    for (const field of OFFICIAL_LEARNING_FIELDS) {
      expect(field.description.length).toBeGreaterThanOrEqual(100);
      expect(field.description.length).toBeLessThanOrEqual(260);
    }
  });

  it('is clean text: no line break, no double space, no syllable hyphen, no control character', () => {
    for (const field of OFFICIAL_LEARNING_FIELDS) {
      expect(field.description).not.toMatch(/[\r\n\t]/);
      expect(field.description).not.toMatch(/ {2}/);
      expect(field.description).toBe(field.description.trim());
      // a hyphen is only left where it belongs to the word: before a space
      // ("Preis- und") or before a word that starts with a hyphen
      expect(field.description).not.toMatch(/\p{L}-\p{Ll}/u);
      // eslint-disable-next-line no-control-regex
      expect(field.description).not.toMatch(/[\u0000-\u001f\u007f­]/);
      expect(field.description).not.toMatch(/[–—]/);
    }
  });

  it('keeps the hyphens that belong to the words', () => {
    expect(officialLearningField(5)?.description).toContain(
      'Preis- und Kommunikationspolitik für die Kundengewinnung und -bindung'
    );
    expect(officialLearningField(10)?.description).toContain(
      'Kosten- und Leistungsrechnung'
    );
    expect(officialLearningField(11)?.description).toContain(
      'Arbeits- und Geschäftsprozesse'
    );
  });

  it('has the words of a joined syllable break in one piece', () => {
    expect(officialLearningField(1)?.description).toContain('Betriebs');
    expect(officialLearningField(4)?.description).toContain(
      'Beschaffungsprozesse'
    );
    expect(officialLearningField(10)?.description).toContain(
      'erfolgsorientiert'
    );
    expect(officialLearningField(12)?.description).toContain('Geschäftsreisen');
  });

  it('matches the topic of the official title', () => {
    expect(officialLearningField(3)?.description).toContain('Aufträge');
    expect(officialLearningField(8)?.description).toContain('Personal');
    expect(officialLearningField(13)?.description).toContain('Projekt');
  });
});
