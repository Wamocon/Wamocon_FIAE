export interface DemoLernfeld {
  id: string;
  number: number;
  title: string;
  description: string;
  hours: number;
  year: number;
  grade?: number;
  status: 'completed' | 'in_progress' | 'upcoming';
}

export const demoLernfelder: DemoLernfeld[] = [
  {
    id: 'lf1',
    number: 1,
    title: 'Das Unternehmen und die eigene Rolle im Betrieb beschreiben',
    description: 'Wirtschaftliche und gesellschaftliche Zusammenhänge, Arbeitsrecht, Unternehmensformen',
    hours: 40,
    year: 1,
    grade: 2.3,
    status: 'completed',
  },
  {
    id: 'lf2',
    number: 2,
    title: 'Arbeitsplätze nach Kundenwunsch ausstatten',
    description: 'Hardware, Software, Betriebssysteme, Kundenberatung',
    hours: 80,
    year: 1,
    grade: 1.7,
    status: 'completed',
  },
  {
    id: 'lf3',
    number: 3,
    title: 'Clients in Netzwerke einbinden',
    description: 'Netzwerktopologien, Protokolle, Adressierung, WLAN',
    hours: 80,
    year: 1,
    grade: 2.0,
    status: 'completed',
  },
  {
    id: 'lf4',
    number: 4,
    title: 'Schutzbedarfsanalyse im eigenen Arbeitsbereich durchführen',
    description: 'IT-Sicherheit, Datenschutz, Verschlüsselung, BSI-Grundschutz',
    hours: 40,
    year: 1,
    grade: 2.7,
    status: 'completed',
  },
  {
    id: 'lf5',
    number: 5,
    title: 'Software zur Verwaltung von Daten anpassen',
    description: 'Datenbanken, SQL, ER-Modellierung, Normalisierung',
    hours: 80,
    year: 1,
    status: 'in_progress',
  },
  {
    id: 'lf6',
    number: 6,
    title: 'Serviceanfragen bearbeiten',
    description: 'ITIL, Service-Level-Agreements, Ticketsysteme',
    hours: 40,
    year: 2,
    status: 'upcoming',
  },
  {
    id: 'lf7',
    number: 7,
    title: 'Cyber-physische Systeme ergänzen',
    description: 'IoT, Sensoren, Aktoren, eingebettete Systeme',
    hours: 80,
    year: 2,
    status: 'upcoming',
  },
  {
    id: 'lf8',
    number: 8,
    title: 'Daten systemübergreifend bereitstellen',
    description: 'APIs, XML, JSON, Webservices, Datenaustauschformate',
    hours: 80,
    year: 2,
    status: 'upcoming',
  },
];

export const demoExams = [
  {
    id: 'e1',
    title: 'Zwischenprüfung (AP Teil 1)',
    date: '2026-03-25',
    type: 'Schriftlich',
    duration: '90 Min.',
    topics: ['Einrichten eines IT-gestützten Arbeitsplatzes'],
    status: 'upcoming' as const,
  },
  {
    id: 'e2',
    title: 'Klassenarbeit — Lernfeld 5',
    date: '2026-03-10',
    type: 'Schriftlich',
    duration: '60 Min.',
    topics: ['SQL', 'ER-Modellierung', 'Normalisierung'],
    status: 'upcoming' as const,
  },
  {
    id: 'e3',
    title: 'Klassenarbeit — Lernfeld 4',
    date: '2026-01-20',
    type: 'Schriftlich',
    duration: '45 Min.',
    topics: ['IT-Sicherheit', 'Datenschutz'],
    status: 'completed' as const,
    grade: 2.3,
  },
  {
    id: 'e4',
    title: 'Präsentation — Lernfeld 3',
    date: '2025-12-15',
    type: 'Mündlich',
    duration: '15 Min.',
    topics: ['Netzwerkplanung'],
    status: 'completed' as const,
    grade: 1.7,
  },
];

export const demoSchoolCalendar = [
  { date: '2026-02-26', event: 'Berufsschule — LF5 Datenbanken', type: 'school' as const },
  { date: '2026-03-05', event: 'Berufsschule — LF5 Datenbanken', type: 'school' as const },
  { date: '2026-03-10', event: 'Klassenarbeit LF5', type: 'exam' as const },
  { date: '2026-03-12', event: 'Berufsschule — LF5 Datenbanken', type: 'school' as const },
  { date: '2026-03-19', event: 'Berufsschule — LF5 Datenbanken', type: 'school' as const },
  { date: '2026-03-25', event: 'Zwischenprüfung AP Teil 1', type: 'exam' as const },
];

export const demoSchoolNotes = [
  {
    id: 'n1',
    title: 'SQL JOIN-Typen Übersicht',
    date: '2026-02-19',
    content: 'INNER JOIN, LEFT JOIN, RIGHT JOIN, FULL OUTER JOIN — Unterschiede und Anwendungsfälle',
    lernfeld: 'LF5',
  },
  {
    id: 'n2',
    title: 'Normalisierungsformen',
    date: '2026-02-12',
    content: '1NF, 2NF, 3NF — Schritte und Beispiele für die Datenbankoptimierung',
    lernfeld: 'LF5',
  },
  {
    id: 'n3',
    title: 'OSI-Modell Zusammenfassung',
    date: '2026-01-15',
    content: 'Die 7 Schichten des OSI-Modells mit Protokollen und Geräten',
    lernfeld: 'LF3',
  },
];
