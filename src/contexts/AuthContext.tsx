'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase'; // Your Supabase client from supabase.ts

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
        'id, auth_id, full_name, role, avatar_url, trainer_auth_id, training_start_date'
      )
      .eq('auth_id', userId)
      .single();

    if (error) {
      console.error('Failed to load profile', error);
      setProfile(null);
      return;
    }

    setProfile({
      id: data.id,
      email,
      full_name: data.full_name,
      role: data.role as 'trainee' | 'trainer',
      avatar: (data as any).avatar_url || null,
      training_start_date: (data as any).training_start_date || null,
      trainer_id: (data as any).trainer_auth_id || null,
    });
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
