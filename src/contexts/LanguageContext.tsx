'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useMemo,
  useCallback,
} from 'react';

/**
 * Static imports — bundled at build time so the first render already has
 * every translation string.  No network fetch, no FOUC, no double render.
 */
import deStrings from '@/locales/de.json';
import enStrings from '@/locales/en.json';

export type Language = 'de' | 'en';

type TranslationMap = Record<string, string>;

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined
);

/** Pre-built lookup so we never need async loading */
const TRANSLATIONS: Record<Language, TranslationMap> = {
  de: deStrings as TranslationMap,
  en: enStrings as TranslationMap,
};

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('de');
  const [mounted, setMounted] = useState(false);

  // Initialize language on mount — check localStorage first
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('language') as Language | null;
    if (saved === 'de' || saved === 'en') {
      setLanguageState(saved);
    }
  }, []);

  // Persist language choice
  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem('language', language);
  }, [mounted, language]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
  }, []);

  const strings = TRANSLATIONS[language];

  const t = useCallback(
    (key: string): string => strings[key] || key,
    [strings]
  );

  const value = useMemo<LanguageContextType>(
    () => ({ language, setLanguage, t }),
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
