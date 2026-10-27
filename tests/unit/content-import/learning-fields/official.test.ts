import {
  LEARNING_FIELD_COUNT,
  learningFieldYear,
} from '@/lib/content-import/learning-fields/model';
import {
  OFFICIAL_LEARNING_FIELDS,
  OFFICIAL_SOURCE,
  officialHours,
  officialLearningField,
} from '@/lib/content-import/learning-fields/official';
import {
  MAX_TITLE_LENGTH,
  cleanTitle,
} from '@/lib/content-import/learning-fields/titles';

describe('official learning fields of the KfBM', () => {
  it('lists the 13 learning fields in order', () => {
    expect(OFFICIAL_LEARNING_FIELDS).toHaveLength(LEARNING_FIELD_COUNT);
    expect(OFFICIAL_LEARNING_FIELDS.map(f => f.number)).toEqual(
      Array.from({ length: 13 }, (_v, i) => i + 1)
    );
  });

  it('names the source of the framework curriculum', () => {
    expect(OFFICIAL_SOURCE).toContain('27.09.2013');
    expect(OFFICIAL_SOURCE).toContain('20.03.2025');
  });

  it('has the official titles, school years and time guidelines', () => {
    expect(
      OFFICIAL_LEARNING_FIELDS.map(f => [
        f.number,
        f.title,
        f.trainingYear,
        f.hours,
      ])
    ).toEqual([
      [
        1,
        'Die eigene Rolle im Betrieb mitgestalten und den Betrieb präsentieren',
        1,
        40,
      ],
      [2, 'Büroprozesse gestalten und Arbeitsvorgänge organisieren', 1, 80],
      [3, 'Aufträge bearbeiten', 1, 80],
      [
        4,
        'Sachgüter und Dienstleistungen beschaffen und Verträge schließen',
        1,
        120,
      ],
      [5, 'Kunden akquirieren und binden', 2, 80],
      [6, 'Werteströme erfassen und beurteilen', 2, 80],
      [7, 'Gesprächssituationen gestalten', 2, 40],
      [8, 'Personalwirtschaftliche Aufgaben wahrnehmen', 2, 80],
      [9, 'Liquidität sichern und Finanzierung vorbereiten', 3, 80],
      [10, 'Wertschöpfungsprozesse erfolgsorientiert steuern', 3, 80],
      [11, 'Geschäftsprozesse darstellen und optimieren', 3, 40],
      [12, 'Veranstaltungen und Geschäftsreisen organisieren', 3, 40],
      [13, 'Ein Projekt planen und durchführen', 3, 40],
    ]);
  });

  it('adds up to 880 hours, 320 in year 1 and 280 in years 2 and 3', () => {
    expect(officialHours()).toBe(880);
    expect(officialHours(1)).toBe(320);
    expect(officialHours(2)).toBe(280);
    expect(officialHours(3)).toBe(280);
  });

  it('agrees with the school year assignment of the model', () => {
    for (const field of OFFICIAL_LEARNING_FIELDS) {
      expect(field.trainingYear).toBe(learningFieldYear(field.number));
    }
  });

  it('writes 40 hours for LF11, not the typing error "40." of the PDF', () => {
    const lf11 = officialLearningField(11);
    expect(lf11?.hours).toBe(40);
    expect(Number.isInteger(lf11?.hours)).toBe(true);
  });

  it('has whole hours and clean titles that fit the column', () => {
    for (const field of OFFICIAL_LEARNING_FIELDS) {
      expect(Number.isInteger(field.hours)).toBe(true);
      expect(field.hours).toBeGreaterThan(0);
      expect(cleanTitle(field.title)).toBe(field.title);
      expect(field.title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
      expect(field.title).not.toMatch(/Lernfeld \d/);
    }
  });

  it('finds an entry by number and nothing outside 1 to 13', () => {
    expect(officialLearningField(3)?.title).toBe('Aufträge bearbeiten');
    expect(officialLearningField(0)).toBeUndefined();
    expect(officialLearningField(14)).toBeUndefined();
  });
});
