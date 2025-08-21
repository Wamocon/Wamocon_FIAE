'use client'

import { useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { BookOpen, Users, GraduationCap, ArrowRight, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function LandingPage() {
  const { user, profile, loading } = useAuth()
  const router = useRouter()

  // Memoize redirect logic to prevent unnecessary re-renders
  const shouldRedirect = useMemo(() => {
    return !loading && user && profile
  }, [loading, user, profile])

  // If user is already authenticated, redirect to appropriate dashboard
  useEffect(() => {
    if (shouldRedirect) {
      if (profile?.role === 'trainee') {
        router.push('/trainee/dashboard')
      } else if (profile?.role === 'trainer') {
        router.push('/trainer/dashboard')
      }
    }
  }, [shouldRedirect, profile, router])

  const handleGetStarted = useCallback(() => {
    router.push('/login')
  }, [router])

  // Memoize loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
        {/* Enhanced background theme */}
        <div className="absolute inset-0 bg-gradient-to-br from-red-900/30 via-red-800/25 to-red-900/35 pointer-events-none"></div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20 pointer-events-none"></div>
        
        <div className="text-center relative z-10">
          <div className="w-16 h-16 bg-gradient-to-br from-red-600 to-red-800 rounded-2xl flex items-center justify-center shadow-2xl mx-auto mb-6">
            <BookOpen className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">FIAE-Lernplattform</h1>
          <p className="text-muted">Laden...</p>
        </div>
      </div>
    )
  }

  // If user is authenticated, show loading while redirecting
  if (shouldRedirect) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
        {/* Enhanced background theme */}
        <div className="absolute inset-0 bg-gradient-to-br from-red-900/30 via-red-800/25 to-red-900/35 pointer-events-none"></div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20 pointer-events-none"></div>
        
        <div className="text-center relative z-10">
          <div className="w-16 h-16 bg-gradient-to-br from-red-600 to-red-800 rounded-2xl flex items-center justify-center shadow-2xl mx-auto mb-6">
            <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          </div>
          <h1 className="text-xl text-foreground">Weiterleitung...</h1>
          <p className="text-muted">Sie werden weitergeleitet</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Enhanced background theme */}
      <div className="absolute inset-0 bg-gradient-to-br from-red-900/30 via-red-800/25 to-red-900/35 pointer-events-none"></div>
      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20 pointer-events-none"></div>
      
      {/* Header */}
      <header className="border-b border-border/40 relative z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-red-600 to-red-800 rounded-xl flex items-center justify-center">
              <BookOpen className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold text-foreground">FIAE</span>
          </div>
          <Button 
            onClick={handleGetStarted}
            variant="outline"
            className="border-red-600 text-red-600 hover:bg-red-600 hover:text-white"
          >
            Anmelden
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20 px-4 relative z-10">
        <div className="container mx-auto text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-foreground mb-6">
            Willkommen bei der{' '}
            <span className="bg-gradient-to-r from-red-600 to-red-800 bg-clip-text text-transparent">
              FIAE-Lernplattform
            </span>
          </h1>
          <p className="text-xl text-muted mb-8 max-w-3xl mx-auto">
            Eine interne Lernplattform für FIAE-Auszubildende und Ausbilder. 
            Entdecken Sie interaktive Module, Quizze und Reflexionsmöglichkeiten.
          </p>
          <Button 
            onClick={handleGetStarted}
            size="lg"
            className="bg-red-600 hover:bg-red-700 text-white px-8 py-4 text-lg"
          >
            Jetzt starten
            <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-4 bg-muted/30 relative z-10">
        <div className="container mx-auto">
          <h2 className="text-3xl font-bold text-center text-foreground mb-16">
            Warum FIAE-Lernplattform?
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center p-6">
              <div className="w-16 h-16 bg-gradient-to-br from-red-600 to-red-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <GraduationCap className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-3">Interaktives Lernen</h3>
              <p className="text-muted">
                Moderne Lernmodule mit Quizzen und praktischen Übungen für ein effektives Lernerlebnis.
              </p>
            </div>
            <div className="text-center p-6">
              <div className="w-16 h-16 bg-gradient-to-br from-red-600 to-red-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Users className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-3">Persönliche Betreuung</h3>
              <p className="text-muted">
                Individuelle Unterstützung durch Ausbilder und kontinuierliches Feedback.
              </p>
            </div>
            <div className="text-center p-6">
              <div className="w-16 h-16 bg-gradient-to-br from-red-600 to-red-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Shield className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-3">Sichere Plattform</h3>
              <p className="text-muted">
                Moderne Sicherheitsstandards und Datenschutz für Ihre Lerninhalte.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 py-8 relative z-10">
        <div className="container mx-auto px-4 text-center">
          <p className="text-muted">© 2025 FIAE-Lernplattform. Alle Rechte vorbehalten.</p>
        </div>
      </footer>
    </div>
  )
}
