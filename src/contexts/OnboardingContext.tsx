'use client';

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  TourStep,
  TRAINEE_MAIN_STEPS,
  TRAINEE_HAI_STEPS,
  TRAINER_MAIN_STEPS,
  TRAINER_HAI_STEPS,
} from '@/lib/tour-steps';

type TourType = 'main' | 'hai';

interface OnboardingContextType {
  isActive: boolean;
  currentStepIndex: number;
  tourType: TourType | null;
  steps: TourStep[];
  currentStep: TourStep | null;
  startTour: (type: TourType) => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => void;
  restartTour: (type: TourType) => void;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

const STORAGE_KEYS = {
  main: 'onboarding_main_completed',
  hai: 'onboarding_hai_completed',
} as const;

function isCompleted(type: TourType): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(STORAGE_KEYS[type]) === 'true';
}

function markCompleted(type: TourType): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS[type], 'true');
}

function clearCompleted(type: TourType): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEYS[type]);
}

function getSteps(role: 'trainee' | 'trainer', type: TourType): TourStep[] {
  if (role === 'trainee') return type === 'main' ? TRAINEE_MAIN_STEPS : TRAINEE_HAI_STEPS;
  return type === 'main' ? TRAINER_MAIN_STEPS : TRAINER_HAI_STEPS;
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [isActive, setIsActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [tourType, setTourType] = useState<TourType | null>(null);
  const [steps, setSteps] = useState<TourStep[]>([]);

  const currentStep = isActive && steps.length > 0 ? steps[currentStepIndex] ?? null : null;

  const startTour = useCallback((type: TourType) => {
    if (!profile?.role) return;
    const tourSteps = getSteps(profile.role as 'trainee' | 'trainer', type);
    setSteps(tourSteps);
    setTourType(type);
    setCurrentStepIndex(0);
    setIsActive(true);
  }, [profile?.role]);

  const completeTour = useCallback(() => {
    if (tourType) markCompleted(tourType);
    const wasMain = tourType === 'main';
    setIsActive(false);
    setTourType(null);
    setCurrentStepIndex(0);
    setSteps([]);

    // After main tour, auto-start HAI tour if not completed
    if (wasMain && !isCompleted('hai')) {
      setTimeout(() => startTour('hai'), 600);
    }
  }, [tourType, startTour]);

  const nextStep = useCallback(() => {
    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex(prev => prev + 1);
    } else {
      completeTour();
    }
  }, [currentStepIndex, steps.length, completeTour]);

  const prevStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
    }
  }, [currentStepIndex]);

  const skipTour = useCallback(() => {
    if (tourType) markCompleted(tourType);
    const wasMain = tourType === 'main';
    setIsActive(false);
    setTourType(null);
    setCurrentStepIndex(0);
    setSteps([]);

    // After skipping main tour, still offer HAI tour
    if (wasMain && !isCompleted('hai')) {
      setTimeout(() => startTour('hai'), 600);
    }
  }, [tourType, startTour]);

  const restartTour = useCallback((type: TourType) => {
    clearCompleted('main');
    clearCompleted('hai');
    startTour(type);
  }, [startTour]);

  // Auto-start on first login
  useEffect(() => {
    if (!profile?.role) return;
    if (isCompleted('main')) return;

    // Delay to let dashboard render first
    const timer = setTimeout(() => {
      startTour('main');
    }, 1200);

    return () => clearTimeout(timer);
    // Only run once when profile loads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.role]);

  return (
    <OnboardingContext.Provider
      value={{
        isActive,
        currentStepIndex,
        tourType,
        steps,
        currentStep,
        startTour,
        nextStep,
        prevStep,
        skipTour,
        restartTour,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider');
  return ctx;
}
