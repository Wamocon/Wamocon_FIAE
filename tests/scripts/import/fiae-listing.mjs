// The names of the component folders of the FIAE delivery as test data (only the names, the tests
// rebuild them as empty folders in a throwaway directory). No original file is used.

const pad = n => String(n).padStart(2, '0');

/** The 26 folders of the delivery of 02.11.2026 (final numbering), names as listed. */
export const FINAL_LISTING = [
  '01_Planen, Vorbereiten und Durchführen von Arbeitsaufgaben (§4 Absatz 2 Nr 1)',
  '02.1_Informieren und Beraten von Kunden (§4 Absatz 2 Nr 2)',
  '02.2_Informieren und Beraten von Kunden und Kundinnen',
  '03.1_Beurteilen marktgängiger IT-Systeme (§4 Absatz 2 Nr 3)',
  '03.2_Beurteilen marktgängiger IT-Systeme',
  '04.1_Entwickeln, Erstellen und Betreuen (§4 Absatz 2 Nr 4)',
  '04.2_Entwickeln, Erstellen und Betreuen von IT-Lösungen',
  '05.1_Durchführen und Dokumentieren von Maßnahmen (§4 Absatz 2 Nr 5)',
  '05.2_Durchführen und Dokumentieren von qualitätssichernden Maßnahmen',
  '06.1_Umsetzen, Integrieren und Prüfen von Maßnahmen (§4 Absatz 2 Nr 6)',
  '06.2_Umsetzen, Integrieren und Prüfung von Maßnahmen zur IT-Sicherheit und Datenschutz',
  '07_Erbringen der Leistungen und Auftragsabschluss (§4 Absatz 2 Nr 7)',
  '08.1_Betreiben von IT-Systemen (§4 Absatz 2 Nr 8)',
  '08.2_Betreiben von IT-Systemen',
  '09.1_Programmieren_von_Softwarelösungen (§4 Absatz 2 Nr 10)',
  '09.2_Programmieren von Softwarelösungen',
  '10.1_Konzipieren und Umsetzen von Softwareanwendungen (§4 Absatz 3 Nr 1)',
  '10.2_Konzipieren von Softwareanwendungen',
  '11.1_Sicherstellen der Qualität von Softwareanwendungen (§4 Absatz 3 Nr 2)',
  '11.2_Sicherstellen der Qualität von Softwareanwendungen',
  '12_Vernetztes Zusammenarbeiten unter Nutzung digitaler Medien (§4 Absatz 7 Nr 5)',
  '13_Inbetriebnehmen von Speicherlösungen',
  '14_Berufsausbildung, Arbeits- und Tarifrecht',
  '15_Aufbau und Organisation des Ausbildungsbetriebes',
  '16_Sicherheit und Gesundheitsschutz bei der Arbeit',
  '17_Umweltschutz',
];

/** The same 26 folders in the old numbering (the number is the order index). */
export const OLD_LISTING = Array.from({ length: 26 }, (_, i) => {
  const nr = i + 1;
  return `${pad(nr)}_Titel ${nr}`;
});
