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
import { isSuperAdmin, isTrainerLevelRole } from '@/lib/auth/roles';
import { normalizeCatalogCode } from '@/lib/catalog/client';
import {
  navigateTo,
  pushCatalogUrl,
  reloadPage,
} from '@/lib/catalog/navigation';
import {
  CATALOG_LOOKUP_TIMEOUT_MS,
  getCatalogHeader,
  readPreferredCatalog,
  setCatalogSelection,
  storedChoiceNeedsCheck,
  writePreferredCatalog,
} from '@/lib/catalog/selection';
import {
  catalogFromSearch,
  isCatalogTabPath,
  pickTabCatalog,
} from '@/lib/catalog/tabs';

export type CatalogOption = {
  code: string;
  title: string;
  branding: CatalogBranding;
  /** An inactive occupation (only a super admin gets one) is marked in the tab. */
  isActive: boolean;
};

export type CatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface CatalogContextValue {
  status: CatalogStatus;
  /** The occupations of the signed in user, FIAE first. */
  catalogs: CatalogOption[];
  /** The occupation the user works in, null while unknown. */
  activeCode: string | null;
  /** The user has more than one occupation. */
  isMultiple: boolean;
  /**
   * The tabs of the pages: the usable occupations of a trainer level user who
   * has more than one of them (active ones, a super admin also the inactive
   * ones), otherwise empty (no tabs).
   */
  tabs: CatalogOption[];
  /** Switch the occupation with a tab: no reload, the URL names the choice. */
  selectTab: (code: string) => void;
  /**
   * Counts the switches (and the first header of a user with several
   * occupations). The page content is keyed with it, so every page loads its
   * data again for the occupation.
   */
  epoch: number;
  /** Branding of the active occupation, the FIAE look if there is none. */
  branding: CatalogBranding;
  /** The branding is shown (the active occupation is not FIAE). */
  brandingApplied: boolean;
  /**
   * Choose another occupation: the page loads again with it, or the browser
   * goes to `destination` (a path) with a full page load if one is given.
   */
  selectCatalog: (code: string, destination?: string) => void;
  /** A CatalogProvider is mounted (false for the neutral default value). */
  inProvider: boolean;
}

const NO_CATALOGS: CatalogOption[] = [];

const NEUTRAL: CatalogContextValue = {
  status: 'idle',
  catalogs: NO_CATALOGS,
  activeCode: null,
  isMultiple: false,
  tabs: NO_CATALOGS,
  selectTab: () => {},
  epoch: 0,
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
      isActive: item.isActive !== false,
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
 * The occupations that can be worked in: the active ones. A super admin can
 * also view an inactive one (to check the content before the activation), it
 * comes after the active ones. Only a super admin ever gets an inactive
 * occupation from the server, and the server checks the choice again.
 */
function usableCatalogs(
  catalogs: CatalogOption[],
  includeInactive: boolean
): CatalogOption[] {
  const active = catalogs.filter(c => c.isActive);
  return includeInactive
    ? [...active, ...catalogs.filter(c => !c.isActive)]
    : active;
}

/** The code of the URL, only on a page that has tabs. */
function catalogFromTabPage(): string | null {
  return isCatalogTabPath(window.location.pathname)
    ? catalogFromSearch(window.location.search)
    : null;
}

/**
 * The occupation to work in: the code of the URL (trainer level only), the
 * stored choice, the one the server names, the first. Unchecked values count
 * only if they are one of the user's usable occupations.
 */
function chooseActive(
  loaded: Loaded,
  fromUrl: string | null,
  includeInactive: boolean
): string {
  const codes = usableCatalogs(loaded.catalogs, includeInactive).map(
    c => c.code
  );
  return (
    pickTabCatalog({
      codes,
      fromUrl,
      stored: readPreferredCatalog(),
      serverActive: loaded.serverActive,
    }) ?? loaded.catalogs[0].code
  );
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
  const [epoch, setEpoch] = useState(0);
  const previousUserId = useRef<string | null>(null);
  // Tabs and the URL choice are for trainer level users only (a trainee has
  // the occupation of the enrollment).
  const trainerLevel = isTrainerLevelRole(profile?.role);
  const trainerLevelRef = useRef(trainerLevel);
  trainerLevelRef.current = trainerLevel;
  // A super admin (also an ADMIN of the platform organization) can view an
  // inactive occupation, nobody else.
  const superAdmin = isSuperAdmin({
    role: profile?.role,
    isPlatformOwner: profile?.organization?.isPlatformOwner,
  });
  const superAdminRef = useRef(superAdmin);
  superAdminRef.current = superAdmin;
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
    // did. Then the first requests may have gone out without the header, and
    // the content of a page with tabs loads again once it is set (epoch).
    const gated = storedChoiceNeedsCheck();
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

        // Several occupations and at least one that can be worked in. Without
        // an active one nothing is sent (the server default applies).
        const multiple =
          data.catalogs.length > 1 &&
          usableCatalogs(data.catalogs, superAdminRef.current).length > 0;
        const active = chooseActive(
          data,
          trainerLevelRef.current ? catalogFromTabPage() : null,
          superAdminRef.current
        );
        const headerBefore = getCatalogHeader();
        // Only a user with several occupations has a choice to remember and
        // to send. For everyone else nothing is stored and nothing is sent.
        writePreferredCatalog(multiple ? active : null);
        setCatalogSelection({
          header: multiple ? active : null,
          pending: false,
        });
        if (
          multiple &&
          !gated &&
          headerBefore === null &&
          trainerLevelRef.current &&
          isCatalogTabPath(window.location.pathname)
        ) {
          setEpoch(value => value + 1);
        }
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
  const tabs = useMemo(() => {
    const usable = usableCatalogs(catalogs, superAdmin);
    return trainerLevel && usable.length > 1 ? usable : NO_CATALOGS;
  }, [catalogs, trainerLevel, superAdmin]);

  // Switch the occupation without a reload: the header and the stored choice
  // change, the page content (keyed with the epoch) loads again, the query
  // keys carry the occupation.
  const applyTab = useCallback((target: string) => {
    writePreferredCatalog(target);
    setCatalogSelection({ header: target });
    setActiveCode(target);
    setEpoch(value => value + 1);
  }, []);

  const selectTab = useCallback(
    (code: string) => {
      const target = normalizeCatalogCode(code);
      if (!target || target === activeCode) return;
      if (!tabs.some(c => c.code === target)) return;
      applyTab(target);
      pushCatalogUrl(activeCode, target);
    },
    [activeCode, tabs, applyTab]
  );

  // The back and forward buttons: a code in the URL that names a tab wins.
  const activeRef = useRef(activeCode);
  activeRef.current = activeCode;
  useEffect(() => {
    if (tabs.length === 0) return;
    const onPopState = () => {
      const fromUrl = catalogFromTabPage();
      if (!fromUrl || fromUrl === activeRef.current) return;
      if (!tabs.some(c => c.code === fromUrl)) return;
      applyTab(fromUrl);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [tabs, applyTab]);

  const selectCatalog = useCallback(
    (code: string, destination?: string) => {
      const target = normalizeCatalogCode(code);
      if (!target || target === activeCode) return;
      if (!catalogs.some(c => c.code === target)) return;
      writePreferredCatalog(target);
      // Data of the previous occupation must not survive in the cache.
      queryClient.clear();
      if (destination) navigateTo(destination);
      else reloadPage();
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
      tabs,
      selectTab,
      epoch,
      branding:
        brandingApplied && active ? active.branding : DEFAULT_CATALOG_BRANDING,
      brandingApplied,
      selectCatalog,
      inProvider: true,
    };
  }, [status, catalogs, activeCode, selectCatalog, tabs, selectTab, epoch]);

  return (
    <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
  );
}

/** Occupations and branding. Without a provider: neutral, nothing applied. */
export function useCatalog(): CatalogContextValue {
  return useContext(CatalogContext);
}
