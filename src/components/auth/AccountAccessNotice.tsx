'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Clock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import type { AccessArea, AccessBlockReason } from '@/lib/auth/access-state';

type Props = {
  reason: AccessBlockReason;
  /** The area the person is in (names the other one for a wrong area). */
  area: AccessArea;
  /** The name from the profile, the only personal data the page shows. */
  fullName?: string | null;
};

/** Reasons the person can try again at once (the state may have changed). */
const RETRY_REASONS: readonly AccessBlockReason[] = [
  'awaitingActivation',
  'profileUnavailable',
];

/**
 * Page of a signed in person who is stopped at an area (account waits for the
 * release, deactivated, wrong area, profile not loaded, no occupation). It
 * replaces the silent jump back to /login: it says what is the case, what to do
 * and offers to sign out. It shows nothing but the name and the message.
 */
export function AccountAccessNotice({ reason, area, fullName }: Props) {
  const { t } = useLanguage();
  const { signOut, refreshProfile } = useAuth();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);

  // The page opens with the heading focused, so a screen reader starts there
  useEffect(() => {
    headingRef.current?.focus();
  }, [reason]);

  const isWait = reason === 'awaitingActivation' || reason === 'noCatalog';
  const canRetry = RETRY_REASONS.includes(reason);
  const Icon = isWait ? Clock : AlertCircle;
  const name = fullName?.trim();
  // A wrong area names the area the person is in, the other messages the reason
  const keyBase =
    reason === 'wrongArea'
      ? `accessNotice.wrongArea.${area}`
      : `accessNotice.${reason}`;
  const otherAreaPath =
    area === 'trainee' ? '/trainer/dashboard' : '/trainee/dashboard';

  const handleRetry = async () => {
    setChecking(true);
    setChecked(false);
    try {
      await refreshProfile();
    } catch {
      // the notice stays, the person can try again
    } finally {
      setChecking(false);
      setChecked(true);
    }
  };

  const buttonBase =
    'focus-visible:ring-accent focus-visible:ring-offset-background inline-flex min-h-11 w-full items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none sm:w-auto';

  return (
    <div className="bg-background relative flex min-h-screen items-center justify-center p-4 pt-16">
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        <LanguageToggle variant="icon" />
        <ThemeToggle variant="icon" />
      </div>
      <main
        aria-labelledby="access-notice-title"
        className="bg-card border-border w-full max-w-md rounded-2xl border p-6 shadow-2xl sm:p-8"
      >
        <div className="flex flex-col items-center text-center">
          <div
            aria-hidden="true"
            className={
              isWait
                ? 'bg-accent/10 text-accent mb-4 flex h-14 w-14 items-center justify-center rounded-full'
                : 'bg-destructive/10 text-destructive mb-4 flex h-14 w-14 items-center justify-center rounded-full'
            }
          >
            <Icon className="h-7 w-7" />
          </div>
          <h1
            id="access-notice-title"
            ref={headingRef}
            tabIndex={-1}
            className="text-foreground text-xl font-bold break-words focus:outline-none"
          >
            {t(`${keyBase}.title`)}
          </h1>
          {name && (
            <p className="text-muted-foreground mt-1 text-sm break-words">
              {t('accessNotice.signedInAs', { name })}
            </p>
          )}
          <div
            role={isWait ? 'status' : 'alert'}
            className="mt-4 space-y-2 text-sm"
          >
            <p className="text-foreground break-words">
              {t(`${keyBase}.text`)}
            </p>
            {reason === 'awaitingActivation' && (
              <p className="text-muted-foreground break-words">
                {t('accessNotice.awaitingActivation.hint')}
              </p>
            )}
            {checked && canRetry && (
              <p className="text-muted-foreground break-words">
                {t(`accessNotice.${reason}.stillSo`)}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          {reason === 'wrongArea' && (
            <Link
              href={otherAreaPath}
              className={`${buttonBase} bg-primary text-primary-foreground hover:bg-primary/90`}
            >
              {t(`${keyBase}.go`)}
            </Link>
          )}
          {canRetry && (
            <button
              type="button"
              onClick={() => {
                // aria-disabled, not disabled: the focus stays on the button
                if (!checking) void handleRetry();
              }}
              aria-disabled={checking}
              aria-busy={checking}
              className={`${buttonBase} bg-primary text-primary-foreground hover:bg-primary/90 aria-disabled:opacity-60`}
            >
              {checking ? t('accessNotice.checking') : t('accessNotice.retry')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void signOut()}
            className={`${buttonBase} border-border text-foreground hover:bg-muted border`}
          >
            {t('auth.logout')}
          </button>
        </div>
      </main>
    </div>
  );
}
