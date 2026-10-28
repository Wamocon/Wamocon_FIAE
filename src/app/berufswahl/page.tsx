'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AccountAccessNotice } from '@/components/auth/AccountAccessNotice';
import { CatalogTiles } from '@/components/catalog/CatalogTiles';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useAuth } from '@/contexts/AuthContext';
import { useCatalog } from '@/contexts/CatalogContext';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  resolveAccessState,
  signedOutTarget,
} from '@/lib/auth/access-state';
import { isTrainerLevelRole } from '@/lib/auth/roles';

// How long the page waits for the profile of a signed in person before it says
// that the profile could not be loaded
const PROFILE_WAIT_MS = 3000;

// Occupation choice after the sign in, only for signed in users. It is shown
// when the platform has more than one active occupation (see
// src/lib/catalog/choice.ts), and the user can come back to it later.
export default function BerufswahlPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, profile, loading, signOut, sessionEnd } = useAuth();
  const { noCatalog } = useCatalog();
  const [waitingForProfile, setWaitingForProfile] = useState(true);

  useEffect(() => {
    if (profile || !user) {
      setWaitingForProfile(true);
      return;
    }
    const timer = setTimeout(
      () => setWaitingForProfile(false),
      PROFILE_WAIT_MS
    );
    return () => clearTimeout(timer);
  }, [profile, user]);

  // Like the protected areas: nobody signed in goes to the login, everybody
  // else who is stopped (not released, deactivated, no profile, no occupation)
  // sees the notice. The page belongs to no area, so the role never stops it.
  const access = resolveAccessState({
    area: isTrainerLevelRole(profile?.role) ? 'trainer' : 'trainee',
    loading,
    signedIn: !!user,
    profile,
    waitingForProfile,
    noCatalog,
  });

  useEffect(() => {
    if (access.kind === 'signedOut') {
      router.replace(signedOutTarget(sessionEnd));
    }
  }, [access.kind, sessionEnd, router]);

  if (access.kind === 'blocked') {
    return (
      <AccountAccessNotice
        reason={access.reason}
        area={isTrainerLevelRole(profile?.role) ? 'trainer' : 'trainee'}
        fullName={profile?.full_name}
      />
    );
  }

  if (access.kind !== 'allowed' || !user || !profile) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <LoadingSpinner />
          <p className="text-muted-foreground mt-4">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background relative min-h-screen p-4">
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        <LanguageToggle variant="icon" />
        <ThemeToggle variant="icon" />
      </div>
      <main className="mx-auto max-w-5xl pt-20 pb-12">
        <h1 className="text-foreground mb-2 text-3xl font-bold">
          {t('catalog.tiles.title')}
        </h1>
        <p className="text-muted-foreground mb-8 max-w-2xl text-sm">
          {t('catalog.tiles.subtitle')}
        </p>
        <CatalogTiles />
        <div className="text-muted-foreground mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span>
            {t('catalog.tiles.signedInAs', {
              name: profile.full_name?.trim() || profile.email || user.email,
            })}
          </span>
          <button
            type="button"
            onClick={() => void signOut()}
            className="text-foreground focus-visible:ring-accent min-h-11 rounded px-1 underline focus-visible:ring-2 focus-visible:outline-none"
          >
            {t('auth.logout')}
          </button>
        </div>
      </main>
    </div>
  );
}
