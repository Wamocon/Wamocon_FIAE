'use client';

import { useAuth } from '@/contexts/AuthContext';
import { mockData } from '@/lib/supabase';
import {
  BarChart3,
  TrendingUp,
  Users,
  Award,
  Clock,
  Target,
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
  AreaChart,
  Area,
} from 'recharts';

export default function TrainerAnalyticsPage() {
  const { profile, loading } = useAuth();

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

  const trainees = mockData.trainees;
  const quizSubmissions = mockData.quizSubmissions;

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

  const quizPerformance = [
    {
      trainee: 'Elias Felsing',
      quiz: 'HTML Grundlagen',
      score: 95,
      date: '2025-01-15',
    },
    {
      trainee: 'Anna Schmidt',
      quiz: 'CSS Layouts',
      score: 88,
      date: '2025-01-14',
    },
    {
      trainee: 'Max Weber',
      quiz: 'JavaScript Basics',
      score: 92,
      date: '2025-01-13',
    },
    {
      trainee: 'Lisa Müller',
      quiz: 'React Hooks',
      score: 78,
      date: '2025-01-12',
    },
    {
      trainee: 'Tom Fischer',
      quiz: 'Node.js Intro',
      score: 85,
      date: '2025-01-11',
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-6">
          <div className="from-accent to-primary flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br">
            <BarChart3 className="h-8 w-8 text-white" />
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
      <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
        <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="from-accent to-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
              <Users className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-muted text-sm">Aktive Azubis</p>
              <p className="text-foreground text-2xl font-bold">
                {trainees.length}
              </p>
            </div>
          </div>
        </div>

        <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-500">
              <TrendingUp className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-muted text-sm">Ø Fortschritt</p>
              <p className="text-foreground text-2xl font-bold">
                {Math.round(
                  trainees.reduce((acc, t) => acc + (t.progress || 0), 0) /
                    trainees.length
                )}
                %
              </p>
            </div>
          </div>
        </div>

        <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-violet-500">
              <Award className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-muted text-sm">Quiz abgeschlossen</p>
              <p className="text-foreground text-2xl font-bold">
                {quizSubmissions.length}
              </p>
            </div>
          </div>
        </div>

        <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-red-500">
              <Clock className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-muted text-sm">Ø Lernzeit</p>
              <p className="text-foreground text-2xl font-bold">4.2h</p>
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

      {/* Quiz Performance Table */}
      <div className="glass-effect rounded-2xl p-6 shadow-lg">
        <h3 className="text-foreground mb-6 flex items-center text-xl font-bold">
          <BarChart3 className="text-accent mr-3 h-6 w-6" />
          Quiz-Leistung
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-accent/30 border-b">
                <th className="text-muted p-3 text-left font-medium">
                  Auszubildender
                </th>
                <th className="text-muted p-3 text-left font-medium">Quiz</th>
                <th className="text-muted p-3 text-left font-medium">
                  Punktzahl
                </th>
                <th className="text-muted p-3 text-left font-medium">Datum</th>
              </tr>
            </thead>
            <tbody>
              {quizPerformance.map((quiz, index) => (
                <tr
                  key={index}
                  className="border-accent/20 hover:bg-accent/5 border-b"
                >
                  <td className="text-foreground p-3 font-medium">
                    {quiz.trainee}
                  </td>
                  <td className="text-muted p-3">{quiz.quiz}</td>
                  <td className="p-3">
                    <span
                      className={`rounded-full px-3 py-1 text-sm font-medium ${
                        quiz.score >= 80
                          ? 'bg-green-500/20 text-green-400'
                          : quiz.score >= 60
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-red-500/20 text-red-400'
                      }`}
                    >
                      {quiz.score}%
                    </span>
                  </td>
                  <td className="text-muted p-3">{quiz.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
