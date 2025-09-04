'use client';

import {
  createContext,
  useContext,
  useState,
  ReactNode,
  useMemo,
  useCallback,
} from 'react';

export type Language = 'de' | 'en';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined
);

// German translations
const translations = {
  de: {
    // Navigation
    'nav.dashboard': 'Dashboard',
    'nav.learningPath': 'Lernpfad',
    'nav.modules': 'Module',
    'nav.quizzes': 'Quizze',
    'nav.reflections': 'Reflektionen',
    'nav.profile': 'Profil',
    'nav.contentManagement': 'Inhaltsverwaltung',
    'nav.traineeManagement': 'Azubi-Verwaltung',

    // Common
    'common.loading': 'Laden...',
    'common.error': 'Fehler',
    'common.success': 'Erfolgreich',
    'common.cancel': 'Abbrechen',
    'common.save': 'Speichern',
    'common.edit': 'Bearbeiten',
    'common.delete': 'Löschen',
    'common.back': 'Zurück',
    'common.next': 'Weiter',
    'common.previous': 'Zurück',

    // Auth
    'auth.login': 'Anmelden',
    'auth.logout': 'Abmelden',
    'auth.email': 'E-Mail-Adresse',
    'auth.password': 'Passwort',
    'auth.welcomeBack': 'Willkommen zurück!',
    'auth.loginFailed': 'Anmeldung fehlgeschlagen',
    'auth.switchToTrainer': 'Zur Ausbilder-Ansicht',
    'auth.switchToTrainee': 'Zur Azubi-Ansicht',

    // Dashboard
    'dashboard.welcome': 'Willkommen',
    'dashboard.continueLearning': 'Weitermachen',
    'dashboard.myLearningPath': 'Mein Lernpfad',
    'dashboard.recentAchievements': 'Letzte Erfolge',
    'dashboard.upcomingDeadlines': 'Anstehende Termine',
    'dashboard.progress': 'Fortschritt',
    'dashboard.activeTrainees': 'Aktive Azubis',
    'dashboard.averageProgress': 'Ø Fortschritt',
    'dashboard.pendingReviews': 'Offene Reviews',

    // Actions
    'actions.continue': 'Weitermachen',
    'actions.start': 'Starten',
    'actions.complete': 'Abschließen',
    'actions.review': 'Bewerten',
    'actions.submit': 'Einreichen',
    'actions.view': 'Anzeigen',

    // Status
    'status.completed': 'Abgeschlossen',
    'status.inProgress': 'In Bearbeitung',
    'status.pending': 'Ausstehend',
    'status.overdue': 'Überfällig',

    // Time
    'time.days': 'Tage',
    'time.hours': 'Stunden',
    'time.minutes': 'Minuten',
    'time.seconds': 'Sekunden',
  },
  en: {
    // Navigation
    'nav.dashboard': 'Dashboard',
    'nav.learningPath': 'Learning Path',
    'nav.modules': 'Modules',
    'nav.quizzes': 'Quizzes',
    'nav.reflections': 'Reflections',
    'nav.profile': 'Profile',
    'nav.contentManagement': 'Content Management',
    'nav.traineeManagement': 'Trainee Management',

    // Common
    'common.loading': 'Loading...',
    'common.error': 'Error',
    'common.success': 'Success',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.edit': 'Edit',
    'common.delete': 'Delete',
    'common.back': 'Back',
    'common.next': 'Next',
    'common.previous': 'Previous',

    // Auth
    'auth.login': 'Login',
    'auth.logout': 'Logout',
    'auth.email': 'Email Address',
    'auth.password': 'Password',
    'auth.welcomeBack': 'Welcome back!',
    'auth.loginFailed': 'Login failed',
    'auth.switchToTrainer': 'Switch to Trainer View',
    'auth.switchToTrainee': 'Switch to Trainee View',

    // Dashboard
    'dashboard.welcome': 'Welcome',
    'dashboard.continueLearning': 'Continue Learning',
    'dashboard.myLearningPath': 'My Learning Path',
    'dashboard.recentAchievements': 'Recent Achievements',
    'dashboard.upcomingDeadlines': 'Upcoming Deadlines',
    'dashboard.progress': 'Progress',
    'dashboard.activeTrainees': 'Active Trainees',
    'dashboard.averageProgress': 'Avg. Progress',
    'dashboard.pendingReviews': 'Pending Reviews',

    // Actions
    'actions.continue': 'Continue',
    'actions.start': 'Start',
    'actions.complete': 'Complete',
    'actions.review': 'Review',
    'actions.submit': 'Submit',
    'actions.view': 'View',

    // Status
    'status.completed': 'Completed',
    'status.inProgress': 'In Progress',
    'status.pending': 'Pending',
    'status.overdue': 'Overdue',

    // Time
    'time.days': 'days',
    'time.hours': 'hours',
    'time.minutes': 'minutes',
    'time.seconds': 'seconds',
  },
};

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('de');

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
  }, []);

  const t = useCallback(
    (key: string): string => {
      return (
        translations[language][
          key as keyof (typeof translations)[typeof language]
        ] || key
      );
    },
    [language]
  );

  // Memoize the context value to prevent unnecessary re-renders
  const value = useMemo<LanguageContextType>(
    () => ({
      language,
      setLanguage,
      t,
    }),
    [language, setLanguage, t]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
