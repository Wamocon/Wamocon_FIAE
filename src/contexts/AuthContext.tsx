'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

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

  useEffect(() => {
    // Realtime subscription handle for current user's profile
    let profileChannel: any = null;
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
            (payload: any) => {
              try {
                const newRow = payload?.new;
                if (newRow && newRow.is_active === false) {
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
                  setProfile(prev => ({ ...(prev as any), full_name: newRow.full_name ?? prev?.full_name, avatar: newRow.avatar_url ?? prev?.avatar, training_start_date: newRow.start_of_training_date ?? prev?.training_start_date, isActive: Boolean(newRow.is_active) }));
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
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) {
        const u = session.user;
        setUser({ id: u.id, email: u.email || '' });
        await loadProfile(u.id);
        try { setupRealtime(u.id); } catch (e) { /* ignore */ }
      }
      setLoading(false);
    };

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user) {
          const u = session.user;
          setUser({ id: u.id, email: u.email || '' });
          loadProfile(u.id);
          try { setupRealtime(u.id); } catch (e) { /* ignore */ }
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
  }, []);

  // Polling fallback: if realtime is not available or delayed, poll the profile periodically
  useEffect(() => {
    if (!user?.id) return;
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
  }, [user?.id]);

  const loadProfile = async (userId: string) => {
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
      setProfile(null);
      return null;
    }

    const mapped = {
      id: data.id,
      email,
      full_name: (data as any).full_name,
      role: String(data.role).toLowerCase() as 'trainee' | 'trainer',
      avatar: (data as any).avatar_url || null,
      training_start_date: (data as any).start_of_training_date || null,
      trainer_id: (data as any).assigned_trainer_id || null,
      // map DB flag
      isActive: Boolean((data as any).is_active),
    };
    setProfile(mapped);
    return mapped;
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
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setLoading(false);
      throw error;
    }
    if (data.user) {
      setUser({ id: data.user.id, email: data.user.email || '' });
      // Handle eventual consistency after email confirmation or first-time login
      await waitForProfile(data.user.id);
      const loaded = await loadProfile(data.user.id);
      // Prevent inactive trainees from logging in
      if (loaded && loaded.role === 'trainee' && loaded.isActive === false) {
        // sign out immediately and inform caller
        await supabase.auth.signOut();
        setUser(null);
        setProfile(null);
        setLoading(false);
        throw new Error('Account ist noch nicht aktiviert. Bitte Ihren Trainer kontaktieren.');
      }
    }
    setLoading(false);
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

    // Wait for DB trigger to create profile, then load it
    await waitForProfile(data.user.id);
    await loadProfile(data.user.id);
    setLoading(false);
  };

  const signOut = async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
      setUser(null);
      setProfile(null);
    } catch (error) {
      // Gracefully handle sign-out failures without crashing the app
      console.error('Auth signOut failed:', error);
    } finally {
      setLoading(false);
    }
  };

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
          full_name: (updates as any).full_name,
          avatar_url: (updates as any).avatar_url,
          start_of_training_date: (updates as any).training_start_date,
          assigned_trainer_id: (updates as any).trainer_auth_id ?? (updates as any).assigned_trainer_id,
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
      if (!newPassword || newPassword.length < 8) {
        throw new Error('Das Passwort muss mindestens 8 Zeichen lang sein.');
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        throw new Error(error.message || 'Passwort konnte nicht geändert werden');
      }
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
