'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { BookOpen, ArrowRight, Play, CheckCircle2 } from 'lucide-react';

type CourseItem = {
  id: string;
  title: string;
  year: number | null;
  chapter: number | null;
  progress: number;
  enablerCount: number;
  completedCount: number;
};

export default function TraineeCoursesPage() {
  const { profile } = useAuth();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<CourseItem[]>([]);

  useEffect(() => {
    const load = async () => {
      if (!profile?.id) return;
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/trainee/courses?traineeId=${profile.id}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(t('courses.loadError'));
        const data = await r.json();
        setCourses(data.courses || []);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : t('error.unknown');
        setError(message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [profile?.id]);

  if (!profile) {
    return (
      <div className="mx-auto max-w-7xl space-y-8 p-6">
        <div className="glass-effect rounded-3xl border border-destructive/30 p-8 shadow-lg">
          <h1 className="text-foreground text-2xl font-bold">{t('courses.loginPrompt')}</h1>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-8 p-6">
        <div className="glass-effect rounded-3xl border border-accent/30 p-8 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent"></div>
            <h1 className="text-foreground text-2xl font-bold">{t('courses.loading')}</h1>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl space-y-8 p-6">
        <div className="glass-effect rounded-3xl border border-destructive/30 p-8 shadow-lg">
          <h1 className="text-foreground text-2xl font-bold">{error}</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-2 flex items-center gap-6">
          <div className="from-accent to-primary flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br">
            <BookOpen className="h-8 w-8 text-foreground" />
          </div>
          <div>
            <h1 className="text-foreground mb-1 text-3xl font-bold">{t('courses.title')}</h1>
            <p className="text-muted">{t('courses.description')}</p>
          </div>
        </div>
      </div>

      {/* Courses Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {courses.length === 0 ? (
          <div className="glass-effect col-span-full rounded-3xl border border-accent/30 p-8 shadow-lg">
            <div className="text-muted-foreground text-center">{t('courses.none')}</div>
          </div>
        ) : (
          courses.map((c) => (
            <Link
              key={c.id}
              href={`/trainee/modules/${c.id}`}
              className="glass-effect group relative cursor-pointer rounded-2xl border-2 border-accent/20 bg-background/40 p-6 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:scale-[1.02] hover:border-accent/50 hover:shadow-xl hover:shadow-accent/10"
            >
              {/* Course Title & Info */}
              <div className="mb-4">
                <h3 className="text-foreground group-hover:text-accent mb-2 text-xl font-bold transition-colors">
                  {c.title}
                </h3>
                <div className="text-sm text-muted-foreground">
                  {c.year ? t('courses.year').replace('{year}', String(c.year)) : '—'} {c.chapter ? `• ${t('courses.chapter').replace('{chapter}', String(c.chapter))}` : ''}
                </div>
              </div>

              {/* Progress Bar with Badge */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">
                    {t('courses.completed').replace('{completed}', String(c.completedCount)).replace('{total}', String(c.enablerCount))}
                  </span>
                  <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-bold ${c.progress === 100
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                      : c.progress > 0
                        ? 'bg-accent/20 text-accent border border-accent/30'
                        : 'bg-muted/20 text-muted-foreground border border-muted/30'
                    }`}>
                    {c.progress === 100 && <CheckCircle2 className="h-3.5 w-3.5" />}
                    {c.progress} %
                  </div>
                </div>
                <div className="bg-muted/30 h-2 w-full overflow-hidden rounded-full">
                  <div
                    className={`h-2 rounded-full transition-all duration-700 ${c.progress === 100
                        ? 'bg-gradient-to-r from-green-500 to-green-400'
                        : 'bg-gradient-to-r from-accent to-primary'
                      }`}
                    style={{ width: `${c.progress}%` }}
                  />
                </div>
              </div>

              {/* Continue Button */}
              <div className="flex items-center justify-between">
                <div className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${c.progress === 100
                  ? 'bg-green-500/20 text-green-400 group-hover:bg-green-500/30'
                  : 'bg-accent/20 text-accent group-hover:bg-accent/30'
                  }`}>
                  {c.progress === 100 ? (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      {t('status.completed')}
                    </>
                  ) : c.progress > 0 ? (
                    <>
                      <Play className="h-4 w-4" />
                      {t('courses.continue')}
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      {t('courses.start')}
                    </>
                  )}
                </div>
                <ArrowRight className="h-5 w-5 text-accent/60 transition-transform group-hover:translate-x-1 group-hover:text-accent" />
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}