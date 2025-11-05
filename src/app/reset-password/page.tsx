'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Eye, EyeOff, Lock } from 'lucide-react';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ type: 'idle' });
  const [ready, setReady] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const router = useRouter();
  const supabase = createClientComponentClient();

  useEffect(() => {
    let unsub: (() => void) | undefined;
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setReady(true);
      }
      // Support links that come in with ?code=... (exchange for a session)
      try {
        if (!data.session && typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          const code = url.searchParams.get('code');
          if (code) {
            const { data: exData, error: exErr } = await supabase.auth.exchangeCodeForSession(code);
            if (!exErr && exData.session) {
              setReady(true);
            }
          }
        }
      } catch {
        // ignore
      }
      const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
        if (session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
          setReady(true);
        }
      });
      unsub = () => listener.subscription.unsubscribe();
      // Fallback: if still not ready after short delay but there's a hash, try again
      setTimeout(async () => {
        if (!ready && typeof window !== 'undefined' && window.location.hash) {
          const { data: d2 } = await supabase.auth.getSession();
          if (d2.session) setReady(true);
        }
      }, 500);
    };
    void init();
    return () => { try { unsub?.(); } catch { /* ignore */ } };
  }, [supabase, ready]);

  const canSubmit = useMemo(() => {
    if (status.type === 'loading') return false;
    if (!ready) return false;
    if (password.length < 6) return false;
    if (password !== confirm) return false;
    return true;
  }, [status.type, ready, password, confirm]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setStatus({ type: 'error', message: 'Passwort muss mindestens 6 Zeichen lang sein.' });
      return;
    }
    if (password !== confirm) {
      setStatus({ type: 'error', message: 'Passwörter stimmen nicht überein.' });
      return;
    }
    setStatus({ type: 'loading' });
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setStatus({ type: 'success', message: 'Passwort aktualisiert. Bitte melden Sie sich erneut an.' });
      setTimeout(() => router.push('/login'), 1000);
    } catch (err: any) {
      setStatus({ type: 'error', message: err?.message || 'Fehler beim Aktualisieren des Passworts.' });
    }
  };

  return (
    <div className="bg-background relative flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border-2 border-accent/30 p-8 shadow-xl">
        <h1 className="mb-2 text-2xl font-bold">Neues Passwort setzen</h1>
        <p className="mb-6 text-sm text-muted">
          {ready
            ? 'Bitte geben Sie Ihr neues Passwort ein.'
            : 'Einen Moment bitte…'}
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block text-sm">
            Neues Passwort
            <div className="relative mt-1">
              <Lock className="text-muted absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
              <input
                type={showPwd ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-border bg-background/50 p-3 pl-10 pr-12"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPwd((s) => !s)}
                className="text-muted hover:text-foreground absolute right-3 top-1/2 -translate-y-1/2 p-1"
                aria-label={showPwd ? 'Passwort verbergen' : 'Passwort anzeigen'}
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>
          <label className="block text-sm">
            Passwort bestätigen
            <div className="relative mt-1">
              <Lock className="text-muted absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
              <input
                type={showConfirm ? 'text' : 'password'}
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-xl border border-border bg-background/50 p-3 pl-10 pr-12"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((s) => !s)}
                className="text-muted hover:text-foreground absolute right-3 top-1/2 -translate-y-1/2 p-1"
                aria-label={showConfirm ? 'Passwort verbergen' : 'Passwort anzeigen'}
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground hover:bg-primary/90 disabled:bg-primary/50"
          >
            {status.type === 'loading' ? 'Speichern…' : 'Passwort ändern'}
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
