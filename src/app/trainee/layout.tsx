'use client';

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { MainLayout } from '@/components/layout/MainLayout';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

const TraineeLayoutComponent = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [waitingForProfile, setWaitingForProfile] = useState(true);

  // Wait for profile to load with a timeout
  useEffect(() => {
    // If we have profile, stop waiting
    if (profile) {
      setWaitingForProfile(false);
      return;
    }
    
    // If loading is done but no profile, wait a bit more for profile sync
    if (!loading && user && !profile) {
      const timer = setTimeout(() => {
        setWaitingForProfile(false);
      }, 5000); // Give 5 seconds for profile to load after auth loading is done
      return () => clearTimeout(timer);
    }
    
    // If loading is done and no user, stop waiting
    if (!loading && !user) {
      setWaitingForProfile(false);
    }
  }, [loading, user, profile]);

  // Memoize authentication check to prevent unnecessary re-renders
  const isAuthenticated = useMemo(() => {
    return user && profile && profile.role === 'trainee';
  }, [user, profile]);

  // Determine if we're still in a loading state
  const isLoading = loading || (user && waitingForProfile && !profile);

  // Memoize redirect logic - only redirect when we're sure auth is complete
  const shouldRedirect = useMemo(() => {
    if (isLoading) return false;
    if (!user) return true;
    if (profile && profile.role !== 'trainee') return true;
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
      router.push('/trainee/dashboard');
    }
  }, [router]);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  // Show loading state while auth is initializing or waiting for profile
  if (isLoading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="text-muted-foreground mt-4">
            Lade...
          </p>
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

  // Show access denied state only after we've finished waiting
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
      userRole="trainee"
    >
      {children}
    </MainLayout>
  );
};

export default memo(TraineeLayoutComponent);
