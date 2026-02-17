'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Eye, EyeOff, Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { useLanguage } from '@/contexts/LanguageContext';

export default function ResetPasswordPage() {
  const { t } = useLanguage();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<{
    type: 'idle' | 'loading' | 'success' | 'error';
    message?: string;
  }>({ type: 'idle' });

  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const router = useRouter();

  const PublicUrls = ['/login', '/forgot-password', '/reset-password'];
  if (
    !PublicUrls.includes(
      typeof window !== 'undefined' ? window.location.pathname : ''
    )
  ) {
    router.replace('/login');
  }
  const supabase = createClientComponentClient();
  const processedRef = useRef(false); // prevent double-verification in React strict/dev

  useEffect(() => {
    let unsub: (() => void) | undefined;
    const init = async () => {
      if (processedRef.current) return;

      const cleanupUrl = () => {
        try {
          if (typeof window !== 'undefined') {
            const url = new URL(window.location.href);
            // Always land on a clean reset-password path after processing tokens
            if (url.pathname !== '/reset-password') {
              router.replace('/reset-password');
            } else {
              window.history.replaceState(null, '', '/reset-password');
            }
          }
        } catch {
          /* ignore */
        }
      };

      // mark processed to avoid double run in Strict Mode
      processedRef.current = true;
    };

    init();

    return () => {
      if (unsub) unsub();
    };
  }, [router, supabase]);

  const canSubmit = useMemo(() => {
    if (status.type === 'loading') return false;

    if (password.length < 6) return false;
    if (password !== confirm) return false;
    return true;
  }, [status.type, password, confirm]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setStatus({
        type: 'error',
        message: t('resetPassword.passwordMinLength'),
      });
      return;
    }
    if (password !== confirm) {
      setStatus({
        type: 'error',
        message: t('resetPassword.passwordMismatch'),
      });
      return;
    }
    setStatus({ type: 'loading' });
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setStatus({ type: 'success', message: t('resetPassword.success') });
      toast.success(t('resetPassword.successToast'));
      setTimeout(() => router.replace('/login'), 800);
    } catch (err: any) {
      setStatus({
        type: 'error',
        message: err?.message || t('resetPassword.error'),
      });
    }
  };

  return (
    <div className="bg-background relative flex min-h-screen items-center justify-center p-4">
      {/* Theme + Language Toggle in top right */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        <LanguageToggle variant="icon" />
        <ThemeToggle variant="icon" />
      </div>
      <div className="border-accent/30 glass-effect-enhanced w-full max-w-md rounded-2xl border-2 p-8 shadow-xl">
        <h1 className="text-foreground mb-2 text-2xl font-bold">
          {t('resetPassword.title')}
        </h1>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block text-sm">
            {t('resetPassword.newPassword')}
            <div className="relative mt-1">
              <Lock className="text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <input
                type={showPwd ? 'text' : 'password'}
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="border-border bg-background/50 w-full rounded-xl border p-3 pr-12 pl-10"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPwd(s => !s)}
                className="text-muted hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 p-1"
                aria-label={
                  showPwd
                    ? t('resetPassword.hidePassword')
                    : t('resetPassword.showPassword')
                }
              >
                {showPwd ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </label>
          <label className="block text-sm">
            {t('resetPassword.confirmPassword')}
            <div className="relative mt-1">
              <Lock className="text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <input
                type={showConfirm ? 'text' : 'password'}
                required
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                className="border-border bg-background/50 w-full rounded-xl border p-3 pr-12 pl-10"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(s => !s)}
                className="text-muted hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 p-1"
                aria-label={
                  showConfirm
                    ? t('resetPassword.hidePassword')
                    : t('resetPassword.showPassword')
                }
              >
                {showConfirm ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </label>
          <button
            type="submit"
            disabled={!canSubmit}
            className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-primary/50 w-full rounded-xl py-3 font-semibold"
          >
            {status.type === 'loading'
              ? t('resetPassword.saving')
              : t('resetPassword.changePassword')}
          </button>
        </form>
        {status.type === 'success' && (
          <p className="mt-4 text-sm text-green-500">{status.message}</p>
        )}
        {status.type === 'error' && (
          <p className="mt-4 text-sm text-red-500">{status.message}</p>
        )}
      </div>
    </div>
  );
}
