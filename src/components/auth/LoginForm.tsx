'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Lock, Eye, EyeOff, BookOpen } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const { profile, signIn } = useAuth();
  const { t } = useLanguage();

  useEffect(() => {
    if (profile) {
      if (profile.role === 'trainer') router.push('/trainer/dashboard');
      else router.push('/trainee/dashboard');
    }
  }, [profile, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      await signIn(email.trim(), password);
      // redirect happens in the effect when profile is loaded
    } catch (err: any) {
      setError(err?.message || t('auth.loginFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-background relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-red-900/20 via-red-800/15 to-red-900/25 dark:from-red-900/20 dark:via-red-800/15 dark:to-red-900/25"></div>
      {/* Theme Toggle in top right */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle variant="icon" />
      </div>
      <div className="relative z-10 w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="from-accent to-primary mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br shadow-2xl">
            <BookOpen className="text-primary-foreground h-8 w-8" />
          </div>
          <h1 className="text-foreground from-accent to-primary mb-2 bg-gradient-to-r bg-clip-text text-4xl font-bold text-transparent">
            {t('auth.title')}
          </h1>
          <p className="text-muted text-lg">{t('auth.welcomeBack')}</p>
          <button
            onClick={() => router.push('/')}
            className="text-accent hover:text-accent/80 mt-2 text-sm underline"
          >
            {t('auth.backToHome')}
          </button>
        </div>
        <div className="glass-effect-enhanced border-accent/30 rounded-2xl border-2 p-8 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="email"
                className="text-foreground mb-2 block text-sm font-medium"
              >
                {t('auth.emailAddress')}
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
                  placeholder={t('auth.emailPlaceholder')}
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="password"
                className="text-foreground mb-2 block text-sm font-medium"
              >
                {t('auth.password')}
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
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-muted hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 p-1 transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <div className="mt-2 text-right">
                <Link href="/forgot-password" className="text-sm text-accent hover:text-accent/80 underline">
                  {t('auth.forgotPassword')}
                </Link>
              </div>
            </div>
            {error && (
              <div className="bg-destructive/10 border-destructive/20 rounded-xl border p-3">
                <p className="text-destructive text-sm">{error}</p>
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
                  {t('auth.loggingIn')}
                </div>
              ) : (
                t('auth.login')
              )}
            </button>
            <div className="text-center space-y-1">
              <p className="text-muted-foreground">
                {t('auth.noAccount')}{' '}
                <Link
                  href="/register"
                  className="font-medium text-red-400 hover:text-red-300"
                >
                  {t('auth.createAccount')}
                </Link>
              </p>
            </div>
          </form>
        </div>
        <div className="text-center">
          <p className="text-muted text-xs">
            {t('auth.copyright')}
          </p>
        </div>
      </div>
    </div>
  );
}
