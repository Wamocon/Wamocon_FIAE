'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { GraduationCap, Eye, EyeOff, Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  // const { signUp } = useAuth()
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'trainee' as 'trainee' | 'trainer',
  });
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('Passwörter stimmen nicht überein');
      return;
    }
    if (formData.password.length < 6) {
      setError('Passwort muss mindestens 6 Zeichen lang sein');
      return;
    }

    setIsLoading(true);
    try {
      // await signUp(formData.fullName, formData.email, formData.password, formData.role)
    } catch (error: any) {
      console.error('Registration failed:', error);
      setError(error.message || 'Registrierung fehlgeschlagen');
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (error) setError('');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background overlay for consistent theme */}
      <div className="absolute inset-0 bg-gradient-to-br from-red-900/20 via-red-800/15 to-red-900/25 pointer-events-none"></div>

      <div className="w-full max-w-md space-y-8 relative z-10">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto w-16 h-16 bg-gradient-to-br from-accent to-primary rounded-full flex items-center justify-center mb-6 shadow-2xl">
            <GraduationCap className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-4xl font-bold text-foreground mb-2 bg-gradient-to-r from-accent to-primary bg-clip-text text-transparent">
            FIAE-Lernplattform
          </h1>
          <p className="text-muted text-lg">
            Registrieren Sie sich für die FIAE-Lernplattform
          </p>
          <button
            onClick={() => router.push('/')}
            className="text-sm text-accent hover:text-accent/80 underline mt-2"
          >
            ← Zurück zur Startseite
          </button>
        </div>

        {/* Registration Form */}
        <div className="glass-effect-enhanced p-8 rounded-2xl shadow-2xl border-2 border-accent/30">
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label
                htmlFor="fullName"
                className="block text-sm font-medium text-foreground mb-2"
              >
                Vollständiger Name *
              </label>
              <input
                id="fullName"
                name="fullName"
                type="text"
                required
                className="w-full px-4 py-3 bg-background/50 border border-border rounded-xl text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-colors"
                placeholder="Max Mustermann"
                value={formData.fullName}
                onChange={e => handleInputChange('fullName', e.target.value)}
              />
            </div>

            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-foreground mb-2"
              >
                E-Mail-Adresse *
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="w-full px-4 py-3 bg-background/50 border border-border rounded-xl text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-colors"
                placeholder="ihre.email@beispiel.de"
                value={formData.email}
                onChange={e => handleInputChange('email', e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Rolle *
              </label>
              <div className="flex bg-background/50 rounded-xl p-1">
                <button
                  type="button"
                  onClick={() => handleInputChange('role', 'trainee')}
                  className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                    formData.role === 'trainee'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted hover:text-foreground'
                  }`}
                >
                  Auszubildender
                </button>
                <button
                  type="button"
                  onClick={() => handleInputChange('role', 'trainer')}
                  className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                    formData.role === 'trainer'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted hover:text-foreground'
                  }`}
                >
                  Ausbilder
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-foreground mb-2"
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
                  className="w-full px-4 py-3 pr-12 bg-background/50 border border-border rounded-xl text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-colors"
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={e => handleInputChange('password', e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-foreground transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-foreground mb-2"
              >
                Passwort bestätigen *
              </label>
              <div className="relative">
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  className="w-full px-4 py-3 pr-12 bg-background/50 border border-border rounded-xl text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-colors"
                  placeholder="••••••••"
                  value={formData.confirmPassword}
                  onChange={e =>
                    handleInputChange('confirmPassword', e.target.value)
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-foreground transition-colors"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 font-semibold bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 disabled:bg-primary/50 transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background focus:ring-accent shadow-lg hover:shadow-xl"
            >
              {isLoading ? (
                <div className="flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin mr-2"></div>
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
                  className="text-red-400 hover:text-red-300 font-medium"
                >
                  Hier anmelden
                </Link>
              </p>
            </div>
          </form>
        </div>

        {/* Already have an account */}
      </div>
    </div>
  );
}
