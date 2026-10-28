'use client';

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useRouter } from 'next/navigation';
import { AccountAccessNotice } from '@/components/auth/AccountAccessNotice';
import { MainLayout } from '@/components/layout/MainLayout';
import {
  resolveAccessState,
  signedOutTarget,
} from '@/lib/auth/access-state';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useSidebar } from '@/contexts/SidebarContext';

const TrainerLayoutComponent = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { user, profile, loading, sessionEnd } = useAuth();
  const { t } = useLanguage();
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

  // What this person sees. Only somebody who is not signed in goes to the
  // login (with the reason). Everybody else who is stopped (wrong area,
  // account not released or deactivated, profile not loaded) sees a page with
  // a message and a sign out button, not a silent jump back to /login.
  const access = useMemo(
    () =>
      resolveAccessState({
        area: 'trainer',
        loading,
        signedIn: !!user,
        profile,
        waitingForProfile,
      }),
    [loading, user, profile, waitingForProfile]
  );

  useEffect(() => {
    if (access.kind === 'signedOut') {
      // replace: the back button does not lead into the same redirect again
      router.replace(signedOutTarget(sessionEnd));
    }
  }, [access.kind, sessionEnd, router]);

  const handleGoBack = useCallback(() => {
    // Use window.history.back() instead of router.back() to prevent potential loops
    if (window.history.length > 1) {
      window.history.back();
    } else {
      router.push('/trainer/dashboard');
    }
  }, [router]);

  // Show loading state while auth is initializing or waiting for profile
  if (access.kind === 'loading') {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="text-muted-foreground mt-4">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  // Not signed in: on the way to the login
  if (access.kind === 'signedOut') {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="text-muted-foreground mt-4">{t('common.redirecting')}</p>
        </div>
      </div>
    );
  }

  // Stopped with a reason: nothing of the area is mounted
  if (access.kind === 'blocked') {
    return (
      <AccountAccessNotice
        reason={access.reason}
        area="trainer"
        fullName={profile?.full_name}
      />
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
