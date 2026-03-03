'use client';

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useRouter } from 'next/navigation';
import { MainLayout } from '@/components/layout/MainLayout';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageLoader } from '@/components/ui/PageLoader';

const TraineeLayoutComponent = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { user, profile, loading } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // If profile is already available from cache, skip waiting entirely.
  // This avoids a flash of the loading spinner on cached sessions.
  const [waitingForProfile, setWaitingForProfile] = useState(() => !profile);

  // Wait for profile to load with a short timeout
  useEffect(() => {
    // Profile arrived — stop waiting immediately
    if (profile) {
      setWaitingForProfile(false);
      return;
    }

    // Auth loading is done but no profile yet — give a brief window.
    // The AuthContext is still loading the profile in the background;
    // this timeout only controls how long the *layout* shows a spinner.
    if (!loading && user && !profile) {
      const timer = setTimeout(() => {
        setWaitingForProfile(false);
      }, 1500);
      return () => clearTimeout(timer);
    }

    // No user at all — stop waiting
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
    return <PageLoader size="lg" fullScreen />;
  }

  // Show redirect state
  if (shouldRedirect) {
    return <PageLoader size="lg" fullScreen />;
  }

  // User exists but profile hasn't arrived yet — keep showing a
  // non-blocking loading state. AuthContext will update `profile` in the
  // background and this layout will re-render automatically.
  if (user && !profile) {
    return <PageLoader size="lg" fullScreen />;
  }

  // No user and no profile after auth completed — truly not authenticated
  if (!isAuthenticated) {
    return <PageLoader size="lg" fullScreen />;
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
