'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { RESEND_CONFIRMATION_PATH } from '@/lib/auth/email-confirmation';

// Supabase sends one e-mail per address and minute, the button waits as long
const COOLDOWN_SECONDS = 60;

type Status = 'idle' | 'sending' | 'sent' | 'rateLimited' | 'failed';

/**
 * Asks for the confirmation e-mail again. The address is the one the person
 * registered or tried to sign in with. The server answers the same way whether
 * or not the account exists, so this never says more than "if there is one,
 * the link is on its way".
 */
export default function ResendConfirmation({ email }: { email: string }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<Status>('idle');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // The message belongs to the last request: it goes when the wait is over and
  // when the person changes the address
  useEffect(() => {
    if (cooldown === 0) setStatus(s => (s === 'sending' ? s : 'idle'));
  }, [cooldown]);
  useEffect(() => {
    setStatus(s => (s === 'sending' ? s : 'idle'));
    setCooldown(0);
  }, [email]);

  const resend = async () => {
    setStatus('sending');
    try {
      const res = await fetch(RESEND_CONFIRMATION_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.ok) {
        setStatus('sent');
        setCooldown(COOLDOWN_SECONDS);
        return;
      }
      if (res.status === 429) {
        const wait = Number(res.headers.get('Retry-After'));
        setStatus('rateLimited');
        setCooldown(
          Number.isFinite(wait) && wait > 0
            ? Math.min(Math.ceil(wait), 3600)
            : COOLDOWN_SECONDS
        );
        return;
      }
      setStatus('failed');
    } catch {
      setStatus('failed');
    }
  };

  const message =
    status === 'sent'
      ? t('emailConfirm.resendSent')
      : status === 'rateLimited'
        ? t('emailConfirm.resendRateLimited')
        : status === 'failed'
          ? t('emailConfirm.resendFailed')
          : null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={resend}
        disabled={status === 'sending' || cooldown > 0 || !email.trim()}
        className="border-accent/40 text-accent hover:bg-accent/10 disabled:text-muted w-full rounded-xl border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === 'sending'
          ? t('emailConfirm.resending')
          : cooldown > 0
            ? t('emailConfirm.resendWait', { seconds: String(cooldown) })
            : t('emailConfirm.resend')}
      </button>
      {message && (
        <p
          role={status === 'sent' ? 'status' : 'alert'}
          className={
            status === 'sent'
              ? 'text-foreground text-sm'
              : 'text-destructive text-sm'
          }
        >
          {message}
        </p>
      )}
    </div>
  );
}
