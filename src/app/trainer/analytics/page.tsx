'use client';

import { useAuth } from '@/contexts/AuthContext';
import {
  BarChart3,
  TrendingUp,
  Users,
  Award,
  Target,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';

export default function TrainerAnalyticsPage() {
  const { profile, user, loading } = useAuth();

  const [trainees, setTrainees] = useState<Array<{ id: string; full_name: string; progress: number }>>([]);
  const [counts, setCounts] = useState<{ activeTrainees: number; pendingReviews: number }>({ activeTrainees: 0, pendingReviews: 0 });
  const [progressTrend, setProgressTrend] = useState<Array<{ week: string; progress: number }>>([]);
  const [moduleProgress, setModuleProgress] = useState<Array<{ name: string; completed: number; inProgress: number; notStarted: number }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!user || !profile) return;
      try {
        const params = new URLSearchParams();
        if (user.id) params.set('trainerAuthId', user.id);
        if (profile.id) params.set('trainerProfileId', profile.id);
        const res = await fetch(`/api/trainer/dashboard?${params.toString()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Konnte Analytics nicht laden');
        const data = await res.json();
        setTrainees(data.trainees || []);
        setCounts(data.counts || { activeTrainees: 0, pendingReviews: 0 });
        setProgressTrend(data.charts?.progressTrend || []);
        setModuleProgress(data.charts?.moduleProgress || []);
      } catch (e: unknown) {
        const message = typeof e === 'object' && e && 'message' in e && typeof (e as any).message === 'string'
          ? (e as any).message
          : 'Unbekannter Fehler';
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
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="border-accent/30 border-t-accent mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">Lade Analysen...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="border-destructive/30 border-t-destructive mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">Benutzer nicht gefunden...</p>
        </div>
      </div>
    );
  }

  if (profile.role !== 'trainer') {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="border-destructive/30 border-t-destructive mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">Zugriff verweigert...</p>
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
            <BarChart3 className="h-8 w-8 text-foreground" />
          </div>
          <div>
            <h1 className="text-foreground mb-2 text-3xl font-bold">
              Analysen & Statistiken
            </h1>
            <p className="text-muted">
              Überblick über den Fortschritt und die Leistung Ihrer
              Auszubildenden
            </p>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="from-accent to-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
              <Users className="h-6 w-6 text-foreground" />
            </div>
            <div>
              <p className="text-muted text-sm">Aktive Azubis</p>
              <p className="text-foreground text-2xl font-bold">{counts.activeTrainees}</p>
            </div>
          </div>
        </div>

        <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-500">
              <TrendingUp className="h-6 w-6 text-foreground" />
            </div>
            <div>
              <p className="text-muted text-sm">Ø Fortschritt</p>
              <p className="text-foreground text-2xl font-bold">{avgProgress}%</p>
            </div>
          </div>
        </div>

        <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-violet-500">
              <Award className="h-6 w-6 text-foreground" />
            </div>
            <div>
              <p className="text-muted text-sm">Ausstehende Reviews</p>
              <p className="text-foreground text-2xl font-bold">{counts.pendingReviews}</p>
            </div>
          </div>
        </div>

      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Progress Over Time */}
        <div className="glass-effect rounded-2xl p-6 shadow-lg">
          <h3 className="text-foreground mb-6 flex items-center text-xl font-bold">
            <TrendingUp className="text-accent mr-3 h-6 w-6" />
            Fortschritt über Zeit
          </h3>
          <ResponsiveContainer width="100%" height={300}>
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
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                }}
              />
              <Area
                type="monotone"
                dataKey="progress"
                stroke="#ef4444"
                fill="#ef4444"
                fillOpacity={0.3}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Module Progress */}
        <div className="glass-effect rounded-2xl p-6 shadow-lg">
          <h3 className="text-foreground mb-6 flex items-center text-xl font-bold">
            <Target className="text-primary mr-3 h-6 w-6" />
            Modul-Fortschritt
          </h3>
          <ResponsiveContainer width="100%" height={300}>
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
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                }}
              />
              <Bar
                dataKey="completed"
                stackId="a"
                fill="#ef4444"
                radius={[4, 0, 0, 4]}
                stroke="#ffffff"
                strokeWidth={1}
              />
              <Bar
                dataKey="inProgress"
                stackId="a"
                fill="#dc2626"
                stroke="#ffffff"
                strokeWidth={1}
              />
              <Bar
                dataKey="notStarted"
                stackId="a"
                fill="#3c2846"
                radius={[0, 4, 4, 0]}
                stroke="#ffffff"
                strokeWidth={1}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      {/* Additional tables (quiz performance, etc.) can be added once data endpoints exist */}
    </div>
  );
}
