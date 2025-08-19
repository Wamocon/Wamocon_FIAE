'use client'

import { useRouter } from 'next/navigation'
import { Users, TrendingUp, Clock, AlertTriangle, BookOpen, Target, BarChart3, PieChart } from 'lucide-react'
import { mockData } from '@/lib/supabase'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'

interface TrainerDashboardProps {
  onNavigation: (view: string, data?: any) => void
}

export default function TrainerDashboard({ onNavigation }: TrainerDashboardProps) {
  const router = useRouter()
  
  const trainees = mockData.trainees
  const pendingReviews = mockData.quizSubmissions.filter(sub => sub.status === 'submitted').length

  // Chart data
  const progressData = [
    { month: 'Jan', trainees: 12, progress: 65 },
    { month: 'Feb', trainees: 15, progress: 72 },
    { month: 'Mar', trainees: 18, progress: 78 },
    { month: 'Apr', trainees: 20, progress: 82 },
    { month: 'Mai', trainees: 22, progress: 85 },
    { month: 'Jun', trainees: 25, progress: 88 }
  ]

  const monthlyProgress = [
    { name: 'HTML/CSS', completed: 85, inProgress: 10, notStarted: 5 },
    { name: 'JavaScript', completed: 70, inProgress: 20, notStarted: 10 },
    { name: 'React', completed: 55, inProgress: 30, notStarted: 15 },
    { name: 'Node.js', completed: 40, inProgress: 35, notStarted: 25 },
    { name: 'Datenbanken', completed: 60, inProgress: 25, notStarted: 15 }
  ]

  const quizPerformance = [
    { trainee: 'Elias Felsing', quiz: 'HTML Grundlagen', score: 95, date: '2025-01-15' },
    { trainee: 'Anna Schmidt', quiz: 'CSS Layouts', score: 88, date: '2025-01-14' },
    { trainee: 'Max Weber', quiz: 'JavaScript Basics', score: 92, date: '2025-01-13' },
    { trainee: 'Lisa Müller', quiz: 'React Hooks', score: 78, date: '2025-01-12' },
    { trainee: 'Tom Fischer', quiz: 'Node.js Intro', score: 85, date: '2025-01-11' }
  ]

  const handleTraineeClick = (traineeId: string) => {
    onNavigation('trainees', { traineeId })
  }

  return (
    <div className="p-6 space-y-6 bg-gradient-to-br from-background via-red-900/30 to-red-800/40 min-h-screen relative">
      {/* Enhanced red background overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-red-900/20 via-red-800/15 to-red-900/25 pointer-events-none rounded-3xl"></div>
      <div className="relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-8">
          {/* Action Required Section - Textual Information Above Charts */}
          <div className="glass-effect p-6 rounded-2xl shadow-lg">
            <h3 className="text-xl font-bold text-foreground mb-6 flex items-center">
              <AlertTriangle className="w-6 h-6 mr-3 text-primary" />
              Aktion erforderlich
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-background/50 p-6 rounded-xl border border-border/50">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-semibold text-foreground">Quiz-Reviews</h4>
                  <span className="text-2xl font-bold text-primary">{pendingReviews}</span>
                </div>
                <p className="text-sm text-muted-foreground">Warten auf Bewertung</p>
                <button className="mt-3 px-4 py-2 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors text-sm">
                  Jetzt bewerten
                </button>
              </div>
              
              <div className="bg-background/50 p-6 rounded-xl border border-border/50">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-semibold text-foreground">Reflektionen</h4>
                  <span className="text-2xl font-bold text-accent">12</span>
                </div>
                <p className="text-sm text-muted-foreground">Neue Einreichungen</p>
                <button className="mt-3 px-4 py-2 bg-accent text-accent-foreground rounded-xl hover:bg-accent/90 transition-colors text-sm">
                  Anzeigen
                </button>
              </div>
            </div>
          </div>

          {/* Trainee Overview Section - Textual Information Above Charts */}
          <div className="glass-effect p-6 rounded-2xl shadow-lg">
            <h3 className="text-xl font-bold text-foreground mb-6 flex items-center">
              <Users className="w-6 h-6 mr-3 text-accent" />
              Auszubildenden-Übersicht
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-background/50 p-6 rounded-xl border border-border/50 text-center">
                <Users className="w-8 h-8 text-accent mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Aktive Azubis</p>
                <p className="text-2xl font-bold text-foreground">{trainees.length}</p>
              </div>
              
              <div className="bg-background/50 p-6 rounded-xl border border-border/50 text-center">
                <TrendingUp className="w-8 h-8 text-primary mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Ø Fortschritt</p>
                <p className="text-2xl font-bold text-foreground">
                  {Math.round(trainees.reduce((acc, t) => acc + (t.progress || 0), 0) / trainees.length)}%
                </p>
              </div>
              
              <div className="bg-background/50 p-6 rounded-xl border border-border/50 text-center">
                <Clock className="w-8 h-8 text-accent mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Offene Reviews</p>
                <p className="text-2xl font-bold text-foreground">{pendingReviews}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar - Charts */}
        <div className="space-y-8">
          {/* Overall Progress Chart */}
          <div className="glass-effect p-6 rounded-2xl shadow-lg">
            <h3 className="font-bold text-lg text-foreground mb-4 flex items-center">
              <TrendingUp className="w-6 h-6 mr-3 text-accent" />
              Gesamtfortschritt
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={progressData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#6b7280" strokeOpacity={0.3} />
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
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)'
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

          {/* Quiz Performance Chart */}
          <div className="glass-effect p-6 rounded-2xl shadow-lg">
            <h3 className="font-bold text-lg text-foreground mb-4 flex items-center">
              <Target className="w-6 h-6 mr-3 text-primary" />
              Quiz-Leistung
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={quizPerformance}>
                <CartesianGrid strokeDasharray="3 3" stroke="#6b7280" strokeOpacity={0.3} />
                <XAxis 
                  dataKey="trainee" 
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
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)'
                  }}
                />
                <Bar 
                  dataKey="score" 
                  fill="#dc2626"
                  radius={[4, 4, 0, 0]}
                  stroke="#ffffff"
                  strokeWidth={1}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Individual Progress Chart */}
          <div className="glass-effect p-6 rounded-2xl shadow-lg">
            <h3 className="font-bold text-lg text-foreground mb-4 flex items-center">
              <BarChart3 className="w-6 h-6 mr-3 text-accent" />
              Einzelner Fortschritt
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyProgress}>
                <CartesianGrid strokeDasharray="3 3" stroke="#6b7280" strokeOpacity={0.3} />
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
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)'
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
      </div>
      </div>
    </div>
  )
}
