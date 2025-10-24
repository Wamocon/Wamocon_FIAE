"use client";

import { useAuth } from '@/contexts/AuthContext';
import type { ModuleSummary } from '@/db/queries';
import { BookOpen, CheckCircle, Play } from 'lucide-react';
import Link from 'next/link';

export default function ModulesList({ modules }: { modules: ModuleSummary[] }) {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="border-accent/30 border-t-accent mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">Lade Module...</p>
        </div>
      </div>
    );
  }

  // If not authenticated or not trainee, we still render modules for now to enable backend data visibility during integration.

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-6">
          <div className="from-accent to-primary flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br">
            <BookOpen className="h-8 w-8 text-white" />
          </div>
          <div>
            <h1 className="text-foreground mb-2 text-3xl font-bold">Lernmodule</h1>
            <p className="text-muted">Entdecken Sie alle verfügbaren Lernmodule und starten Sie Ihre Ausbildung</p>
          </div>
        </div>
      </div>

      {/* Modules Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {modules.map((module) => (
          <div
            key={module.id}
            className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg transition-all duration-300 hover:shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="from-accent to-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
                  <BookOpen className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h3 className="text-foreground text-xl font-bold">{module.title}</h3>
                  <span className="bg-accent/20 text-accent rounded-full px-3 py-1 text-sm font-medium">
                    Jahr {module.training_year}
                  </span>
                </div>
              </div>
            </div>

            <p className="text-muted mb-4 line-clamp-2">Modul aus dem {module.training_year}. Ausbildungsjahr</p>

            {/* Progress */}
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted">Fortschritt</span>
                <span className="text-foreground font-medium">{module.progress ?? 0}%</span>
              </div>
              <div className="bg-muted/30 h-3 w-full rounded-full">
                <div
                  className="from-accent to-primary h-3 rounded-full bg-gradient-to-r transition-all duration-500"
                  style={{ width: `${module.progress ?? 0}%` }}
                />
              </div>
            </div>

            {/* Stats */}
            <div className="mb-4 grid grid-cols-3 gap-4 text-sm">
              <div className="bg-background/50 rounded-xl p-3 text-center">
                <div className="text-accent text-lg font-bold">{module.lessonsCount}</div>
                <div className="text-muted">Lektionen</div>
              </div>
              <div className="bg-background/50 rounded-xl p-3 text-center">
                <div className="text-primary text-lg font-bold">{module.subLessonsCount}</div>
                <div className="text-muted">Aufgaben</div>
              </div>
              <div className="bg-background/50 rounded-xl p-3 text-center">
                <div className="text-accent text-lg font-bold">~8</div>
                <div className="text-muted">Wochen</div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <Link
                href={`/trainee/modules/${module.id}`}
                className="bg-accent text-accent-foreground hover:bg-accent/90 flex-1 rounded-xl px-4 py-2 text-center text-sm font-medium transition-colors"
              >
                <Play className="mr-2 inline h-4 w-4" />
                {module.progress && module.progress > 0 ? 'Weiter' : 'Starten'}
              </Link>
              <button className="bg-muted/30 text-muted hover:text-foreground hover:bg-muted/50 rounded-xl px-4 py-2 transition-colors">
                <CheckCircle className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
