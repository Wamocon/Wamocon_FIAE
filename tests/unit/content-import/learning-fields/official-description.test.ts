import {
  OFFICIAL_LEARNING_FIELDS,
  officialGoal,
  officialLearningField,
} from '@/lib/content-import/learning-fields/official';

// The description is the text of the framework curriculum (verbatim, with the
// Zielformulierung first), like the FIAE learning fields have it: about 1200
// characters, paragraphs separated by a blank line.
describe('official descriptions of the learning fields', () => {
  it('has one description per learning field', () => {
    expect(OFFICIAL_LEARNING_FIELDS).toHaveLength(13);
    for (const field of OFFICIAL_LEARNING_FIELDS) {
      expect(typeof field.description).toBe('string');
      expect(field.description.length).toBeGreaterThan(0);
    }
  });

  it('starts with the Zielformulierung: one sentence in the form of the framework curriculum', () => {
    for (const field of OFFICIAL_LEARNING_FIELDS) {
      const goal = officialGoal(field.number) as string;
      expect(goal).toMatch(
        /^Die Schülerinnen und Schüler (besitzen|verfügen über) die Kompetenz, .+\.$/
      );
      expect(goal.match(/\. /g)).toBeNull();
      expect(field.description.startsWith(goal)).toBe(true);
    }
  });

  it('adds paragraphs of the competence description, whole ones, in the FIAE range', () => {
    const lengths = OFFICIAL_LEARNING_FIELDS.map(f => f.description.length);
    for (const field of OFFICIAL_LEARNING_FIELDS) {
      const paragraphs = field.description.split('\n\n');
      expect(paragraphs.length).toBeGreaterThanOrEqual(3);
      // whole paragraphs: each one ends like a sentence
      for (const paragraph of paragraphs) {
        expect(paragraph).toMatch(/[.)]$/);
      }
      expect(field.description.length).toBeGreaterThanOrEqual(900);
      expect(field.description.length).toBeLessThanOrEqual(1400);
    }
    // FIAE: 1263 on average, 2117 at most
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    expect(mean).toBeGreaterThan(1100);
    expect(mean).toBeLessThan(1400);
  });

  it('is clean text: no line break inside a paragraph, no double space, no syllable hyphen, no control character', () => {
    for (const field of OFFICIAL_LEARNING_FIELDS) {
      for (const paragraph of field.description.split('\n\n')) {
        expect(paragraph).not.toMatch(/[\r\n\t]/);
        expect(paragraph).not.toMatch(/ {2}/);
        expect(paragraph).toBe(paragraph.trim());
        // a hyphen is only left where it belongs to the word: before a space
        // ("Preis- und"), before a word that starts with a hyphen or in a
        // compound with a capital letter after it ("Ist-Aufnahme")
        expect(paragraph).not.toMatch(/\p{L}-\p{Ll}/u);
      }
      // eslint-disable-next-line no-control-regex
      expect(field.description).not.toMatch(
        /[\u0000-\u0009\u000b-\u001f\u007f­]/
      );
      expect(field.description).not.toMatch(/[–—]/);
      expect(field.description).not.toMatch(/�/);
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
    expect(officialLearningField(11)?.description).toContain('Ist-Aufnahme');
    expect(officialLearningField(1)?.description).toContain(
      'Jugend- und Auszubildendenvertretung'
    );
  });

  it('has the words of a joined syllable break in one piece', () => {
    expect(officialLearningField(1)?.description).toContain('Betriebs');
    expect(officialLearningField(1)?.description).toContain(
      'betriebswirtschaftlichen'
    );
    expect(officialLearningField(4)?.description).toContain(
      'Beschaffungsprozesse'
    );
    expect(officialLearningField(4)?.description).toContain('ZÄHLENWENN');
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

  it('has no goal for a number outside 1 to 13', () => {
    expect(officialGoal(0)).toBeUndefined();
    expect(officialGoal(14)).toBeUndefined();
  });
});
