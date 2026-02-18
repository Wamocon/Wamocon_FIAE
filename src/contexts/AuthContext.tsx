'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { prefetch } from '@/lib/prefetch';
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';

interface User {
  id: string;
  email: string;
}

interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: 'trainee' | 'trainer';
  avatar?: string | null;
  birth_date?: string | null;
  training_start_date?: string | null;
  trainer_id?: string | null;
  isActive?: boolean;
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    fullName: string,
    email: string,
    password: string,
    role: 'trainee' | 'trainer'
  ) => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (updates: {
    full_name?: string;
    avatar_url?: string | null;
    birth_date?: string | null;
    training_start_date?: string | null;
    trainer_auth_id?: string | null;
  }) => Promise<void>;
  refreshProfile: () => Promise<void>;
  switchRole: (role: 'trainee' | 'trainer') => Promise<void>;
  changePassword: (newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Cache keys for localStorage
const CACHE_KEYS = {
  USER: 'auth_user_cache',
  PROFILE: 'auth_profile_cache',
  LOGIN_AT: 'auth_login_at',
};

// Helper to get cached data from localStorage
const getCachedAuth = (): { user: User | null; profile: Profile | null } => {
  if (typeof window === 'undefined') return { user: null, profile: null };
  try {
    const userStr = localStorage.getItem(CACHE_KEYS.USER);
    const profileStr = localStorage.getItem(CACHE_KEYS.PROFILE);
    const user = userStr ? JSON.parse(userStr) : null;
    const profile = profileStr ? JSON.parse(profileStr) : null;
    return { user, profile };
  } catch {
    return { user: null, profile: null };
  }
};

// Helper to save auth data to localStorage
const setCachedAuth = (user: User | null, profile: Profile | null) => {
  if (typeof window === 'undefined') return;
  try {
    if (user) {
      localStorage.setItem(CACHE_KEYS.USER, JSON.stringify(user));
    } else {
      localStorage.removeItem(CACHE_KEYS.USER);
    }
    if (profile) {
      localStorage.setItem(CACHE_KEYS.PROFILE, JSON.stringify(profile));
    } else {
      localStorage.removeItem(CACHE_KEYS.PROFILE);
    }
  } catch {
    // ignore
  }
};

// Clear all cached auth data
const clearCachedAuth = () => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(CACHE_KEYS.USER);
    localStorage.removeItem(CACHE_KEYS.PROFILE);
    localStorage.removeItem(CACHE_KEYS.LOGIN_AT);
    // Also clear supabase keys
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('sb-')) {
        try {
          localStorage.removeItem(k);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    // ignore
  }
};

/**
 * Build the dashboard API URL for prefetching.
 * This lets us start the heaviest API call in parallel with auth verification.
 */
function buildDashboardUrl(
  userId: string,
  role: string,
  profileId?: string
): string {
  if (role === 'trainer') {
    const params = new URLSearchParams();
    params.set('trainerAuthId', userId);
    if (profileId) params.set('trainerProfileId', profileId);
    return `/api/trainer/dashboard?${params.toString()}`;
  }
  return `/api/trainee/dashboard?userId=${profileId || userId}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Initialize from cache for instant rendering
  const cached = getCachedAuth();
  const [user, setUser] = useState<User | null>(cached.user);
  const [profile, setProfile] = useState<Profile | null>(cached.profile);
  const [loading, setLoading] = useState(!cached.user); // Only show loading if no cached user
  const router = useRouter();
  const pathname = usePathname();
  const initRef = useRef(false);

  // Prefetch dashboard data as early as possible when we have cached auth.
  // This runs during the very first render — before auth verification completes —
  // so the dashboard API call happens IN PARALLEL with supabase.auth.getSession().
  const prefetchedRef = useRef(false);
  if (!prefetchedRef.current && cached.user && cached.profile) {
    prefetchedRef.current = true;
    const dashUrl = buildDashboardUrl(
      cached.user.id,
      cached.profile.role,
      cached.profile.id
    );
    prefetch(dashUrl);
  }

  // Public routes must not perform private API or DB calls
  const isPublicPath = useMemo(() => {
    const publicPaths = new Set<string>([
      '/',
      '/login',
      '/register',
      '/forgot-password',
      '/reset-password',
    ]);
    const p = pathname || '';
    return publicPaths.has(p) || p.startsWith('/verify');
  }, [pathname]);

  // Auto logout after 4 hours
  const SESSION_MAX_MS = 4 * 60 * 60 * 1000;
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearLogoutTimer = () => {
    if (logoutTimerRef.current) {
      clearTimeout(logoutTimerRef.current);
      logoutTimerRef.current = null;
    }
  };
  const scheduleAutoLogout = () => {
    if (typeof window === 'undefined') return;
    clearLogoutTimer();
    const loginAtRaw = localStorage.getItem(CACHE_KEYS.LOGIN_AT);
    const loginAt = loginAtRaw ? Number(loginAtRaw) : Date.now();
    const remaining = SESSION_MAX_MS - (Date.now() - loginAt);
    if (remaining <= 0) {
      void signOut(true);
      return;
    }
    logoutTimerRef.current = setTimeout(() => {
      void signOut(true);
    }, remaining);
  };

  // Load profile from Supabase
  const loadProfile = async (
    userId: string,
    email?: string
  ): Promise<Profile | null> => {
    try {
      const userEmail = email || user?.email || '';

      const { data, error } = await supabase
        .from('profiles')
        .select(
          'id, full_name, role, avatar_url, assigned_trainer_id, start_of_training_date, birth_date, is_active'
        )
        .eq('id', userId)
        .single();

      if (error || !data) {
        console.error('Error loading profile:', error);
        return null;
      }

      type ProfileRow = {
        id: string;
        full_name: string | null;
        role: 'TRAINER' | 'TRAINEE';
        avatar_url: string | null;
        assigned_trainer_id: string | null;
        start_of_training_date: string | null;
        birth_date: string | null;
        is_active: boolean | null;
      };
      const row = data as ProfileRow;
      const mapped: Profile = {
        id: row.id,
        email: userEmail,
        full_name: row.full_name ?? '',
        role: String(row.role).toLowerCase() as 'trainee' | 'trainer',
        avatar: row.avatar_url || null,
        birth_date: row.birth_date || null,
        training_start_date: row.start_of_training_date || null,
        trainer_id: row.assigned_trainer_id || null,
        isActive:
          row.is_active === null || row.is_active === undefined
            ? true
            : Boolean(row.is_active),
      };

      setProfile(mapped);
      setCachedAuth(user, mapped);
      return mapped;
    } catch (e) {
      console.error('Exception in loadProfile:', e);
      return null;
    }
  };

  // Fast profile load with short timeout
  const loadProfileFast = async (
    userId: string,
    email?: string,
    timeoutMs = 3000
  ): Promise<Profile | null> => {
    try {
      const result = await Promise.race([
        loadProfile(userId, email),
        new Promise<null>(resolve =>
          setTimeout(() => resolve(null), timeoutMs)
        ),
      ]);
      return result;
    } catch {
      return null;
    }
  };

  // Sync profile in background (non-blocking)
  const syncProfileBackground = (token: string) => {
    fetch('/api/auth/sync-profile', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {
      /* ignore */
    });
  };

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    let profileChannel: RealtimeChannel | null = null;

    const setupRealtime = (userId: string) => {
      try {
        if (profileChannel) profileChannel.unsubscribe();
      } catch {
        /* ignore */
      }

      try {
        profileChannel = supabase
          .channel(`profile:${userId}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'profiles',
              filter: `id=eq.${userId}`,
            },
            (
              payload: RealtimePostgresChangesPayload<Record<string, unknown>>
            ) => {
              const newRow = payload?.new as Record<string, unknown> | null;
              if (newRow && newRow['is_active'] === false) {
                signOut(false);
              } else if (newRow) {
                setProfile(prev => {
                  if (!prev) return prev;
                  const updated: Profile = {
                    ...prev,
                    full_name:
                      typeof newRow['full_name'] === 'string'
                        ? newRow['full_name']
                        : prev.full_name,
                    avatar:
                      typeof newRow['avatar_url'] === 'string'
                        ? newRow['avatar_url']
                        : prev.avatar,
                    isActive:
                      typeof newRow['is_active'] === 'boolean'
                        ? newRow['is_active']
                        : prev.isActive,
                  };
                  setCachedAuth(user, updated);
                  return updated;
                });
              }
            }
          )
          .subscribe((status: string) => {
            // Auto-reconnect when the Realtime channel drops silently
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              setTimeout(() => setupRealtime(userId), 5_000);
            }
          });
      } catch {
        /* ignore */
      }
    };

    const init = async () => {
      try {
        // Get session quickly
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.user) {
          const u = { id: session.user.id, email: session.user.email || '' };
          setUser(u);
          setCachedAuth(u, profile);

          // If we have cached profile, use it immediately and refresh in background
          if (profile && profile.id === u.id) {
            setLoading(false);
            // Background refresh
            if (!isPublicPath) {
              if (session.access_token)
                syncProfileBackground(session.access_token);
              loadProfileFast(u.id, u.email).then(loaded => {
                if (loaded) setCachedAuth(u, loaded);
              });
              setupRealtime(u.id);
            }
          } else if (!isPublicPath) {
            // No cache, need to load profile
            if (session.access_token)
              syncProfileBackground(session.access_token);
            const loaded = await loadProfileFast(u.id, u.email, 2000);
            if (!loaded) {
              // Retry once more
              await loadProfileFast(u.id, u.email, 3000);
            }
            setupRealtime(u.id);
            setLoading(false);
          } else {
            setLoading(false);
          }
        } else {
          // No session - clear everything
          setUser(null);
          setProfile(null);
          clearCachedAuth();
          setLoading(false);
        }
      } catch (e) {
        console.error('Auth init error:', e);
        setLoading(false);
      }
    };

    // Auth state change listener
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
          router.replace('/reset-password');
          return;
        }

        if (session?.user) {
          const u = { id: session.user.id, email: session.user.email || '' };
          setUser(u);

          if (!isPublicPath) {
            if (session.access_token)
              syncProfileBackground(session.access_token);
            loadProfileFast(u.id, u.email);
            setupRealtime(u.id);
          }
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setProfile(null);
          clearCachedAuth();
          try {
            if (profileChannel) profileChannel.unsubscribe();
          } catch {
            /* ignore */
          }
          if (!isPublicPath) {
            try {
              router.replace('/');
            } catch {
              /* ignore */
            }
          }
        }
      }
    );

    init();

    return () => {
      try {
        authListener.subscription.unsubscribe();
      } catch {
        /* ignore */
      }
      try {
        if (profileChannel) profileChannel.unsubscribe();
      } catch {
        /* ignore */
      }
    };
  }, []);

  // Deactivation check — rely on Realtime subscription primarily.
  // Poll only for trainees every 5 minutes as a fallback, and only when the
  // browser tab is visible.  Realtime handles instant deactivation; this
  // catch-all guards against silent channel drops.
  useEffect(() => {
    if (!user?.id || isPublicPath || profile?.role !== 'trainee') return;
    let mounted = true;

    const check = async () => {
      if (!mounted) return;
      // Skip poll when the tab is not visible — no need to burn requests
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      )
        return;
      const loaded = await loadProfile(user.id);
      if (loaded && loaded.isActive === false) {
        signOut(false);
      }
    };

    const id = setInterval(check, 300_000); // 5 minutes
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [user?.id, isPublicPath, profile?.role]);

  const waitForProfile = async (
    userId: string,
    timeoutMs = 2000,
    intervalMs = 200
  ) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();
      if (data) return true;
      await new Promise(res => setTimeout(res, intervalMs));
    }
    return false;
  };

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    let userId: string | null = null;
    let userEmail: string | null = null;

    const sdkResult = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (sdkResult.error) {
      // Fallback to REST login
      try {
        const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`;
        const apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey },
          body: JSON.stringify({ email, password }),
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          setLoading(false);
          if (
            resp.status === 400 &&
            /email/i.test(text) &&
            /confirm/i.test(text)
          ) {
            throw new Error('E-Mail ist noch nicht bestätigt.');
          }
          if (resp.status === 400)
            throw new Error('E-Mail oder Passwort ist falsch.');
          throw new Error('Anmeldung fehlgeschlagen.');
        }
        const data = await resp.json();
        if (!data?.access_token || !data?.refresh_token) {
          setLoading(false);
          throw new Error('Unerwartete Antwort vom Auth-Server.');
        }
        const { data: setRes, error: setErr } = await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        });
        if (setErr || !setRes.session?.user) {
          setLoading(false);
          throw new Error(setErr?.message || 'Anmeldung fehlgeschlagen.');
        }
        userId = setRes.session.user.id;
        userEmail = setRes.session.user.email || email;
      } catch (e: unknown) {
        setLoading(false);
        throw e instanceof Error ? e : new Error('Anmeldung fehlgeschlagen.');
      }
    } else if (sdkResult.data.user) {
      userId = sdkResult.data.user.id;
      userEmail = sdkResult.data.user.email || email;
    }

    if (userId) {
      const u = { id: userId, email: userEmail || '' };
      setUser(u);
      localStorage.setItem(CACHE_KEYS.LOGIN_AT, Date.now().toString());

      // Sync profile in background
      const { data: sessionRes } = await supabase.auth.getSession();
      if (sessionRes.session?.access_token) {
        syncProfileBackground(sessionRes.session.access_token);
      }

      await waitForProfile(userId);
      const loaded = await loadProfile(userId, userEmail || '');

      if (loaded && loaded.role === 'trainee' && loaded.isActive === false) {
        await supabase.auth.signOut();
        setUser(null);
        setProfile(null);
        clearCachedAuth();
        setLoading(false);
        throw new Error('Account ist noch nicht aktiviert.');
      }

      setCachedAuth(u, loaded);
      setLoading(false);
      scheduleAutoLogout();

      if (isPublicPath) {
        const target =
          loaded?.role === 'trainer'
            ? '/trainer/dashboard'
            : '/trainee/dashboard';
        router.replace(target);
      }
      return;
    }

    setLoading(false);
    throw new Error('Anmeldung fehlgeschlagen.');
  };

  const signUp = async (
    fullName: string,
    email: string,
    password: string,
    role: 'trainee' | 'trainer'
  ) => {
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role,
        },
      },
    });

    if (error || !data.user) {
      setLoading(false);
      throw error || new Error('Sign up failed');
    }

    setUser({ id: data.user.id, email });
    try {
      if (typeof window !== 'undefined')
        window.localStorage.setItem('auth_login_at', Date.now().toString());
    } catch (_) {
      /* ignore */
    }

    // Wait for DB trigger to create profile, then load it
    await waitForProfile(data.user.id);
    const loaded = await loadProfile(data.user.id);
    setLoading(false);
    scheduleAutoLogout();
    // After sign up redirect to dashboard appropriate for role
    try {
      const target =
        loaded?.role === 'trainer'
          ? '/trainer/dashboard'
          : '/trainee/dashboard';
      router.replace(target);
    } catch (_) {
      /* ignore */
    }
  };
  const signOut = async (silent?: boolean) => {
    setLoading(true);
    clearLogoutTimer();
    // Fallback: ensure tokens cleared even if SDK errors
    try {
      await Promise.race([
        supabase.auth.signOut(),
        new Promise(resolve => setTimeout(resolve, 3000)), // timeout safeguard
      ]);
    } catch (error) {
      console.error('Auth signOut failed:', error);
    }
    try {
      if (typeof window !== 'undefined') {
        // Remove stored login timestamp & any supabase keys
        window.localStorage.removeItem('auth_login_at');
        for (const k of Object.keys(window.localStorage)) {
          if (k.startsWith('sb-')) {
            try {
              window.localStorage.removeItem(k);
            } catch (_) {
              /* ignore */
            }
          }
        }
      }
    } catch (_) {
      /* ignore */
    }
    setUser(null);
    setProfile(null);
    setLoading(false);
    if (!silent) {
      try {
        router.replace('/');
      } catch (_) {
        /* ignore */
      }
    }
  };

  useEffect(() => {
    // On mount or when user changes, schedule auto logout if logged in
    if (user?.id) {
      scheduleAutoLogout();
    } else {
      try {
        if (typeof window !== 'undefined')
          window.localStorage.removeItem('auth_login_at');
      } catch (_) {
        /* ignore */
      }
      clearLogoutTimer();
    }
    return () => {
      clearLogoutTimer();
    };
  }, [user?.id]);

  // Stable callback references to avoid re-creating the context value every render
  const stableSignIn = useCallback(signIn, []);
  const stableSignUp = useCallback(signUp, []);
  const stableSignOut = useCallback(signOut, []);

  const updateProfile = useCallback(
    async (updates: {
      full_name?: string;
      avatar_url?: string | null;
      birth_date?: string | null;
      training_start_date?: string | null;
      trainer_auth_id?: string | null;
    }) => {
      if (!profile) return;
      await supabase
        .from('profiles')
        .update({
          full_name: updates.full_name,
          avatar_url: updates.avatar_url ?? null,
          birth_date: updates.birth_date ?? null,
          start_of_training_date: updates.training_start_date ?? null,
          assigned_trainer_id: updates.trainer_auth_id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', profile.id);
      if (user) await loadProfile(user.id);
    },
    [profile, user]
  );

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.id);
  }, [user]);

  const stableSwitchRole = useCallback(
    async (role: 'trainee' | 'trainer') => {
      if (!profile) return;
      const dbRole = role.toUpperCase();
      await supabase
        .from('profiles')
        .update({ role: dbRole, updated_at: new Date().toISOString() })
        .eq('id', profile.id);
      if (user) await loadProfile(user.id);
    },
    [profile, user]
  );

  const changePassword = useCallback(async (newPassword: string) => {
    if (!newPassword || newPassword.length < 8) {
      throw new Error('Das Passwort muss mindestens 8 Zeichen lang sein.');
    }

    const timeoutPromise = new Promise<{ data: any; error: null }>(resolve => {
      setTimeout(() => resolve({ data: null, error: null }), 3000);
    });

    const updatePromise = supabase.auth.updateUser({ password: newPassword });
    const { error } = await Promise.race([updatePromise, timeoutPromise]);
    if (error) {
      throw new Error(error.message || 'Passwort konnte nicht geändert werden');
    }
  }, []);

  const value: AuthContextType = useMemo(
    () => ({
      user,
      profile,
      loading,
      signIn: stableSignIn,
      signUp: stableSignUp,
      signOut: stableSignOut,
      updateProfile,
      refreshProfile,
      switchRole: stableSwitchRole,
      changePassword,
    }),
    [user, profile, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
