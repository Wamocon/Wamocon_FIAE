'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export interface DemoProfile {
  id: string;
  email: string;
  full_name: string;
  role: 'trainee' | 'trainer';
  avatar: string | null;
  training_start_date: string | null;
  trainer_id: string | null;
}

const traineeProfile: DemoProfile = {
  id: 'demo-trainee-001',
  email: 'max.mueller@demo.lfa.de',
  full_name: 'Max Müller',
  role: 'trainee', // Keeping 'trainee' to match DemoProfile type
  avatar: null, // Keeping 'avatar' to match DemoProfile type
  training_start_date: '2024-09-01', // Changed date, keeping field name
  trainer_id: 'demo-trainer-001',
};

const trainerProfile: DemoProfile = {
  id: 'demo-trainer-001',
  email: 'anna.schmidt@demo.lfa.de',
  full_name: 'Anna Schmidt',
  role: 'trainer',
  avatar: null,
  training_start_date: null,
  trainer_id: null,
};

interface DemoContextValue {
  role: 'trainee' | 'trainer';
  profile: DemoProfile;
  setRole: (role: 'trainee' | 'trainer') => void;
  toggleRole: () => void;
  showDemoToast: (action: string) => void;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<'trainee' | 'trainer'>('trainee');

  const profile = role === 'trainee' ? traineeProfile : trainerProfile;

  const setRole = useCallback((newRole: 'trainee' | 'trainer') => {
    setRoleState(newRole);
  }, []);

  const toggleRole = useCallback(() => {
    setRoleState(prev => (prev === 'trainee' ? 'trainer' : 'trainee'));
  }, []);

  const showDemoToast = useCallback((action: string) => {
    // Simple toast using native API — no dependency on toast library
    if (typeof window !== 'undefined') {
      const toast = document.createElement('div');
      toast.className =
        'fixed top-20 right-6 z-[9999] bg-amber-600 text-white px-4 py-3 rounded-xl shadow-2xl text-sm font-medium animate-in fade-in slide-in-from-top-2 duration-300';
      toast.textContent = `Demo Modus — ${action} ist deaktiviert.`;
      document.body.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 300ms';
        setTimeout(() => toast.remove(), 300);
      }, 2500);
    }
  }, []);

  return (
    <DemoContext.Provider value={{ role, profile, setRole, toggleRole, showDemoToast }}>
      {children}
    </DemoContext.Provider>
  );
}

export function useDemo() {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error('useDemo must be used within DemoProvider');
  return ctx;
}
