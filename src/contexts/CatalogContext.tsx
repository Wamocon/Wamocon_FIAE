'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import {
  DEFAULT_CATALOG_BRANDING,
  isBrandingApplied,
  resolveCatalogBranding,
  type CatalogBranding,
} from '@/lib/catalog/branding';
import { normalizeCatalogCode } from '@/lib/catalog/client';
import { reloadPage } from '@/lib/catalog/navigation';
import {
  CATALOG_LOOKUP_TIMEOUT_MS,
  readPreferredCatalog,
  setCatalogSelection,
  storedChoiceNeedsCheck,
  writePreferredCatalog,
} from '@/lib/catalog/selection';

export type CatalogOption = {
  code: string;
  title: string;
  branding: CatalogBranding;
};

export type CatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface CatalogContextValue {
  status: CatalogStatus;
  /** The occupations of the signed in user, FIAE first. */
  catalogs: CatalogOption[];
  /** The occupation the user works in, null while unknown. */
  activeCode: string | null;
  /** The user has more than one occupation (the switcher is shown). */
  isMultiple: boolean;
  /** Branding of the active occupation, the FIAE look if there is none. */
  branding: CatalogBranding;
  /** The branding is shown (the active occupation is not FIAE). */
  brandingApplied: boolean;
  /** Choose another occupation: the page loads again with it. */
  selectCatalog: (code: string) => void;
  /** A CatalogProvider is mounted (false for the neutral default value). */
  inProvider: boolean;
}

const NO_CATALOGS: CatalogOption[] = [];

const NEUTRAL: CatalogContextValue = {
  status: 'idle',
  catalogs: NO_CATALOGS,
  activeCode: null,
  isMultiple: false,
  branding: DEFAULT_CATALOG_BRANDING,
  brandingApplied: false,
  selectCatalog: () => {},
  inProvider: false,
};

const CatalogContext = createContext<CatalogContextValue>(NEUTRAL);

type Loaded = { catalogs: CatalogOption[]; serverActive: string | null };

/** Check the answer of GET /api/me/catalogs, null if it is unusable. */
function parseCatalogs(data: unknown): Loaded | null {
  const list = (data as { catalogs?: unknown } | null)?.catalogs;
  if (!Array.isArray(list)) return null;
  const catalogs: CatalogOption[] = [];
  for (const entry of list) {
    const item = (entry ?? {}) as Record<string, unknown>;
    const code = normalizeCatalogCode(item.code);
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!code || !title || catalogs.some(c => c.code === code)) continue;
    catalogs.push({
      code,
      title: title.slice(0, 200),
      branding: resolveCatalogBranding(item.branding),
    });
  }
  if (catalogs.length === 0) return null;
  const active = normalizeCatalogCode(
    (data as { activeCode?: unknown }).activeCode
  );
  return {
    catalogs,
    serverActive:
      active && catalogs.some(c => c.code === active) ? active : null,
  };
}

/**
 * The occupation to work in: the stored choice if it is one of the user's
 * occupations (unchecked values are never used), otherwise the one the server
 * names, otherwise the first.
 */
function chooseActive(loaded: Loaded): string {
  const preferred = readPreferredCatalog();
  if (preferred && loaded.catalogs.some(c => c.code === preferred)) {
    return preferred;
  }
  return loaded.serverActive ?? loaded.catalogs[0].code;
}

/**
 * Holds the occupations of the signed in user and the occupation they work in.
 *
 * The list comes from GET /api/me/catalogs. The choice is stored in the browser
 * (lfa.preferredCatalog) and used only if it is one of the user's occupations.
 * Only a user with more than one occupation sends `x-catalog` (authFetch) and
 * has the choice in the query keys (useApiQuery); everything stays as it was for
 * a user with a single occupation. Mount it inside AuthProvider and
 * QueryProvider.
 */
export function CatalogProvider({ children }: { children: ReactNode }) {
  const { profile, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const userId = profile?.id ?? null;
  const [status, setStatus] = useState<CatalogStatus>('idle');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const previousUserId = useRef<string | null>(null);
  // The user the header in the shared state was set for.
  const headerOwner = useRef<string | null>(null);

  // The cache of React Query holds lists of one account. When another account
  // signs in, or the user signs out, they must not show up for the next one
  // (for up to a minute otherwise). The first sign in of a tab (nobody before)
  // and every re-render of the same user leave the cache alone, so nobody who
  // stays signed in loses data they would have kept.
  useEffect(() => {
    const previous = previousUserId.current;
    previousUserId.current = userId;
    if (previous && previous !== userId) queryClient.clear();
  }, [userId, queryClient]);

  useEffect(() => {
    if (!userId) {
      // Nobody is signed in: nothing to load, nothing to hold back. While the
      // sign in state is still being determined, a stored choice stays pending.
      if (!authLoading) {
        setStatus('idle');
        setLoaded(null);
        setActiveCode(null);
        setCatalogSelection({ header: null, pending: false });
      }
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      CATALOG_LOOKUP_TIMEOUT_MS
    );
    setStatus('loading');
    // The header of a previous account (another tab may have switched the
    // account) is not sent for this one. A load again for the same user (the
    // sign in flag flipped) keeps its header, so the query keys do not flap.
    // A stored choice other than FIAE holds requests back until it is checked;
    // for FIAE, and for nobody with a choice, requests go out as they always
    // did.
    const sameUser = headerOwner.current === userId;
    headerOwner.current = userId;
    setCatalogSelection(
      sameUser
        ? { pending: storedChoiceNeedsCheck() }
        : { header: null, pending: storedChoiceNeedsCheck() }
    );

    (async () => {
      try {
        const res = await authFetch('/api/me/catalogs', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = parseCatalogs(await res.json());
        if (!data) throw new Error('unusable answer');
        if (cancelled) return;

        const multiple = data.catalogs.length > 1;
        const active = chooseActive(data);
        // Only a user with several occupations has a choice to remember and
        // to send. For everyone else nothing is stored and nothing is sent.
        writePreferredCatalog(multiple ? active : null);
        setCatalogSelection({
          header: multiple ? active : null,
          pending: false,
        });
        setLoaded(data);
        setActiveCode(active);
        setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        // The list is unknown, so the view is the default one (no switcher, no
        // branding) and nothing is held back. A stored choice other than FIAE
        // is still sent: the server checks it against the scope of the user, a
        // wrong code ends in 403. Without it the requests would go out without
        // a header, the server would take FIAE, and a user who chose KfBM
        // would silently read and write in the FIAE catalog. Without a stored
        // choice nothing is sent (fail open, as before). The stored choice
        // stays, the next load can use it again.
        console.warn('[catalog] occupations could not be loaded', error);
        const stored = storedChoiceNeedsCheck() ? readPreferredCatalog() : null;
        setCatalogSelection({ header: stored, pending: false });
        setLoaded(null);
        setActiveCode(null);
        setStatus('error');
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [userId, authLoading]);

  const catalogs = loaded?.catalogs ?? NO_CATALOGS;

  const selectCatalog = useCallback(
    (code: string) => {
      const target = normalizeCatalogCode(code);
      if (!target || target === activeCode) return;
      if (!catalogs.some(c => c.code === target)) return;
      writePreferredCatalog(target);
      // Data of the previous occupation must not survive in the cache.
      queryClient.clear();
      reloadPage();
    },
    [activeCode, catalogs, queryClient]
  );

  const value = useMemo<CatalogContextValue>(() => {
    const active = catalogs.find(c => c.code === activeCode) ?? null;
    const brandingApplied = !!active && isBrandingApplied(active.code);
    return {
      status,
      catalogs,
      activeCode,
      isMultiple: catalogs.length > 1,
      branding:
        brandingApplied && active ? active.branding : DEFAULT_CATALOG_BRANDING,
      brandingApplied,
      selectCatalog,
      inProvider: true,
    };
  }, [status, catalogs, activeCode, selectCatalog]);

  return (
    <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
  );
}

/** Occupations and branding. Without a provider: neutral, nothing applied. */
export function useCatalog(): CatalogContextValue {
  return useContext(CatalogContext);
}
