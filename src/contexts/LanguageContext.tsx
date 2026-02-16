'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useMemo,
  useCallback,
  useRef,
} from 'react';

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

/**
 * Cache loaded translations so we never fetch the same locale twice.
 * Lives outside the component so it survives re-mounts.
 */
const translationCache: Record<string, TranslationMap> = {};

async function loadTranslations(lang: Language): Promise<TranslationMap> {
  if (translationCache[lang]) return translationCache[lang];
  const resp = await fetch(`/locales/${lang}.json`);
  const data: TranslationMap = await resp.json();
  translationCache[lang] = data;
  return data;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('de');
  const [strings, setStrings] = useState<TranslationMap>(
    translationCache['de'] ?? {}
  );
  const [mounted, setMounted] = useState(false);
  const loadingRef = useRef(false);

  // Load translations whenever the active language changes
  useEffect(() => {
    let cancelled = false;
    loadingRef.current = true;
    loadTranslations(language).then(data => {
      if (!cancelled) {
        setStrings(data);
        loadingRef.current = false;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  // Initialize language on mount - check localStorage first
  useEffect(() => {
    setMounted(true);
    const savedLanguage = localStorage.getItem('language') as Language | null;
    if (savedLanguage && (savedLanguage === 'de' || savedLanguage === 'en')) {
      setLanguageState(savedLanguage);
    }
  }, []);

  // Save language to localStorage when it changes
  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem('language', language);
  }, [mounted, language]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
  }, []);

  const t = useCallback(
    (key: string): string => {
      return strings[key] || key;
    },
    [strings]
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
