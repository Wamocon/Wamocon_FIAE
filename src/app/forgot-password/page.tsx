'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ type: 'idle' });
  const router = useRouter();
  const supabase = createClientComponentClient();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ type: 'loading' });
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL || '';
      const redirectTo = `${origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (error) throw error;
      setStatus({ type: 'success', message: 'Wenn die E-Mail existiert, wurde ein Link zum Zurücksetzen gesendet.' });
    } catch (err: any) {
      setStatus({ type: 'error', message: err?.message || 'Fehler beim Senden der E-Mail.' });
    }
  };

  return (
    <div className="bg-background relative flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border-2 border-accent/30 p-8 shadow-xl">
        <h1 className="mb-2 text-2xl font-bold">Passwort zurücksetzen</h1>
        <p className="mb-6 text-sm text-muted">Geben Sie Ihre E-Mail-Adresse ein. Wir senden Ihnen einen Link zum Zurücksetzen des Passworts.</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block text-sm">
            E-Mail-Adresse
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-background/50 p-3"
              placeholder="ihre.email@beispiel.de"
            />
          </label>
          <button
            type="submit"
            disabled={status.type === 'loading'}
            className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground hover:bg-primary/90 disabled:bg-primary/50"
          >
            {status.type === 'loading' ? 'Senden…' : 'Link senden'}
          </button>
        </form>
        {status.type === 'success' && (
          <p className="mt-4 text-sm text-green-500">{status.message}</p>
        )}
        {status.type === 'error' && (
          <p className="mt-4 text-sm text-red-500">{status.message}</p>
        )}
        <button onClick={() => router.push('/login')} className="mt-6 text-sm underline">
          Zurück zur Anmeldung
        </button>
      </div>
    </div>
  );
}
