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
// Description: the verbatim text of the learning field in Teil V of the same
// framework curriculum, like the FIAE learning fields have it (the text of the
// framework curriculum, on average 1263 characters, at most 2117, paragraphs
// separated by a blank line): first the "Zielformulierung" (the first paragraph
// below the title and the "Zeitrichtwert", one sentence that starts "Die
// Schülerinnen und Schüler besitzen / verfügen über die Kompetenz ..."), then the
// paragraphs of the competence description that follow it, whole paragraphs only,
// as many as stay within 1400 characters (the whole text of a learning field has
// 1700 to 4500). The "Inhalte" are not a list of their own in this framework
// curriculum, they stand as bracketed examples inside these paragraphs, so they
// come along. Nothing is paraphrased. Only the layout of the PDF is cleaned: line
// breaks inside a paragraph become spaces and the syllable hyphens at the end of
// a line are removed ("Be-" and "triebs" is "Betriebs"). A hyphen that belongs
// to the word stays ("Preis- und Kommunikationspolitik", "Ist-Aufnahme"). The
// source of each text is OFFICIAL_SOURCE, Teil V, the chapter of the learning
// field. The owner said the learning field description of KfBM has the form of
// the FIAE one (28.10.2026), an earlier version of this file took only the
// Zielformulierung on the assumption of 100 to 250 characters.
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
  /**
   * Verbatim text of the framework curriculum: the "Zielformulierung" and the
   * paragraphs that follow it up to 1400 characters, separated by a blank line.
   */
  description: string;
}

export const OFFICIAL_SOURCE =
  'Rahmenlehrplan Kaufmann/Kauffrau für Büromanagement, KMK-Beschluss vom 27.09.2013 in der Fassung vom 20.03.2025, Teil V Lernfelder';

export const OFFICIAL_LEARNING_FIELDS: readonly OfficialLearningField[] = [
  {
    number: 1,
    title:
      'Die eigene Rolle im Betrieb mitgestalten und den Betrieb präsentieren',
    trainingYear: 1,
    hours: 40,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, ihre Rolle innerhalb des Betriebs aktiv zu gestalten und ihren Betrieb adressatengerecht zu präsentieren.\n\nDie Schülerinnen und Schüler klären ihren Verantwortungsbereich im Betrieb und identifizieren sich mit ihrer Rolle als Auszubildende und als zukünftige Arbeitnehmer und Arbeitnehmerin, die auf unterschiedlichen rechtlichen Grundlagen basieren.\n\nDie Schülerinnen und Schüler analysieren ihre eigenen Rechte und Pflichten, informieren sich über Inhalte und Regelungen der Ausbildungsverträge sowie ihre Mitbestimmungsrechte durch die Jugend- und Auszubildendenvertretung. Sie informieren sich über geltendes Recht (Berufsbildungsgesetz, Jugendarbeitsschutzgesetz) und das für sie geltende Tarifrecht. Ebenso erkunden sie Möglichkeiten beruflicher Fort- und Weiterbildung.\n\nDie Schülerinnen und Schüler recherchieren und bewerten Informationen und deren Quellen zur Darstellung ihres Betriebes, auch mit digitalen Medien, und überprüfen die Validität der Informationen. Sie erschließen das Leistungsspektrum ihres Betriebes, die eingesetzten betriebswirtschaftlichen Produktionsfaktoren, auch unter Berücksichtigung von Aspekten der Nachhaltigkeit. Sie analysieren die Ziele ihres Betriebes sowie dessen Stellung in der arbeitsteiligen Wirtschaft und innerhalb des erweiterten Wirtschaftskreislaufes.',
  },
  {
    number: 2,
    title: 'Büroprozesse gestalten und Arbeitsvorgänge organisieren',
    trainingYear: 1,
    hours: 80,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, ihre Arbeitsprozesse im Büro eigenverantwortlich und effizient zu planen und zu gestalten sowie gesundheitliche und rechtliche Aspekte, auch im Umgang miteinander, zu berücksichtigen.\n\nDie Schülerinnen und Schüler zeigen die Bereitschaft, die komplexen Herausforderungen ihres Aufgabenbereichs engagiert und verantwortungsbewusst zu bewältigen. Sie analysieren die Anforderungen an die Gestaltung ihrer jeweiligen Arbeitsprozesse sowie ihres Arbeitsplatzes und Arbeitsraumes. Sie überprüfen ihre digitale Schreibfertigkeit, soweit sie für die Erledigung ihrer Aufgaben angemessen ist.\n\nDie Schülerinnen und Schüler informieren sich über die Anforderungen an bürowirtschaftliche Abläufe. Sie erkunden gesetzliche Vorschriften zur Gestaltung des Arbeitsplatzes und -raumes sowie ergonomische und ökologische Erfordernisse.\n\nDie Schülerinnen und Schüler recherchieren Maßnahmen zur Erhaltung und Förderung ihrer Gesundheit. Sie entwickeln Strategien zur Bewältigung von Belastungen am Arbeitsplatz (Stress, Burnout) und Konflikten (Mobbing).\n\nSie planen unter ergonomischen, ökologischen und ablauforganisatorischen Aspekten die Gestaltung ihres Arbeitsplatzes (Büroraumkonzepte, Homeoffice, mobiles Arbeiten). Sie achten auf die Arbeitssicherheit und die Erhaltung ihrer Gesundheit (Bewegung, Ernährung, Stressregulation, Suchtprävention).',
  },
  {
    number: 3,
    title: 'Aufträge bearbeiten',
    trainingYear: 1,
    hours: 80,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, Anfragen zu beantworten, Angebote zu erstellen und Aufträge anzunehmen sowie störungsfreie Prozesse fachgerecht auszuführen.\n\nDie Schülerinnen und Schüler analysieren den Geschäftsprozess der Auftragsbearbeitung und ihren Verantwortungsbereich sowie ihre Befugnisse in diesem Prozess. Sie sind bereit, mit anderen zusammenzuarbeiten und nehmen Kunden als wichtige Partner wahr. Sie erschließen sich die Struktur von büroüblichen Applikationen.\n\nDie Schülerinnen und Schüler sondieren die betrieblichen Rahmenbedingungen für die Erstellung von Angeboten. Sie informieren sich über die Formulierung und normgerechte Gestaltung von Texten des internen und externen Schriftverkehrs.\n\nDie Schülerinnen und Schüler organisieren eine fachgerechte und kundenorientierte Abwicklung von Aufträgen. Sie berücksichtigen dabei die Interessen des Betriebes, unterschiedliche Bedürfnisse der Kunden und die Aspekte der Nachhaltigkeit.',
  },
  {
    number: 4,
    title: 'Sachgüter und Dienstleistungen beschaffen und Verträge schließen',
    trainingYear: 1,
    hours: 120,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, Beschaffungsprozesse zu planen, durchzuführen und zu überwachen.\n\nDie Schülerinnen und Schüler definieren ihren Verantwortungsbereich bei der Durchführung von Beschaffungs- und Lagerhaltungsprozessen.\n\nDie Schülerinnen und Schüler ermitteln den Bedarf an betriebsnotwendigen Gütern und beachten dabei das ökonomische Prinzip sowie Aspekte des nachhaltigen Wirtschaftens. Sie recherchieren Bezugsquellen unter Verwendung verschiedener Kommunikationswege und Datenquellen. Sie informieren sich über die Inhalte von Angeboten. Sie identifizieren rechtliche und ökonomische Handlungsspielräume sowie betriebliche Vorgaben bei Konflikten in Kaufvertragsstörungen.\n\nDie Schülerinnen und Schüler bestimmen die erforderlichen Bestell- und Lieferzeitpunkte sowie die optimale Bestellmenge. Sie erstellen mit einem Tabellenkalkulationsprogramm Diagramme und nutzen diese für ihre Entscheidung. Sie wählen kriterienorientiert Möglichkeiten der Lagerung aus.\n\nDie Schülerinnen und Schüler schreiben mit Hilfe eines Textverarbeitungsprogramms Anfragen norm- und sachgerecht. Sie bewerten und vergleichen eingehende Angebote nach quantitativen und qualitativen Kriterien mit Hilfe der Nutzwertanalyse und setzen dafür ein Tabellenkalkulationsprogramm ein. Dabei nutzen sie notwendige Funktionen wie WENN, ZÄHLENWENN, SUMMEWENN und SVERWEIS.',
  },
  {
    number: 5,
    title: 'Kunden akquirieren und binden',
    trainingYear: 2,
    hours: 80,
    description:
      'Die Schülerinnen und Schüler verfügen über die Kompetenz, den Einsatz von Preis- und Kommunikationspolitik für die Kundengewinnung und -bindung zu nutzen.\n\nDie Schülerinnen und Schüler analysieren anhand der Daten der Marktforschung (Primär- und Sekundärforschung) und der Kundendaten die aktuelle Marktsituation (Kundenstruktur, Konkurrenz, konjunkturelle Lage) zum Leistungsangebot des Betriebes. Sie gestalten auf der Basis vorgegebener Elemente einen Fragebogen mit den Anwendungsmöglichkeiten (Formulargestaltung) mit Hilfe digitaler Medien.\n\nDie Schülerinnen und Schüler informieren sich darüber, auf welchem Markt (Käufer- und Verkäufermarkt) sich ihr Betrieb befindet. Sie leiten daraus die absatzpolitischen Ziele und Möglichkeiten der Preisfestsetzung auch mithilfe von Modellen (vollständige Konkurrenz) ab.\n\nSie nehmen Kundinnen und Kunden als wichtige Partner wahr, ermitteln den spezifischen Nutzen von Produkten und Dienstleistungen für diese und gestalten Kundenbeziehungen. Sie identifizieren Wettbewerbsstrategien, um die absatzpolitischen Ziele des Betriebes zu erreichen.\n\nIm Rahmen einer Werbeplanung treffen die Schülerinnen und Schüler Entscheidungen zur Zielgruppe sowie zum Streugebiet und zur Streuzeit. Sie planen dabei den möglichen Einsatz von sozialen Netzwerken zur Optimierung der Unternehmensprofilbildung und der Erhöhung der Kundenzufriedenheit.',
  },
  {
    number: 6,
    title: 'Werteströme erfassen und beurteilen',
    trainingYear: 2,
    hours: 80,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, Werteströme im Betrieb prozessbegleitend zu erfassen und ordnungsgemäß zu dokumentieren sowie die Auswirkungen auf den Betriebserfolg zu beurteilen.\n\nDie Schülerinnen und Schüler identifizieren mit den Kategorien Güter, Geld und Information systematisch Werteströme ihres Betriebes anhand von Belegen, die im Rahmen der Geschäftsprozesse entstehen.\n\nSie informieren sich über die rechtlichen Anforderungen an eine ordnungsgemäße Buchführung (Handelsgesetzbuch, Abgabenordnung, Umsatzsteuergesetz).\n\nDie Schülerinnen und Schüler strukturieren zeitliche und organisatorische Abläufe zur Bearbeitung der Belege unter Berücksichtigung der betrieblichen Rahmenbedingungen.\n\nDie Schülerinnen und Schüler kontieren Eingangsrechnungen von Sachgütern und Dienstleistungen und dokumentieren die zugrundeliegenden Geschäftsvorfälle. Sie nutzen das aufwandsrechnerische Verfahren beim Einkauf von Handelswaren und buchen Ausgangsrechnungen aus deren Verkauf. Sie buchen die notwendigen Zahlungen unter Berücksichtigung von Skonto. Sie führen Stornobuchungen (Rücksendung) durch. Sie erfassen buchhalterisch Wertminderungen von Anlagegütern. Sie berücksichtigen die Umsatzsteuer und erstellen Umsatzsteuervoranmeldungen.',
  },
  {
    number: 7,
    title: 'Gesprächssituationen gestalten',
    trainingYear: 2,
    hours: 40,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, in Gesprächssituationen mit Geschäftspartnern angemessen und sachgerecht zu handeln.\n\nDie Schülerinnen und Schüler erfassen die unterschiedlichen Anforderungen, die Gesprächssituationen (Beratung, Beschwerde, Reklamation) mit sich bringen. Sie zeigen Bereitschaft und Flexibilität, Gespräche engagiert und verantwortungsbewusst zu führen.\n\nDie Schülerinnen und Schüler erkennen mögliche Konflikte und deren Ursachen in Gesprächssituationen.\n\nDie Schülerinnen und Schüler informieren sich über die Möglichkeiten der Kommunikation mit Geschäftspartnern ihres Betriebes. Dazu schätzen sie die jeweilige Kommunikationssituation ein.\n\nSie recherchieren Techniken der Kommunikation sowie rechtliche und betriebliche Regelungen, wobei sie auch interkulturelle Besonderheiten ermitteln.\n\nDie Schülerinnen und Schüler ermitteln die Wünsche, Emotionen und Interessen der Geschäftspartner durch aktives Zuhören und gezielte Fragestellung sowie durch die Analyse von Äußerungen und Verhalten.\n\nDie Schülerinnen und Schüler wählen die Kommunikationswege aus, definieren die situationsbezogenen Gesprächsziele und sammeln Argumente für die Gespräche. Sie achten auf eine positive Gesprächsatmosphäre zur Umsetzung ihrer Ziele.',
  },
  {
    number: 8,
    title: 'Personalwirtschaftliche Aufgaben wahrnehmen',
    trainingYear: 2,
    hours: 80,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, bei der Beschaffung, Verwaltung und Entwicklung von Personal sowie bei der Beendigung von Arbeitsverhältnissen mitzuwirken.\n\nDie Schülerinnen und Schüler analysieren den Personalbestand in quantitativer und qualitativer Hinsicht, um personalwirtschaftliche Entscheidungen vorzubereiten. Dabei berücksichtigen sie die konjunkturelle Situation und gesamtwirtschaftliche Faktoren (Demografie, außenwirtschaftliche Entwicklungen) und gesellschaftliche Verantwortung (Inklusion, Migration).\n\nDie Schülerinnen und Schüler bestimmen den quantitativen und qualitativen Personalbedarf unter Berücksichtigung der betrieblichen Ziele. Sie informieren sich bei einer Unterdeckung über Wege der Personalbeschaffung (intern, extern), über die Kompetenzanforderungen sowie die organisatorische Einbindung neuer Mitarbeiter und Mitarbeiterinnen.\n\nDie Schülerinnen und Schüler ermitteln die rechtlichen Anforderungen (Gesetze, Tarifverträge, Betriebsvereinbarungen) beim Abschluss und der Beendigung von unterschiedlichen Arten eines Arbeitsvertrages. Sie informieren sich über die gesetzlichen Bestimmungen des sozialen Arbeitsschutzes (Mutterschutzgesetz) sowie über die Erfordernisse der Inklusion.',
  },
  {
    number: 9,
    title: 'Liquidität sichern und Finanzierung vorbereiten',
    trainingYear: 3,
    hours: 80,
    description:
      'Die Schülerinnen und Schüler verfügen über die Kompetenz, die Liquidität ihres Betriebes zu sichern und Finanzierungsentscheidungen für Investitionen unter Berücksichtigung der Rechtsform des Betriebes vorzubereiten.\n\nDie Schülerinnen und Schüler analysieren mögliche Maßnahmen für den Betrieb, um liquide zu bleiben. Sie sondieren ihren Handlungsspielraum bei der Sicherung der Liquidität. Sie klären die Vorgaben für die Finanzierung von geplanten Anschaffungen des Betriebes und ihren jeweiligen Verantwortungsbereich.\n\nDie Schülerinnen und Schüler informieren sich über die Möglichkeiten der anlassbezogenen Bonitätsprüfung sowie über die Erfassung von Zahlungsströmen. Sie ermitteln Zahlungsstörungen und bestimmen eine liquiditäts- und kundenorientierte Reaktion darauf.\n\nSie eruieren auch mit Hilfe digitaler Medien Alternativen der Finanzierung von Investitionen.\n\nSie erkunden die Regelungen zur Vertretung, Geschäftsführung, Haftung und Gewinnverteilung in Abhängigkeit von der Rechtsform des Unternehmens (Einzelunternehmung, Kommanditgesellschaft, Gesellschaft mit beschränkter Haftung).\n\nSie informieren sich über die grundsätzliche Vorgehensweise bei der Beantragung von Krediten und deren Sicherungen.\n\nDie Schülerinnen und Schüler planen mit Budgets und ordnen die künftigen Einnahmen und Ausgaben des Betriebes nach deren Fälligkeit.',
  },
  {
    number: 10,
    title: 'Wertschöpfungsprozesse erfolgsorientiert steuern',
    trainingYear: 3,
    hours: 80,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, Wertschöpfungsprozesse auf Grundlage der Daten der Kosten- und Leistungsrechnung zu analysieren, erfolgsorientiert zu steuern und zu beurteilen.\n\nDie Schülerinnen und Schüler identifizieren Kosten (Einzel- und Gemeinkosten, fixe und variable Kosten) und Leistungen in ihrem Betrieb.\n\nDie Schülerinnen und Schüler informieren sich über die Kostenarten des Betriebes.\n\nDie Schülerinnen und Schüler bereiten alle Daten für die Durchführung der Kostenarten- sowie der Kostenstellenrechnung vor.\n\nDie Schülerinnen und Schüler ermitteln das Betriebsergebnis mit Hilfe der Ergebnistabelle. Dazu grenzen sie Aufwendungen und Erträgen ab und berücksichtigen kalkulatorische Kosten (kalkulatorischer Unternehmerlohn, kalkulatorische Abschreibungen).\n\nDie Schülerinnen und Schüler nutzen die ermittelten Kosten für die Kostenstellenrechnung und führen diese auf der Grundlage des einfachen Betriebsabrechnungsbogens durch.\n\nSie errechnen im Rahmen einer Kostenträgerrechnung auf Vollkostenbasis Selbstkosten und kalkulieren Angebotspreise für die Produkte und Dienstleistungen ihres Betriebes (einfache Zuschlagskalkulation, Kalkulation von Handelswaren in Form der Vorwärts- und Rückwärtskalkulation). Dabei nutzen sie die Tabellenkalkulation.',
  },
  {
    number: 11,
    title: 'Geschäftsprozesse darstellen und optimieren',
    trainingYear: 3,
    // The PDF reads "40. Stunden" (typing error), the value is 40, see above.
    hours: 40,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, die Arbeits- und Geschäftsprozesse des Betriebes darzustellen, zu optimieren und zur Qualitätssicherung sowie zur kontinuierlichen Verbesserung von Arbeitsprozessen beizutragen.\n\nDie Schülerinnen und Schüler differenzieren die Geschäftsprozesse (Kern- und Unterstützungsprozesse) des Betriebes.\n\nSie informieren sich über die Bedeutung von Schnittstellen bei der Vorgangsbearbeitung und Informationsweitergabe. Sie identifizieren Schnittstellen zwischen den Prozessen. Dabei nutzen sie Handbücher, Verfahrensanweisungen und digitale Leitfäden.\n\nSie recherchieren mögliche Darstellungsformen von Geschäfts- und Arbeitsprozessen.\n\nDie Schülerinnen und Schüler stellen den organisatorischen Aufbau des Betriebes mit seinen Aufgaben und Zuständigkeiten und dessen Leitungssystem dar. Sie fertigen eine Ist-Aufnahme der Prozesse an, um die Geschäfts- und Arbeitsprozesse (Ablaufdiagramme, ereignisgesteuerte Prozesskette) darzustellen und identifizieren Schwachstellen. Sie entwickeln im Team Vorschläge zur Optimierung der Abläufe im Rahmen der kontinuierlichen Verbesserung von Kern- und Unterstützungsprozessen und dokumentieren diese. Dabei berücksichtigen sie die Informations- und Entscheidungswege sowie Schnittstellen.',
  },
  {
    number: 12,
    title: 'Veranstaltungen und Geschäftsreisen organisieren',
    trainingYear: 3,
    hours: 40,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, Veranstaltungen und Geschäftsreisen eigenverantwortlich und effizient zu planen, mit zu gestalten und zu dokumentieren.\n\nDie Schülerinnen und Schüler zeigen Bereitschaft und Flexibilität, Veranstaltungen und Geschäftsreisen engagiert und verantwortungsbewusst zu organisieren.\n\nDie Schülerinnen und Schüler informieren sich über die Zielsetzungen und Anforderungen ihrer jeweiligen Veranstaltungsart (Sitzung, Konferenz, Videokonferenz, Kongress, Messe, Seminar, Webinar, Tagung).\n\nSie erfassen die Rahmenbedingungen und Wünsche der Reisenden an die Geschäftsreisen und sondieren Angebote für die Verkehrsmittel sowie die Unterkunft für die Reise.\n\nDie Schülerinnen und Schüler bereiten Veranstaltungen vor. Sie stellen gemäß dem Anlass das Programm und die Tagesordnung zusammen. Sie sorgen für die notwendigen Ressourcen, wie die Bereitstellung der Räume, der Medien und des Caterings. Sie verfassen Einladungsschreiben, auch in einer Fremdsprache.\n\nSie erstellen Zeit- und Arbeitspläne ihrer Veranstaltung. Sie nutzen digitale inner- und außerbetriebliche Kommunikationssysteme.\n\nDie Schülerinnen und Schüler wählen Verkehrswege, -mittel und Übernachtungsmöglichkeiten für die Geschäftsreise. Sie beachten dabei die Dauer, Entfernungen und örtliche Gegebenheiten des Reiseziels und den Aspekten der Nachhaltigkeit.',
  },
  {
    number: 13,
    title: 'Ein Projekt planen und durchführen',
    trainingYear: 3,
    hours: 40,
    description:
      'Die Schülerinnen und Schüler besitzen die Kompetenz, selbstständig und eigenverantwortlich ein branchenbezogenes Projekt von der Projektidee bis zur Projektauswertung zu realisieren.\n\nDie Schülerinnen und Schüler formulieren aus einem gegebenen Anlass heraus die Projektziele. Zur Ideenfindung wenden sie Kreativitätstechniken an.\n\nSie informieren sich über die für das Projekt erforderliche Projektorganisation (Struktur, Gestaltung, systematische Durchführung, Hilfsmittel), sondieren zielorientierte Maßnahmen, entscheiden sich für eine Projektmanagementmethode und leiten daraus die notwendigen Arbeitspakete ab.\n\nDie Schülerinnen und Schüler organisieren sich selbstständig in einem Projektteam und erstellen einen Projektstrukturplan sowie Projektablauf- und Terminpläne, Kapazitäts- und Qualitätspläne.\n\nSie argumentieren überzeugend für den Plan, stellen sich möglicher Kritik und gewinnen das Team für die Umsetzung des Plans. Sie legen Regeln insbesondere zur Konfliktlösung und das Projektinformationssystem fest.',
  },
];

/** The "Zielformulierung" of a learning field: the first paragraph of its description. */
export function officialGoal(number: number): string | undefined {
  return officialLearningField(number)?.description.split('\n\n')[0];
}

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
