export interface DemoCourse {
  id: string;
  title: string;
  description: string;
  component: string;
  progress: number;
  totalEnablers: number;
  completedEnablers: number;
  status: 'not_started' | 'in_progress' | 'completed';
  icon: string;
}

export const demoCourses: DemoCourse[] = [
  {
    id: 'c1',
    title: 'Das Unternehmen und die eigene Rolle im Betrieb',
    description: 'Betriebliche Strukturen, Gesch\u00e4ftsprozesse und die eigene Rolle im Unternehmen verstehen.',
    component: 'Komponente 1',
    progress: 100,
    totalEnablers: 8,
    completedEnablers: 8,
    status: 'completed',
    icon: '\ud83c\udfe2',
  },
  {
    id: 'c2',
    title: 'Arbeitsplatz nach Kundenwunsch einrichten',
    description: 'IT-Arbeitspl\u00e4tze nach Kundenanforderungen planen, konfigurieren und bereitstellen.',
    component: 'Komponente 2',
    progress: 100,
    totalEnablers: 7,
    completedEnablers: 7,
    status: 'completed',
    icon: '\ud83d\udcbb',
  },
  {
    id: 'c3',
    title: 'Clients in Netzwerk einbinden',
    description: 'Netzwerkkomponenten konfigurieren und Clients in bestehende Netzwerke integrieren.',
    component: 'Komponente 3',
    progress: 85,
    totalEnablers: 6,
    completedEnablers: 5,
    status: 'in_progress',
    icon: '\ud83c\udf10',
  },
  {
    id: 'c4',
    title: 'Schutzbedarfsanalyse durchf\u00fchren',
    description: 'IT-Sicherheitsrisiken analysieren und Schutzma\u00dfnahmen planen.',
    component: 'Komponente 4',
    progress: 60,
    totalEnablers: 5,
    completedEnablers: 3,
    status: 'in_progress',
    icon: '\ud83d\udee1\ufe0f',
  },
  {
    id: 'c5',
    title: 'Software zur Verwaltung von Daten anpassen',
    description: 'Datenbanken entwerfen, erstellen und Daten mit SQL verwalten.',
    component: 'Komponente 5',
    progress: 40,
    totalEnablers: 7,
    completedEnablers: 3,
    status: 'in_progress',
    icon: '\ud83d\uddc4\ufe0f',
  },
  {
    id: 'c6',
    title: 'Serviceanfragen bearbeiten',
    description: 'IT-Service-Prozesse verstehen und Kundenanfragen systematisch bearbeiten.',
    component: 'Komponente 6',
    progress: 20,
    totalEnablers: 6,
    completedEnablers: 1,
    status: 'in_progress',
    icon: '\ud83c\udfab',
  },
  {
    id: 'c7',
    title: 'Cyber-physische Systeme erg\u00e4nzen',
    description: 'Vernetzte Systeme verstehen, erweitern und in bestehende Infrastrukturen integrieren.',
    component: 'Komponente 7',
    progress: 0,
    totalEnablers: 5,
    completedEnablers: 0,
    status: 'not_started',
    icon: '\u2699\ufe0f',
  },
  {
    id: 'c8',
    title: 'Daten systemübergreifend bereitstellen',
    description: 'Schnittstellen und Datenformate für den systemübergreifenden Datenaustausch implementieren.',
    component: 'Komponente 8',
    progress: 0,
    totalEnablers: 6,
    completedEnablers: 0,
    status: 'not_started',
    icon: '\ud83d\udd04',
  },
  {
    id: 'c9',
    title: 'Netzwerke und Dienste bereitstellen',
    description: 'Netzwerkdienste planen, konfigurieren und administrieren.',
    component: 'Komponente 9',
    progress: 0,
    totalEnablers: 7,
    completedEnablers: 0,
    status: 'not_started',
    icon: '\ud83d\udce1',
  },
  {
    id: 'c10',
    title: 'Benutzerschnittstellen gestalten',
    description: 'Benutzeroberflächen nach UX-Prinzipien entwerfen und umsetzen.',
    component: 'Komponente 10',
    progress: 0,
    totalEnablers: 6,
    completedEnablers: 0,
    status: 'not_started',
    icon: '\ud83c\udfa8',
  },
];
