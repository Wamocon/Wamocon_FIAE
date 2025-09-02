'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  BookOpen,
  Users,
  GraduationCap,
  ArrowRight,
  Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function LandingPage() {
  const { user, profile, loading } = useAuth();
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

  // Memoize loading state
  if (loading) {
    return (
      <div className="bg-background relative flex min-h-screen items-center justify-center overflow-hidden">
        {/* Enhanced background theme */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-red-900/30 via-red-800/25 to-red-900/35"></div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20"></div>

        <div className="relative z-10 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-red-800 shadow-2xl">
            <BookOpen className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-foreground text-2xl font-bold">
            FIAE-Lernplattform
          </h1>
          <p className="text-muted">Laden...</p>
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
          <h1 className="text-foreground text-xl">Weiterleitung...</h1>
          <p className="text-muted">Sie werden weitergeleitet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background relative min-h-screen overflow-hidden">
      {/* Enhanced background theme */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-red-900/30 via-red-800/25 to-red-900/35"></div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20"></div>

      {/* Header */}
      <header className="border-border/40 relative z-10 border-b">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center space-x-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-red-600 to-red-800">
              <BookOpen className="h-6 w-6 text-white" />
            </div>
            <span className="text-foreground text-xl font-bold">FIAE</span>
          </div>
          <Button
            onClick={handleSignUp}
            variant="outline"
            className="border-red-600 text-red-600 hover:bg-red-600 hover:text-white"
          >
            Anmelden
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 px-4 py-20">
        <div className="container mx-auto text-center">
          <h1 className="text-foreground mb-6 text-5xl font-bold md:text-6xl">
            Willkommen bei der{' '}
            <span className="bg-gradient-to-r from-red-600 to-red-800 bg-clip-text text-transparent">
              FIAE-Lernplattform
            </span>
          </h1>
          <p className="text-muted mx-auto mb-8 max-w-3xl text-xl">
            Eine interne Lernplattform für FIAE-Auszubildende und Ausbilder.
            Entdecken Sie interaktive Module, Quizze und
            Reflexionsmöglichkeiten.
          </p>
          <Button
            onClick={handleGetStarted}
            size="lg"
            className="bg-red-600 px-8 py-4 text-lg text-white hover:bg-red-700"
          >
            Jetzt starten
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-muted/30 relative z-10 px-4 py-20">
        <div className="container mx-auto">
          <h2 className="text-foreground mb-16 text-center text-3xl font-bold">
            Warum FIAE-Lernplattform?
          </h2>
          <div className="grid gap-8 md:grid-cols-3">
            <div className="p-6 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-red-800">
                <GraduationCap className="h-8 w-8 text-white" />
              </div>
              <h3 className="text-foreground mb-3 text-xl font-semibold">
                Interaktives Lernen
              </h3>
              <p className="text-muted">
                Moderne Lernmodule mit Quizzen und praktischen Übungen für ein
                effektives Lernerlebnis.
              </p>
            </div>
            <div className="p-6 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-red-800">
                <Users className="h-8 w-8 text-white" />
              </div>
              <h3 className="text-foreground mb-3 text-xl font-semibold">
                Persönliche Betreuung
              </h3>
              <p className="text-muted">
                Individuelle Unterstützung durch Ausbilder und kontinuierliches
                Feedback.
              </p>
            </div>
            <div className="p-6 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-red-800">
                <Shield className="h-8 w-8 text-white" />
              </div>
              <h3 className="text-foreground mb-3 text-xl font-semibold">
                Sichere Plattform
              </h3>
              <p className="text-muted">
                Moderne Sicherheitsstandards und Datenschutz für Ihre
                Lerninhalte.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-border/40 relative z-10 border-t py-8">
        <div className="container mx-auto px-4 text-center">
          <p className="text-muted">
            © 2025 FIAE-Lernplattform. Alle Rechte vorbehalten.
          </p>
        </div>
      </footer>
    </div>
  );
}
