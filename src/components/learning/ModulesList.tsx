'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ModuleSummary } from '@/db/queries';
import { BookOpen, CheckCircle, Play } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import Link from 'next/link';

export default function ModulesList({ modules }: { modules: ModuleSummary[] }) {
  const { profile, loading } = useAuth();
  const { t } = useLanguage();

  if (loading) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <LoadingSpinner size="lg" />
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
            <BookOpen className="text-foreground h-8 w-8" />
          </div>
          <div>
            <h1 className="text-foreground mb-2 text-3xl font-bold">
              {t('modules.title')}
            </h1>
            <p className="text-muted">{t('modules.description')}</p>
          </div>
        </div>
      </div>

      {/* Modules Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {modules.map(module => (
          <div
            key={module.id}
            className="glass-effect border-accent/30 flex h-[420px] flex-col overflow-hidden rounded-3xl border p-6 shadow-lg transition-all duration-300 hover:shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <div className="from-accent to-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
                  <BookOpen className="text-foregroundround h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-foreground line-clamp-2 min-h-[56px] text-xl font-bold break-words">
                    {module.title}
                  </h3>
                  <span className="bg-accent/20 text-accent rounded-full px-3 py-1 text-sm font-medium">
                    {t('modules.year').replace(
                      '{year}',
                      String(module.training_year)
                    )}
                  </span>
                </div>
              </div>
            </div>

            <p className="text-muted mb-4 line-clamp-2 min-h-[40px] text-sm break-words">
              {t('modules.fromYear').replace(
                '{year}',
                String(module.training_year)
              )}
            </p>

            {/* Progress */}
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted">{t('modules.progress')}</span>
                <span className="text-foreground font-medium">
                  {module.progress ?? 0}%
                </span>
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
                <div className="text-accent text-lg font-bold">
                  {module.lessonsCount}
                </div>
                <div className="text-muted">{t('modules.lessons')}</div>
              </div>
              <div className="bg-background/50 rounded-xl p-3 text-center">
                <div className="text-primary text-lg font-bold">
                  {module.subLessonsCount}
                </div>
                <div className="text-muted">{t('modules.tasks')}</div>
              </div>
              <div className="bg-background/50 rounded-xl p-3 text-center">
                <div className="text-accent text-lg font-bold">
                  {module.estimatedWeeks ?? 0}
                </div>
                <div className="text-muted">{t('modules.weeks')}</div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-auto flex items-center gap-2 pt-2">
              <Link
                prefetch={false}
                href={`/trainee/modules/${module.id}`}
                className="bg-accent text-accent-foreground hover:bg-accent/90 flex-1 rounded-xl px-4 py-2 text-center text-sm font-medium transition-colors"
              >
                <Play className="mr-2 inline h-4 w-4" />
                {module.progress && module.progress > 0
                  ? t('modules.continue')
                  : t('modules.start')}
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
