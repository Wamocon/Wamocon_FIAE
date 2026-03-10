'use client';

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useRouter } from 'next/navigation';
import { MainLayout } from '@/components/layout/MainLayout';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useSidebar } from '@/contexts/SidebarContext';
import { AlertCircle, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * Full-screen blocking overlay shown when the trainee has no birth_date.
 * Prevents any navigation or interaction until the date is provided.
 */
function BirthdateBlocker() {
  const { t } = useLanguage();
  const { profile, updateProfile, refreshProfile } = useAuth();
  const [birthDate, setBirthDate] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!birthDate) return;
    setSaving(true);
    try {
      await updateProfile({ birth_date: birthDate });
      await refreshProfile();
      toast.success(t('profile.updateSuccess') || 'Profil aktualisiert');
    } catch {
      toast.error('Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="bg-card border-border mx-4 w-full max-w-md rounded-2xl border p-8 shadow-2xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="bg-destructive/10 mb-4 flex h-14 w-14 items-center justify-center rounded-full">
            <AlertCircle className="text-destructive h-7 w-7" />
          </div>
          <h2 className="text-foreground text-xl font-bold">
            {t('profile.birthDateRequired') || 'Geburtsdatum erforderlich'}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            {t('profile.birthDateRequiredText') ||
              'Bitte geben Sie Ihr Geburtsdatum ein, um die Plattform nutzen zu können.'}
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-foreground mb-1.5 block text-sm font-medium">
              <Calendar className="mr-1.5 inline-block h-4 w-4" />
              {t('profile.birthDate') || 'Geburtsdatum'}
            </label>
            <input
              type="date"
              value={birthDate}
              onChange={e => setBirthDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="bg-background border-border text-foreground w-full rounded-lg border px-3 py-2.5 text-sm transition-colors focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={!birthDate || saving}
            className="bg-accent text-accent-foreground hover:bg-accent/90 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? (
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : null}
            {t('common.save') || 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}

const TraineeLayoutComponent = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { user, profile, loading } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const { isOpen: sidebarOpen, toggle: handleToggleSidebar } = useSidebar();

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
    return user && profile && profile.role === 'trainee' && profile.trainerActivated !== false;
  }, [user, profile]);

  // Determine if we're still in a loading state
  const isLoading = loading || (user && waitingForProfile && !profile);

  // Memoize redirect logic - only redirect when we're sure auth is complete
  const shouldRedirect = useMemo(() => {
    if (isLoading) return false;
    if (!user) return true;
    if (profile && profile.role !== 'trainee') return true;
    if (profile && profile.trainerActivated === false) return true;
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

  // Show loading state while auth is initializing or waiting for profile
  if (isLoading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="text-muted-foreground mt-4">{t('common.loading')}</p>
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
          <p className="text-muted-foreground mt-4">
            {t('common.redirecting')}
          </p>
        </div>
      </div>
    );
  }

  // User exists but profile hasn't arrived yet — keep showing a
  // non-blocking loading state. AuthContext will update `profile` in the
  // background and this layout will re-render automatically.
  if (user && !profile) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="text-muted-foreground mt-4">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  // No user and no profile after auth completed — truly not authenticated
  if (!isAuthenticated) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="text-muted-foreground mt-4">{t('quiz.accessDenied')}</p>
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
      {!profile?.birth_date && <BirthdateBlocker />}
      {children}
    </MainLayout>
  );
};

export default memo(TraineeLayoutComponent);
