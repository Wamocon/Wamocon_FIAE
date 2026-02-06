// App Configuration
export const APP_CONFIG = {
  name: 'FIAE-Lernplattform',
  version: '1.0.0',
  description: 'Professional Learning Platform for FIAE',
  defaultLanguage: 'de',
  supportedLanguages: ['de', 'en'],
  defaultTheme: 'dark',
  supportedThemes: ['light', 'dark'],
};

// API Configuration
export const API_CONFIG = {
  baseUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  timeout: 30000,
  retries: 3,
};

// Supabase Configuration
export const SUPABASE_CONFIG = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
};

// Navigation Links
export const NAVIGATION = {
  trainee: [
    {
      key: 'dashboard',
      icon: 'LayoutDashboard',
      label: 'Dashboard',
      view: 'dashboard',
    },
    { key: 'profile', icon: 'User', label: 'Mein Profil', view: 'profile' },
  ],
  trainer: [
    {
      key: 'dashboard',
      icon: 'LayoutDashboard',
      label: 'Dashboard',
      view: 'dashboard',
    },
    {
      key: 'contentManagement',
      icon: 'FolderKanban',
      label: 'Inhalts-Management',
      view: 'contentManagement',
    },
    {
      key: 'quizManagement',
      icon: 'FileQuestion',
      label: 'Quiz-Verwaltung',
      view: 'quizManagement',
    },
    { key: 'profile', icon: 'User', label: 'Mein Profil', view: 'profile' },
  ],
};

// Learning Path Configuration
export const LEARNING_PATH = {
  maxModulesPerYear: 6,
  maxChaptersPerModule: 10,
  maxLessonsPerChapter: 20,
  passingScore: 70,
  timeLimitMinutes: 30,
};

// Quiz Configuration
export const QUIZ_CONFIG = {
  minQuestions: 5,
  maxQuestions: 50,
  defaultTimeLimit: 30,
  passingScore: 70,
  maxAttempts: 3,
};

// File Upload Configuration
export const FILE_UPLOAD = {
  maxSize: 10 * 1024 * 1024, // 10MB
  allowedTypes: ['pdf', 'png', 'jpg', 'jpeg', 'zip'],
  maxFiles: 5,
};

// Notification Configuration
export const NOTIFICATIONS = {
  maxUnread: 99,
  autoDismiss: 5000,
  position: 'top-right',
};

// Theme Colors
export const THEME_COLORS = {
  primary: {
    50: '#eff6ff',
    100: '#dbeafe',
    200: '#bfdbfe',
    300: '#93c5fd',
    400: '#60a5fa',
    500: '#3b82f6',
    600: '#2563eb',
    700: '#1d4ed8',
    800: '#1e40af',
    900: '#1e3a8a',
  },
  gray: {
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827',
  },
};

// Spacing
export const SPACING = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
  '2xl': '3rem',
  '3xl': '4rem',
};

// Border Radius
export const BORDER_RADIUS = {
  none: '0',
  sm: '0.125rem',
  md: '0.375rem',
  lg: '0.5rem',
  xl: '0.75rem',
  '2xl': '1rem',
  '3xl': '1.5rem',
  full: '9999px',
};

// Localization
export const LOCALIZATION = {
  de: {
    common: {
      loading: 'Laden...',
      error: 'Fehler',
      success: 'Erfolgreich',
      cancel: 'Abbrechen',
      save: 'Speichern',
      delete: 'Löschen',
      edit: 'Bearbeiten',
      view: 'Anzeigen',
    },
    auth: {
      login: 'Anmelden',
      logout: 'Abmelden',
      email: 'E-Mail',
      password: 'Passwort',
      welcomeBack: 'Willkommen zurück!',
      loginFailed: 'Anmeldung fehlgeschlagen',
    },
    navigation: {
      dashboard: 'Dashboard',
      profile: 'Profil',
      settings: 'Einstellungen',
    },
  },
  en: {
    common: {
      loading: 'Loading...',
      error: 'Error',
      success: 'Success',
      cancel: 'Cancel',
      save: 'Save',
      delete: 'Delete',
      edit: 'Edit',
      view: 'View',
    },
    auth: {
      login: 'Sign In',
      logout: 'Sign Out',
      email: 'Email',
      password: 'Password',
      welcomeBack: 'Welcome back!',
      loginFailed: 'Login failed',
    },
    navigation: {
      dashboard: 'Dashboard',
      profile: 'Profile',
      settings: 'Settings',
    },
  },
};

// Validation Rules
export const VALIDATION = {
  email: {
    required: 'E-Mail ist erforderlich',
    invalid: 'Ungültige E-Mail-Adresse',
  },
  password: {
    required: 'Passwort ist erforderlich',
    minLength: 'Passwort muss mindestens 8 Zeichen lang sein',
  },
  name: {
    required: 'Name ist erforderlich',
    minLength: 'Name muss mindestens 2 Zeichen lang sein',
  },
};

// Error Messages
export const ERROR_MESSAGES = {
  network: 'Netzwerkfehler. Bitte versuchen Sie es erneut.',
  unauthorized: 'Sie sind nicht berechtigt, diese Aktion auszuführen.',
  notFound: 'Die angeforderte Ressource wurde nicht gefunden.',
  serverError:
    'Ein Serverfehler ist aufgetreten. Bitte versuchen Sie es später erneut.',
  validation: 'Bitte überprüfen Sie Ihre Eingaben.',
};

// Success Messages
export const SUCCESS_MESSAGES = {
  saved: 'Änderungen wurden erfolgreich gespeichert.',
  deleted: 'Element wurde erfolgreich gelöscht.',
  created: 'Element wurde erfolgreich erstellt.',
  updated: 'Element wurde erfolgreich aktualisiert.',
};
