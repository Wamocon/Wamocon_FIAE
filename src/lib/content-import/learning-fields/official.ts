// Official titles and time guidelines of the 13 learning fields of the KfBM.
//
// Source: Rahmenlehrplan für den Ausbildungsberuf Kaufmann und Kauffrau für
// Büromanagement (Beschluss der Kultusministerkonferenz vom 27.09.2013 in der
// Fassung der Bildungsministerkonferenz vom 20.03.2025), Teil V Lernfelder. The
// owner named the learning field PDF as the authoritative source. Title and
// "Zeitrichtwert" (hours) are the ones of the chapter of each learning field.
//
// The hours add up to 880, per school year to 320, 280 and 280 (the sums of the
// overview table of the framework curriculum). The tests check that.
//
// LF11: the chapter of the PDF reads "40. Stunden" (a typing error with a dot).
// The value is 40 hours: it is the only reading that fits the year sum of 280
// hours (80 + 80 + 40 + 40 + 40) and the overview table. The dot is NOT taken
// over, the 40 is written down here on purpose.
//
// Pure data, no file access, no database.

import type { SchoolYear } from './model';

export interface OfficialLearningField {
  /** Number 1 to 13. */
  number: number;
  /** Official title ("Bezeichnung") of the learning field. */
  title: string;
  trainingYear: SchoolYear;
  /** "Zeitrichtwert" in hours. */
  hours: number;
}

export const OFFICIAL_SOURCE =
  'Rahmenlehrplan Kaufmann/Kauffrau für Büromanagement, KMK-Beschluss vom 27.09.2013 in der Fassung vom 20.03.2025';

export const OFFICIAL_LEARNING_FIELDS: readonly OfficialLearningField[] = [
  {
    number: 1,
    title:
      'Die eigene Rolle im Betrieb mitgestalten und den Betrieb präsentieren',
    trainingYear: 1,
    hours: 40,
  },
  {
    number: 2,
    title: 'Büroprozesse gestalten und Arbeitsvorgänge organisieren',
    trainingYear: 1,
    hours: 80,
  },
  { number: 3, title: 'Aufträge bearbeiten', trainingYear: 1, hours: 80 },
  {
    number: 4,
    title: 'Sachgüter und Dienstleistungen beschaffen und Verträge schließen',
    trainingYear: 1,
    hours: 120,
  },
  {
    number: 5,
    title: 'Kunden akquirieren und binden',
    trainingYear: 2,
    hours: 80,
  },
  {
    number: 6,
    title: 'Werteströme erfassen und beurteilen',
    trainingYear: 2,
    hours: 80,
  },
  {
    number: 7,
    title: 'Gesprächssituationen gestalten',
    trainingYear: 2,
    hours: 40,
  },
  {
    number: 8,
    title: 'Personalwirtschaftliche Aufgaben wahrnehmen',
    trainingYear: 2,
    hours: 80,
  },
  {
    number: 9,
    title: 'Liquidität sichern und Finanzierung vorbereiten',
    trainingYear: 3,
    hours: 80,
  },
  {
    number: 10,
    title: 'Wertschöpfungsprozesse erfolgsorientiert steuern',
    trainingYear: 3,
    hours: 80,
  },
  {
    number: 11,
    title: 'Geschäftsprozesse darstellen und optimieren',
    trainingYear: 3,
    // The PDF reads "40. Stunden" (typing error), the value is 40, see above.
    hours: 40,
  },
  {
    number: 12,
    title: 'Veranstaltungen und Geschäftsreisen organisieren',
    trainingYear: 3,
    hours: 40,
  },
  {
    number: 13,
    title: 'Ein Projekt planen und durchführen',
    trainingYear: 3,
    hours: 40,
  },
];

/** The official entry of a learning field number, undefined outside 1 to 13. */
export function officialLearningField(
  number: number
): OfficialLearningField | undefined {
  return OFFICIAL_LEARNING_FIELDS.find(f => f.number === number);
}

/** Sum of the time guidelines of all learning fields, or of one school year. */
export function officialHours(year?: SchoolYear): number {
  return OFFICIAL_LEARNING_FIELDS.filter(
    f => year === undefined || f.trainingYear === year
  ).reduce((sum, f) => sum + f.hours, 0);
}
