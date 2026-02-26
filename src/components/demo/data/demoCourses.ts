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
    description: 'Betriebliche Strukturen, Geschäftsprozesse und die eigene Rolle im Unternehmen verstehen.',
    component: 'Komponente 1',
    progress: 100,
    totalEnablers: 8,
    completedEnablers: 8,
    status: 'completed',
    icon: '🏠',
  },
  {
    id: 'c2',
    title: 'Arbeitsplatz nach Kundenwunsch einrichten',
    description: 'IT-Arbeitsplätze nach Kundenanforderungen planen, konfigurieren und bereitstellen.',
    component: 'Komponente 2',
    progress: 100,
    totalEnablers: 7,
    completedEnablers: 7,
    status: 'completed',
    icon: '💻',
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
    icon: '🌐',
  },
  {
    id: 'c4',
    title: 'Schutzbedarfsanalyse durchführen',
    description: 'IT-Sicherheitsrisiken analysieren und Schutzmaßnahmen planen.',
    component: 'Komponente 4',
    progress: 60,
    totalEnablers: 5,
    completedEnablers: 3,
    status: 'in_progress',
    icon: '🔒',
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
    icon: '🗄️',
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
    icon: '🎧',
  },
  {
    id: 'c7',
    title: 'Cyber-physische Systeme ergänzen',
    description: 'Vernetzte Systeme verstehen, erweitern und in bestehende Infrastrukturen integrieren.',
    component: 'Komponente 7',
    progress: 0,
    totalEnablers: 5,
    completedEnablers: 0,
    status: 'not_started',
    icon: '⚙️',
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
    icon: '📊',
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
    icon: '📡',
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
    icon: '🎨',
  },
];
