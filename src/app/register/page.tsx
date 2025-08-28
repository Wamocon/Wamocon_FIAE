'use client';

import { useState } from 'react';
import { GraduationCap, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export default function RegisterPage() {
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const router = useRouter();
  const supabase = createClientComponentClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Basic validation
    if (!formData.email || !formData.password) {
      setError('Bitte geben Sie eine E-Mail-Adresse und ein Passwort ein.');
      return;
    }
    if (formData.password.length < 6) {
      setError('Passwort muss mindestens 6 Zeichen lang sein.');
      return;
    }

    setIsLoading(true);
    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email: formData.email.trim(),
        password: formData.password,
      });

      if (signUpError) throw signUpError;

      // Success message (Supabase trigger will insert profile automatically)
      setSuccess('Registrierung erfolgreich! Bitte bestätigen Sie Ihre E-Mail.');
      setTimeout(() => router.push('/login'), 1500);
    } catch (err: unknown) {
      console.error('Registration failed:', err);
      setError(
        err instanceof Error ? err.message : 'Registrierung fehlgeschlagen'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (error) setError('');
    if (success) setSuccess('');
  };

  return (
    <div className="bg-background relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-red-900/20 via-red-800/15 to-red-900/25"></div>
      <div className="relative z-10 w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="from-accent to-primary mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br shadow-2xl">
            <GraduationCap className="text-primary-foreground h-8 w-8" />
          </div>
          <h1 className="text-foreground from-accent to-primary mb-2 bg-gradient-to-r bg-clip-text text-4xl font-bold text-transparent">
            FIAE-Lernplattform
          </h1>
          <p className="text-muted text-lg">
            Registrieren Sie sich für die FIAE-Lernplattform
          </p>
          <button
            onClick={() => router.push('/')}
            className="text-accent hover:text-accent/80 mt-2 text-sm underline"
          >
            ← Zurück zur Startseite
          </button>
        </div>

        <div className="glass-effect-enhanced border-accent/30 rounded-2xl border-2 p-8 shadow-2xl">
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label
                htmlFor="email"
                className="text-foreground mb-2 block text-sm font-medium"
              >
                E-Mail-Adresse *
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="bg-background/50 border-border text-foreground placeholder-muted focus:ring-accent w-full rounded-xl border px-4 py-3 transition-colors focus:border-transparent focus:ring-2 focus:outline-none"
                placeholder="ihre.email@beispiel.de"
                value={formData.email}
                onChange={e => handleInputChange('email', e.target.value)}
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="text-foreground mb-2 block text-sm font-medium"
              >
                Passwort *
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  className="bg-background/50 border-border text-foreground placeholder-muted focus:ring-accent w-full rounded-xl border px-4 py-3 pr-12 transition-colors focus:border-transparent focus:ring-2 focus:outline-none"
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={e => handleInputChange('password', e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-muted hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 p-1 transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-destructive/10 border-destructive/20 rounded-xl border p-3">
                <p className="text-destructive text-sm">{error}</p>
              </div>
            )}

            {success && (
              <div className="bg-green-100 border-green-300 text-green-800 rounded-xl border p-3">
                <p className="text-sm">{success}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-primary/50 focus:ring-offset-background focus:ring-accent w-full rounded-xl py-3 font-semibold shadow-lg transition-colors duration-300 hover:shadow-xl focus:ring-2 focus:ring-offset-2 focus:outline-none"
            >
              {isLoading ? (
                <div className="flex items-center justify-center">
                  <div className="border-primary-foreground/30 border-t-primary-foreground mr-2 h-5 w-5 animate-spin rounded-full border-2"></div>
                  Registrieren...
                </div>
              ) : (
                'Konto erstellen'
              )}
            </button>

            <div className="text-center">
              <p className="text-gray-400">
                Bereits ein Konto?{' '}
                <Link
                  href="/login"
                  className="font-medium text-red-400 hover:text-red-300"
                >
                  Hier anmelden
                </Link>
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
