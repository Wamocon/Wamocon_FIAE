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
import { supabase } from '@/lib/supabase';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface Trainee {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  progress?: number;
}

export default function TrainerDashboard() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [pendingReviews, setPendingReviews] = useState<number>(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const load = async () => {
      const { data: traineeRows } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url, role')
        .eq('role', 'trainee');

      setTrainees(
        (traineeRows || []).map(r => ({
          id: r.id as any,
          full_name: (r as any).full_name,
          avatar_url: (r as any).avatar_url ?? null,
          progress: 0,
        }))
      );

      const { count } = await supabase
        .from('quiz_submissions')
        .select('id', { count: 'exact', head: true });

      setPendingReviews(count || 0);
    };
    load();
  }, []);

  if (!mounted) return null;

  // Chart data
  const progressData = [
    { month: 'Jan', trainees: 12, progress: 65 },
    { month: 'Feb', trainees: 15, progress: 72 },
    { month: 'Mar', trainees: 18, progress: 78 },
    { month: 'Apr', trainees: 20, progress: 82 },
    { month: 'Mai', trainees: 22, progress: 85 },
    { month: 'Jun', trainees: 25, progress: 88 },
  ];

  const monthlyProgress = [
    { name: 'HTML/CSS', completed: 85, inProgress: 10, notStarted: 5 },
    { name: 'JavaScript', completed: 70, inProgress: 20, notStarted: 10 },
    { name: 'React', completed: 55, inProgress: 30, notStarted: 15 },
    { name: 'Node.js', completed: 40, inProgress: 35, notStarted: 25 },
    { name: 'Datenbanken', completed: 60, inProgress: 25, notStarted: 15 },
  ];

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
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="bg-background/50 border-border/50 rounded-xl border p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="text-foreground font-semibold">
                      Quiz-Reviews
                    </h4>
                    <span className="text-primary text-2xl font-bold">
                      {pendingReviews}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    Warten auf Bewertung
                  </p>
                  <button className="bg-primary text-primary-foreground hover:bg-primary/90 mt-3 rounded-xl px-4 py-2 text-sm transition-colors">
                    Jetzt bewerten
                  </button>
                </div>

                <div className="bg-background/50 border-border/50 rounded-xl border p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="text-foreground font-semibold">
                      Reflektionen
                    </h4>
                    <span className="text-accent text-2xl font-bold">—</span>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    Neue Einreichungen
                  </p>
                  <button className="bg-accent text-accent-foreground hover:bg-accent/90 mt-3 rounded-xl px-4 py-2 text-sm transition-colors">
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
                <div className="bg-background/50 border-border/50 rounded-xl border p-6 text-center">
                  <Users className="text-accent mx-auto mb-3 h-8 w-8" />
                  <p className="text-muted-foreground text-sm">Aktive Azubis</p>
                  <p className="text-foreground text-2xl font-bold">
                    {trainees.length}
                  </p>
                </div>

                <div className="bg-background/50 border-border/50 rounded-xl border p-6 text-center">
                  <TrendingUp className="text-primary mx-auto mb-3 h-8 w-8" />
                  <p className="text-muted-foreground text-sm">Ø Fortschritt</p>
                  <p className="text-foreground text-2xl font-bold">
                    {avgProgress}%
                  </p>
                </div>

                <div className="bg-background/50 border-border/50 rounded-xl border p-6 text-center">
                  <Clock className="text-accent mx-auto mb-3 h-8 w-8" />
                  <p className="text-muted-foreground text-sm">
                    Offene Reviews
                  </p>
                  <p className="text-foreground text-2xl font-bold">
                    {pendingReviews}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Sidebar - Charts */}
          <div className="space-y-8">
            {/* Overall Progress Chart */}
            <div className="glass-effect rounded-2xl p-6 shadow-lg">
              <h3 className="text-foreground mb-4 flex items-center text-lg font-bold">
                <TrendingUp className="text-accent mr-3 h-6 w-6" />
                Gesamtfortschritt
              </h3>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={progressData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#6b7280"
                    strokeOpacity={0.3}
                  />
                  <XAxis
                    dataKey="month"
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
              <h3 className="text-foreground mb-4 flex items-center text-lg font-bold">
                <BarChart3 className="text-accent mr-3 h-6 w-6" />
                Einzelner Fortschritt
              </h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthlyProgress}>
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
