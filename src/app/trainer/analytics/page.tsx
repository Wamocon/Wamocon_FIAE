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
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-accent/30 border-t-accent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Lade Analysen...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-destructive/30 border-t-destructive rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Benutzer nicht gefunden...</p>
        </div>
      </div>
    );
  }

  if (profile.role !== 'trainer') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-destructive/30 border-t-destructive rounded-full animate-spin mx-auto mb-4"></div>
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
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30">
        <div className="flex items-center gap-6 mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-accent to-primary rounded-3xl flex items-center justify-center">
            <BarChart3 className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
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
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="glass-effect rounded-3xl p-6 shadow-lg border border-accent/30">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-accent to-primary rounded-2xl flex items-center justify-center">
              <Users className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-muted">Aktive Azubis</p>
              <p className="text-2xl font-bold text-foreground">
                {trainees.length}
              </p>
            </div>
          </div>
        </div>

        <div className="glass-effect rounded-3xl p-6 shadow-lg border border-accent/30">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-emerald-500 rounded-2xl flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-muted">Ø Fortschritt</p>
              <p className="text-2xl font-bold text-foreground">
                {Math.round(
                  trainees.reduce((acc, t) => acc + (t.progress || 0), 0) /
                    trainees.length
                )}
                %
              </p>
            </div>
          </div>
        </div>

        <div className="glass-effect rounded-3xl p-6 shadow-lg border border-accent/30">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-violet-500 rounded-2xl flex items-center justify-center">
              <Award className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-muted">Quiz abgeschlossen</p>
              <p className="text-2xl font-bold text-foreground">
                {quizSubmissions.length}
              </p>
            </div>
          </div>
        </div>

        <div className="glass-effect rounded-3xl p-6 shadow-lg border border-accent/30">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl flex items-center justify-center">
              <Clock className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-muted">Ø Lernzeit</p>
              <p className="text-2xl font-bold text-foreground">4.2h</p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Progress Over Time */}
        <div className="glass-effect p-6 rounded-2xl shadow-lg">
          <h3 className="text-xl font-bold text-foreground mb-6 flex items-center">
            <TrendingUp className="w-6 h-6 mr-3 text-accent" />
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
        <div className="glass-effect p-6 rounded-2xl shadow-lg">
          <h3 className="text-xl font-bold text-foreground mb-6 flex items-center">
            <Target className="w-6 h-6 mr-3 text-primary" />
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
      <div className="glass-effect p-6 rounded-2xl shadow-lg">
        <h3 className="text-xl font-bold text-foreground mb-6 flex items-center">
          <BarChart3 className="w-6 h-6 mr-3 text-accent" />
          Quiz-Leistung
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-accent/30">
                <th className="text-left p-3 text-muted font-medium">
                  Auszubildender
                </th>
                <th className="text-left p-3 text-muted font-medium">Quiz</th>
                <th className="text-left p-3 text-muted font-medium">
                  Punktzahl
                </th>
                <th className="text-left p-3 text-muted font-medium">Datum</th>
              </tr>
            </thead>
            <tbody>
              {quizPerformance.map((quiz, index) => (
                <tr
                  key={index}
                  className="border-b border-accent/20 hover:bg-accent/5"
                >
                  <td className="p-3 text-foreground font-medium">
                    {quiz.trainee}
                  </td>
                  <td className="p-3 text-muted">{quiz.quiz}</td>
                  <td className="p-3">
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-medium ${
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
                  <td className="p-3 text-muted">{quiz.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
