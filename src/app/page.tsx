'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/lib/supabase';
import {
  BookOpen,
  Users,
  GraduationCap,
  ArrowRight,
  Shield,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { motion } from 'framer-motion';

export default function LandingPage() {
  const { user, profile, loading } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const [sessionReady, setSessionReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  const containerMotion = {
    hidden: { opacity: 0, y: 16 },
    show: {
      opacity: 1,
      y: 0,
      transition: { staggerChildren: 0.08, delayChildren: 0.12 },
    },
  };

  const itemMotion = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
  };

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setHasSession(!!data.session?.user);
        setSessionReady(true);
      })
      .catch(() => {
        if (!active) return;
        setHasSession(false);
        setSessionReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // If user is already authenticated, redirect to appropriate dashboard
  useEffect(() => {
    if (!loading && sessionReady && hasSession && user && profile) {
      if (profile.role === 'trainee') {
        router.push('/trainee/dashboard');
      } else if (profile.role === 'trainer') {
        router.push('/trainer/dashboard');
      }
    }
  }, [user, profile, loading, sessionReady, hasSession, router]);

  const handleGetStarted = () => {
    router.push('/login');
  };
  const handleSignUp = () => {
    router.push('/register');
  };

  // Derived state to show intermediate redirect screen
  const shouldRedirect =
    !loading && sessionReady && hasSession && !!user && !!profile;

  // Memoize loading state
  if (loading) {
    return (
      <div className="bg-background relative flex min-h-screen items-center justify-center overflow-hidden">
        {/* Enhanced background theme */}
        <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-red-900/30 via-red-800/25 to-red-900/35"></div>
        <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/40 via-transparent to-black/20"></div>

        <div className="relative z-10 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-red-600 to-red-800 shadow-2xl">
            <BookOpen className="text-foreground h-8 w-8" />
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
        <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-red-900/30 via-red-800/25 to-red-900/35"></div>
        <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/40 via-transparent to-black/20"></div>

        <div className="relative z-10 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-red-600 to-red-800 shadow-2xl">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
          </div>
          <h1 className="text-foreground text-xl">
            {t('landing.redirecting')}
          </h1>
          <p className="text-muted">{t('landing.beingRedirected')}</p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className="bg-background relative flex min-h-screen flex-col justify-between overflow-hidden"
      variants={containerMotion}
      initial="hidden"
      animate="show"
    >
      {/* Enhanced background theme */}
      <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-red-700/80 via-red-400/150 to-red-700/80"></div>
      <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-white/500 via-transparent to-white/500"></div>

      {/* Header */}
      <motion.header
        className="border-border/40 relative z-10 border-b"
        variants={itemMotion}
      >
        <div className="flex items-center justify-between px-6 py-4 md:px-12 lg:px-16">
          <div className="flex items-center space-x-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-red-600 to-red-800">
              <BookOpen className="text-foreground h-6 w-6" />
            </div>
            <span className="text-foreground text-xl font-bold">FIAE</span>
          </div>
          <div className="flex items-center space-x-3">
            <LanguageToggle variant="icon" />
            <ThemeToggle variant="icon" />
            <Button
              onClick={handleSignUp}
              variant="outline"
              className="hover:text-foreground border-red-600 text-red-600 hover:bg-red-600"
            >
              {t('landing.signUp')}
            </Button>
          </div>
        </div>
      </motion.header>

      {/* Main Content */}
      <motion.main
        className="flex flex-col items-center justify-center px-6 py-8 md:px-12 lg:px-16"
        variants={itemMotion}
      >
        <motion.section className="text-center" variants={itemMotion}>
          <h1 className="text-foreground mb-4 text-4xl font-bold md:text-5xl lg:text-6xl">
            {t('landing.welcome')}{' '}
            <span className="bg-linear-to-r from-red-600 to-red-800 bg-clip-text text-transparent">
              {t('landing.platformName')}
            </span>
          </h1>
          <p className="text-muted mx-auto mb-6 max-w-2xl text-lg md:text-xl">
            {t('landing.description')}
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              onClick={handleGetStarted}
              size="lg"
              className="text-foreground bg-red-600 px-8 py-4 text-lg hover:bg-red-700"
            >
              {t('landing.getStarted')}
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button
              onClick={() => router.push('/demo')}
              size="lg"
              variant="outline"
              className="border-foreground/30 text-foreground hover:bg-foreground/10 px-8 py-4 text-lg"
            >
              <Eye className="mr-2 h-5 w-5" />
              Demo ansehen
            </Button>
          </div>
        </motion.section>

        <motion.section
          className="bg-muted/30 mt-8 w-full px-6 py-8 md:px-12 lg:px-16"
          variants={itemMotion}
        >
          <h2 className="text-foreground mb-6 text-center text-2xl font-bold md:text-3xl">
            {t('landing.whyPlatform')}
          </h2>
          <div className="flex flex-col items-stretch justify-between gap-6 md:flex-row md:gap-4 lg:gap-6">
            <motion.div
              className="flex-1 rounded-xl p-6 text-center transition-transform hover:scale-105"
              variants={itemMotion}
            >
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-red-600 to-red-800 md:h-16 md:w-16">
                <GraduationCap className="text-foreground h-7 w-7 md:h-8 md:w-8" />
              </div>
              <h3 className="text-foreground mb-2 text-lg font-semibold md:text-xl">
                {t('landing.interactiveLearning')}
              </h3>
              <p className="text-muted text-sm md:text-base">
                {t('landing.interactiveLearningDesc')}
              </p>
            </motion.div>
            <motion.div
              className="flex-1 rounded-xl p-6 text-center transition-transform hover:scale-105"
              variants={itemMotion}
            >
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-red-600 to-red-800 md:h-16 md:w-16">
                <Users className="text-foreground h-7 w-7 md:h-8 md:w-8" />
              </div>
              <h3 className="text-foreground mb-2 text-lg font-semibold md:text-xl">
                {t('landing.personalSupport')}
              </h3>
              <p className="text-muted text-sm md:text-base">
                {t('landing.personalSupportDesc')}
              </p>
            </motion.div>
            <motion.div
              className="flex-1 rounded-xl p-6 text-center transition-transform hover:scale-105"
              variants={itemMotion}
            >
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-red-600 to-red-800 md:h-16 md:w-16">
                <Shield className="text-foreground h-7 w-7 md:h-8 md:w-8" />
              </div>
              <h3 className="text-foreground mb-2 text-lg font-semibold md:text-xl">
                {t('landing.securePlatform')}
              </h3>
              <p className="text-muted text-sm md:text-base">
                {t('landing.securePlatformDesc')}
              </p>
            </motion.div>
          </div>
        </motion.section>
      </motion.main>

      {/* Footer */}
      <motion.footer
        className="border-border/40 relative z-10 border-t py-6"
        variants={itemMotion}
      >
        <div className="px-6 text-center md:px-12 lg:px-16">
          <p className="text-muted text-sm">{t('landing.copyright')}</p>
        </div>
      </motion.footer>
    </motion.div>
  );
}
