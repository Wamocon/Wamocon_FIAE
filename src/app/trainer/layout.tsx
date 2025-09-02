'use client';

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { MainLayout } from '@/components/layout/MainLayout';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

const TrainerLayoutComponent = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Memoize authentication check to prevent unnecessary re-renders
  const isAuthenticated = useMemo(() => {
    return !loading && user && profile && profile.role === 'trainer';
  }, [loading, user, profile]);

  // Memoize redirect logic
  const shouldRedirect = useMemo(() => {
    if (loading) return false;
    if (!user) return true;
    if (profile && profile.role !== 'trainer') return true;
    return false;
  }, [loading, user, profile]);

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

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  // Show loading state
  if (loading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="text-muted-foreground mt-4">
            Lade Trainer Dashboard...
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

  // Show access denied state
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
