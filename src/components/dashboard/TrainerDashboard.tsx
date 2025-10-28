'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  TrendingUp,
  Clock,
  AlertTriangle,
  Target,
  BarChart3,
} from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '@/contexts/AuthContext';

interface Trainee {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  progress?: number;
}

type DashboardResponse = {
  trainees: Trainee[];
  counts: { activeTrainees: number; pendingReviews: number; recentReflections: number; pendingQuiz: number; pendingReflections: number; pendingUseCases: number };
  charts: {
    progressTrend: { week: string; progress: number }[];
    moduleProgress: { name: string; completed: number; inProgress: number; notStarted: number }[];
  };
};

export default function TrainerDashboard() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [pendingReviews, setPendingReviews] = useState<number>(0);
  const [pendingQuiz, setPendingQuiz] = useState<number>(0);
  const [pendingReflections, setPendingReflections] = useState<number>(0);
  const [recentReflections, setRecentReflections] = useState<number>(0);
  const [progressTrend, setProgressTrend] = useState<{ week: string; progress: number }[]>([]);
  const [moduleProgress, setModuleProgress] = useState<{ name: string; completed: number; inProgress: number; notStarted: number }[]>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
  if (!user?.id && !profile?.id) return; // wait for auth
  const params = new URLSearchParams();
  if (user?.id) params.set('trainerAuthId', user.id);
  if (profile?.id) params.set('trainerProfileId', profile.id);
  const url = `/api/trainer/dashboard?${params.toString()}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load dashboard');
        const data: DashboardResponse = await res.json();
  setTrainees(data.trainees || []);
  setPendingReviews(data.counts?.pendingReviews || 0);
  setPendingQuiz(data.counts?.pendingQuiz || 0);
  setPendingReflections(data.counts?.pendingReflections || 0);
  setRecentReflections(data.counts?.recentReflections || 0);
  setProgressTrend(data.charts?.progressTrend || []);
  setModuleProgress(data.charts?.moduleProgress || []);
      } catch (e) {
        console.error(e);
      }
    };
    load();
  }, [user?.id]);

  if (!mounted) return null;

  // Chart data now comes from API: progressTrend and moduleProgress

  const avgProgress = trainees.length
    ? Math.round(
        trainees.reduce(
          (acc: number, t: Trainee) => acc + (t.progress || 0),
          0
        ) / trainees.length
      )
    : 0;

  console.log('Trainees:', trainees.length);
  console.log('Pending Reviews:', pendingReviews);
  console.log('Recent Reflections:', recentReflections);
  console.log('Progress Trend:', progressTrend);
  console.log('Module Progress:', moduleProgress);
  console.log('Avg Progress:', avgProgress);

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
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
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
                  <button onClick={() => router.push('/trainer/reviews?view=quizzes&onlyPending=true')} className="bg-primary text-primary-foreground hover:bg-primary/90 mt-3 rounded-xl px-4 py-2 text-sm transition-colors">
                    Jetzt bewerten
                  </button>
                </div>

                <div className="bg-background/50 border-border/50 rounded-xl border p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="text-foreground font-semibold">
                      Reflektionen
                    </h4>
                    <span className="text-accent text-2xl font-bold">{recentReflections}</span>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    Neue Einreichungen
                  </p>
                  <button onClick={() => router.push('/trainer/reflections')} className="bg-accent text-accent-foreground hover:bg-accent/90 mt-3 rounded-xl px-4 py-2 text-sm transition-colors">
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
                  <p className="text-foreground text-2xl font-bold">
                    {pendingQuiz + pendingReflections}
                  </p>
                </div>
              </div>
            </div>
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
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={progressTrend}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#6b7280"
                    strokeOpacity={0.3}
                  />
                  <XAxis
                    dataKey="week"
                    stroke="#ffffff"
                    fontSize={12}
                    tick={{ fill: '#ffffff' }}
                  />
                  <YAxis
                    stroke="#ffffff"
                    fontSize={12}
                    tick={{ fill: '#ffffff' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e1423',
                      border: '1px solid #ef4444',
                      borderRadius: '8px',
                      color: '#ffffff',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="progress"
                    stroke="#ef4444"
                    fill="#ef4444"
                    fillOpacity={0.4}
                    strokeWidth={3}
                  />
                </AreaChart>
              </ResponsiveContainer>
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
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={moduleProgress}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#6b7280"
                    strokeOpacity={0.3}
                  />
                  <XAxis
                    dataKey="name"
                    stroke="#ffffff"
                    fontSize={10}
                    angle={-45}
                    textAnchor="end"
                    height={60}
                    tick={{ fill: '#ffffff' }}
                  />
                  <YAxis
                    stroke="#ffffff"
                    fontSize={12}
                    tick={{ fill: '#ffffff' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e1423',
                      border: '1px solid #ef4444',
                      borderRadius: '8px',
                      color: '#ffffff',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                    }}
                  />
                  <Bar
                    dataKey="completed"
                    stackId="a"
                    fill="#ef4444"
                    radius={[4, 0, 0, 4]}
                  />
                  <Bar dataKey="inProgress" stackId="a" fill="#dc2626" />
                  <Bar
                    dataKey="notStarted"
                    stackId="a"
                    fill="#3c2846"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
