'use client';

import { useRouter } from 'next/navigation';
import {
  Award,
  Calendar,
  ArrowRight,
  Play,
  BookOpen,
  Target,
  TrendingUp,
  Clock,
  BarChart3,
  PieChart,
} from 'lucide-react';
import { mockData } from '@/lib/supabase';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts';

interface TraineeDashboardProps {
  onNavigation: (view: string, data?: any) => void;
}

export default function TraineeDashboard({
  onNavigation,
}: TraineeDashboardProps) {
  const router = useRouter();

  // Use mock data from supabase
  const nextLesson = {
    id: 'les_1_2_1',
    title: 'Variablen, Datentypen und Operatoren',
    module: 'Variablen und Datentypen',
    estimatedTime: '45 min',
  };

  const modules = mockData.curriculum;

  // Chart data
  const weeklyProgress = [
    { week: 'W1', progress: 15 },
    { week: 'W2', progress: 28 },
    { week: 'W3', progress: 42 },
    { week: 'W4', progress: 55 },
    { week: 'W5', progress: 68 },
    { week: 'W6', progress: 75 },
  ];

  const skillRadar = [
    { skill: 'HTML/CSS', value: 85 },
    { skill: 'JavaScript', value: 72 },
    { skill: 'React', value: 68 },
    { skill: 'Node.js', value: 45 },
    { skill: 'Datenbanken', value: 78 },
    { skill: 'Git', value: 82 },
  ];

  const moduleProgress = modules.map(module => ({
    name:
      module.title.length > 20
        ? module.title.substring(0, 20) + '...'
        : module.title,
    progress: module.progress,
    color:
      module.progress > 70
        ? '#ef4444'
        : module.progress > 40
          ? '#dc2626'
          : '#3c2846',
  }));

  const handleModuleClick = (moduleId: string) => {
    onNavigation('modules', { moduleId });
  };

  const handleLessonClick = (lessonId: string) => {
    onNavigation('lessons', { lessonId });
  };

  return (
    <div className="from-background relative min-h-screen space-y-6 bg-gradient-to-br via-red-900/30 to-red-800/40 p-6">
      {/* Enhanced red background overlay */}
      <div className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-br from-red-900/20 via-red-800/15 to-red-900/25"></div>
      <div className="relative z-10">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* Continue Learning Card */}
            <div
              className="glass-effect-enhanced border-accent/40 hover:border-accent/70 hover:shadow-accent/20 transform cursor-pointer rounded-2xl border-2 p-6 shadow-2xl transition-all duration-300 hover:-translate-y-1"
              onClick={() => handleLessonClick(nextLesson.id)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-accent mb-3 text-sm font-bold tracking-wider uppercase">
                    WEITERMACHEN
                  </h3>
                  <p className="text-foreground text-2xl leading-tight font-bold">
                    {nextLesson.title}
                  </p>
                  <p className="text-muted-foreground mt-2">
                    Modul: {nextLesson.module}
                  </p>
                </div>
                <div className="from-accent to-primary flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br shadow-lg">
                  <Play className="h-8 w-8 text-white" />
                </div>
              </div>
              <div className="text-accent mt-4 flex items-center">
                <Clock className="mr-2 h-4 w-4" />
                <span className="text-sm font-medium">
                  {nextLesson.estimatedTime}
                </span>
              </div>
            </div>

            {/* Learning Path Section - Textual Information Above Charts */}
            <div className="glass-effect-enhanced border-accent/30 rounded-2xl border-2 p-6 shadow-2xl">
              <h3 className="text-foreground mb-6 flex items-center text-xl font-bold">
                <div className="from-accent to-primary mr-4 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br">
                  <BookOpen className="h-5 w-5 text-white" />
                </div>
                Mein Lernpfad
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {modules.map(module => (
                  <div
                    key={module.moduleId}
                    className="from-background/80 hover:from-background/90 border-accent/20 hover:border-accent/40 group cursor-pointer rounded-xl border bg-gradient-to-br to-red-900/10 p-5 shadow-lg transition-all duration-300 hover:to-red-900/20 hover:shadow-xl"
                    onClick={() => handleModuleClick(module.moduleId)}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-foreground group-hover:text-accent text-lg font-bold transition-colors">
                        {module.title}
                      </h3>
                      <ArrowRight className="text-accent/60 group-hover:text-accent h-5 w-5 transition-colors" />
                    </div>
                    <p className="text-muted-foreground mb-3 text-sm">
                      Fortschritt
                    </p>
                    <div className="bg-muted/50 h-3 w-full overflow-hidden rounded-full">
                      <div
                        className="from-accent to-primary h-3 rounded-full bg-gradient-to-r shadow-lg transition-all duration-700"
                        style={{ width: `${module.progress}%` }}
                      />
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-muted-foreground text-sm">
                        0% → {module.progress}%
                      </span>
                      <span className="text-accent text-lg font-bold">
                        {module.progress}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Achievements Section - Textual Information Above Charts */}
            <div className="glass-effect border-accent/20 rounded-2xl border p-6 shadow-lg">
              <h3 className="text-foreground mb-4 flex items-center text-lg font-bold">
                <div className="mr-3 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-yellow-500 to-orange-500">
                  <Award className="h-4 w-4 text-white" />
                </div>
                Letzte Erfolge
              </h3>
              <div className="space-y-3">
                <div className="from-background/60 border-accent/20 hover:border-accent/40 flex items-center justify-between rounded-xl border bg-gradient-to-r to-red-900/10 p-4 transition-colors">
                  <span className="text-foreground font-medium">
                    90% im Quiz "Grundbegriffe"
                  </span>
                  <div className="bg-accent/20 flex h-8 w-8 items-center justify-center rounded-full">
                    <Award className="text-accent h-4 w-4" />
                  </div>
                </div>
                <div className="from-background/60 border-accent/20 hover:border-accent/40 flex items-center justify-between rounded-xl border bg-gradient-to-r to-red-900/10 p-4 transition-colors">
                  <span className="text-foreground font-medium">
                    Modul "HTML/CSS" abgeschlossen
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/20">
                    <BookOpen className="h-4 w-4 text-green-400" />
                  </div>
                </div>
                <div className="from-background/60 border-accent/20 hover:border-accent/40 flex items-center justify-between rounded-xl border bg-gradient-to-r to-red-900/10 p-4 transition-colors">
                  <span className="text-foreground font-medium">
                    7 Tage in Folge gelernt
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/20">
                    <TrendingUp className="h-4 w-4 text-blue-400" />
                  </div>
                </div>
              </div>
            </div>

            {/* Upcoming Deadlines Section - Textual Information Above Charts */}
            <div className="glass-effect border-accent/20 rounded-2xl border p-6 shadow-lg">
              <h3 className="text-foreground mb-4 flex items-center text-lg font-bold">
                <div className="mr-3 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-red-500 to-pink-500">
                  <Calendar className="h-4 w-4 text-white" />
                </div>
                Anstehende Termine
              </h3>
              <div className="space-y-3">
                <div className="from-background/60 border-accent/20 hover:border-accent/40 flex items-center justify-between rounded-xl border bg-gradient-to-r to-red-900/10 p-4 transition-colors">
                  <span className="text-foreground font-medium">
                    Reflektion Q3: 30.09.2025
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/20">
                    <Calendar className="h-4 w-4 text-purple-400" />
                  </div>
                </div>
                <div className="from-background/60 border-accent/20 hover:border-accent/40 flex items-center justify-between rounded-xl border bg-gradient-to-r to-red-900/10 p-4 transition-colors">
                  <span className="text-foreground font-medium">
                    Quiz "JavaScript": 25.08.2025
                  </span>
                  <div className="bg-accent/20 flex h-8 w-8 items-center justify-center rounded-full">
                    <Target className="text-accent h-4 w-4" />
                  </div>
                </div>
                <div className="from-background/60 border-accent/20 hover:border-accent/40 flex items-center justify-between rounded-xl border bg-gradient-to-r to-red-900/10 p-4 transition-colors">
                  <span className="text-foreground font-medium">
                    Projektabgabe: 15.09.2025
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500/20">
                    <BookOpen className="h-4 w-4 text-orange-400" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Sidebar - Charts */}
          <div className="space-y-6">
            {/* Weekly Progress Chart */}
            <div className="glass-effect-enhanced border-accent/30 rounded-2xl border-2 p-6 shadow-2xl">
              <h3 className="text-foreground mb-4 flex items-center text-lg font-bold">
                <div className="from-accent to-primary mr-3 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br">
                  <BarChart3 className="h-4 w-4 text-white" />
                </div>
                Wöchentlicher Fortschritt
              </h3>
              <ResponsiveContainer
                width="100%"
                height={200}
                className="from-background/40 rounded-xl bg-gradient-to-br to-red-900/10 p-2"
              >
                <LineChart data={weeklyProgress}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#6b7280"
                    strokeOpacity={0.2}
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
                      border: '2px solid #ff1a1a',
                      borderRadius: '12px',
                      color: '#ffffff',
                      boxShadow: '0 8px 24px rgba(255, 26, 26, 0.3)',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="progress"
                    stroke="#ff1a1a"
                    strokeWidth={4}
                    dot={{
                      fill: '#ff1a1a',
                      strokeWidth: 3,
                      r: 6,
                      stroke: '#ffffff',
                    }}
                    activeDot={{ r: 8, stroke: '#ffffff', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
              {/* Compact data display */}
              <div className="mt-4 grid grid-cols-3 gap-2">
                {weeklyProgress.map((item, index) => (
                  <div
                    key={index}
                    className="from-accent/20 to-primary/20 border-accent/30 rounded-lg border bg-gradient-to-br p-2 text-center"
                  >
                    <div className="text-accent text-sm font-bold">
                      {item.week}
                    </div>
                    <div className="text-foreground font-semibold">
                      {item.progress}%
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Skills Radar Chart */}
            <div className="glass-effect-enhanced border-accent/30 rounded-2xl border-2 p-6 shadow-2xl">
              <h3 className="text-foreground mb-4 flex items-center text-lg font-bold">
                <div className="mr-3 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-emerald-500">
                  <Target className="h-4 w-4 text-white" />
                </div>
                Fähigkeiten
              </h3>
              <ResponsiveContainer
                width="100%"
                height={200}
                className="from-background/40 rounded-xl bg-gradient-to-br to-green-900/10 p-2"
              >
                <RadarChart data={skillRadar}>
                  <PolarGrid stroke="#6b7280" strokeOpacity={0.2} />
                  <PolarAngleAxis
                    dataKey="skill"
                    stroke="#ffffff"
                    fontSize={11}
                    tick={{ fill: '#ffffff' }}
                  />
                  <PolarRadiusAxis
                    stroke="#ffffff"
                    fontSize={10}
                    tick={{ fill: '#ffffff' }}
                    axisLine={false}
                  />
                  <Radar
                    name="Skills"
                    dataKey="value"
                    stroke="#ff1a1a"
                    fill="#ff1a1a"
                    fillOpacity={0.3}
                    strokeWidth={3}
                  />
                </RadarChart>
              </ResponsiveContainer>
              {/* Compact skills display */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                {skillRadar.map((item, index) => (
                  <div
                    key={index}
                    className="rounded-lg border border-green-500/30 bg-gradient-to-br from-green-500/20 to-emerald-500/20 p-2 text-center"
                  >
                    <div className="text-xs font-bold text-green-400">
                      {item.skill}
                    </div>
                    <div className="text-foreground text-sm font-semibold">
                      {item.value}/100
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Module Progress Chart */}
            <div className="glass-effect-enhanced border-accent/30 rounded-2xl border-2 p-6 shadow-2xl">
              <h3 className="text-foreground mb-4 flex items-center text-lg font-bold">
                <div className="mr-3 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-500">
                  <PieChart className="h-4 w-4 text-white" />
                </div>
                Modul-Fortschritt
              </h3>
              <ResponsiveContainer
                width="100%"
                height={200}
                className="from-background/40 rounded-xl bg-gradient-to-br to-blue-900/10 p-2"
              >
                <BarChart data={moduleProgress}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#6b7280"
                    strokeOpacity={0.2}
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
                    fontSize={10}
                    tick={{ fill: '#ffffff' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e1423',
                      border: '2px solid #ff1a1a',
                      borderRadius: '12px',
                      color: '#ffffff',
                      boxShadow: '0 8px 24px rgba(255, 26, 26, 0.3)',
                    }}
                  />
                  <Bar
                    dataKey="progress"
                    fill="#ff1a1a"
                    radius={[4, 4, 0, 0]}
                    stroke="#ffffff"
                    strokeWidth={1}
                  />
                </BarChart>
              </ResponsiveContainer>
              {/* Compact module progress display */}
              <div className="mt-4 space-y-2">
                {moduleProgress.map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between rounded-lg border border-blue-500/30 bg-gradient-to-r from-blue-500/20 to-purple-500/20 p-2"
                  >
                    <span className="text-foreground mr-2 flex-1 truncate text-xs font-medium">
                      {item.name}
                    </span>
                    <div className="flex items-center space-x-2">
                      <div className="h-2 w-16 rounded-full bg-blue-500/30">
                        <div
                          className="from-accent to-primary h-2 rounded-full bg-gradient-to-r shadow-lg"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                      <span className="text-accent min-w-[2.5rem] text-right text-sm font-bold">
                        {item.progress}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
