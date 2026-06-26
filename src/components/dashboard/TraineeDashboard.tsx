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
  Filter,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import dynamic from 'next/dynamic';

// Lazy-load recharts components (~200KB) - they're not needed for initial render
const WeeklyProgressChart = dynamic(
  () => import('./TraineeDashboardCharts').then(mod => mod.WeeklyProgressChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[200px] items-center justify-center">
        <LoadingSpinner size="sm" />
      </div>
    ),
  }
);
const SkillRadarChart = dynamic(
  () => import('./TraineeDashboardCharts').then(mod => mod.SkillRadarChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[200px] items-center justify-center">
        <LoadingSpinner size="sm" />
      </div>
    ),
  }
);
const ModuleBarChart = dynamic(
  () => import('./TraineeDashboardCharts').then(mod => mod.ModuleBarChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[200px] items-center justify-center">
        <LoadingSpinner size="sm" />
      </div>
    ),
  }
);

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

// Cache helpers for instant dashboard loading (used as placeholderData)
const TRAINEE_DASHBOARD_CACHE_KEY = 'wmc_trainee_dashboard_cache';
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes (increased from 5)

const getDashboardCacheKey = (
  userId: string | undefined,
  durationYears: number | null | undefined
) =>
  `${TRAINEE_DASHBOARD_CACHE_KEY}_${userId || 'anonymous'}_${durationYears || 3}`;

const getCachedDashboard = (cacheKey: string): DashboardData | null => {
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) return data;
    }
  } catch (_) {}
  return null;
};

const setCachedDashboard = (cacheKey: string, data: DashboardData) => {
  try {
    localStorage.setItem(
      cacheKey,
      JSON.stringify({ data, timestamp: Date.now() })
    );
  } catch (_) {}
};

export default function TraineeDashboard() {
  const router = useRouter();
  const { profile } = useAuth();
  const { t } = useLanguage();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Redirect trainee without birth_date to profile completion
  useEffect(() => {
    if (profile?.role === 'trainee' && !profile.birth_date) {
      router.replace('/trainee/profile?required=true');
    }
  }, [profile, router]);

  // ── React Query replaces manual useState + useEffect + fetch ──
  const url = profile?.id
    ? `/api/trainee/dashboard?userId=${profile.id}`
    : null;
  const dashboardCacheKey = getDashboardCacheKey(
    profile?.id,
    profile?.ausbildung_duration_years
  );

  const { data, error: dataError } = useApiQuery<DashboardData>(url, {
    usePrefetch: true,
    placeholderData: () => getCachedDashboard(dashboardCacheKey) ?? undefined,
  });

  // Persist fresh data to localStorage for instant display on next visit
  useEffect(() => {
    if (data) setCachedDashboard(dashboardCacheKey, data);
  }, [dashboardCacheKey, data]);

  // Derive state from the query response
  const modules = data?.modules ?? [];
  const weeklyProgress = data?.weeklyProgress ?? [];
  const skillRadar = data?.skillRadar ?? [];
  const achievements = data?.achievements ?? [];
  const deadlines = data?.deadlines ?? [];
  const nextLesson = data?.nextItem
    ? {
        id: data.nextItem.lessonId,
        title: data.nextItem.lessonTitle,
        module: data.nextItem.moduleTitle,
        estimatedTime: data.nextItem.estimatedTime,
      }
    : null;

  // ── UI State for Module List ──
  const [filter, setFilter] = useState<'all' | 'in_progress' | 'completed'>(
    'all'
  );
  const [visibleCount, setVisibleCount] = useState(6);
  const [visibleModuleProgressCount, setVisibleModuleProgressCount] =
    useState(5);

  // Don't render until mounted (SSR fix)
  if (!mounted) return null;

  // Filter modules
  const filteredModules = modules.filter((m: any) => {
    if (filter === 'all') return true;
    if (filter === 'in_progress') return m.progress > 0 && m.progress < 100;
    if (filter === 'completed') return m.progress === 100;
    return true;
  });

  const displayedModules = filteredModules.slice(0, visibleCount);
  const hasMore = filteredModules.length > visibleCount;

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
              <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <h3 className="text-foreground flex items-center text-xl font-bold">
                  <div className="from-accent to-primary mr-4 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br">
                    <BookOpen className="text-foreground h-5 w-5" />
                  </div>
                  {t('dashboard.myLearningPath')}
                </h3>

                {/* Filter Dropdown/Tabs */}
                <div className="bg-background/40 flex rounded-lg p-1 backdrop-blur-sm">
                  <button
                    onClick={() => setFilter('all')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                      filter === 'all'
                        ? 'bg-accent text-white shadow-md'
                        : 'text-muted-foreground hover:text-foreground hover:bg-white/10'
                    }`}
                  >
                    {t('dashboard.filterAll') || 'Alle'}
                  </button>
                  <button
                    onClick={() => setFilter('in_progress')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                      filter === 'in_progress'
                        ? 'bg-accent text-white shadow-md'
                        : 'text-muted-foreground hover:text-foreground hover:bg-white/10'
                    }`}
                  >
                    {t('dashboard.filterInProgress') || 'In Bearbeitung'}
                  </button>
                  <button
                    onClick={() => setFilter('completed')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                      filter === 'completed'
                        ? 'bg-green-600 text-white shadow-md'
                        : 'text-muted-foreground hover:text-foreground hover:bg-white/10'
                    }`}
                  >
                    {t('dashboard.filterCompleted') || 'Abgeschlossen'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <AnimatePresence mode="popLayout">
                  {displayedModules.map((module: any) => (
                    <motion.div
                      key={module.id}
                      layout
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.2 }}
                      className="from-background/80 hover:from-background/90 border-accent/20 hover:border-accent/40 group cursor-pointer rounded-xl border bg-gradient-to-br to-red-900/10 p-5 shadow-lg transition-all duration-300 hover:to-red-900/20 hover:shadow-xl"
                      onClick={() => handleModuleClick(module.id)}
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-foreground group-hover:text-accent min-w-0 truncate text-lg font-bold transition-colors">
                          {module.title}
                        </h3>
                        <ArrowRight className="text-accent/60 group-hover:text-accent h-5 w-5 transition-colors" />
                      </div>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-muted-foreground text-sm">
                          {t('dashboard.progress')}
                        </p>
                        {module.progress === 100 && (
                          <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-xs font-bold text-green-500">
                            {t('dashboard.filterCompleted')}
                          </span>
                        )}
                      </div>
                      <div className="bg-muted/50 h-3 w-full overflow-hidden rounded-full">
                        <div
                          className={`h-3 rounded-full shadow-lg transition-all duration-700 ${
                            module.progress === 100
                              ? 'bg-gradient-to-r from-green-500 to-emerald-500'
                              : 'from-accent to-primary bg-gradient-to-r'
                          }`}
                          style={{ width: `${module.progress ?? 0}%` }}
                        />
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-muted-foreground text-sm">
                          0% → {module.progress ?? 0}%
                        </span>
                        <span
                          className={`text-lg font-bold ${module.progress === 100 ? 'text-green-500' : 'text-accent'}`}
                        >
                          {module.progress ?? 0}%
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              {/* Show More / Show Less Button */}
              {filteredModules.length > 6 && (
                <div className="mt-6 flex justify-center">
                  <button
                    onClick={() =>
                      setVisibleCount(hasMore ? filteredModules.length : 6)
                    }
                    className="group bg-accent/10 hover:bg-accent/20 border-accent/30 text-accent flex items-center gap-2 rounded-full border px-6 py-2.5 text-sm font-bold transition-all hover:scale-105 active:scale-95"
                  >
                    {hasMore ? (
                      <>
                        {t('dashboard.showMore') || 'Mehr anzeigen'} (
                        {filteredModules.length - visibleCount})
                        <ChevronDown className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
                      </>
                    ) : (
                      <>
                        {t('dashboard.showLess') || 'Weniger anzeigen'}
                        <ChevronUp className="h-4 w-4 transition-transform group-hover:-translate-y-0.5" />
                      </>
                    )}
                  </button>
                </div>
              )}

              {filteredModules.length === 0 && (
                <div className="text-muted-foreground py-12 text-center">
                  <div className="bg-muted/20 mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full">
                    <Filter className="h-6 w-6 opacity-50" />
                  </div>
                  <p>No modules found for this filter.</p>
                </div>
              )}
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
              <WeeklyProgressChart data={weeklyProgress} />
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
              <SkillRadarChart data={skillRadar} />
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
              <ModuleBarChart data={moduleProgress} />
              {/* Compact module progress display */}
              <div className="mt-4 space-y-2">
                <AnimatePresence mode="popLayout">
                  {moduleProgress
                    .slice(0, visibleModuleProgressCount)
                    .map((item: any, index: number) => (
                      <motion.div
                        key={item.name || index}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-center justify-between rounded-lg border border-blue-500/30 bg-gradient-to-r from-blue-500/20 to-purple-500/20 p-2"
                      >
                        <span className="text-foreground mr-2 flex-1 truncate text-xs font-medium">
                          {item.name}
                        </span>
                        <div className="flex items-center space-x-2">
                          <div className="h-2 w-16 rounded-full bg-blue-500/30">
                            <div
                              className="from-accent to-primary h-2 rounded-full bg-gradient-to-r shadow-lg transition-all duration-500"
                              style={{ width: `${item.progress}%` }}
                            />
                          </div>
                          <span className="text-accent min-w-[2.5rem] text-right text-sm font-bold">
                            {item.progress}%
                          </span>
                        </div>
                      </motion.div>
                    ))}
                </AnimatePresence>

                {moduleProgress.length > 5 && (
                  <button
                    onClick={() =>
                      setVisibleModuleProgressCount(
                        visibleModuleProgressCount > 5
                          ? 5
                          : moduleProgress.length
                      )
                    }
                    className="text-accent hover:text-accent/80 flex w-full items-center justify-center gap-1 py-1 text-xs font-bold transition-colors"
                  >
                    {visibleModuleProgressCount > 5 ? (
                      <>
                        {t('dashboard.showLess')}{' '}
                        <ChevronUp className="h-3 w-3" />
                      </>
                    ) : (
                      <>
                        {t('dashboard.showMore')} ({moduleProgress.length - 5}){' '}
                        <ChevronDown className="h-3 w-3" />
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
