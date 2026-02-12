'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  BookOpen,
  Users,
  GraduationCap,
  ArrowRight,
  Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

export default function LandingPage() {
  const { user, profile, loading } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  // If user is already authenticated, redirect to appropriate dashboard
  useEffect(() => {
    if (!loading && user && profile) {
      if (profile.role === 'trainee') {
        router.push('/trainee/dashboard');
      } else if (profile.role === 'trainer') {
        router.push('/trainer/dashboard');
      }
    }
  }, [user, profile, loading, router]);

  const handleGetStarted = () => {
    router.push('/login');
  };
  const handleSignUp = () => {
    router.push('/register');
  };

  // Derived state to show intermediate redirect screen
  const shouldRedirect = !loading && !!user && !!profile;

  // Memoize loading state
  if (loading) {
    return (
      <div className="bg-background relative flex min-h-screen items-center justify-center overflow-hidden">
        {/* Enhanced background theme */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-red-900/30 via-red-800/25 to-red-900/35"></div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20"></div>

        <div className="relative z-10 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-red-800 shadow-2xl">
            <BookOpen className="h-8 w-8 text-foreground" />
          </div>
          <h1 className="text-foreground text-2xl font-bold">
            {t('landing.platformName')}
          </h1>
          <p className="text-muted">{t('landing.loading')}</p>
        </div>
      </div>
    );
  }

  // If user is authenticated, show loading while redirecting
  if (shouldRedirect) {
    return (
      <div className="bg-background relative flex min-h-screen items-center justify-center overflow-hidden">
        {/* Enhanced background theme */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-red-900/30 via-red-800/25 to-red-900/35"></div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20"></div>

        <div className="relative z-10 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-red-800 shadow-2xl">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
          </div>
          <h1 className="text-foreground text-xl">{t('landing.redirecting')}</h1>
          <p className="text-muted">{t('landing.beingRedirected')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background relative flex min-h-screen flex-col justify-between overflow-hidden">
      {/* Enhanced background theme */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-red-700/80 via-red-400/150 to-red-700/80"></div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-white/500 via-transparent to-white/500"></div>

      {/* Header */}
      <header className="border-border/40 relative z-10 border-b">
        <div className="flex items-center justify-between px-6 py-4 md:px-12 lg:px-16">
          <div className="flex items-center space-x-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-red-600 to-red-800">
              <BookOpen className="h-6 w-6 text-foreground" />
            </div>
            <span className="text-foreground text-xl font-bold">FIAE</span>
          </div>
          <div className="flex items-center space-x-3">
            <ThemeToggle variant="icon" />
            <Button
              onClick={handleSignUp}
              variant="outline"
              className="border-red-600 text-red-600 hover:bg-red-600 hover:text-foreground"
            >
              {t('landing.signUp')}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-col items-center justify-center px-6 py-8 md:px-12 lg:px-16">
        <section className="text-center">
          <h1 className="text-foreground mb-4 text-4xl font-bold md:text-5xl lg:text-6xl">
            {t('landing.welcome')}{' '}
            <span className="bg-gradient-to-r from-red-600 to-red-800 bg-clip-text text-transparent">
              {t('landing.platformName')}
            </span>
          </h1>
          <p className="text-muted mx-auto mb-6 max-w-2xl text-lg md:text-xl">
            {t('landing.description')}
          </p>
          <Button
            onClick={handleGetStarted}
            size="lg"
            className="bg-red-600 px-8 py-4 text-lg text-foreground hover:bg-red-700"
          >
            {t('landing.getStarted')}
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </section>

        <section className="bg-muted/30 mt-8 w-full px-6 py-8 md:px-12 lg:px-16">
          <h2 className="text-foreground mb-6 text-center text-2xl font-bold md:text-3xl">
            {t('landing.whyPlatform')}
          </h2>
          <div className="flex flex-col items-stretch justify-between gap-6 md:flex-row md:gap-4 lg:gap-6">
            <div className="flex-1 rounded-xl p-6 text-center transition-transform hover:scale-105">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-red-800 md:h-16 md:w-16">
                <GraduationCap className="h-7 w-7 text-foreground md:h-8 md:w-8" />
              </div>
              <h3 className="text-foreground mb-2 text-lg font-semibold md:text-xl">
                {t('landing.interactiveLearning')}
              </h3>
              <p className="text-muted text-sm md:text-base">
                {t('landing.interactiveLearningDesc')}
              </p>
            </div>
            <div className="flex-1 rounded-xl p-6 text-center transition-transform hover:scale-105">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-red-800 md:h-16 md:w-16">
                <Users className="h-7 w-7 text-foreground md:h-8 md:w-8" />
              </div>
              <h3 className="text-foreground mb-2 text-lg font-semibold md:text-xl">
                {t('landing.personalSupport')}
              </h3>
              <p className="text-muted text-sm md:text-base">
                {t('landing.personalSupportDesc')}
              </p>
            </div>
            <div className="flex-1 rounded-xl p-6 text-center transition-transform hover:scale-105">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-red-800 md:h-16 md:w-16">
                <Shield className="h-7 w-7 text-foreground md:h-8 md:w-8" />
              </div>
              <h3 className="text-foreground mb-2 text-lg font-semibold md:text-xl">
                {t('landing.securePlatform')}
              </h3>
              <p className="text-muted text-sm md:text-base">
                {t('landing.securePlatformDesc')}
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-border/40 relative z-10 border-t py-6">
        <div className="px-6 text-center md:px-12 lg:px-16">
          <p className="text-muted text-sm">
            {t('landing.copyright')}
          </p>
        </div>
      </footer>
    </div>
  );
}
