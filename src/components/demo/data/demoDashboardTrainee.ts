export const traineeStats = {
  overallProgress: 72,
  completedModules: 8,
  totalModules: 14,
  quizAverage: 84,
  streak: 12,
  totalHours: 186,
  rank: 2,
  totalTrainees: 6,
};

export const weeklyProgress = [
  { day: 'Mo', hours: 4.5, quizzes: 2 },
  { day: 'Di', hours: 3.0, quizzes: 1 },
  { day: 'Mi', hours: 5.5, quizzes: 3 },
  { day: 'Do', hours: 2.0, quizzes: 0 },
  { day: 'Fr', hours: 6.0, quizzes: 2 },
  { day: 'Sa', hours: 1.5, quizzes: 1 },
  { day: 'So', hours: 0, quizzes: 0 },
];

export const skillRadar = [
  { skill: 'Programmierung', value: 85 },
  { skill: 'Datenbanken', value: 70 },
  { skill: 'Netzwerke', value: 65 },
  { skill: 'IT-Sicherheit', value: 60 },
  { skill: 'Projektmanagement', value: 50 },
  { skill: 'Webentwicklung', value: 78 },
];

export const moduleProgress = [
  { name: 'Komp. 1', progress: 100 },
  { name: 'Komp. 2', progress: 100 },
  { name: 'Komp. 3', progress: 85 },
  { name: 'Komp. 4', progress: 60 },
  { name: 'Komp. 5', progress: 40 },
  { name: 'Komp. 6', progress: 20 },
  { name: 'Komp. 7', progress: 0 },
  { name: 'Komp. 8', progress: 0 },
];

export const recentActivity = [
  {
    id: '1',
    type: 'quiz' as const,
    title: 'Netzwerktechnik Quiz \u2014 Schwer',
    date: '2026-02-24',
    score: 92,
    description: '11 von 12 Fragen richtig',
  },
  {
    id: '2',
    type: 'enabler' as const,
    title: 'Enabler 5.3: SQL-Joins abgeschlossen',
    date: '2026-02-23',
    description: 'Kurs-Enabler abgeschlossen',
  },
  {
    id: '3',
    type: 'quiz' as const,
    title: 'IT-Sicherheit Quiz \u2014 Mittel',
    date: '2026-02-22',
    score: 78,
    description: '7 von 9 Fragen richtig',
  },
  {
    id: '4',
    type: 'report' as const,
    title: 'T\u00e4tigkeitsnachweis KW 8 eingereicht',
    date: '2026-02-21',
    description: 'Wochenbericht erfolgreich eingereicht',
  },
  {
    id: '5',
    type: 'enabler' as const,
    title: 'Enabler 4.2: Firewall-Konfiguration',
    date: '2026-02-20',
    description: 'Kurs-Enabler abgeschlossen',
  },
];

export const achievements = [
  { id: '1', title: 'Erste Schritte', icon: '\ud83c\udf1f', unlocked: true, description: 'Erstes Modul abgeschlossen' },
  { id: '2', title: 'Quiz-Meister', icon: '\ud83c\udfc6', unlocked: true, description: '10 Quizze bestanden' },
  { id: '3', title: 'Streak-K\u00f6nig', icon: '\ud83d\udd25', unlocked: true, description: '7 Tage in Folge aktiv' },
  { id: '4', title: 'Halbzeit', icon: '\u23f3', unlocked: true, description: '50% Fortschritt erreicht' },
  { id: '5', title: 'Perfektionist', icon: '\ud83d\udc8e', unlocked: false, description: 'Alle Quizze mit 100%' },
  { id: '6', title: 'Absolvent', icon: '\ud83c\udf93', unlocked: false, description: 'Alle Module abgeschlossen' },
];

export const nextLesson = {
  title: 'Enabler 3.6: VLAN-Konfiguration',
  course: 'Clients in Netzwerk einbinden',
  component: 'Komponente 3',
  estimatedTime: '45 Min.',
};
