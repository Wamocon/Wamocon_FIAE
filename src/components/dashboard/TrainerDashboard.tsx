'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  Users,
  TrendingUp,
  Clock,
  AlertTriangle,
  BarChart3,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import HaiAdminWidget from '@/components/hai/HaiAdminWidget';

// Dynamically import chart components with SSR disabled
const ProgressTrendChart = dynamic(
  () => import('./DashboardCharts').then(mod => mod.ProgressTrendChart),
  { ssr: false, loading: () => <div className="flex h-[200px] items-center justify-center text-muted-foreground text-sm">Lade...</div> }
);

const ModuleProgressChart = dynamic(
  () => import('./DashboardCharts').then(mod => mod.ModuleProgressChart),
  { ssr: false, loading: () => <div className="flex h-[200px] items-center justify-center text-muted-foreground text-sm">Lade...</div> }
);

interface Trainee {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  progress?: number;
}

type DashboardResponse = {
  trainees: Trainee[];
  counts: { activeTrainees: number; pendingReviews: number; recentReflections: number; totalReflections?: number; pendingQuiz: number; pendingReflections: number; pendingUseCases: number; pendingEnablers?: number; pendingActivityReports?: number };
  charts: {
    progressTrend: { week: string; progress: number }[];
    moduleProgress: { name: string; completed: number; inProgress: number; notStarted: number }[];
  };
};

// Cache helpers for instant dashboard loading
const TRAINER_DASHBOARD_CACHE_KEY = 'wmc_trainer_dashboard_cache_v4';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const getCachedDashboard = (): DashboardResponse | null => {
  try {
    const cached = localStorage.getItem(TRAINER_DASHBOARD_CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) return data;
    }
  } catch (_) { }
  return null;
};

const setCachedDashboard = (data: DashboardResponse) => {
  try {
    localStorage.setItem(TRAINER_DASHBOARD_CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
  } catch (_) { }
};

export default function TrainerDashboard() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [pendingReviews, setPendingReviews] = useState<number>(0);
  const [pendingQuiz, setPendingQuiz] = useState<number>(0);
  const [pendingReflections, setPendingReflections] = useState<number>(0);
  const [pendingActivityReports, setPendingActivityReports] = useState<number>(0);
  const [recentReflections, setRecentReflections] = useState<number>(0);
  const [totalReflections, setTotalReflections] = useState<number>(0);
  const [progressTrend, setProgressTrend] = useState<{ week: string; progress: number }[]>([]);
  const [moduleProgress, setModuleProgress] = useState<{ name: string; completed: number; inProgress: number; notStarted: number }[]>([]);

  // Apply cached or fresh dashboard data to state
  const applyDashboardData = (data: DashboardResponse) => {
    setTrainees(data.trainees || []);
    setPendingReviews(data.counts?.pendingReviews || 0);
    setPendingQuiz(data.counts?.pendingQuiz || 0);
    setPendingReflections(data.counts?.pendingReflections || 0);
    setPendingActivityReports(data.counts?.pendingActivityReports || 0);
    setRecentReflections(data.counts?.recentReflections || 0);
    setTotalReflections(data.counts?.totalReflections || 0);
    setProgressTrend(data.charts?.progressTrend || []);
    setModuleProgress(data.charts?.moduleProgress || []);
  };

  useEffect(() => {
    setMounted(true);
    // Load cached data immediately on mount
    const cached = getCachedDashboard();
    if (cached) {
      applyDashboardData(cached);
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        if (!user?.id && !profile?.id) {
          setDataLoading(false);
          return;
        }
        // Only show loading if no cached data
        const hasCached = getCachedDashboard() !== null;
        if (!hasCached) setDataLoading(true);
        setDataError(null);

        const params = new URLSearchParams();
        if (user?.id) params.set('trainerAuthId', user.id);
        if (profile?.id) params.set('trainerProfileId', profile.id);
        const url = `/api/trainer/dashboard?${params.toString()}`;
        const res = await fetch(url);
        if (!res.ok) {
          const errText = await res.text().catch(() => 'Unknown error');
          console.error('Trainer Dashboard API error:', res.status, errText);
          setDataError(`Fehler beim Laden: ${res.status}`);
          setDataLoading(false);
          return;
        }
        const data: DashboardResponse = await res.json();

        // Update state and cache
        applyDashboardData(data);
        setCachedDashboard(data);
      } catch (e) {
        console.error(e);
        setDataError('Netzwerkfehler beim Laden der Daten');
      } finally {
        setDataLoading(false);
      }
    };
    load();
  }, [user?.id, profile?.id]);

  if (!mounted) return null;

  // Chart data now comes from API: progressTrend and moduleProgress

  // Ensure chart data is safe and numeric to avoid runtime errors
  const progressTrendSafe = (progressTrend || []).filter(p => p && typeof p === 'object').map((p) => ({
    week: String(p?.week ?? ''),
    progress: Number(p?.progress ?? 0),
  }));

  const moduleProgressSafe = (moduleProgress || []).filter(m => m && typeof m === 'object').map((m) => ({
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
    <div className="from-background relative min-h-screen space-y-6 bg-gradient-to-br via-red-900/30 to-red-800/40 p-6">
      {/* Enhanced red background overlay */}
      <div className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-br from-red-900/20 via-red-800/15 to-red-900/25"></div>
      <div className="relative z-10">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-8 lg:col-span-2">
            {/* Action Required Section */}
            <div className="glass-effect rounded-2xl p-6 shadow-lg">
              <h3 className="text-foreground mb-6 flex items-center text-xl font-bold">
                <AlertTriangle className="text-primary mr-3 h-6 w-6" />
                Aktion erforderlich
              </h3>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {/* Pending Reports Card */}
                <div className="bg-background/50 border-border/50 rounded-xl border p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="text-foreground font-semibold">
                      Ausstehende Nachweise
                    </h4>
                    <span className="text-primary text-2xl font-bold">
                      {pendingActivityReports}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    Warten auf Genehmigung
                  </p>
                  <button onClick={() => router.push('/trainer/activity-reports?filter=pending')} className="bg-primary text-primary-foreground hover:bg-primary/90 mt-3 rounded-xl px-4 py-2 text-sm transition-colors w-full">
                    Prüfen
                  </button>
                </div>

                <div className="bg-background/50 border-border/50 rounded-xl border p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="text-foreground font-semibold">
                      Quiz-Reviews
                    </h4>
                    <span className="text-primary text-2xl font-bold">
                      {pendingQuiz}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    Warten auf Bewertung
                  </p>
                  <button onClick={() => router.push('/trainer/reviews?view=quizzes&onlyPending=true')} className="bg-primary text-primary-foreground hover:bg-primary/90 mt-3 rounded-xl px-4 py-2 text-sm transition-colors w-full">
                    Jetzt bewerten
                  </button>
                </div>

                <div className="bg-background/50 border-border/50 rounded-xl border p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="text-foreground font-semibold">
                      Reflektionen
                    </h4>
                    <span className="text-accent text-2xl font-bold">{totalReflections}</span>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    Alle Einreichungen
                  </p>
                  <button onClick={() => router.push('/trainer/reflections')} className="bg-accent text-accent-foreground hover:bg-accent/90 mt-3 rounded-xl px-4 py-2 text-sm transition-colors w-full">
                    Anzeigen
                  </button>
                </div>
              </div>
            </div>

            {/* Trainee Overview Section */}
            <div className="glass-effect rounded-2xl p-6 shadow-lg">
              <h3 className="text-foreground mb-6 flex items-center text-xl font-bold">
                <Users className="text-accent mr-3 h-6 w-6" />
                Auszubildenden-Übersicht
              </h3>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                <div
                  role="button"
                  onClick={() => router.push('/trainer/trainees')}
                  className="bg-background/50 border-border/50 hover:bg-background/70 cursor-pointer rounded-xl border p-6 text-center transition-colors"
                >
                  <Users className="text-accent mx-auto mb-3 h-8 w-8" />
                  <p className="text-muted-foreground text-sm">Aktive Azubis</p>
                  <p className="text-foreground text-2xl font-bold">
                    {trainees.length}
                  </p>
                </div>

                <div
                  role="button"
                  onClick={() => router.push('/trainer/analytics')}
                  className="bg-background/50 border-border/50 hover:bg-background/70 cursor-pointer rounded-xl border p-6 text-center transition-colors"
                >
                  <TrendingUp className="text-primary mx-auto mb-3 h-8 w-8" />
                  <p className="text-muted-foreground text-sm">Ø Fortschritt</p>
                  <p className="text-foreground text-2xl font-bold">
                    {avgProgress}%
                  </p>
                </div>

                <div
                  role="button"
                  onClick={() => router.push('/trainer/reviews?onlyPending=true')}
                  className="bg-background/50 border-border/50 hover:bg-background/70 cursor-pointer rounded-xl border p-6 text-center transition-colors"
                >
                  <Clock className="text-accent mx-auto mb-3 h-8 w-8" />
                  <p className="text-muted-foreground text-sm">
                    Offene Reviews
                  </p>
                  <p className="text-foreground text-2xl font-bold">{pendingReviews}</p>
                </div>
              </div>
            </div>

            {/* HAI Admin Section */}
            <HaiAdminWidget />
          </div>

          {/* Right Sidebar - Charts */}
          <div className="space-y-8">
            {/* Overall Progress Chart */}
            <div className="glass-effect rounded-2xl p-6 shadow-lg">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-foreground flex items-center text-lg font-bold">
                  <TrendingUp className="text-accent mr-3 h-6 w-6" />
                  Gesamtfortschritt
                </h3>
                <button
                  onClick={() => router.push('/trainer/analytics')}
                  className="border-accent/30 text-foreground hover:bg-background/60 rounded-xl border px-3 py-1 text-xs"
                >
                  Anzeigen
                </button>
              </div>
              <ProgressTrendChart data={progressTrendSafe} loading={dataLoading} />
            </div>

            {/* Module Progress Chart */}
            <div className="glass-effect rounded-2xl p-6 shadow-lg">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-foreground flex items-center text-lg font-bold">
                  <BarChart3 className="text-accent mr-3 h-6 w-6" />
                  Einzelner Fortschritt
                </h3>
                <button
                  onClick={() => router.push('/trainer/analytics')}
                  className="border-accent/30 text-foreground hover:bg-background/60 rounded-xl border px-3 py-1 text-xs"
                >
                  Anzeigen
                </button>
              </div>
              <ModuleProgressChart data={moduleProgressSafe} loading={dataLoading} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
