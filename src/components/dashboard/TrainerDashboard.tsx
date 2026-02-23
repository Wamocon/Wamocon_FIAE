'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  Users,
  TrendingUp,
  AlertTriangle,
  BarChart3,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

// Dynamically import chart components with SSR disabled
const ProgressTrendChart = dynamic(
  () => import('./DashboardCharts').then(mod => mod.ProgressTrendChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[200px] items-center justify-center">
        <div className="border-accent/30 border-t-accent h-6 w-6 animate-spin rounded-full border-2" />
      </div>
    ),
  }
);

const ModuleProgressChart = dynamic(
  () => import('./DashboardCharts').then(mod => mod.ModuleProgressChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[200px] items-center justify-center">
        <div className="border-accent/30 border-t-accent h-6 w-6 animate-spin rounded-full border-2" />
      </div>
    ),
  }
);

interface Trainee {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  progress?: number;
}

type DashboardResponse = {
  trainees: Trainee[];
  counts: {
    activeTrainees: number;
    pendingReviews: number;
    pendingQuiz: number;
    pendingUseCases: number;
    pendingEnablers?: number;
    pendingActivityReports?: number;
  };
  charts: {
    progressTrend: { week: string; progress: number }[];
    moduleProgress: {
      name: string;
      completed: number;
      inProgress: number;
      notStarted: number;
    }[];
  };
};

// Cache helpers for instant dashboard loading (used as placeholderData)
const TRAINER_DASHBOARD_CACHE_KEY = 'wmc_trainer_dashboard_cache_v4';
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes (increased from 5)

const getCachedDashboard = (): DashboardResponse | null => {
  try {
    const cached = localStorage.getItem(TRAINER_DASHBOARD_CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) return data;
    }
  } catch (_) {}
  return null;
};

const setCachedDashboard = (data: DashboardResponse) => {
  try {
    localStorage.setItem(
      TRAINER_DASHBOARD_CACHE_KEY,
      JSON.stringify({ data, timestamp: Date.now() })
    );
  } catch (_) {}
};

export default function TrainerDashboard() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { t } = useLanguage();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // ── React Query replaces manual useState + useEffect + fetch ──
  const url = (() => {
    if (!user?.id && !profile?.id) return null;
    const params = new URLSearchParams();
    if (user?.id) params.set('trainerAuthId', user.id);
    if (profile?.id) params.set('trainerProfileId', profile.id);
    return `/api/trainer/dashboard?${params.toString()}`;
  })();

  const { data, isLoading: dataLoading } = useApiQuery<DashboardResponse>(url, {
    usePrefetch: true,
    placeholderData: () => getCachedDashboard() ?? undefined,
  });

  // Persist fresh data to localStorage for instant display on next visit
  useEffect(() => {
    if (data) setCachedDashboard(data);
  }, [data]);

  // Derive state from the query response
  const trainees = data?.trainees ?? [];
  const pendingReviews = data?.counts?.pendingReviews ?? 0;
  const pendingActivityReports = data?.counts?.pendingActivityReports ?? 0;
  const progressTrend = data?.charts?.progressTrend ?? [];
  const moduleProgress = data?.charts?.moduleProgress ?? [];

  if (!mounted) return null;

  // Chart data now comes from API: progressTrend and moduleProgress

  // Ensure chart data is safe and numeric to avoid runtime errors
  const progressTrendSafe = (progressTrend || [])
    .filter(p => p && typeof p === 'object')
    .map(p => ({
      week: String(p?.week ?? ''),
      progress: Number(p?.progress ?? 0),
    }));

  const moduleProgressSafe = (moduleProgress || [])
    .filter(m => m && typeof m === 'object')
    .map(m => ({
      name: String(m?.name ?? ''),
      completed: Number(m?.completed ?? 0),
      inProgress: Number(m?.inProgress ?? 0),
      notStarted: Number(m?.notStarted ?? 0),
    }));

  const avgProgress = trainees.length
    ? Math.round(
        trainees.reduce(
          (acc: number, t: Trainee) => acc + (t.progress || 0),
          0
        ) / trainees.length
      )
    : 0;

  return (
    <div className="from-background relative min-h-full space-y-6 bg-gradient-to-br via-red-900/30 to-red-800/40 p-6">
      {/* Enhanced red background overlay */}
      <div className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-br from-red-900/20 via-red-800/15 to-red-900/25"></div>
      <div className="relative z-10">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-8 lg:col-span-2">
            {/* Action Required Section */}
            <div className="glass-effect rounded-2xl p-6 shadow-lg">
              <h3 className="text-foreground mb-6 flex items-center text-xl font-bold">
                <AlertTriangle className="text-primary mr-3 h-6 w-6" />
                {t('dashboard.actionRequired')}
              </h3>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {/* Pending Reports Card */}
                <div className="bg-background/50 border-border/50 rounded-xl border p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="text-foreground font-semibold">
                      {t('dashboard.pendingProofs')}
                    </h4>
                    <span className="text-primary text-2xl font-bold">
                      {pendingActivityReports}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {t('dashboard.waitingApproval')}
                  </p>
                  <button
                    onClick={() =>
                      router.push('/trainer/activity-reports?filter=pending')
                    }
                    className="bg-primary text-primary-foreground hover:bg-primary/90 mt-3 w-full rounded-xl px-4 py-2 text-sm transition-colors"
                  >
                    {t('dashboard.reviewNow')}
                  </button>
                </div>

                <div className="bg-background/50 border-border/50 rounded-xl border p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="text-foreground font-semibold">
                      {t('dashboard.pendingReviews')}
                    </h4>
                    <span className="text-primary text-2xl font-bold">
                      {pendingReviews}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {t('dashboard.pendingReviewsDesc')}
                  </p>
                  <button
                    onClick={() =>
                      router.push(
                        '/trainer/reviews?onlyPending=true'
                      )
                    }
                    className="bg-primary text-primary-foreground hover:bg-primary/90 mt-3 w-full rounded-xl px-4 py-2 text-sm transition-colors"
                  >
                    {t('dashboard.reviewNow')}
                  </button>
                </div>
              </div>
            </div>

            {/* Trainee Overview Section */}
            <div className="glass-effect rounded-2xl p-6 shadow-lg">
              <div className="mb-6 flex items-center justify-between">
                <h3 className="text-foreground flex items-center text-xl font-bold">
                  <Users className="text-accent mr-3 h-6 w-6" />
                  {t('dashboard.traineesOverview')}
                  <span className="text-muted-foreground ml-2 text-base font-normal">
                    ({trainees.length})
                  </span>
                </h3>
                <button
                  onClick={() => router.push('/trainer/trainees')}
                  className="text-accent hover:text-accent/80 text-sm font-medium transition-colors"
                >
                  {t('common.viewAll')}
                </button>
              </div>
              {trainees.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t('trainee.management.noTrainees')}</p>
              ) : (
                <div className="space-y-3">
                  {trainees.map((trainee) => (
                    <div
                      key={trainee.id}
                      role="button"
                      onClick={() => router.push(`/trainer/trainees/${trainee.id}`)}
                      className="bg-background/50 border-border/50 hover:bg-accent/10 hover:ring-1 hover:ring-accent cursor-pointer rounded-xl border p-4 transition-all duration-200"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-foreground font-medium text-sm">
                          {trainee.full_name}
                        </span>
                        <span className="text-foreground text-sm font-bold">
                          {trainee.progress || 0}%
                        </span>
                      </div>
                      <div className="bg-muted/30 h-2 w-full rounded-full">
                        <div
                          className={`h-2 rounded-full transition-all duration-500 ${
                            (trainee.progress || 0) >= 70
                              ? 'bg-green-500'
                              : (trainee.progress || 0) >= 30
                                ? 'bg-amber-500'
                                : 'bg-primary'
                          }`}
                          style={{ width: `${Math.max(0, Math.min(100, trainee.progress || 0))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

          {/* Right Sidebar - Charts */}
          <div className="space-y-8">
            {/* Overall Progress Chart */}
            <div className="glass-effect rounded-2xl p-6 shadow-lg">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-foreground flex items-center text-lg font-bold">
                  <TrendingUp className="text-accent mr-3 h-6 w-6" />
                  {t('dashboard.overallProgress')}
                </h3>
              </div>
              <ProgressTrendChart
                data={progressTrendSafe}
                loading={dataLoading}
              />
            </div>

            {/* Module Progress Chart */}
            <div className="glass-effect rounded-2xl p-6 shadow-lg">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-foreground flex items-center text-lg font-bold">
                  <BarChart3 className="text-accent mr-3 h-6 w-6" />
                  {t('dashboard.individualProgress')}
                </h3>
              </div>
              <ModuleProgressChart
                data={moduleProgressSafe}
                loading={dataLoading}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
