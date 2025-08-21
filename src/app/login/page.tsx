'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Mail, Lock, Eye, EyeOff, BookOpen } from 'lucide-react';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const { signIn, profile } = useAuth();

  // Handle redirect after successful authentication
  useEffect(() => {
    if (profile && !isLoading) {
      if (profile.role === 'trainer') {
        router.push('/trainer/dashboard');
      } else if (profile.role === 'trainee') {
        router.push('/trainee/dashboard');
      } else {
        // Fallback to trainee dashboard if role is undefined
        router.push('/trainee/dashboard');
      }
    }
  }, [profile, isLoading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
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
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background overlay for consistent theme */}
      <div className="absolute inset-0 bg-gradient-to-br from-red-900/20 via-red-800/15 to-red-900/25 pointer-events-none"></div>

      <div className="w-full max-w-md space-y-8 relative z-10">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto w-16 h-16 bg-gradient-to-br from-accent to-primary rounded-full flex items-center justify-center mb-6 shadow-2xl">
            <BookOpen className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-4xl font-bold text-foreground mb-2 bg-gradient-to-r from-accent to-primary bg-clip-text text-transparent">
            FIAE-Lernplattform
          </h1>
          <p className="text-muted text-lg">Willkommen zurück!</p>
          <button
            onClick={() => router.push('/')}
            className="text-sm text-accent hover:text-accent/80 underline mt-2"
          >
            ← Zurück zur Startseite
          </button>
        </div>

        {/* Login Form */}
        <div className="glass-effect-enhanced p-8 rounded-2xl shadow-2xl border-2 border-accent/30">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email Field */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-foreground mb-2"
              >
                E-Mail-Adresse
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="w-full pl-10 pr-4 py-3 bg-background/50 border border-border rounded-xl text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-colors"
                  placeholder="ihre.email@beispiel.de"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-foreground mb-2"
              >
                Passwort
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="w-full pl-12 pr-12 py-3 bg-background/50 border border-border rounded-xl text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-colors"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-foreground transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 font-semibold bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 disabled:bg-primary/50 transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background focus:ring-accent shadow-lg hover:shadow-xl"
            >
              {isLoading ? (
                <div className="flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-2"></div>
                  Anmeldung läuft...
                </div>
              ) : (
                'Anmelden'
              )}
            </button>

            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            <div className="text-center">
              <p className="text-gray-400">
                Noch kein Konto?{' '}
                <Link
                  href="/register"
                  className="text-red-400 hover:text-red-300 font-medium"
                >
                  Konto erstellen
                </Link>
              </p>
            </div>
          </form>
        </div>

        {/* Copyright */}
        <div className="text-center">
          <p className="text-xs text-muted">
            © 2025 FIAE-Lernplattform. Alle Rechte vorbehalten.
          </p>
        </div>
      </div>
    </div>
  );
}
