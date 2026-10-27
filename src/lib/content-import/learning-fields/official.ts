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
// Description: the verbatim "Zielformulierung" of each learning field, the
// first paragraph below the title and the "Zeitrichtwert" in Teil V of the same
// framework curriculum (one sentence that starts "Die Schülerinnen und Schüler
// besitzen / verfügen über die Kompetenz ..."). Nothing is paraphrased. Only the
// layout of the PDF is cleaned: line breaks become spaces and the syllable
// hyphens at the end of a line are removed ("Be-" and "triebs" is "Betriebs").
// A hyphen that belongs to the word stays ("Preis- und Kommunikationspolitik").
// The Zielformulierung is the form of the description the FIAE learning fields
// have (one or two sentences, 100 to 250 characters), so the learning field
// pages look the same for both occupations. The "Inhalte" are not taken over:
// in the framework curriculum they are not a list of their own, they stand as
// bracketed examples inside the running text of the competence description.
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
  /** Verbatim "Zielformulierung" of the framework curriculum. */
  description: string;
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
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, ihre Rolle innerhalb des Betriebs aktiv zu gestalten und ihren Betrieb adressatengerecht zu präsentieren.',
  },
  {
    number: 2,
    title: 'Büroprozesse gestalten und Arbeitsvorgänge organisieren',
    trainingYear: 1,
    hours: 80,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, ihre Arbeitsprozesse im Büro eigenverantwortlich und effizient zu planen und zu gestalten sowie gesundheitliche und rechtliche Aspekte, auch im Umgang miteinander, zu berücksichtigen.',
  },
  {
    number: 3,
    title: 'Aufträge bearbeiten',
    trainingYear: 1,
    hours: 80,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, Anfragen zu beantworten, Angebote zu erstellen und Aufträge anzunehmen sowie störungsfreie Prozesse fachgerecht auszuführen.',
  },
  {
    number: 4,
    title: 'Sachgüter und Dienstleistungen beschaffen und Verträge schließen',
    trainingYear: 1,
    hours: 120,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, Beschaffungsprozesse zu planen, durchzuführen und zu überwachen.',
  },
  {
    number: 5,
    title: 'Kunden akquirieren und binden',
    trainingYear: 2,
    hours: 80,
    description:
      'Die Schülerinnen und Schüler verfügen über die Kompetenz, den Einsatz von Preis- und Kommunikationspolitik für die Kundengewinnung und -bindung zu nutzen.',
  },
  {
    number: 6,
    title: 'Werteströme erfassen und beurteilen',
    trainingYear: 2,
    hours: 80,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, Werteströme im Betrieb prozessbegleitend zu erfassen und ordnungsgemäß zu dokumentieren sowie die Auswirkungen auf den Betriebserfolg zu beurteilen.',
  },
  {
    number: 7,
    title: 'Gesprächssituationen gestalten',
    trainingYear: 2,
    hours: 40,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, in Gesprächssituationen mit Geschäftspartnern angemessen und sachgerecht zu handeln.',
  },
  {
    number: 8,
    title: 'Personalwirtschaftliche Aufgaben wahrnehmen',
    trainingYear: 2,
    hours: 80,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, bei der Beschaffung, Verwaltung und Entwicklung von Personal sowie bei der Beendigung von Arbeitsverhältnissen mitzuwirken.',
  },
  {
    number: 9,
    title: 'Liquidität sichern und Finanzierung vorbereiten',
    trainingYear: 3,
    hours: 80,
    description:
      'Die Schülerinnen und Schüler verfügen über die Kompetenz, die Liquidität ihres Betriebes zu sichern und Finanzierungsentscheidungen für Investitionen unter Berücksichtigung der Rechtsform des Betriebes vorzubereiten.',
  },
  {
    number: 10,
    title: 'Wertschöpfungsprozesse erfolgsorientiert steuern',
    trainingYear: 3,
    hours: 80,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, Wertschöpfungsprozesse auf Grundlage der Daten der Kosten- und Leistungsrechnung zu analysieren, erfolgsorientiert zu steuern und zu beurteilen.',
  },
  {
    number: 11,
    title: 'Geschäftsprozesse darstellen und optimieren',
    trainingYear: 3,
    // The PDF reads "40. Stunden" (typing error), the value is 40, see above.
    hours: 40,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, die Arbeits- und Geschäftsprozesse des Betriebes darzustellen, zu optimieren und zur Qualitätssicherung sowie zur kontinuierlichen Verbesserung von Arbeitsprozessen beizutragen.',
  },
  {
    number: 12,
    title: 'Veranstaltungen und Geschäftsreisen organisieren',
    trainingYear: 3,
    hours: 40,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, Veranstaltungen und Geschäftsreisen eigenverantwortlich und effizient zu planen, mit zu gestalten und zu dokumentieren.',
  },
  {
    number: 13,
    title: 'Ein Projekt planen und durchführen',
    trainingYear: 3,
    hours: 40,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, selbstständig und eigenverantwortlich ein branchenbezogenes Projekt von der Projektidee bis zur Projektauswertung zu realisieren.',
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
