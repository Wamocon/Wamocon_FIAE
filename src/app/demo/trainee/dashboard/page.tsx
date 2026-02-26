'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  traineeStats,
  weeklyProgress,
  moduleProgress,
  recentActivity,
  achievements,
  nextLesson,
  skillRadar,
} from '@/components/demo/data/demoDashboardTrainee';
import {
  BookOpen,
  Trophy,
  Flame,
  Clock,
  TrendingUp,
  ArrowRight,
  Star,
  Target,
  Zap,
} from 'lucide-react';
import { useDemo } from '@/components/demo/DemoContext';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  LineChart,
  Line,
} from 'recharts';

export default function DemoTraineeDashboard() {
  const { showDemoToast } = useDemo();

  return (
    <div className="space-y-6 p-6">
      {/* Welcome + Stats Row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="glass-effect border-border/40 col-span-1 md:col-span-2 lg:col-span-2">
          <CardContent className="flex items-center gap-6 p-6">
            <div className="flex-1">
              <h2 className="text-foreground text-2xl font-bold">
                Willkommen zurück, Max! 👋
              </h2>
              <p className="text-muted-foreground mt-1">
                Du hast eine {traineeStats.streak}-Tage-Serie! Weiter so!
              </p>
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Gesamtfortschritt</span>
                  <span className="text-foreground font-semibold">
                    {traineeStats.overallProgress}%
                  </span>
                </div>
                <Progress value={traineeStats.overallProgress} className="h-3" />
              </div>
            </div>
            <div className="hidden items-center justify-center md:flex">
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-red-500/20 to-red-600/20 ring-2 ring-red-500/30">
                <span className="text-3xl font-bold text-red-500">
                  #{traineeStats.rank}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-effect border-border/40">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/20">
              <BookOpen className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <p className="text-muted-foreground text-sm">Module</p>
              <p className="text-foreground text-2xl font-bold">
                {traineeStats.completedModules}/{traineeStats.totalModules}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-effect border-border/40">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-500/20">
              <Trophy className="h-6 w-6 text-green-500" />
            </div>
            <div>
              <p className="text-muted-foreground text-sm">Quiz</p>
              <p className="text-foreground text-2xl font-bold">
                {traineeStats.quizAverage}%
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="glass-effect border-border/40">
          <CardContent className="flex items-center gap-3 p-4">
            <Flame className="h-5 w-5 text-orange-500" />
            <div>
              <p className="text-muted-foreground text-xs">Serie</p>
              <p className="text-foreground font-bold">{traineeStats.streak} Tage</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-effect border-border/40">
          <CardContent className="flex items-center gap-3 p-4">
            <Clock className="h-5 w-5 text-purple-500" />
            <div>
              <p className="text-muted-foreground text-xs">Lernstunden</p>
              <p className="text-foreground font-bold">{traineeStats.totalHours}h</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-effect border-border/40">
          <CardContent className="flex items-center gap-3 p-4">
            <Target className="h-5 w-5 text-red-500" />
            <div>
              <p className="text-muted-foreground text-xs">Platzierung</p>
              <p className="text-foreground font-bold">
                {traineeStats.rank} von {traineeStats.totalTrainees}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-effect border-border/40">
          <CardContent className="flex items-center gap-3 p-4">
            <Zap className="h-5 w-5 text-yellow-500" />
            <div>
              <p className="text-muted-foreground text-xs">Nächste Lektion</p>
              <p className="text-foreground truncate text-sm font-bold">
                {nextLesson.estimatedTime}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Next Lesson Card */}
      <Card className="glass-effect border-accent/30 border">
        <CardContent className="flex items-center justify-between p-6">
          <div>
            <p className="text-accent text-sm font-medium">Nächste Lektion</p>
            <h3 className="text-foreground mt-1 text-lg font-semibold">
              {nextLesson.title}
            </h3>
            <p className="text-muted-foreground text-sm">
              {nextLesson.course} &middot; {nextLesson.estimatedTime}
            </p>
          </div>
          <button
            onClick={() => showDemoToast('Lektion starten')}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 px-5 py-3 text-sm font-semibold text-white transition-all hover:scale-105"
          >
            Fortfahren <ArrowRight className="h-4 w-4" />
          </button>
        </CardContent>
      </Card>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Weekly Activity */}
        <Card className="glass-effect border-border/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingUp className="h-5 w-5 text-blue-500" />
              Wochenaktivität
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={weeklyProgress}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <Bar dataKey="hours" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} name="Stunden" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Skill Radar */}
        <Card className="glass-effect border-border/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Star className="h-5 w-5 text-yellow-500" />
              Kompetenzprofil
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <RadarChart data={skillRadar}>
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis dataKey="skill" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                <PolarRadiusAxis tick={false} domain={[0, 100]} />
                <Radar
                  dataKey="value"
                  stroke="hsl(var(--accent))"
                  fill="hsl(var(--accent))"
                  fillOpacity={0.2}
                />
              </RadarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Module Progress + Recent Activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Module Progress */}
        <Card className="glass-effect border-border/40">
          <CardHeader>
            <CardTitle className="text-lg">Modulfortschritt</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={moduleProgress} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={60} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                  formatter={(value: number) => [`${value}%`, 'Fortschritt']}
                />
                <Bar dataKey="progress" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="glass-effect border-border/40">
          <CardHeader>
            <CardTitle className="text-lg">Letzte Aktivitäten</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentActivity.map(item => (
                <div
                  key={item.id}
                  className="bg-background/50 flex items-center justify-between rounded-xl p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate text-sm font-medium">
                      {item.title}
                    </p>
                    <p className="text-muted-foreground text-xs">{item.date}</p>
                  </div>
                  {item.score !== undefined && (
                    <Badge
                      variant={item.score >= 80 ? 'default' : 'secondary'}
                      className="ml-2 shrink-0"
                    >
                      {item.score}%
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Achievements */}
      <Card className="glass-effect border-border/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Trophy className="h-5 w-5 text-yellow-500" />
            Erfolge
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {achievements.map(a => (
              <div
                key={a.id}
                className={`flex flex-col items-center rounded-xl p-4 text-center transition-all ${
                  a.unlocked
                    ? 'bg-accent/10 ring-accent/30 ring-1'
                    : 'bg-muted/20 opacity-50'
                }`}
              >
                <span className="text-2xl">{a.icon}</span>
                <p className="text-foreground mt-2 text-xs font-semibold">{a.title}</p>
                <p className="text-muted-foreground mt-1 text-[10px]">
                  {a.description}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
