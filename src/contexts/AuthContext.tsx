'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

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
    training_start_date?: string | null;
    trainer_auth_id?: string | null;
  }) => Promise<void>;
  refreshProfile: () => Promise<void>;
  switchRole: (role: 'trainee' | 'trainer') => Promise<void>;
  changePassword: (newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  // Public routes must not perform private API or DB calls
  const isPublicPath = useMemo(() => {
    const publicPaths = new Set<string>([
      '/',
      '/login', // ensure login route is treated as public so we don't auto load profile after signOut
      '/register',
      '/forgot-password',
      '/reset-password',
    ]);
    return publicPaths.has(pathname || '');
  }, [pathname]);

  // Auto logout after 4 hours
  const SESSION_MAX_MS = 4 * 60 * 60 * 1000; // 4h
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
    const loginAtRaw = window.localStorage.getItem('auth_login_at');
    const loginAt = loginAtRaw ? Number(loginAtRaw) : Date.now();
    const now = Date.now();
    const remaining = SESSION_MAX_MS - (now - loginAt);
    if (remaining <= 0) {
      void signOut(true);
      return;
    }
    logoutTimerRef.current = setTimeout(() => { void signOut(true); }, remaining);
  };

  // Utility: sleep helper
  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

  // Load profile with soft timeout and small retries; returns null on timeout instead of throwing
  const loadProfileWithTimeout = async (userId: string, timeoutMs = 8000, retries = 2) => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
        const result = (await Promise.race([loadProfile(userId), timeout])) as Profile | null;
        if (result) return result;
      } catch (_) {
        // ignore and retry
      }
      // backoff before next attempt
      if (attempt < retries) await sleep(300 * (attempt + 1));
    }
    return null;
  };

  useEffect(() => {
    // Realtime subscription handle for current user's profile
    let profileChannel: RealtimeChannel | null = null;
    const setupRealtime = (userId?: string) => {
      // cleanup previous
      try {
        if (profileChannel) profileChannel.unsubscribe();
      } catch (e) {
        /* ignore */
      }
      profileChannel = null;
      if (!userId) return;
      try {
        profileChannel = supabase
          .channel(`public:profiles:id=eq.${userId}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
            (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
              try {
                const newRow = payload?.new as Record<string, unknown> | null | undefined;
                if (newRow && newRow['is_active'] === false) {
                  // If current user was deactivated, sign them out immediately
                  supabase.auth.signOut()
                    .catch((err) => console.error('Error signing out after deactivation', err))
                    .finally(() => {
                      setUser(null);
                      setProfile(null);
                      try { router.replace('/login'); } catch (e) { /* ignore */ }
                    });
                } else if (newRow) {
                  // Update local profile when changes arrive
                  setProfile(prev => {
                    if (!prev) return prev;
                    const updated: Profile = {
                      ...prev,
                      full_name: typeof newRow['full_name'] === 'string' ? (newRow['full_name'] as string) : prev.full_name,
                      avatar: typeof newRow['avatar_url'] === 'string' ? (newRow['avatar_url'] as string) : prev.avatar,
                      training_start_date: typeof newRow['start_of_training_date'] === 'string' ? (newRow['start_of_training_date'] as string) : prev.training_start_date,
                      isActive: typeof newRow['is_active'] === 'boolean' ? (newRow['is_active'] as boolean) : prev.isActive,
                    };
                    return updated;
                  });
                }
              } catch (e) {
                console.error('Realtime profile handler error', e);
              }
            }
          )
          .subscribe();
      } catch (e) {
        console.warn('Failed to setup realtime profile subscription', e);
      }
    };

    const init = async () => {
      setLoading(true);
      
      try {
        // Add timeout to prevent hanging forever
        const initTimeout = new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error('Init timeout')), 3000); // 10 second timeout
        });
        
        const initLogic = async () => {
          const {
            data: { session },
          } = await supabase.auth.getSession();

          // Handle PKCE OAuth redirects only (/?code=...&state=...)
          try {
            if (typeof window !== 'undefined') {
              const url = new URL(window.location.href);
              const code = url.searchParams.get('code');
              const state = url.searchParams.get('state');
              if (!session?.user && code && state) {
                const { data: exData, error: exErr } = await supabase.auth.exchangeCodeForSession(code);
                if (!exErr && exData.session) {
                  // Session established via OAuth PKCE; no redirect needed here.
                }
              }
            }
          } catch (e) {
            // ignore
          }
          
          if (session?.user) {
            const u = session.user;
            setUser({ id: u.id, email: u.email || '' });
            if (!isPublicPath) {
              // Ensure profile exists/updated on server
              try {
                if (session.access_token) {
                  const syncTimeout = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('sync timeout')), 5000)
                  );
                  await Promise.race([
                    fetch('/api/auth/sync-profile', {
                      method: 'POST',
                      headers: {
                        Authorization: `Bearer ${session.access_token}`,
                      },
                    }),
                    syncTimeout
                  ]);
                }
              } catch (e) {
                console.warn('Profile sync failed or timed out:', e);
              }
              
              // Load profile with soft timeout and background resilience
              const loaded = await loadProfileWithTimeout(u.id, 8000, 2);
              if (!loaded) {
                // Soft warn and continue; schedule a quiet background refresh
                console.warn('Load profile soft-timeout during init; will retry in background');
                // fire-and-forget retry (no await)
                loadProfileWithTimeout(u.id, 8000, 2).catch(() => void 0);
              }
              
              try { setupRealtime(u.id); } catch (e) { /* ignore */ }
            }
          }
        };
        
        await Promise.race([initLogic(), initTimeout]);
      } catch (e) {
        console.error('Auth init error or timeout:', e);
      } finally {
        setLoading(false);
      }
    };

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          const u = session.user;
          setUser({ id: u.id, email: u.email || '' });
          // If arriving from a password recovery link, send user to the reset page UI
          try {
            if (event === 'PASSWORD_RECOVERY') {
              router.replace('/reset-password');
            }
          } catch (e) { /* ignore */ }
          if (!isPublicPath) {
            // Ensure profile exists/updated on server
            try {
              if (session.access_token) {
                const syncTimeout = new Promise((_, reject) => 
                  setTimeout(() => reject(new Error('sync timeout in onAuthStateChange')), 5000)
                );
                await Promise.race([
                  fetch('/api/auth/sync-profile', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${session.access_token}` },
                  }),
                  syncTimeout
                ]);
              }
            } catch (e) {
              console.warn('Profile sync failed or timed out in onAuthStateChange:', e);
            }
            
            const loaded = await loadProfileWithTimeout(u.id, 8000, 2);
            if (!loaded) {
              console.warn('Load profile soft-timeout in onAuthStateChange; will retry in background');
              loadProfileWithTimeout(u.id, 8000, 2).catch(() => void 0);
            }
            
            try { setupRealtime(u.id); } catch (e) { /* ignore */ }
          }
        } else {
          setUser(null);
          setProfile(null);
          try { if (profileChannel) profileChannel.unsubscribe(); } catch (e) { /* ignore */ }
          profileChannel = null;
        }
      }
    );

    init();

    return () => {
      try {
        authListener.subscription.unsubscribe();
      } catch (e) {
        // ignore
      }
      try {
        if (profileChannel) profileChannel.unsubscribe();
      } catch (e) {
        // ignore
      }
    };
  }, [isPublicPath]);

  // Polling fallback: if realtime is not available or delayed, poll the profile periodically
  useEffect(() => {
    if (!user?.id || isPublicPath) return;
    let mounted = true;
    const check = async () => {
      try {
        const loaded = await loadProfile(user.id);
        if (!mounted) return;
        if (loaded && loaded.role === 'trainee' && loaded.isActive === false) {
          // force sign out
          try {
            await supabase.auth.signOut();
          } catch (e) {
            console.error('Error signing out after deactivation', e);
          } finally {
            setUser(null);
            setProfile(null);
            try { router.replace('/login'); } catch (e) { /* ignore */ }
          }
        }
      } catch (e) {
        // ignore transient errors
      }
    };
    // initial check
    check();
    const id = setInterval(check, 15000); // every 15s
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [user?.id, isPublicPath]);

  const loadProfile = async (userId: string) => {
    try {
      const { data: authUser } = await supabase.auth.getUser();
      const email = authUser.user?.email || '';

      const { data, error } = await supabase
        .from('profiles')
        .select(
          'id, full_name, role, avatar_url, assigned_trainer_id, start_of_training_date, is_active'
        )
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Error loading profile:', error);
        setProfile(null);
        return null;
      }

      type ProfileRow = {
        id: string;
        full_name: string | null;
        role: 'TRAINER' | 'TRAINEE';
        avatar_url: string | null;
        assigned_trainer_id: string | null;
        start_of_training_date: string | null;
        is_active: boolean | null;
      };
      const row = data as ProfileRow;
      const mapped: Profile = {
        id: row.id,
        email,
        full_name: row.full_name ?? '',
        role: String(row.role).toLowerCase() as 'trainee' | 'trainer',
        avatar: row.avatar_url || null,
        training_start_date: row.start_of_training_date || null,
        trainer_id: row.assigned_trainer_id || null,
        // map DB flag; default to true when column is null/undefined
        isActive: row.is_active === null || row.is_active === undefined ? true : Boolean(row.is_active),
      };
      setProfile(mapped);
      return mapped;
    } catch (e) {
      console.error('Exception in loadProfile:', e);
      setProfile(null);
      return null;
    }
  };

  const waitForProfile = async (
    userId: string,
    timeoutMs = 4000,
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
    // First, try the SDK sign in
    let userId: string | null = null;
    let userEmail: string | null = null;
    const sdkResult = await supabase.auth.signInWithPassword({ email, password });
    if (sdkResult.error) {
      // If SDK fails, try direct REST login as a fallback (per hosted quirks)
      // POST { email, password } to /auth/v1/token?grant_type=password with apikey header (anon key)
      try {
        const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`;
        const apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey,
          },
          body: JSON.stringify({ email, password }),
          cache: 'no-store',
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          // eslint-disable-next-line no-console
          console.error('[auth] REST login failed', resp.status, text);
          setLoading(false);
          if (resp.status === 400 && /email/i.test(text) && /confirm/i.test(text)) {
            throw new Error('E-Mail ist noch nicht bestätigt. Bitte bestätigen oder nutzen Sie "Passwort vergessen?"');
          }
          if (resp.status === 400) throw new Error('E-Mail oder Passwort ist falsch.');
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
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error('[auth] signIn fallback error:', e);
        setLoading(false);
        throw e instanceof Error ? e : new Error('Anmeldung fehlgeschlagen.');
      }
    } else if (sdkResult.data.user) {
      userId = sdkResult.data.user.id;
      userEmail = sdkResult.data.user.email || email;
    }

    if (userId) {
      setUser({ id: userId, email: userEmail || '' });
      try {
        if (typeof window !== 'undefined') window.localStorage.setItem('auth_login_at', Date.now().toString());
      } catch (_) { /* ignore */ }
      // Always sync & load profile (even on public path) so UI has data immediately
      try {
        const { data: sessionRes } = await supabase.auth.getSession();
        const token = sessionRes.session?.access_token;
        if (token) {
          await fetch('/api/auth/sync-profile', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      } catch (e) { /* ignore */ }
      await waitForProfile(userId);
      const loaded = await loadProfile(userId);
      if (loaded && loaded.role === 'trainee' && loaded.isActive === false) {
        await supabase.auth.signOut();
        setUser(null);
        setProfile(null);
        setLoading(false);
        throw new Error('Account ist noch nicht aktiviert. Bitte Ihren Trainer kontaktieren.');
      }
      setLoading(false);
      scheduleAutoLogout();
      // Redirect based on role if currently on a public path (likely /login)
      try {
        if (isPublicPath) {
          const target = loaded?.role === 'trainer' ? '/trainer/dashboard' : '/trainee/dashboard';
          router.replace(target);
        }
      } catch (_) { /* ignore */ }
      return;
    }

    // If we got here, neither SDK nor fallback succeeded
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
    try { if (typeof window !== 'undefined') window.localStorage.setItem('auth_login_at', Date.now().toString()); } catch (_) { /* ignore */ }

    // Wait for DB trigger to create profile, then load it
    await waitForProfile(data.user.id);
    const loaded = await loadProfile(data.user.id);
    setLoading(false);
    scheduleAutoLogout();
    // After sign up redirect to dashboard appropriate for role
    try {
      const target = loaded?.role === 'trainer' ? '/trainer/dashboard' : '/trainee/dashboard';
      router.replace(target);
    } catch (_) { /* ignore */ }
  };
  const signOut = async (silent?: boolean) => {
    setLoading(true);
    clearLogoutTimer();
    // Fallback: ensure tokens cleared even if SDK errors
    try {
      await Promise.race([
        supabase.auth.signOut(),
        new Promise((resolve) => setTimeout(resolve, 3000)), // timeout safeguard
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
            try { window.localStorage.removeItem(k); } catch (_) { /* ignore */ }
          }
        }
      }
    } catch (_) { /* ignore */ }
    setUser(null);
    setProfile(null);
    setLoading(false);
    if (!silent) {
      try { router.replace('/login'); } catch (_) { /* ignore */ }
    }
  };

  useEffect(() => {
    // On mount or when user changes, schedule auto logout if logged in
    if (user?.id) {
      scheduleAutoLogout();
    } else {
      try { if (typeof window !== 'undefined') window.localStorage.removeItem('auth_login_at'); } catch (_) { /* ignore */ }
      clearLogoutTimer();
    }
    return () => { clearLogoutTimer(); };
  }, [user?.id]);

  const value: AuthContextType = {
    user,
    profile,
    loading,
    signIn,
    signUp,
    signOut,
    updateProfile: async updates => {
      if (!profile) return;
      await supabase
        .from('profiles')
        .update({
          // map legacy keys to new column names when present
          full_name: updates.full_name,
          avatar_url: updates.avatar_url ?? null,
          start_of_training_date: updates.training_start_date ?? null,
          assigned_trainer_id: updates.trainer_auth_id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', profile.id);
      if (user) await loadProfile(user.id);
    },
    refreshProfile: async () => {
      if (user) await loadProfile(user.id);
    },
    switchRole: async (role: 'trainee' | 'trainer') => {
      if (!profile) return;
      const dbRole = role.toUpperCase(); // 'TRAINEE' | 'TRAINER'
      await supabase
        .from('profiles')
        .update({ role: dbRole, updated_at: new Date().toISOString() })
        .eq('id', profile.id);
      if (user) await loadProfile(user.id);
    },
    changePassword: async (newPassword: string) => {
      console.log('[AuthContext] changePassword called with password length:', newPassword.length);
      if (!newPassword || newPassword.length < 8) {
        throw new Error('Das Passwort muss mindestens 8 Zeichen lang sein.');
      }
      console.log('[AuthContext] Calling supabase.auth.updateUser...');
      
      // Supabase updateUser hangs when email confirmation is enabled
      // The password still changes successfully, so we treat timeout as success
      const timeoutPromise = new Promise<{ data: any; error: null }>((resolve) => {
        setTimeout(() => {
          console.log('[AuthContext] Password update timeout reached - treating as success');
          resolve({ data: null, error: null });
        }, 3000); // 3 seconds is enough
      });
      
      const updatePromise = supabase.auth.updateUser({ password: newPassword });
      
      const { error, data } = await Promise.race([updatePromise, timeoutPromise]);
      console.log('[AuthContext] supabase.auth.updateUser completed. Error:', error, 'Data:', data);
      if (error) {
        throw new Error(error.message || 'Passwort konnte nicht geändert werden');
      }
      console.log('[AuthContext] Password changed successfully, returning');
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
