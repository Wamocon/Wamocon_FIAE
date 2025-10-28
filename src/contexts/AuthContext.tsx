'use client';

import { createContext, useContext, useEffect, useState } from 'react';
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) {
        const u = session.user;
        setUser({ id: u.id, email: u.email || '' });
        await loadProfile(u.id);
      }
      setLoading(false);
    };

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user) {
          const u = session.user;
          setUser({ id: u.id, email: u.email || '' });
          loadProfile(u.id);
        } else {
          setUser(null);
          setProfile(null);
        }
      }
    );

    init();

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const loadProfile = async (userId: string) => {
    const { data: authUser } = await supabase.auth.getUser();
    const email = authUser.user?.email || '';

    const { data, error } = await supabase
      .from('profiles')
      .select(
        'id, full_name, role, avatar_url, assigned_trainer_id, start_of_training_date'
      )
      .eq('id', userId)
      .single();

    if (error) {
      setProfile(null);
      return;
    }

    setProfile({
      id: data.id,
      email,
      full_name: (data as any).full_name,
      role: String(data.role).toLowerCase() as 'trainee' | 'trainer',
      avatar: (data as any).avatar_url || null,
      training_start_date: (data as any).start_of_training_date || null,
      trainer_id: (data as any).assigned_trainer_id || null,
    });
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
      await loadProfile(data.user.id);
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
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setLoading(false);
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
