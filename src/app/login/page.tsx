'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Mail, Lock, Eye, EyeOff, BookOpen } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const { signIn, profile } = useAuth();

  // Memoize redirect logic to prevent unnecessary re-renders
  const shouldRedirect = useMemo(() => {
    return profile && !isLoading;
  }, [profile, isLoading]);

  // Handle redirect after successful authentication
  useEffect(() => {
    if (shouldRedirect) {
      if (profile?.role === 'trainer') {
        router.push('/trainer/dashboard');
      } else if (profile?.role === 'trainee') {
        router.push('/trainee/dashboard');
      } else {
        // Fallback to trainee dashboard if role is undefined
        router.push('/trainee/dashboard');
      }
    }
  }, [shouldRedirect, profile, router]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setIsLoading(true);
      setError('');

      try {
        await signIn(email, password);
        // The redirect will be handled by the useEffect when the profile updates
      } catch (err) {
        setError(
          'Anmeldung fehlgeschlagen. Bitte überprüfen Sie Ihre Anmeldedaten.'
        );
      } finally {
        setIsLoading(false);
      }
    },
    [signIn, email, password]
  );

  const handleGoBack = useCallback(() => {
    router.push('/');
  }, [router]);

  const togglePasswordVisibility = useCallback(() => {
    setShowPassword(prev => !prev);
  }, []);

  return (
    <div className="bg-background relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      {/* Background overlay for consistent theme */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-red-900/20 via-red-800/15 to-red-900/25"></div>

      <div className="relative z-10 w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="from-accent to-primary mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br shadow-2xl">
            <BookOpen className="text-primary-foreground h-8 w-8" />
          </div>
          <h1 className="text-foreground from-accent to-primary mb-2 bg-gradient-to-r bg-clip-text text-4xl font-bold text-transparent">
            FIAE-Lernplattform
          </h1>
          <p className="text-muted text-lg">Willkommen zurück!</p>
          <button
            onClick={handleGoBack}
            className="text-accent hover:text-accent/80 mt-2 text-sm underline"
          >
            ← Zurück zur Startseite
          </button>
        </div>

        {/* Login Form */}
        <div className="glass-effect-enhanced border-accent/30 rounded-2xl border-2 p-8 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email Field */}
            <div>
              <label
                htmlFor="email"
                className="text-foreground mb-2 block text-sm font-medium"
              >
                E-Mail-Adresse
              </label>
              <div className="relative">
                <Mail className="text-muted absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="bg-background/50 border-border text-foreground placeholder-muted focus:ring-accent w-full rounded-xl border py-3 pr-4 pl-10 transition-colors focus:border-transparent focus:ring-2 focus:outline-none"
                  placeholder="ihre.email@beispiel.de"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label
                htmlFor="password"
                className="text-foreground mb-2 block text-sm font-medium"
              >
                Passwort
              </label>
              <div className="relative">
                <Lock className="text-muted absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="bg-background/50 border-border text-foreground placeholder-muted focus:ring-accent w-full rounded-xl border py-3 pr-12 pl-12 transition-colors focus:border-transparent focus:ring-2 focus:outline-none"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={togglePasswordVisibility}
                  className="text-muted hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 p-1 transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-destructive/10 border-destructive/20 rounded-xl border p-3">
                <p className="text-destructive text-sm">{error}</p>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-primary/50 focus:ring-offset-background focus:ring-accent w-full rounded-xl py-3 font-semibold shadow-lg transition-colors duration-300 hover:shadow-xl focus:ring-2 focus:ring-offset-2 focus:outline-none"
            >
              {isLoading ? (
                <div className="flex items-center justify-center">
                  <div className="border-primary-foreground/30 border-t-primary-foreground mr-2 h-5 w-5 animate-spin rounded-full border-2"></div>
                  Anmeldung läuft...
                </div>
              ) : (
                'Anmelden'
              )}
            </button>
          </form>
        </div>

        {/* Copyright */}
        <div className="text-center">
          <p className="text-muted text-xs">
            © 2025 FIAE-Lernplattform. Alle Rechte vorbehalten.
          </p>
        </div>
      </div>
    </div>
  );
}
