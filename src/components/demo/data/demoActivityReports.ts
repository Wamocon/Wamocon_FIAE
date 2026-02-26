export interface DemoReport {
  id: string;
  week: string;
  year: number;
  trainee: string;
  traineeId: string;
  submittedAt: string;
  status: 'submitted' | 'approved' | 'rejected' | 'draft';
  totalHours: number;
  entries: {
    day: string;
    activity: string;
    hours: number;
    category: string;
  }[];
  feedback?: string;
}

export const demoReports: DemoReport[] = [
  {
    id: 'r1',
    week: 'KW 8',
    year: 2026,
    trainee: 'Max Müller',
    traineeId: 'demo-trainee-001',
    submittedAt: '2026-02-21T14:30:00',
    status: 'submitted',
    totalHours: 38.5,
    entries: [
      { day: 'Montag', activity: 'React-Komponenten für Dashboard entwickelt', hours: 7.5, category: 'Entwicklung' },
      { day: 'Dienstag', activity: 'Unit-Tests geschrieben und Code-Review', hours: 8, category: 'Testing' },
      { day: 'Mittwoch', activity: 'Berufsschule — Netzwerktechnik', hours: 8, category: 'Berufsschule' },
      { day: 'Donnerstag', activity: 'API-Endpoints implementiert', hours: 7.5, category: 'Entwicklung' },
      { day: 'Freitag', activity: 'Sprint-Review und Retrospektive', hours: 7.5, category: 'Projektmanagement' },
    ],
  },
  {
    id: 'r2',
    week: 'KW 7',
    year: 2026,
    trainee: 'Max Müller',
    traineeId: 'demo-trainee-001',
    submittedAt: '2026-02-14T16:00:00',
    status: 'approved',
    totalHours: 40,
    entries: [
      { day: 'Montag', activity: 'Datenbankschema entworfen', hours: 8, category: 'Entwicklung' },
      { day: 'Dienstag', activity: 'SQL-Migrationen geschrieben', hours: 8, category: 'Entwicklung' },
      { day: 'Mittwoch', activity: 'Berufsschule — Datenbanken', hours: 8, category: 'Berufsschule' },
      { day: 'Donnerstag', activity: 'REST-API Dokumentation erstellt', hours: 8, category: 'Dokumentation' },
      { day: 'Freitag', activity: 'Pair Programming mit Senior Dev', hours: 8, category: 'Entwicklung' },
    ],
    feedback: 'Sehr gute Arbeit! Die API-Dokumentation ist besonders gut gelungen.',
  },
  {
    id: 'r3',
    week: 'KW 6',
    year: 2026,
    trainee: 'Max Müller',
    traineeId: 'demo-trainee-001',
    submittedAt: '2026-02-07T15:20:00',
    status: 'approved',
    totalHours: 39,
    entries: [
      { day: 'Montag', activity: 'Bug-Fixing im Frontend', hours: 7, category: 'Entwicklung' },
      { day: 'Dienstag', activity: 'CSS/Tailwind Styling optimiert', hours: 8, category: 'Entwicklung' },
      { day: 'Mittwoch', activity: 'Berufsschule — Programmierung', hours: 8, category: 'Berufsschule' },
      { day: 'Donnerstag', activity: 'CI/CD-Pipeline konfiguriert', hours: 8, category: 'DevOps' },
      { day: 'Freitag', activity: 'Projektplanung nächster Sprint', hours: 8, category: 'Projektmanagement' },
    ],
    feedback: 'Gute Fortschritte bei der CI/CD-Pipeline. Weiter so!',
  },
  {
    id: 'r4',
    week: 'KW 8',
    year: 2026,
    trainee: 'Lisa Weber',
    traineeId: 'demo-trainee-002',
    submittedAt: '2026-02-21T17:00:00',
    status: 'submitted',
    totalHours: 40,
    entries: [
      { day: 'Montag', activity: 'Microservices-Architektur geplant', hours: 8, category: 'Entwicklung' },
      { day: 'Dienstag', activity: 'Docker-Container erstellt', hours: 8, category: 'DevOps' },
      { day: 'Mittwoch', activity: 'Berufsschule — IT-Sicherheit', hours: 8, category: 'Berufsschule' },
      { day: 'Donnerstag', activity: 'Kubernetes Deployment konfiguriert', hours: 8, category: 'DevOps' },
      { day: 'Freitag', activity: 'Monitoring mit Grafana eingerichtet', hours: 8, category: 'DevOps' },
    ],
  },
  {
    id: 'r5',
    week: 'KW 8',
    year: 2026,
    trainee: 'Tom Becker',
    traineeId: 'demo-trainee-003',
    submittedAt: '2026-02-22T09:30:00',
    status: 'submitted',
    totalHours: 36,
    entries: [
      { day: 'Montag', activity: 'HTML/CSS Grundlagen wiederholt', hours: 7, category: 'Lernen' },
      { day: 'Dienstag', activity: 'JavaScript-Übungen bearbeitet', hours: 7, category: 'Lernen' },
      { day: 'Mittwoch', activity: 'Berufsschule — Programmierung', hours: 8, category: 'Berufsschule' },
      { day: 'Donnerstag', activity: 'Kleines Webprojekt begonnen', hours: 7, category: 'Entwicklung' },
      { day: 'Freitag', activity: 'Code-Review mit Ausbilder', hours: 7, category: 'Entwicklung' },
    ],
  },
  {
    id: 'r6',
    week: 'KW 5',
    year: 2026,
    trainee: 'Max Müller',
    traineeId: 'demo-trainee-001',
    submittedAt: '2026-01-31T14:00:00',
    status: 'approved',
    totalHours: 40,
    entries: [
      { day: 'Montag', activity: 'Einarbeitung in neue Frameworks', hours: 8, category: 'Lernen' },
      { day: 'Dienstag', activity: 'Prototyp erstellt', hours: 8, category: 'Entwicklung' },
      { day: 'Mittwoch', activity: 'Berufsschule — Wirtschaft', hours: 8, category: 'Berufsschule' },
      { day: 'Donnerstag', activity: 'User-Stories geschrieben', hours: 8, category: 'Projektmanagement' },
      { day: 'Freitag', activity: 'Präsentation für Team vorbereitet', hours: 8, category: 'Dokumentation' },
    ],
    feedback: 'Tolle Initiative beim Prototyp!',
  },
];
