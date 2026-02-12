'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
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
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
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

// Types for dashboard data
type DashboardData = {
  modules: any[];
  nextItem: {
    lessonId: string;
    lessonTitle: string;
    moduleTitle: string;
    estimatedTime: string;
  } | null;
  weeklyProgress: any[];
  skillRadar: any[];
  achievements: any[];
  deadlines: any[];
};

// Cache helpers for instant dashboard loading
const TRAINEE_DASHBOARD_CACHE_KEY = 'wmc_trainee_dashboard_cache';
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes (increased from 5)

const getCachedDashboard = (): DashboardData | null => {
  try {
    const cached = localStorage.getItem(TRAINEE_DASHBOARD_CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) return data;
    }
  } catch (_) {}
  return null;
};

const setCachedDashboard = (data: DashboardData) => {
  try {
    localStorage.setItem(
      TRAINEE_DASHBOARD_CACHE_KEY,
      JSON.stringify({ data, timestamp: Date.now() })
    );
  } catch (_) {}
};

export default function TraineeDashboard() {
  const router = useRouter();
  const { profile } = useAuth();
  const { t } = useLanguage();

  const [mounted, setMounted] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [nextLesson, setNextLesson] = useState<{
    id: string;
    title: string;
    module: string;
    estimatedTime: string;
  } | null>(null);
  const [modules, setModules] = useState<any[]>([]);
  const [weeklyProgress, setWeeklyProgress] = useState<any[]>([]);
  const [skillRadar, setSkillRadar] = useState<any[]>([]);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [deadlines, setDeadlines] = useState<any[]>([]);

  // Apply cached or fresh dashboard data to state
  const applyDashboardData = (data: DashboardData) => {
    setModules(Array.isArray(data.modules) ? data.modules : []);
    setWeeklyProgress(
      Array.isArray(data.weeklyProgress) ? data.weeklyProgress : []
    );
    setSkillRadar(Array.isArray(data.skillRadar) ? data.skillRadar : []);
    setAchievements(Array.isArray(data.achievements) ? data.achievements : []);
    setDeadlines(Array.isArray(data.deadlines) ? data.deadlines : []);
    if (data.nextItem) {
      setNextLesson({
        id: data.nextItem.lessonId,
        title: data.nextItem.lessonTitle,
        module: data.nextItem.moduleTitle,
        estimatedTime: data.nextItem.estimatedTime,
      });
    } else {
      setNextLesson(null);
    }
  };

  useEffect(() => {
    setMounted(true);
    // Load cached data immediately on mount
    const cached = getCachedDashboard();
    if (cached) {
      applyDashboardData(cached);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!profile?.id) {
        setFetching(false);
        return;
      }
      setFetching(true);
      setDataError(null);
      try {
        const res = await fetch(`/api/trainee/dashboard?userId=${profile.id}`);
        if (!res.ok) {
          const errText = await res.text().catch(() => 'Unknown error');
          console.error('Dashboard API error:', res.status, errText);
          setDataError(`${t('dashboard.error.loading')} ${res.status}`);
          setFetching(false);
          return;
        }
        const data = await res.json();

        // Update state and cache
        applyDashboardData(data);
        setCachedDashboard(data);
      } catch (e) {
        console.error(e);
        setDataError(t('dashboard.error.network'));
      } finally {
        setFetching(false);
      }
    };
    load();
  }, [profile?.id]);

  // Don't render until mounted (SSR fix)
  if (!mounted) return null;

  // Derived module progress for charts

  const moduleProgress = modules.map((module: any) => ({
    name:
      module.title.length > 20
        ? module.title.substring(0, 20) + '...'
        : module.title,
    progress: module.progress ?? 0,
    color:
      (module.progress ?? 0) > 70
        ? '#ef4444'
        : (module.progress ?? 0) > 40
          ? '#dc2626'
          : '#3c2846',
  }));

  const handleModuleClick = (moduleId: string) => {
    router.push(`/trainee/modules/${moduleId}`);
  };

  const handleLessonClick = (lessonId: string) => {
    // Redirect to enabler detail for ongoing item
    router.push(`/trainee/enablers/${lessonId}`);
  };

  const handleNavigation = (view: string, data?: any) => {
    switch (view) {
      case 'modules':
        if (data?.moduleId) {
          router.push(`/trainee/modules/${data.moduleId}`);
        } else {
          router.push('/trainee/modules');
        }
        break;
      case 'lessons':
        if (data?.lessonId) {
          router.push(`/trainee/trainer-feedback/${data.lessonId}`);
        } else {
          router.push('/trainee/trainer-feedback');
        }
        break;
      case 'quizzes':
        if (data?.quizId) {
          router.push(`/trainee/quizzes/${data.quizId}`);
        } else {
          router.push('/trainee/quizzes');
        }
        break;
      case 'dashboard':
        router.push('/trainee/dashboard');
        break;
      default:
        console.log('Navigation:', view, data);
    }
  };

  return (
    <div className="from-background relative min-h-full space-y-6 bg-gradient-to-br via-red-900/30 to-red-800/40 p-6">
      {/* Enhanced red background overlay */}
      <div className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-br from-red-900/20 via-red-800/15 to-red-900/25"></div>
      <div className="relative z-10">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* Continue Learning Card */}
            <div
              className="glass-effect-enhanced border-accent/40 hover:border-accent/70 hover:shadow-accent/20 transform cursor-pointer rounded-2xl border-2 p-6 shadow-2xl transition-all duration-300 hover:-translate-y-1"
              onClick={() => nextLesson && handleLessonClick(nextLesson.id)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-accent mb-3 text-sm font-bold tracking-wider uppercase">
                    {t('dashboard.continueLearning').toUpperCase()}
                  </h3>
                  <p className="text-foreground text-2xl leading-tight font-bold">
                    {nextLesson
                      ? nextLesson.title
                      : t('dashboard.keepLearning')}
                  </p>
                  <p className="text-muted-foreground mt-2">
                    {t('dashboard.module')}{' '}
                    {nextLesson ? nextLesson.module : '-'}
                  </p>
                </div>
                <div className="from-accent to-primary flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br shadow-lg">
                  <Play className="text-foreground h-8 w-8" />
                </div>
              </div>
              <div className="text-accent mt-4 flex items-center">
                <Clock className="mr-2 h-4 w-4" />
                <span className="text-sm font-medium">
                  {nextLesson ? nextLesson.estimatedTime : ''}
                </span>
              </div>
            </div>

            {/* Learning Path Section - Textual Information Above Charts */}
            <div className="glass-effect-enhanced border-accent/30 rounded-2xl border-2 p-6 shadow-2xl">
              <h3 className="text-foreground mb-6 flex items-center text-xl font-bold">
                <div className="from-accent to-primary mr-4 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br">
                  <BookOpen className="text-foreground h-5 w-5" />
                </div>
                {t('dashboard.myLearningPath')}
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {modules.map((module: any) => (
                  <div
                    key={module.id}
                    className="from-background/80 hover:from-background/90 border-accent/20 hover:border-accent/40 group cursor-pointer rounded-xl border bg-gradient-to-br to-red-900/10 p-5 shadow-lg transition-all duration-300 hover:to-red-900/20 hover:shadow-xl"
                    onClick={() => handleModuleClick(module.id)}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-foreground group-hover:text-accent text-lg font-bold transition-colors">
                        {module.title}
                      </h3>
                      <ArrowRight className="text-accent/60 group-hover:text-accent h-5 w-5 transition-colors" />
                    </div>
                    <p className="text-muted-foreground mb-3 text-sm">
                      {t('dashboard.progress')}
                    </p>
                    <div className="bg-muted/50 h-3 w-full overflow-hidden rounded-full">
                      <div
                        className="from-accent to-primary h-3 rounded-full bg-gradient-to-r shadow-lg transition-all duration-700"
                        style={{ width: `${module.progress ?? 0}%` }}
                      />
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-muted-foreground text-sm">
                        0% → {module.progress ?? 0}%
                      </span>
                      <span className="text-accent text-lg font-bold">
                        {module.progress ?? 0}%
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
                  <Award className="text-foreground h-4 w-4" />
                </div>
                {t('dashboard.recentAchievements')}
              </h3>
              <div className="space-y-3">
                {achievements.length === 0 && (
                  <div className="text-muted-foreground">
                    {t('dashboard.noActivities')}
                  </div>
                )}
                {achievements.map((a, idx) => (
                  <div
                    key={idx}
                    className="from-background/60 border-accent/20 hover:border-accent/40 flex items-center justify-between rounded-xl border bg-gradient-to-r to-red-900/10 p-4 transition-colors"
                  >
                    <span className="text-foreground font-medium">
                      {a.text}
                    </span>
                    <div className="bg-accent/20 flex h-8 w-8 items-center justify-center rounded-full">
                      {a.kind === 'quiz' && (
                        <Award className="text-accent h-4 w-4" />
                      )}
                      {a.kind === 'module' && (
                        <BookOpen className="h-4 w-4 text-green-400" />
                      )}
                      {a.kind === 'streak' && (
                        <TrendingUp className="h-4 w-4 text-blue-400" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Upcoming Deadlines Section - Textual Information Above Charts */}
            <div className="glass-effect border-accent/20 rounded-2xl border p-6 shadow-lg">
              <h3 className="text-foreground mb-4 flex items-center text-lg font-bold">
                <div className="mr-3 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-red-500 to-pink-500">
                  <Calendar className="text-foreground h-4 w-4" />
                </div>
                {t('dashboard.upcomingDeadlines')}
              </h3>
              <div className="space-y-3">
                {deadlines.length === 0 && (
                  <div className="text-muted-foreground">
                    {t('dashboard.noDeadlines')}
                  </div>
                )}
                {deadlines.map((d, idx) => (
                  <div
                    key={idx}
                    className="from-background/60 border-accent/20 hover:border-accent/40 flex items-center justify-between rounded-xl border bg-gradient-to-r to-red-900/10 p-4 transition-colors"
                  >
                    <span className="text-foreground font-medium">
                      {d.label}: {new Date(d.dueDate).toLocaleDateString()}
                    </span>
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/20">
                      <Calendar className="h-4 w-4 text-purple-400" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Sidebar - Charts */}
          <div className="space-y-6">
            {/* Weekly Progress Chart */}
            <div className="glass-effect-enhanced border-accent/30 rounded-2xl border-2 p-6 shadow-2xl">
              <h3 className="text-foreground mb-4 flex items-center text-lg font-bold">
                <div className="from-accent to-primary mr-3 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br">
                  <BarChart3 className="text-foreground h-4 w-4" />
                </div>
                {t('dashboard.weeklyProgress')}
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
                    stroke="currentColor"
                    fontSize={12}
                    tick={{ fill: 'currentColor' }}
                  />
                  <YAxis
                    stroke="currentColor"
                    fontSize={12}
                    tick={{ fill: 'currentColor' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e1423',
                      border: '2px solid #ff1a1a',
                      borderRadius: '12px',
                      color: 'currentColor',
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
                      stroke: 'currentColor',
                    }}
                    activeDot={{ r: 8, stroke: 'currentColor', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
              {/* Compact data display */}
              <div className="mt-4 grid grid-cols-3 gap-2">
                {weeklyProgress.map((item: any, index: number) => (
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
                  <Target className="text-foreground h-4 w-4" />
                </div>
                {t('dashboard.skills')}
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
                    stroke="currentColor"
                    fontSize={11}
                    tick={{ fill: 'currentColor' }}
                  />
                  <PolarRadiusAxis
                    stroke="currentColor"
                    fontSize={10}
                    tick={{ fill: 'currentColor' }}
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
                {skillRadar.map((item: any, index: number) => (
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
                  <PieChart className="text-foreground h-4 w-4" />
                </div>
                {t('dashboard.moduleProgress')}
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
                    stroke="currentColor"
                    fontSize={10}
                    angle={-45}
                    textAnchor="end"
                    height={60}
                    tick={{ fill: 'currentColor' }}
                  />
                  <YAxis
                    stroke="currentColor"
                    fontSize={10}
                    tick={{ fill: 'currentColor' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e1423',
                      border: '2px solid #ff1a1a',
                      borderRadius: '12px',
                      color: 'currentColor',
                      boxShadow: '0 8px 24px rgba(255, 26, 26, 0.3)',
                    }}
                  />
                  <Bar
                    dataKey="progress"
                    fill="#ff1a1a"
                    radius={[4, 4, 0, 0]}
                    stroke="currentColor"
                    strokeWidth={1}
                  />
                </BarChart>
              </ResponsiveContainer>
              {/* Compact module progress display */}
              <div className="mt-4 space-y-2">
                {moduleProgress.map((item: any, index: number) => (
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
