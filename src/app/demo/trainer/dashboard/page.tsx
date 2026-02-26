'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  trainerStats,
  traineeOverview,
  pendingItems,
  weeklyStats,
  progressByComponent,
} from '@/components/demo/data/demoDashboardTrainer';
import { useDemo } from '@/components/demo/DemoContext';
import {
  Users,
  ClipboardList,
  TrendingUp,
  Clock,
  AlertTriangle,
  CheckCircle,
  BarChart3,
  FileText,
  Eye,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from 'recharts';

export default function DemoTrainerDashboard() {
  const { showDemoToast } = useDemo();

  const statusColor = (status: string) => {
    switch (status) {
      case 'excellent':
        return 'text-green-400';
      case 'good':
        return 'text-blue-400';
      case 'warning':
        return 'text-amber-400';
      case 'critical':
        return 'text-red-400';
      default:
        return 'text-muted-foreground';
    }
  };

  const priorityBadge = (priority: string) => {
    switch (priority) {
      case 'high':
        return <Badge className="bg-red-500/20 text-red-400">Hoch</Badge>;
      case 'medium':
        return <Badge className="bg-amber-500/20 text-amber-400">Mittel</Badge>;
      default:
        return <Badge variant="secondary">Niedrig</Badge>;
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Welcome */}
      <div>
        <h1 className="text-foreground text-2xl font-bold">
          Guten Tag, Anna! 👋
        </h1>
        <p className="text-muted-foreground mt-1">
          {trainerStats.pendingReviews} Bewertungen und{' '}
          {trainerStats.pendingReports} Berichte ausstehend
        </p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="glass-effect border-border/40">
          <CardContent className="flex items-center gap-3 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/20">
              <Users className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <p className="text-foreground text-2xl font-bold">
                {trainerStats.activeTrainees}/{trainerStats.totalTrainees}
              </p>
              <p className="text-muted-foreground text-xs">Aktive Azubis</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-effect border-border/40">
          <CardContent className="flex items-center gap-3 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/20">
              <ClipboardList className="h-6 w-6 text-amber-500" />
            </div>
            <div>
              <p className="text-foreground text-2xl font-bold">
                {trainerStats.pendingReviews}
              </p>
              <p className="text-muted-foreground text-xs">Offene Bewertungen</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-effect border-border/40">
          <CardContent className="flex items-center gap-3 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-500/20">
              <TrendingUp className="h-6 w-6 text-green-500" />
            </div>
            <div>
              <p className="text-foreground text-2xl font-bold">
                {trainerStats.avgProgress}%
              </p>
              <p className="text-muted-foreground text-xs">Ø Fortschritt</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-effect border-border/40">
          <CardContent className="flex items-center gap-3 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/20">
              <BarChart3 className="h-6 w-6 text-purple-500" />
            </div>
            <div>
              <p className="text-foreground text-2xl font-bold">
                {trainerStats.avgQuizScore}%
              </p>
              <p className="text-muted-foreground text-xs">Ø Quiz-Score</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pending Items + Trainee Overview */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Pending Items */}
        <Card className="glass-effect border-border/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock className="h-5 w-5 text-amber-500" />
              Ausstehende Aufgaben
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingItems.map(item => (
              <div
                key={item.id}
                className="bg-background/50 flex items-center justify-between rounded-xl p-3 transition-all hover:bg-background/80 cursor-pointer"
                onClick={() => showDemoToast('öffnen')}
              >
                <div className="flex items-center gap-3">
                  {item.type === 'report' ? (
                    <FileText className="h-4 w-4 text-amber-500" />
                  ) : (
                    <Eye className="h-4 w-4 text-blue-500" />
                  )}
                  <div>
                    <p className="text-foreground text-sm font-medium">
                      {item.title}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {item.trainee} &middot; {item.date}
                    </p>
                  </div>
                </div>
                {priorityBadge(item.priority)}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Trainee Overview */}
        <Card className="glass-effect border-border/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5 text-blue-500" />
              Azubi-Übersicht
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {traineeOverview.map(t => (
              <div
                key={t.name}
                className="bg-background/50 flex items-center gap-4 rounded-xl p-3"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent/80 text-xs font-bold text-white">
                  {t.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-foreground text-sm font-medium">{t.name}</p>
                    <span className={`text-xs font-bold ${statusColor(t.status)}`}>
                      {t.quizAvg}%
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Progress value={t.progress} className="h-1.5 flex-1" />
                    <span className="text-muted-foreground text-xs">{t.progress}%</span>
                  </div>
                </div>
                {t.status === 'critical' && (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Weekly Activity */}
        <Card className="glass-effect border-border/40">
          <CardHeader>
            <CardTitle className="text-lg">Wochenstatistik</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={weeklyStats}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="submissions"
                  stroke="hsl(var(--accent))"
                  strokeWidth={2}
                  name="Einreichungen"
                  dot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="reviews"
                  stroke="#22c55e"
                  strokeWidth={2}
                  name="Bewertungen"
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Component Progress */}
        <Card className="glass-effect border-border/40">
          <CardHeader>
            <CardTitle className="text-lg">Ø Fortschritt je Komponente</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={progressByComponent}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                  formatter={(value: number) => [`${value}%`, 'Ø Fortschritt']}
                />
                <Bar
                  dataKey="avgProgress"
                  fill="hsl(var(--accent))"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
