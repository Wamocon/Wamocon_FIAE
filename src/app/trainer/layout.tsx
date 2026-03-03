'use client';

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { MainLayout } from '@/components/layout/MainLayout';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useSidebar } from '@/contexts/SidebarContext';

const TrainerLayoutComponent = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const { isOpen: sidebarOpen, toggle: handleToggleSidebar } = useSidebar();

  // If profile is already available from cache, skip waiting entirely.
  const [waitingForProfile, setWaitingForProfile] = useState(() => !profile);

  // Wait for profile to load with a short timeout
  useEffect(() => {
    if (profile) {
      setWaitingForProfile(false);
      return;
    }

    if (!loading && user && !profile) {
      const timer = setTimeout(() => {
        setWaitingForProfile(false);
      }, 1500);
      return () => clearTimeout(timer);
    }

    if (!loading && !user) {
      setWaitingForProfile(false);
    }
  }, [loading, user, profile]);

  // Memoize authentication check to prevent unnecessary re-renders
  const isAuthenticated = useMemo(() => {
    return user && profile && profile.role === 'trainer';
  }, [user, profile]);

  // Determine if we're still in a loading state
  const isLoading = loading || (user && waitingForProfile && !profile);

  // Memoize redirect logic - only redirect when we're sure auth is complete
  const shouldRedirect = useMemo(() => {
    if (isLoading) return false;
    if (!user) return true;
    if (profile && profile.role !== 'trainer') return true;
    return false;
  }, [isLoading, user, profile]);

  useEffect(() => {
    if (shouldRedirect) {
      router.push('/login');
    }
  }, [shouldRedirect, router]);

  const handleGoBack = useCallback(() => {
    // Use window.history.back() instead of router.back() to prevent potential loops
    if (window.history.length > 1) {
      window.history.back();
    } else {
      router.push('/trainer/dashboard');
    }
  }, [router]);

  // Show loading state while auth is initializing or waiting for profile
  if (isLoading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="text-muted-foreground mt-4">Lade...</p>
        </div>
      </div>
    );
  }

  // Show redirect state
  if (shouldRedirect) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="text-muted-foreground mt-4">Weiterleitung...</p>
        </div>
      </div>
    );
  }

  // User exists but profile hasn't arrived yet
  if (user && !profile) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="text-muted-foreground mt-4">Lade...</p>
        </div>
      </div>
    );
  }

  // No user and no profile after auth completed
  if (!isAuthenticated) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="text-muted-foreground mt-4">Zugriff verweigert...</p>
        </div>
      </div>
    );
  }

  return (
    <MainLayout
      user={user}
      profile={profile}
      onGoBack={handleGoBack}
      sidebarOpen={sidebarOpen}
      onToggleSidebar={handleToggleSidebar}
      userRole="trainer"
    >
      {children}
    </MainLayout>
  );
};

export default memo(TrainerLayoutComponent);
