'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  Plus,
  Edit,
  Trash2,
  BookOpen,
  FolderOpen,
  FileText,
  Eye,
  MoreVertical,
  Search,
  Filter,
  Trash,
  Users,
  UserPlus,
} from 'lucide-react';

type CourseCard = {
  id: string;
  title: string;
  year: number | null;
  chapter: number | null;
  examPart: number | null;
  enablersCount: number;
  useCasesCount: number;
  trainersCount?: number;
  traineesCount?: number;
};

export function ContentManagement() {
  const router = useRouter();
  const { profile, isPlatformOwner } = useAuth();
  const { t } = useLanguage();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedYear, setSelectedYear] = useState('all');
  const [selectedExamPart, setSelectedExamPart] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const [courses, setCourses] = useState<CourseCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Quick-add Enabler modal state (course list view)
  const [showAddEnabler, setShowAddEnabler] = useState(false);
  const [activeCourseId, setActiveCourseId] = useState<string | null>(null);
  const [enTitle, setEnTitle] = useState('');
  const [enDescription, setEnDescription] = useState('');
  const [enScenario, setEnScenario] = useState('');
  const [enHint, setEnHint] = useState('');
  const [enPpt, setEnPpt] = useState('');
  const [enVideo, setEnVideo] = useState('');
  type BuilderQuestion = {
    questionText: string;
    options: [string, string, string, string];
    correctIndex: number;
  };
  const [enQuestions, setEnQuestions] = useState<BuilderQuestion[]>([
    { questionText: '', options: ['', '', '', ''], correctIndex: 0 },
  ]);
  const [enSubmitting, setEnSubmitting] = useState(false);
  const [enDuration, setEnDuration] = useState<string>('');
  const [enActive, setEnActive] = useState<boolean>(false);
  // Quick-add Use Case modal state
  const [showAddUseCase, setShowAddUseCase] = useState(false);
  const [ucTitle, setUcTitle] = useState('');
  const [ucDesc, setUcDesc] = useState('');
  const [ucSubmitting, setUcSubmitting] = useState(false);
  const [ucDuration, setUcDuration] = useState<string>('');
  const [ucActive, setUcActive] = useState<boolean>(false);

  type TraineeOption = { id: string; fullName: string; email: string };
  const [showAssign, setShowAssign] = useState(false);
  const [assignQuery, setAssignQuery] = useState('');
  const [assignResults, setAssignResults] = useState<TraineeOption[]>([]);
  const [selectedTrainees, setSelectedTrainees] = useState<TraineeOption[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
  const [assignAllCourses, setAssignAllCourses] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const loadCourses = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (!profile?.id) return;
      if (searchTerm.trim()) params.set('q', searchTerm.trim());
      if (selectedYear) params.set('year', selectedYear);
      if (selectedExamPart) params.set('examPart', selectedExamPart);
      params.set('trainerProfileId', profile.id);
      const res = await fetch(`/api/trainer/courses?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Failed to load content');
      const data = await res.json();
      setCourses(data.courses || []);
    } catch (e: any) {
      setError(e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [profile?.id, searchTerm, selectedYear, selectedExamPart]);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  useEffect(() => {
    if (!showAssign) return;
    const q = assignQuery.trim();
    if (!q) {
      setAssignResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/trainer/profiles?role=TRAINEE&q=${encodeURIComponent(q)}`,
          { signal: controller.signal, cache: 'no-store' }
        );
        if (!res.ok) return;
        const data = await res.json();
        const existing = new Set(selectedTrainees.map(t => t.id));
        setAssignResults(
          (data.profiles || []).filter((p: any) => !existing.has(p.id))
        );
      } catch {
        // Ignore aborted/failed searches
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [assignQuery, selectedTrainees, showAssign]);

  const filteredCurriculum = useMemo(() => courses, [courses]);

  const assignCourseIds = assignAllCourses
    ? filteredCurriculum.map(c => c.id)
    : selectedCourseIds;

  const toggleCourseSelection = (courseId: string) => {
    setSelectedCourseIds(prev =>
      prev.includes(courseId)
        ? prev.filter(id => id !== courseId)
        : [...prev, courseId]
    );
  };

  const handleAssign = async () => {
    if (!profile?.id) {
      setAssignError(t('content.noTrainerProfile'));
      return;
    }
    if (!selectedTrainees.length) {
      setAssignError(t('content.assignSelectTrainee'));
      return;
    }
    if (!assignCourseIds.length) {
      setAssignError(t('content.assignSelectCourse'));
      return;
    }

    setAssignError(null);
    setAssigning(true);
    try {
      for (const courseId of assignCourseIds) {
        for (const trainee of selectedTrainees) {
          const res = await fetch(
            `/api/trainer/courses/${courseId}/members?trainerId=${profile.id}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: trainee.id, role: 'TRAINEE' }),
            }
          );
          if (res.status === 409) continue;
          if (!res.ok) throw new Error(t('content.assignFailed'));
        }
      }
      setShowAssign(false);
      setAssignQuery('');
      setAssignResults([]);
      setSelectedTrainees([]);
      setSelectedCourseIds([]);
      setAssignAllCourses(false);
      await loadCourses();
    } catch (e: any) {
      setAssignError(e?.message || t('content.assignFailed'));
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-foreground mb-2 text-3xl font-bold">
              {t('content.management.title')}
            </h1>
            <p className="text-muted">{t('content.management.description')}</p>
          </div>
          {isPlatformOwner && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setShowAssign(true)}
                className="border-accent/30 text-foreground hover:bg-accent/10 inline-flex cursor-pointer items-center gap-2 rounded-2xl border px-5 py-3 text-sm font-semibold shadow-sm transition-all duration-200 hover:-translate-y-0.5"
              >
                <UserPlus className="h-5 w-5" />
                {t('content.assignCourses')}
              </button>
              <button
                onClick={() => {
                  router.push('/trainer/content-management/new');
                }}
                className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 text-foreground flex transform cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r px-6 py-3 font-semibold shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
              >
                <Plus className="h-5 w-5" />
                {t('content.newCourse')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
        <div className="flex flex-col items-center justify-between gap-4 lg:flex-row">
          {/* Search and Filters */}
          <div className="flex flex-1 flex-col gap-4 sm:flex-row">
            <div className="relative max-w-md flex-1">
              <Search className="text-muted absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2" />
              <input
                type="text"
                placeholder={t('content.searchModules')}
                className="bg-background/50 border-accent/30 focus:ring-accent text-foreground w-full rounded-2xl border py-3 pr-4 pl-10 focus:border-transparent focus:ring-2 focus:outline-none"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>

            <select
              value={selectedYear}
              onChange={e => setSelectedYear(e.target.value)}
              className="bg-background/50 border-accent/30 focus:ring-accent text-foreground rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
            >
              <option value="all">{t('content.allYears')}</option>
              <option value="1">
                {t('content.yearNumber').replace('{number}', '1')}
              </option>
              <option value="2">
                {t('content.yearNumber').replace('{number}', '2')}
              </option>
              <option value="3">
                {t('content.yearNumber').replace('{number}', '3')}
              </option>
            </select>

            <select
              value={selectedExamPart}
              onChange={e => setSelectedExamPart(e.target.value)}
              className="bg-background/50 border-accent/30 focus:ring-accent text-foreground rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
            >
              <option value="all">{t('content.allExamParts')}</option>
              <option value="1">
                {t('content.examPartNumber').replace('{number}', '1')}
              </option>
              <option value="2">
                {t('content.examPartNumber').replace('{number}', '2')}
              </option>
            </select>
          </div>

          {/* View Mode Toggle */}
          <div className="bg-muted/30 flex rounded-2xl p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`cursor-pointer rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 ${
                viewMode === 'grid'
                  ? 'bg-accent text-foreground shadow-sm'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              {t('content.gridView')}
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`cursor-pointer rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 ${
                viewMode === 'list'
                  ? 'bg-accent text-foreground shadow-sm'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              {t('content.listView')}
            </button>
          </div>
        </div>
      </div>

      {/* Content Grid/List */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <LoadingSpinner size="md" />
        </div>
      )}
      {error && <div className="text-red-500">{error}</div>}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredCurriculum.map(course => (
            <div
              key={course.id}
              className="glass-effect border-accent/30 flex h-[420px] cursor-pointer flex-col rounded-3xl border p-6 shadow-lg transition-all duration-300 hover:shadow-xl"
              onClick={() =>
                router.push(`/trainer/content-management/${course.id}/edit`)
              }
              role="button"
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  router.push(`/trainer/content-management/${course.id}/edit`);
                }
              }}
            >
              <div className="mb-4 flex items-start justify-between">
                <div className="from-accent to-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
                  <BookOpen className="text-foreground h-6 w-6" />
                </div>
                <img
                  src="/WMC_Logo_1.png"
                  alt={course.title}
                  className="h-12 w-40 rounded-2xl object-cover"
                />
              </div>

              <h3 className="text-foreground mb-2 line-clamp-3 min-h-[3.5rem] text-xl font-bold">
                {course.title}
              </h3>

              <div className="text-muted mb-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="bg-accent text-foreground rounded-full px-3 py-1 font-medium">
                  {t('content.yearNumber').replace(
                    '{number}',
                    String(course.year ?? '-')
                  )}
                </span>
                <span className="bg-muted/30 text-muted rounded-full px-3 py-1">
                  {t('content.chapterNumber').replace(
                    '{number}',
                    String(course.chapter ?? '-')
                  )}
                </span>
                {course.examPart && (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400">
                    {t('content.examPartNumber').replace(
                      '{number}',
                      String(course.examPart)
                    )}
                  </span>
                )}
              </div>

              <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
                <span className="border-accent/30 bg-accent/10 text-foreground inline-flex items-center gap-1 rounded-full border px-2 py-1">
                  <Users className="h-3.5 w-3.5" />
                  {t('content.assignedTrainers').replace(
                    '{count}',
                    String(course.trainersCount ?? 0)
                  )}
                </span>
                <span className="border-accent/30 bg-accent/10 text-foreground inline-flex items-center gap-1 rounded-full border px-2 py-1">
                  <Users className="h-3.5 w-3.5" />
                  {t('content.assignedTrainees').replace(
                    '{count}',
                    String(course.traineesCount ?? 0)
                  )}
                </span>
              </div>

              <div className="mb-4 flex-1 space-y-3">
                <div className="bg-muted/30 flex items-center justify-between gap-3 rounded-xl p-3">
                  <div className="min-w-0">
                    <h4 className="text-foreground text-sm font-medium">
                      {t('content.lessons')}
                    </h4>
                  </div>
                  <p className="text-muted text-xs">
                    {course.enablersCount} {t('content.topics')}
                  </p>
                  {/* <button
                    onClick={() => {
                      setActiveCourseId(course.id);
                      setEnTitle('');
                      setEnDescription('');
                      setEnScenario('');
                      setEnHint('');
                      setEnPpt('');
                      setEnVideo('');
                      setEnQuestions([{ questionText: '', options: ['', '', '', ''], correctIndex: 0 }]);
                      setEnDuration('');
                      setEnActive(false);
                      setShowAddEnabler(true);
                    }}
                    className="text-accent hover:text-accent/90 text-sm font-medium"
                  >
                    {t('content.add')}
                  </button> */}
                </div>

                <div className="bg-muted/30 flex items-center justify-between gap-3 rounded-xl p-3">
                  <div className="min-w-0">
                    <h4 className="text-foreground text-sm font-medium">
                      {t('content.useCases')}
                    </h4>
                  </div>
                  <p className="text-muted text-xs">
                    {course.useCasesCount} {t('content.tasks')}
                  </p>
                  {/* <button
                    onClick={() => {
                      setActiveCourseId(course.id);
                      setUcTitle('');
                      setUcDesc('');
                      setUcDuration('');
                      setUcActive(false);
                      setShowAddUseCase(true);
                    }}
                    className="text-accent hover:text-accent/90 text-sm font-medium"
                  >
                    {t('content.add')}
                  </button> */}
                </div>
              </div>

              <div className="border-accent/30 flex items-center justify-between gap-2 border-t pt-4">
                <button
                  onClick={e => {
                    e.stopPropagation();
                    router.push(
                      `/trainer/content-management/${course.id}/edit`
                    );
                  }}
                  className="border-accent/30 bg-accent/10 text-foreground hover:bg-accent/20 inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors"
                >
                  <Eye className="h-4 w-4" />
                  {isPlatformOwner ? t('content.edit') : t('content.view')}
                </button>
                {isPlatformOwner && (
                  <button
                    onClick={async e => {
                      e.stopPropagation();
                      if (!window.confirm(t('content.deleteModuleConfirm')))
                        return;
                      const prevCourses = courses;
                      setCourses(prev => prev.filter(c => c.id !== course.id));
                      try {
                        const res = await fetch(
                          `/api/trainer/courses/${course.id}?trainerId=${profile?.id || ''}`,
                          { method: 'DELETE' }
                        );
                        if (!res.ok) throw new Error(t('content.error.delete'));
                      } catch (e: any) {
                        setCourses(prevCourses);
                        toast.error(e?.message || t('content.unknownError'));
                      }
                    }}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-500 transition-colors hover:bg-red-500/20"
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('content.deleteCourse')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredCurriculum.map(course => (
            <div
              key={course.id}
              className="glass-effect border-accent/30 cursor-pointer overflow-hidden rounded-3xl border p-6 shadow-lg"
              onClick={() =>
                router.push(`/trainer/content-management/${course.id}/edit`)
              }
              role="button"
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  router.push(`/trainer/content-management/${course.id}/edit`);
                }
              }}
            >
              {/* Header Row */}
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 flex-1 items-start gap-4">
                  <div className="from-accent to-primary flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br">
                    <BookOpen className="text-foreground h-7 w-7" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-foreground mb-1 text-2xl font-bold break-words">
                      {course.title}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      <span className="bg-accent text-foreground rounded-full px-3 py-1 text-xs font-semibold">
                        {t('content.yearNumber').replace(
                          '{number}',
                          String(course.year ?? '-')
                        )}
                      </span>
                      <span className="bg-muted/30 text-muted rounded-full px-3 py-1 text-xs">
                        {t('content.chapterNumber').replace(
                          '{number}',
                          String(course.chapter ?? '-')
                        )}
                      </span>
                      {course.examPart && (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400">
                          {t('content.examPartNumber').replace(
                            '{number}',
                            String(course.examPart)
                          )}
                        </span>
                      )}
                      <span className="bg-muted/30 text-muted rounded-full px-3 py-1 text-xs">
                        ID {course.id.slice(0, 8)}…
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="border-accent/30 bg-accent/10 text-foreground inline-flex items-center gap-1 rounded-full border px-2 py-1">
                        <Users className="h-3.5 w-3.5" />
                        {t('content.assignedTrainers').replace(
                          '{count}',
                          String(course.trainersCount ?? 0)
                        )}
                      </span>
                      <span className="border-accent/30 bg-accent/10 text-foreground inline-flex items-center gap-1 rounded-full border px-2 py-1">
                        <Users className="h-3.5 w-3.5" />
                        {t('content.assignedTrainees').replace(
                          '{count}',
                          String(course.traineesCount ?? 0)
                        )}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 self-end md:self-auto">
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      router.push(
                        `/trainer/content-management/${course.id}/edit`
                      );
                    }}
                    className="border-accent/30 bg-accent/10 text-foreground hover:bg-accent/20 inline-flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors"
                  >
                    {isPlatformOwner ? t('content.edit') : t('content.view')}
                  </button>
                  {isPlatformOwner && (
                    <button
                      onClick={async e => {
                        e.stopPropagation();
                        if (!window.confirm(t('content.deleteModuleConfirm')))
                          return;
                        const prevCourses = courses;
                        setCourses(prev => prev.filter(c => c.id !== course.id));
                        try {
                          const res = await fetch(
                            `/api/trainer/courses/${course.id}?trainerId=${profile?.id || ''}`,
                            { method: 'DELETE' }
                          );
                          if (!res.ok) throw new Error(t('content.error.delete'));
                        } catch (e: any) {
                          setCourses(prevCourses);
                          toast.error(e?.message || t('content.unknownError'));
                        }
                      }}
                      className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-500 transition-colors hover:bg-red-500/20"
                      aria-label={t('content.deleteCourse')}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t('content.deleteCourse')}
                    </button>
                  )}
                </div>
              </div>

              {/* Stats Row */}
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
                <div className="glass-effect bg-muted/30 flex items-center justify-between rounded-xl p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <FolderOpen className="text-muted h-5 w-5" />
                    <div className="min-w-0">
                      <p className="text-foreground truncate text-sm font-semibold">
                        {t('content.lessons')}
                      </p>
                      <p className="text-muted truncate text-xs">
                        {t('content.topicsInCourse')}
                      </p>
                    </div>
                  </div>
                  <span className="text-foreground text-lg font-bold">
                    {course.enablersCount}
                  </span>
                </div>
                <div className="glass-effect bg-muted/30 flex items-center justify-between rounded-xl p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <FileText className="text-muted h-5 w-5" />
                    <div className="min-w-0">
                      <p className="text-foreground truncate text-sm font-semibold">
                        {t('content.useCases')}
                      </p>
                      <p className="text-muted truncate text-xs">
                        {t('content.tasksInCourse')}
                      </p>
                    </div>
                  </div>
                  <span className="text-foreground text-lg font-bold">
                    {course.useCasesCount}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredCurriculum.length === 0 && (
        <div className="glass-effect border-accent/30 rounded-3xl border p-12 text-center shadow-lg">
          <div className="from-muted to-muted/30 mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br">
            <BookOpen className="text-muted h-10 w-10" />
          </div>
          <h3 className="text-foreground mb-2 text-xl font-semibold">
            {t('content.noCoursesFound')}
          </h3>
          <p className="text-muted mb-6">
            {searchTerm || selectedYear !== 'all'
              ? t('content.tryOtherCriteria')
              : t('content.createFirst')}
          </p>
          {isPlatformOwner && (
            <button
              onClick={() => router.push('/trainer/content-management/new')}
              className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 text-foreground transform rounded-2xl bg-gradient-to-r px-6 py-3 font-medium shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
            >
              {t('content.createNewCourse')}
            </button>
          )}
        </div>
      )}

      {showAssign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => !assigning && setShowAssign(false)}
          />
          <div className="border-accent/30 bg-background/90 relative z-10 w-full max-w-5xl rounded-3xl border p-6 shadow-2xl backdrop-blur">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-foreground text-xl font-semibold">
                  {t('content.assignCoursesTitle')}
                </h2>
                <p className="text-muted-foreground text-xs">
                  {t('content.assignCoursesDesc')}
                </p>
              </div>
              <button
                type="button"
                className="border-accent/30 text-foreground hover:bg-accent/10 inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"
                onClick={() => !assigning && setShowAssign(false)}
              >
                {t('common.close')}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="border-accent/20 bg-background/40 rounded-2xl border p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">
                    {t('content.assignSelectCourses')}
                  </div>
                  <label className="text-muted-foreground flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={assignAllCourses}
                      onChange={e => setAssignAllCourses(e.target.checked)}
                    />
                    {t('content.assignAllCourses')}
                  </label>
                </div>
                <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-2">
                  {filteredCurriculum.map(course => (
                    <label
                      key={course.id}
                      className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2 transition ${
                        assignCourseIds.includes(course.id)
                          ? 'border-accent/40 bg-accent/10'
                          : 'border-accent/10 hover:border-accent/30 hover:bg-accent/5'
                      } ${assignAllCourses ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {course.title}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {t('content.yearNumber').replace(
                            '{number}',
                            String(course.year ?? '-')
                          )}{' '}
                          ·{' '}
                          {t('content.chapterNumber').replace(
                            '{number}',
                            String(course.chapter ?? '-')
                          )}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={assignCourseIds.includes(course.id)}
                        disabled={assignAllCourses}
                        onChange={() => toggleCourseSelection(course.id)}
                      />
                    </label>
                  ))}
                </div>
                <div className="text-muted-foreground mt-3 text-xs">
                  {t('content.assignSelectedCoursesCount').replace(
                    '{count}',
                    String(assignCourseIds.length)
                  )}
                </div>
              </div>

              <div className="border-accent/20 bg-background/40 rounded-2xl border p-4">
                <div className="text-sm font-semibold">
                  {t('content.assignSelectTrainees')}
                </div>
                <div className="relative mt-3">
                  <Search className="text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                  <input
                    value={assignQuery}
                    onChange={e => setAssignQuery(e.target.value)}
                    placeholder={t('content.assignSearchTrainees')}
                    className="border-accent/20 bg-background/60 w-full rounded-xl border py-2 pr-3 pl-9 text-sm"
                  />
                </div>
                <div className="mt-3 max-h-56 space-y-2 overflow-auto pr-2">
                  {assignResults.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setSelectedTrainees(prev => [...prev, p]);
                        setAssignResults(prev =>
                          prev.filter(x => x.id !== p.id)
                        );
                      }}
                      className="border-accent/10 hover:border-accent/30 hover:bg-accent/5 flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {p.fullName}
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                          {p.email}
                        </div>
                      </div>
                      <span className="text-accent border-accent/50 bg-accent/10 hover:bg-accent/20 flex flex-shrink-0 items-center rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap">
                        {t('content.clickToAdd')}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="mt-4">
                  <div className="text-muted-foreground mb-2 text-xs font-semibold">
                    {t('content.assignSelectedTraineesCount').replace(
                      '{count}',
                      String(selectedTrainees.length)
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedTrainees.map(t => (
                      <span
                        key={t.id}
                        className="border-accent/30 bg-accent/10 text-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
                      >
                        {t.fullName}
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            setSelectedTrainees(prev =>
                              prev.filter(x => x.id !== t.id)
                            )
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {assignError && (
              <div className="mt-4 text-sm text-red-500">{assignError}</div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                className="border-accent/30 text-foreground hover:bg-accent/10 inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm"
                onClick={() => !assigning && setShowAssign(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleAssign}
                disabled={assigning}
                className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 text-foreground inline-flex items-center gap-2 rounded-xl bg-gradient-to-r px-5 py-2 text-sm font-semibold shadow-lg disabled:opacity-60"
              >
                <Users className="h-4 w-4" />
                {assigning ? t('content.assigning') : t('content.assignNow')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Enabler Modal (Quick Add from course card) */}
      {showAddEnabler && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !enSubmitting && setShowAddEnabler(false)}
          />
          <div className="border-border bg-background relative z-10 w-full max-w-2xl rounded-xl border p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {t('content.newLesson')}
              </h2>
              <button
                className="border-border rounded-md border px-2 py-1 text-sm"
                onClick={() => !enSubmitting && setShowAddEnabler(false)}
              >
                {t('common.close')}
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t('content.title')}
                </label>
                <input
                  value={enTitle}
                  onChange={e => setEnTitle(e.target.value)}
                  className="border-border bg-background w-full rounded-md border px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t('content.description')}
                </label>
                <textarea
                  value={enDescription}
                  onChange={e => setEnDescription(e.target.value)}
                  className="border-border bg-background w-full rounded-md border px-3 py-2"
                  rows={3}
                  placeholder={t('content.descriptionPlaceholder')}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('content.pptLink')}
                  </label>
                  <input
                    value={enPpt}
                    onChange={e => setEnPpt(e.target.value)}
                    className="border-border bg-background w-full rounded-md border px-3 py-2"
                    placeholder="https://..."
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('content.videoLink')}
                  </label>
                  <input
                    value={enVideo}
                    onChange={e => setEnVideo(e.target.value)}
                    className="border-border bg-background w-full rounded-md border px-3 py-2"
                    placeholder="https://..."
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('content.duration')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={enDuration}
                    onChange={e => setEnDuration(e.target.value)}
                    className="border-border bg-background w-full rounded-md border px-3 py-2"
                    placeholder={t('content.durationPlaceholder')}
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={enActive}
                      onChange={e => setEnActive(e.target.checked)}
                    />
                    <span>{t('content.active')}</span>
                  </label>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t('content.scenario')}
                </label>
                <textarea
                  value={enScenario}
                  onChange={e => setEnScenario(e.target.value)}
                  className="border-border bg-background w-full rounded-md border px-3 py-2"
                  rows={4}
                  placeholder={t('content.scenarioPlaceholder')}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t('content.hint')}
                </label>
                <textarea
                  value={enHint}
                  onChange={e => setEnHint(e.target.value)}
                  className="border-border bg-background w-full rounded-md border px-3 py-2"
                  rows={3}
                  placeholder={t('content.hintPlaceholder')}
                />
              </div>
              <div className="mt-2">
                <div className="mb-2 text-sm font-semibold">
                  {t('content.quizQuestions')}
                </div>
                <div className="max-h-[40vh] space-y-4 overflow-y-auto pr-1">
                  {enQuestions.map((q, qi) => (
                    <div
                      key={qi}
                      className="border-border rounded-lg border p-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-medium">
                          {t('content.questionNumber').replace(
                            '{number}',
                            String(qi + 1)
                          )}
                        </div>
                        <button
                          type="button"
                          className="border-border rounded-md border px-2 py-1 text-xs"
                          onClick={() =>
                            setEnQuestions(prev =>
                              prev.filter((_, i) => i !== qi)
                            )
                          }
                        >
                          {t('content.remove')}
                        </button>
                      </div>
                      <input
                        className="border-border bg-background mt-2 w-full rounded-md border px-3 py-2"
                        placeholder={t('content.questionText')}
                        value={q.questionText}
                        onChange={e =>
                          setEnQuestions(prev =>
                            prev.map((x, i) =>
                              i === qi
                                ? { ...x, questionText: e.target.value }
                                : x
                            )
                          )
                        }
                      />
                      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                        {q.options.map((opt, oi) => (
                          <label key={oi} className="flex items-center gap-2">
                            <input
                              type="radio"
                              name={`correct-${qi}`}
                              checked={q.correctIndex === oi}
                              onChange={() =>
                                setEnQuestions(prev =>
                                  prev.map((x, i) =>
                                    i === qi ? { ...x, correctIndex: oi } : x
                                  )
                                )
                              }
                            />
                            <input
                              className="border-border bg-background flex-1 rounded-md border px-3 py-2"
                              placeholder={t('content.optionNumber').replace(
                                '{number}',
                                String(oi + 1)
                              )}
                              value={opt}
                              onChange={e =>
                                setEnQuestions(prev =>
                                  prev.map((x, i) =>
                                    i === qi
                                      ? {
                                          ...x,
                                          options: x.options.map((o, j) =>
                                            j === oi ? e.target.value : o
                                          ) as [string, string, string, string],
                                        }
                                      : x
                                  )
                                )
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="border-border mt-3 rounded-md border px-3 py-2 text-sm"
                  onClick={() =>
                    setEnQuestions(prev => [
                      ...prev,
                      {
                        questionText: '',
                        options: ['', '', '', ''],
                        correctIndex: 0,
                      },
                    ])
                  }
                >
                  {t('content.addQuestion')}
                </button>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  className="border-border rounded-md border px-4 py-2"
                  type="button"
                  onClick={() => !enSubmitting && setShowAddEnabler(false)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className="bg-primary text-foreground rounded-md px-4 py-2 disabled:opacity-60"
                  disabled={enSubmitting}
                  onClick={async () => {
                    if (!profile?.id) {
                      alert(t('content.noTrainerProfile'));
                      return;
                    }
                    if (!activeCourseId) {
                      alert(t('content.noCourseSelected'));
                      return;
                    }
                    if (!enTitle.trim()) {
                      alert(t('content.enterTitle'));
                      return;
                    }
                    const cleaned = enQuestions
                      .map(q => ({
                        questionText: q.questionText.trim(),
                        options: q.options.map(o => o.trim()) as [
                          string,
                          string,
                          string,
                          string,
                        ],
                        correctIndex: Number(q.correctIndex),
                      }))
                      .filter(q => q.questionText && q.options.every(o => o));
                    setEnSubmitting(true);
                    try {
                      // Create Lesson (active)
                      const res = await fetch(
                        `/api/trainer/courses/${activeCourseId}/enablers?trainerId=${profile.id}`,
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            title: enTitle.trim(),
                            descriptionText: enDescription.trim() || undefined,
                            scenarioText: enScenario.trim() || undefined,
                            hintText: enHint.trim() || undefined,
                            pptUrl: enPpt.trim() || undefined,
                            videoUrl: enVideo.trim() || undefined,
                            durationValue: enDuration
                              ? Number(enDuration)
                              : undefined,
                            durationUnit: enDuration ? 'DAYS' : undefined,
                            isActive: enActive,
                          }),
                        }
                      );
                      if (!res.ok)
                        throw new Error(t('content.error.createLesson'));
                      const data = await res.json();
                      const enablerId = data.enabler?.id;
                      if (!enablerId)
                        throw new Error(t('content.error.missingLessonId'));

                      // Create quiz if defined
                      if (cleaned.length) {
                        const rq = await fetch(
                          `/api/trainer/enablers/${enablerId}/quiz`,
                          {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              title: `Quiz: ${enTitle.trim()}`,
                              createdById: profile.id,
                              questions: cleaned,
                            }),
                          }
                        );
                        if (!rq.ok)
                          throw new Error(t('content.error.saveQuiz'));
                      }

                      // Refresh course list
                      const r = await fetch(
                        `/api/trainer/courses?trainerProfileId=${profile.id}&year=${selectedYear}&q=${encodeURIComponent(searchTerm)}`
                      );
                      const fresh = await r.json();
                      setCourses(fresh.courses || []);

                      setShowAddEnabler(false);
                      setActiveCourseId(null);
                      setEnTitle('');
                      setEnDescription('');
                      setEnScenario('');
                      setEnHint('');
                      setEnPpt('');
                      setEnVideo('');
                      setEnDuration('');
                      setEnActive(false);
                      setEnQuestions([
                        {
                          questionText: '',
                          options: ['', '', '', ''],
                          correctIndex: 0,
                        },
                      ]);
                    } catch (e: any) {
                      alert(e?.message || t('content.unknownError'));
                    } finally {
                      setEnSubmitting(false);
                    }
                  }}
                >
                  {t('content.create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Use Case Modal (Quick Add from course card) */}
      {showAddUseCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !ucSubmitting && setShowAddUseCase(false)}
          />
          <div className="border-border bg-background relative z-10 w-full max-w-xl rounded-xl border p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {t('content.newUseCase')}
              </h2>
              <button
                className="border-border rounded-md border px-2 py-1 text-sm"
                onClick={() => !ucSubmitting && setShowAddUseCase(false)}
              >
                {t('common.close')}
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t('content.title')}
                </label>
                <input
                  value={ucTitle}
                  onChange={e => setUcTitle(e.target.value)}
                  className="border-border bg-background w-full rounded-md border px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t('content.descriptionRequired')}
                </label>
                <textarea
                  value={ucDesc}
                  onChange={e => setUcDesc(e.target.value)}
                  className="border-border bg-background w-full rounded-md border px-3 py-2"
                  rows={4}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('content.duration')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={ucDuration}
                    onChange={e => setUcDuration(e.target.value)}
                    className="border-border bg-background w-full rounded-md border px-3 py-2"
                    placeholder={t('content.durationPlaceholder')}
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={ucActive}
                      onChange={e => setUcActive(e.target.checked)}
                    />
                    <span>{t('content.active')}</span>
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  className="border-border rounded-md border px-4 py-2"
                  type="button"
                  onClick={() => !ucSubmitting && setShowAddUseCase(false)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className="bg-primary text-foreground rounded-md px-4 py-2 disabled:opacity-60"
                  disabled={ucSubmitting}
                  onClick={async () => {
                    if (!profile?.id) {
                      alert(t('content.noTrainerProfile'));
                      return;
                    }
                    if (!activeCourseId) {
                      alert(t('content.noCourseSelected'));
                      return;
                    }
                    if (!ucTitle.trim()) {
                      alert(t('content.enterTitle'));
                      return;
                    }
                    if (!ucDesc.trim()) {
                      alert(t('content.enterDescription'));
                      return;
                    }
                    setUcSubmitting(true);
                    try {
                      const res = await fetch(
                        `/api/trainer/courses/${activeCourseId}/use-cases?trainerId=${profile.id}`,
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            title: ucTitle.trim(),
                            descriptionText: ucDesc.trim(),
                            durationValue: ucDuration
                              ? Number(ucDuration)
                              : undefined,
                            durationUnit: ucDuration ? 'DAYS' : undefined,
                            isActive: ucActive,
                          }),
                        }
                      );
                      if (!res.ok)
                        throw new Error(t('content.error.createUseCase'));

                      // Refresh list
                      const r = await fetch(
                        `/api/trainer/courses?trainerProfileId=${profile.id}&year=${selectedYear}&q=${encodeURIComponent(searchTerm)}`
                      );
                      const fresh = await r.json();
                      setCourses(fresh.courses || []);

                      setShowAddUseCase(false);
                      setActiveCourseId(null);
                      setUcTitle('');
                      setUcDesc('');
                      setUcDuration('');
                      setUcActive(false);
                    } catch (e: any) {
                      alert(e?.message || t('content.unknownError'));
                    } finally {
                      setUcSubmitting(false);
                    }
                  }}
                >
                  {t('content.create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
