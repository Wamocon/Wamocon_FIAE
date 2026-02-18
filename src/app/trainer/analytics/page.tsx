'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { BarChart3, TrendingUp, Users, Award, Target } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';

// Lazy-load recharts (~108 kB) — only downloaded when the analytics page is visited
const AnalyticsCharts = dynamic(
  () =>
    import('@/components/trainer/AnalyticsCharts').then(m => m.AnalyticsCharts),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 items-center justify-center">
        <div className="border-accent h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
      </div>
    ),
  }
);

export default function TrainerAnalyticsPage() {
  const { profile, user, loading } = useAuth();
  const { t } = useLanguage();

  const [trainees, setTrainees] = useState<
    Array<{ id: string; full_name: string; progress: number }>
  >([]);
  const [counts, setCounts] = useState<{
    activeTrainees: number;
    pendingReviews: number;
  }>({ activeTrainees: 0, pendingReviews: 0 });
  const [progressTrend, setProgressTrend] = useState<
    Array<{ week: string; progress: number }>
  >([]);
  const [moduleProgress, setModuleProgress] = useState<
    Array<{
      name: string;
      completed: number;
      inProgress: number;
      notStarted: number;
    }>
  >([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!user || !profile) return;
      try {
        const params = new URLSearchParams();
        if (user.id) params.set('trainerAuthId', user.id);
        if (profile.id) params.set('trainerProfileId', profile.id);
        const res = await fetch(`/api/trainer/dashboard?${params.toString()}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(t('trainer.analytics.loadError'));
        const data = await res.json();
        setTrainees(data.trainees || []);
        setCounts(data.counts || { activeTrainees: 0, pendingReviews: 0 });
        setProgressTrend(data.charts?.progressTrend || []);
        setModuleProgress(data.charts?.moduleProgress || []);
      } catch (e: unknown) {
        const message =
          typeof e === 'object' &&
          e &&
          'message' in e &&
          typeof (e as any).message === 'string'
            ? (e as any).message
            : t('trainer.analytics.unknownError');
        setError(message);
      }
    };
    if (profile?.role === 'trainer') load();
  }, [user, profile]);

  const avgProgress = useMemo(() => {
    if (!trainees.length) return 0;
    const total = trainees.reduce((acc, t) => acc + (t.progress || 0), 0);
    return Math.round(total / trainees.length);
  }, [trainees]);

  if (loading) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="border-accent/30 border-t-accent mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">
            {t('trainer.analytics.loading')}
          </p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="border-destructive/30 border-t-destructive mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">
            {t('trainer.analytics.userNotFound')}
          </p>
        </div>
      </div>
    );
  }

  if (profile.role !== 'trainer') {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="border-destructive/30 border-t-destructive mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">
            {t('trainer.analytics.accessDenied')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-6">
          <div className="from-accent to-primary flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br">
            <BarChart3 className="text-foreground h-8 w-8" />
          </div>
          <div>
            <h1 className="text-foreground mb-2 text-3xl font-bold">
              {t('trainer.analytics.title')}
            </h1>
            <p className="text-muted">{t('trainer.analytics.description')}</p>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="from-accent to-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
              <Users className="text-foreground h-6 w-6" />
            </div>
            <div>
              <p className="text-muted text-sm">
                {t('trainer.analytics.activeTrainees')}
              </p>
              <p className="text-foreground text-2xl font-bold">
                {counts.activeTrainees}
              </p>
            </div>
          </div>
        </div>

        <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-500">
              <TrendingUp className="text-foreground h-6 w-6" />
            </div>
            <div>
              <p className="text-muted text-sm">
                {t('trainer.analytics.avgProgress')}
              </p>
              <p className="text-foreground text-2xl font-bold">
                {avgProgress}%
              </p>
            </div>
          </div>
        </div>

        <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-violet-500">
              <Award className="text-foreground h-6 w-6" />
            </div>
            <div>
              <p className="text-muted text-sm">
                {t('trainer.analytics.pendingReviews')}
              </p>
              <p className="text-foreground text-2xl font-bold">
                {counts.pendingReviews}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <AnalyticsCharts
        progressTrend={progressTrend}
        moduleProgress={moduleProgress}
        labels={{
          progressOverTime: t('trainer.analytics.progressOverTime'),
          moduleProgress: t('trainer.analytics.moduleProgress'),
        }}
      />
      {/* Additional tables (quiz performance, etc.) can be added once data endpoints exist */}
    </div>
  );
}
