'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Lock, Eye, EyeOff, BookOpen } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { isTrainerLevelRole } from '@/lib/auth/roles';
import { authFetch } from '@/lib/authFetch';
import { writePreferredCatalog } from '@/lib/catalog/selection';
import {
  OCCUPATION_CHOICE_PATH,
  needsOccupationChoice,
  type LoginLinkChoice,
} from '@/lib/catalog/choice';
import { useLanguage } from '@/contexts/LanguageContext';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { LanguageToggle } from '@/components/ui/LanguageToggle';

type CatalogState = 'idle' | 'ready' | 'unknown' | 'unavailable';

// The check of the login link must not hold the sign in back for long: after
// this time the sign in goes on to the dashboard, as if the check had failed.
const LINK_CHECK_TIMEOUT_MS = 4000;

// catalogCode: the occupation the visitor chose on /ausbildung (?catalog=CODE).
// Without it the form behaves exactly as before.
export default function LoginForm({ catalogCode }: { catalogCode?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [catalogTitle, setCatalogTitle] = useState<string | null>(null);
  const [catalogState, setCatalogState] = useState<CatalogState>('idle');
  // Number of active occupations of the platform, null while it is not known
  const [activeCount, setActiveCount] = useState<number | null>(null);
  // True while the sign in decides where to go, so this form does not send the
  // person to the dashboard first
  const holdRedirect = useRef(false);
  const router = useRouter();
  const { profile, signIn } = useAuth();
  const { t } = useLanguage();

  // The public list of the active occupations. Its length tells whether the
  // occupation choice follows the sign in, and with a login link it names the
  // chosen occupation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/catalogs');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const catalogs = Array.isArray(data?.catalogs) ? data.catalogs : [];
        if (cancelled) return;
        setActiveCount(catalogs.length);
        if (!catalogCode) return;
        const found = catalogs.find(
          (c: { code?: string }) => String(c.code).toUpperCase() === catalogCode
        );
        if (found) {
          setCatalogTitle(found.title);
          setCatalogState('ready');
        } else {
          setCatalogState('unknown');
        }
      } catch {
        if (!cancelled && catalogCode) setCatalogState('unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalogCode]);

  // After the sign in the server says whether this account has the chosen
  // occupation. It is a hint only: a failed check never undoes the sign in.
  const checkCatalogAccess = async (
    code: string,
    notAllowedKey = 'catalogs.login.notAllowed'
  ): Promise<LoginLinkChoice> => {
    try {
      const res = await authFetch(
        `/api/me/catalogs?catalog=${encodeURIComponent(code)}`
      );
      if (res.status === 403) {
        toast.error(t(notAllowedKey, { title: catalogTitle ?? code }));
        return 'denied';
      }
      return res.ok ? 'allowed' : 'unknown';
    } catch {
      // network error: nothing to tell the user
      return 'unknown';
    }
  };

  // Where the sign in leads on a platform with several active occupations: the
  // occupation choice, unless the login link chose an occupation the account
  // has. null: the dashboard of the role, as always.
  const resolveRedirect = async (): Promise<string | null> => {
    let link: LoginLinkChoice = 'none';
    if (catalogCode && catalogState !== 'unknown') {
      link = await Promise.race([
        checkCatalogAccess(catalogCode, 'catalog.tiles.loginNotAllowed'),
        new Promise<LoginLinkChoice>(resolve =>
          setTimeout(() => resolve('unknown'), LINK_CHECK_TIMEOUT_MS)
        ),
      ]);
    }
    return needsOccupationChoice({ activeCatalogCount: activeCount, link })
      ? OCCUPATION_CHOICE_PATH
      : null;
  };

  useEffect(() => {
    if (profile && !holdRedirect.current) {
      if (isTrainerLevelRole(profile.role)) router.push('/trainer/dashboard');
      else router.push('/trainee/dashboard');
    }
  }, [profile, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      // The occupation of the login link becomes the occupation to work in. The
      // CatalogProvider only uses it if it is one of the account's occupations.
      if (catalogCode && catalogState !== 'unknown') {
        writePreferredCatalog(catalogCode);
      }
      if (activeCount !== null && activeCount > 1) {
        // Several active occupations: signIn asks where to go
        holdRedirect.current = true;
        await signIn(email.trim(), password, resolveRedirect);
      } else {
        await signIn(email.trim(), password);
        // redirect happens in the effect when profile is loaded
        if (catalogCode && catalogState !== 'unknown') {
          await checkCatalogAccess(catalogCode);
        }
      }
    } catch (err: any) {
      holdRedirect.current = false;
      setError(err?.message || t('auth.loginFailed'));
    } finally {
      setIsLoading(false);
    }
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
            <BookOpen className="text-primary-foreground h-8 w-8" />
          </div>
          <h1 className="text-foreground from-accent to-primary mb-2 bg-linear-to-r bg-clip-text text-4xl font-bold text-transparent">
            {t('auth.title')}
          </h1>
          <p className="text-muted text-lg">{t('auth.welcomeBack')}</p>
          <button
            onClick={() => router.push('/')}
            className="text-accent hover:text-accent/80 mt-2 text-sm underline"
          >
            {t('auth.backToHome')}
          </button>
          {catalogCode && catalogState === 'ready' && catalogTitle && (
            <p
              role="status"
              className="text-foreground mt-4 text-sm font-medium"
            >
              {t('catalogs.login.banner', { title: catalogTitle })}
            </p>
          )}
          {catalogCode && catalogState === 'unknown' && (
            <p role="status" className="text-muted-foreground mt-4 text-sm">
              {t('catalogs.login.unknown')}
            </p>
          )}
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
                  aria-label={
                    showPassword
                      ? t('auth.hidePassword')
                      : t('auth.showPassword')
                  }
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
                <Link
                  href="/forgot-password"
                  className="text-accent hover:text-accent/80 text-sm underline"
                >
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
            <div className="space-y-1 text-center">
              <p className="text-muted-foreground text-xs">
                {t('auth.accountCreatedByAdmin')}
              </p>
            </div>
          </form>
        </div>
        <div className="text-center">
          <p className="text-muted text-xs">{t('auth.copyright')}</p>
        </div>
      </div>
    </div>
  );
}
