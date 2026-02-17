'use client';

import { useState } from 'react';
import { GraduationCap, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { useLanguage } from '@/contexts/LanguageContext';

export default function RegisterPage() {
  const { t } = useLanguage();
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState<{
    type: 'trainer' | 'trainee' | null;
  }>({ type: null });
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Basic validation
    if (!formData.email || !formData.password) {
      setError(t('register.emailPasswordRequired'));
      return;
    }
    if (formData.password.length < 6) {
      setError(t('register.passwordMinLength'));
      return;
    }

    setIsLoading(true);
    try {
      const resp = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email.trim(),
          password: formData.password,
        }),
      });

      const body = await resp.json();
      if (!resp.ok) {
        console.error('Server registration failed', body);
        setError(body?.error || t('register.failed'));
        return;
      }

      // Show success message based on role
      if (body.role === 'TRAINER') {
        setSuccessMessage({ type: 'trainer' });
        // Redirect to login after 3 seconds
        setTimeout(() => {
          router.push('/login');
        }, 3000);
      } else if (body.role === 'TRAINEE') {
        setSuccessMessage({ type: 'trainee' });
        // Redirect to login info page after 5 seconds
        setTimeout(() => {
          router.push('/login');
        }, 5000);
      } else {
        // Fallback
        router.push('/login');
      }
    } catch (err: unknown) {
      console.error('Registration failed:', err);
      setError(err instanceof Error ? err.message : t('register.failed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (error) setError('');
  };

  return (
    <div className="bg-background relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-red-900/20 via-red-800/15 to-red-900/25 dark:from-red-900/20 dark:via-red-800/15 dark:to-red-900/25"></div>
      {/* Theme + Language Toggle in top right */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        <LanguageToggle variant="icon" />
        <ThemeToggle variant="icon" />
      </div>
      <div className="relative z-10 w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="from-accent to-primary mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-linear-to-br shadow-2xl">
            <GraduationCap className="text-primary-foreground h-8 w-8" />
          </div>
          <h1 className="text-foreground from-accent to-primary mb-2 bg-linear-to-r bg-clip-text text-4xl font-bold text-transparent">
            {t('landing.platformName')}
          </h1>
          <p className="text-muted text-lg">{t('register.title')}</p>
          <button
            onClick={() => router.push('/')}
            className="text-accent hover:text-accent/80 mt-2 text-sm underline"
          >
            {t('register.backToHome')}
          </button>
        </div>

        <div className="glass-effect-enhanced border-accent/30 rounded-2xl border-2 p-8 shadow-2xl">
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label
                htmlFor="email"
                className="text-foreground mb-2 block text-sm font-medium"
              >
                {t('register.emailLabel')}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="bg-background/50 border-border text-foreground placeholder-muted focus:ring-accent w-full rounded-xl border px-4 py-3 transition-colors focus:border-transparent focus:ring-2 focus:outline-none"
                placeholder={t('register.emailPlaceholder')}
                value={formData.email}
                onChange={e => handleInputChange('email', e.target.value)}
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="text-foreground mb-2 block text-sm font-medium"
              >
                {t('register.passwordLabel')}
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

            {/* Only email & password required for registration now */}

            {error && (
              <div className="bg-destructive/10 border-destructive/20 rounded-xl border p-3">
                <p className="text-destructive text-sm">{error}</p>
              </div>
            )}

            {/* Success messages */}
            {successMessage.type === 'trainer' && (
              <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-green-500/20 p-1">
                    <svg
                      className="h-5 w-5 text-green-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-green-600 dark:text-green-400">
                      {t('register.trainerSuccess')}
                    </p>
                    <p className="mt-1 text-xs text-green-600/80 dark:text-green-400/80">
                      {t('register.trainerSuccessMessage')}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {successMessage.type === 'trainee' && (
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-blue-500/20 p-1">
                    <svg
                      className="h-5 w-5 text-blue-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                      {t('register.traineeSuccess')}
                    </p>
                    <p className="mt-1 text-xs text-blue-600/80 dark:text-blue-400/80">
                      {t('register.traineeSuccessMessage')}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || successMessage.type !== null}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-primary/50 focus:ring-offset-background focus:ring-accent w-full rounded-xl py-3 font-semibold shadow-lg transition-colors duration-300 hover:shadow-xl focus:ring-2 focus:ring-offset-2 focus:outline-none"
            >
              {isLoading ? (
                <div className="flex items-center justify-center">
                  <div className="border-primary-foreground/30 border-t-primary-foreground mr-2 h-5 w-5 animate-spin rounded-full border-2"></div>
                  {t('register.registering')}
                </div>
              ) : (
                t('register.createAccount')
              )}
            </button>

            <div className="text-center">
              <p className="text-muted-foreground">
                {t('register.alreadyHaveAccount')}{' '}
                <Link
                  href="/login"
                  className="font-medium text-red-400 hover:text-red-300"
                >
                  {t('register.loginHere')}
                </Link>
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
