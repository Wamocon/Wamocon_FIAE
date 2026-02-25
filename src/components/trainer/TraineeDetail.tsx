'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import toast from 'react-hot-toast';
import {
  FileCheck2,
  TrendingUp,
  Award,
  BookOpen,
  Download,
  Share2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

interface TraineeDetailProps {
  traineeId: string;
}

export default function TraineeDetail({ traineeId }: TraineeDetailProps) {
  const router = useRouter();
  const { profile } = useAuth() as any;
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<
    'overview' | 'progress' | 'submissions' | 'notes'
  >('overview');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trainee, setTrainee] = useState<{
    id: string;
    full_name: string;
    avatar_url?: string | null;
    training_start_date?: string | null;
    assigned_trainer_id?: string | null;
    progress: number;
  } | null>(null);
  const [edit, setEdit] = useState({
    full_name: '',
    avatar_url: '',
    start_of_training_date: '',
  });
  const [saving, setSaving] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [overview, setOverview] = useState<null | {
    stats: {
      progressPct: number;
      completedEnablers: number;
      totalEnablers: number;
      pending: { quizzes: number; useCases: number };
    };
    enablers: Array<{
      id: string;
      title: string;
      courseId: string;
      courseTitle: string;
      completed: boolean;
      isActive: boolean;
      link: string;
    }>;
    useCases: Array<{
      id: string;
      title: string;
      status: string | null;
      isActive: boolean;
      attemptNumber?: number | null;
      link: string;
    }>;
    enablerQuizzes: Array<{
      enablerId: string;
      enablerTitle: string;
      quizId: string;
      difficulty: string;
      lastScore: number | null;
      attemptNumber: number | null;
      isReviewed: boolean | null;
      link: string;
    }>;
    globalQuizzes: Array<{
      quizId: string;
      title: string;
      lastScore: number | null;
      attemptNumber: number | null;
      isReviewed: boolean | null;
      link: string;
    }>;
  }>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/trainer/trainees/${traineeId}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(t('trainee.detail.loadError'));
        const data = await res.json();
        setTrainee(data.trainee);
        setEdit({
          full_name: data.trainee?.full_name || '',
          avatar_url: data.trainee?.avatar_url || '',
          start_of_training_date: data.trainee?.training_start_date
            ? String(data.trainee.training_start_date).slice(0, 10)
            : '',
        });
        // Load overview
        const oRes = await fetch(
          `/api/trainer/trainees/${traineeId}/overview`,
          { cache: 'no-store' }
        );
        if (oRes.ok) {
          const oData = await oRes.json();
          setOverview(oData);
        }
      } catch (e: any) {
        setError(e?.message || t('error.unknown'));
      } finally {
        setLoading(false);
      }
    };
    if (traineeId) load();
  }, [traineeId, t]);

  const generatePdfBlob = async () => {
    // dynamically import to keep bundle small and avoid SSR issues
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]); // A4 portrait in points
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontSizeHeading = 18;
    const fontSize = 12;
    const left = 50;
    let y = 800;

    page.drawText(
      `${t('trainee.detail.pdfTrainee')} ${trainee?.full_name || ''}`,
      { x: left, y, size: fontSizeHeading, font }
    );
    y -= 26;
    page.drawText(`ID: ${trainee?.id || ''}`, {
      x: left,
      y,
      size: fontSize,
      font,
    });
    y -= 18;
    page.drawText(
      `${t('trainee.detail.trainingStart')}: ${trainee?.training_start_date || '—'}`,
      { x: left, y, size: fontSize, font }
    );
    y -= 18;
    page.drawText(
      `${t('trainee.detail.pdfProgress')} ${trainee?.progress ?? 0}%`,
      { x: left, y, size: fontSize, font }
    );
    y -= 26;

    page.drawText(t('trainee.detail.pdfQuickStats'), {
      x: left,
      y,
      size: fontSizeHeading,
      font,
    });
    y -= 22;
    page.drawText(
      `${t('trainee.detail.pdfOverallProgress')} ${trainee?.progress ?? 0}%`,
      { x: left, y, size: fontSize, font }
    );
    y -= 16;
    page.drawText(`${t('trainee.detail.pdfModulesCompleted')} —`, {
      x: left,
      y,
      size: fontSize,
      font,
    });
    y -= 16;
    page.drawText(`${t('trainee.detail.pdfAverage')} 82%`, {
      x: left,
      y,
      size: fontSize,
      font,
    });

    const pdfBytes = await pdfDoc.save();
    // pdfBytes is a Uint8Array - convert to a plain ArrayBuffer slice to satisfy strict BlobPart typing
    const ab = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength
    ) as ArrayBuffer;
    const blob = new Blob([ab], { type: 'application/pdf' });
    return blob;
  };

  const [exporting, setExporting] = useState(false);

  const handleDownloadPdf = async () => {
    try {
      setExporting(true);
      const blob = await generatePdfBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${trainee?.full_name || 'trainee'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || t('trainee.detail.exportError'));
    } finally {
      setExporting(false);
    }
  };

  const handleSharePdf = async () => {
    try {
      setExporting(true);
      const blob = await generatePdfBlob();
      const file = new File([blob], `${trainee?.full_name || 'trainee'}.pdf`, {
        type: 'application/pdf',
      });
      // Use Web Share API if available
      const nav: any = navigator as any;
      if (nav?.canShare && nav.canShare({ files: [file] })) {
        await nav.share({
          files: [file],
          title: `${t('trainee.detail.shareTitle')} ${trainee?.full_name || ''}`,
          text: t('trainee.detail.shareText'),
        });
      } else {
        // Fallback to download
        handleDownloadPdf();
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || t('trainee.detail.shareError'));
    } finally {
      setExporting(false);
    }
  };

  const handleSave = async () => {
    if (!profile?.id || !trainee?.id) return;
    try {
      setSaving(true);
      setError(null);
      const payload: any = {
        trainer_id: profile.id,
        full_name: edit.full_name,
        avatar_url: edit.avatar_url,
      };
      if (edit.start_of_training_date)
        payload.start_of_training_date = edit.start_of_training_date;
      const res = await fetch(`/api/trainer/trainees/${trainee.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(t('trainee.detail.saveError'));
      const data = await res.json();
      setTrainee(prev => ({
        ...prev!,
        full_name: data.trainee.full_name,
        avatar_url: data.trainee.avatar_url,
        training_start_date: data.trainee.training_start_date,
      }));
    } catch (e: any) {
      setError(e?.message || t('error.unknown'));
    } finally {
      setSaving(false);
    }
  };

  const [openSections, setOpenSections] = useState({
    modules: true,
    lessonQuizzes: false,
    useCases: false,
    globalQuizzes: false,
  });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const [enablerFilter, setEnablerFilter] = useState<'all' | 'completed' | 'active' | 'inactive'>('all');
  const [openCourses, setOpenCourses] = useState<Set<string> | null>(null);

  const toggleCourse = (courseTitle: string) => {
    setOpenCourses(prev => {
      const base = prev ?? new Set<string>();
      const next = new Set(base);
      if (next.has(courseTitle)) next.delete(courseTitle);
      else next.add(courseTitle);
      return next;
    });
  };

  const groupedEnablers = useMemo(() => {
    if (!overview?.enablers) return {};
    const filtered = overview.enablers.filter(e => {
      if (enablerFilter === 'completed') return e.completed;
      if (enablerFilter === 'active') return e.isActive && !e.completed;
      if (enablerFilter === 'inactive') return !e.isActive;
      return true;
    });
    return filtered.reduce<Record<string, typeof filtered>>((acc, e) => {
      const key = e.courseTitle || t('trainee.detail.unknownCourse');
      if (!acc[key]) acc[key] = [];
      acc[key].push(e);
      return acc;
    }, {});
  }, [overview?.enablers, enablerFilter, t]);

  // Default: all courses expanded on first load
  useEffect(() => {
    if (openCourses === null && Object.keys(groupedEnablers).length > 0) {
      setOpenCourses(new Set(Object.keys(groupedEnablers)));
    }
  }, [groupedEnablers, openCourses]);

  // Helpers
  const toggleItem = async (
    itemType: 'ENABLER' | 'USE_CASE' | 'GLOBAL_QUIZ',
    itemId: string,
    isActive: boolean
  ) => {
    if (!trainee?.id) return;

    // Optimistic update
    setOverview(prev => {
      if (!prev) return prev;
      const next = { ...prev };
      if (itemType === 'ENABLER') {
        next.enablers = next.enablers.map(e => (e.id === itemId ? { ...e, isActive } : e));
      } else if (itemType === 'USE_CASE') {
        next.useCases = next.useCases.map(u => (u.id === itemId ? { ...u, isActive } : u));
      } else if (itemType === 'GLOBAL_QUIZ') {
        next.globalQuizzes = next.globalQuizzes.map(q => (q.quizId === itemId ? { ...q, isActive } : q));
      }
      return next;
    });

    try {
      const payload: any = { itemType, itemId, isActive };
      if (profile?.role === 'trainer' && profile?.id)
        payload.trainerId = profile.id;

      const res = await fetch(`/api/trainer/trainees/${trainee.id}/activate`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Failed to toggle active state');

      // Background refresh to ensure consistency
      const oRes = await fetch(`/api/trainer/trainees/${trainee.id}/overview`, {
        cache: 'no-store',
      });
      if (oRes.ok) {
        const oData = await oRes.json();
        setOverview(oData);
      }
    } catch (e) {
      console.error(e);
      toast.error(t('error.unknown'));
      // Revert: full reload on error
      const oRes = await fetch(`/api/trainer/trainees/${trainee.id}/overview`, {
        cache: 'no-store',
      });
      if (oRes.ok) {
        const oData = await oRes.json();
        setOverview(oData);
      }
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-8 p-6">
        {/* Skeleton header */}
        <div className="glass-effect border-accent/30 animate-pulse rounded-3xl border p-8 shadow-lg">
          <div className="flex items-center gap-6">
            <div className="bg-muted h-24 w-24 rounded-3xl" />
            <div className="space-y-3">
              <div className="bg-muted h-8 w-48 rounded-lg" />
              <div className="bg-muted h-4 w-32 rounded-lg" />
            </div>
          </div>
        </div>
        {/* Skeleton sections */}
        <div className="glass-effect border-accent/30 animate-pulse rounded-3xl border p-6 shadow-lg">
          <div className="space-y-4 p-8">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="border-accent/20 rounded-2xl border p-4">
                <div className="bg-muted h-6 w-40 rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-6">
            <div className="relative">
              {trainee?.avatar_url ? (
                <Image
                  src={trainee.avatar_url}
                  alt={trainee.full_name}
                  width={96}
                  height={96}
                  className="border-accent/30 h-24 w-24 rounded-3xl border-4 object-cover shadow-lg"
                />
              ) : (
                <div className="border-accent/30 bg-muted text-muted flex h-24 w-24 items-center justify-center rounded-3xl border-4 shadow-lg">
                  <TrendingUp className="h-6 w-6" />
                </div>
              )}
              <div className="absolute -right-2 -bottom-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-green-500">
                <div className="h-3 w-3 rounded-full bg-white"></div>
              </div>
            </div>
            <div>
              <h1 className="text-foreground mb-2 text-3xl font-bold">
                {trainee?.full_name || t('trainee.detail.trainee')}
              </h1>
              <div className="flex items-center gap-4">
                <span className="bg-accent/20 text-accent rounded-full px-3 py-1 text-sm font-medium">
                  {t('trainee.detail.trainee')}
                </span>
                <span className="text-muted">ID: {trainee?.id}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowEdit(v => !v)}
              className="text-muted bg-muted/30 hover:bg-muted/50 flex items-center gap-2 rounded-2xl px-4 py-2 transition-all duration-200"
            >
              {showEdit
                ? t('trainee.detail.hideEdit')
                : t('trainee.detail.edit')}
            </button>
            <button
              onClick={handleSharePdf}
              disabled={exporting}
              className="text-muted bg-muted/30 hover:bg-muted/50 flex items-center gap-2 rounded-2xl px-4 py-2 transition-all duration-200 disabled:opacity-60"
            >
              <Share2 className="h-4 w-4" />
              {exporting
                ? t('trainee.detail.sharing')
                : t('trainee.detail.share')}
            </button>
            <button
              onClick={handleDownloadPdf}
              disabled={exporting}
              className="text-muted bg-muted/30 hover:bg-muted/50 flex items-center gap-2 rounded-2xl px-4 py-2 transition-all duration-200 disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {exporting
                ? t('trainee.detail.exporting')
                : t('trainee.detail.export')}
            </button>
          </div>
        </div>
      </div>

      {/* Row 3: Assignments & Progress */}
      <div className="glass-effect bg-background border-accent/30 rounded-3xl border p-6 shadow-lg">
        <div className="p-8">
          {/* Edit form for trainers */}
          {profile?.role === 'trainer' && trainee && showEdit && (
            <div className="border-accent/30 bg-background mb-8 rounded-2xl border p-6">
              <h3 className="text-foreground mb-4 text-lg font-semibold">
                {t('trainee.detail.editDetails')}
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="text-foreground mb-1 block text-sm">
                    {t('trainee.detail.fullName')}
                  </label>
                  <input
                    className="bg-background text-foreground w-full rounded-xl border px-3 py-2"
                    value={edit.full_name}
                    onChange={e =>
                      setEdit(p => ({ ...p, full_name: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="text-foreground mb-1 block">
                    {t('trainee.detail.avatarUrl')}
                  </label>
                  <input
                    className="bg-background text-foreground w-full rounded-xl border px-3 py-2"
                    value={edit.avatar_url}
                    onChange={e =>
                      setEdit(p => ({ ...p, avatar_url: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="text-foreground mb-1 block text-sm">
                    {t('trainee.detail.trainingStart')}
                  </label>
                  <input
                    type="date"
                    className="bg-background text-foreground w-full rounded-xl border px-3 py-2"
                    value={edit.start_of_training_date}
                    onChange={e =>
                      setEdit(p => ({
                        ...p,
                        start_of_training_date: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="text-foreground rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
                >
                  {saving
                    ? t('trainee.detail.saving')
                    : t('trainee.detail.save')}
                </button>
                {error && <div className="text-sm text-red-600">{error}</div>}
              </div>
            </div>
          )}

          {/* Redesigned third row content */}
          <div className="space-y-4">
            {/* Enablers (Modules) — grouped by course */}
            <section className="border-accent/20 rounded-2xl border p-4">
              <button
                type="button"
                onClick={() => toggleSection('modules')}
                className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-lg p-1 transition-colors hover:bg-accent/5"
              >
                <div className="bg-background text-foreground flex flex-1 items-center justify-between">
                  <h3 className="text-foreground text-xl font-bold">
                    {t('trainee.detail.modules')}
                  </h3>
                  <div className="flex items-center gap-3">
                    {/* Overall progress bar */}
                    <div className="flex items-center gap-2">
                      <div className="bg-muted h-2 w-24 overflow-hidden rounded-full">
                        <div
                          className="h-full rounded-full bg-green-500 transition-all"
                          style={{ width: `${overview?.stats.progressPct ?? 0}%` }}
                        />
                      </div>
                      <span className="text-foreground text-sm font-medium">
                        {overview?.stats.completedEnablers ?? 0}/{overview?.stats.totalEnablers ?? 0}
                      </span>
                    </div>
                  </div>
                </div>
                <ChevronDown
                  className={`h-5 w-5 text-muted-foreground transition-transform ${openSections.modules ? 'rotate-180' : ''
                    }`}
                />
              </button>
              {openSections.modules && (
                <div className="mt-4">
                  {/* Filter controls */}
                  <div className="mb-4 flex flex-wrap gap-2">
                    {(['all', 'completed', 'active', 'inactive'] as const).map(f => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setEnablerFilter(f)}
                        className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-all ${enablerFilter === f
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                          }`}
                      >
                        {f === 'all' ? t('trainee.detail.filterAll')
                          : f === 'completed' ? t('trainee.detail.filterCompleted')
                            : f === 'active' ? t('trainee.detail.filterActive')
                              : t('trainee.detail.filterInactive')}
                      </button>
                    ))}
                  </div>

                  {Object.keys(groupedEnablers).length ? (
                    <div className="space-y-3">
                      {Object.entries(groupedEnablers).map(([courseTitle, courseEnablers]) => {
                        const completedInCourse = courseEnablers.filter(e => e.completed).length;
                        const totalInCourse = courseEnablers.length;
                        const coursePct = totalInCourse > 0 ? Math.round((completedInCourse / totalInCourse) * 100) : 0;
                        const isOpen = openCourses === null || openCourses.has(courseTitle);
                        return (
                          <div key={courseTitle} className="border-accent/20 rounded-xl border">
                            <button
                              type="button"
                              onClick={() => toggleCourse(courseTitle)}
                              className="flex w-full cursor-pointer items-center gap-3 rounded-xl p-3 transition-colors hover:bg-accent/5"
                            >
                              <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                              <div className="flex flex-1 items-center justify-between gap-2">
                                <span className="text-foreground text-sm font-semibold">{courseTitle}</span>
                                <div className="flex items-center gap-2">
                                  <div className="bg-muted h-1.5 w-16 overflow-hidden rounded-full">
                                    <div
                                      className="h-full rounded-full bg-green-500 transition-all"
                                      style={{ width: `${coursePct}%` }}
                                    />
                                  </div>
                                  <span className="text-muted-foreground text-xs">
                                    {completedInCourse}/{totalInCourse}
                                  </span>
                                </div>
                              </div>
                            </button>
                            {isOpen && (
                              <div className="grid grid-cols-1 gap-3 px-3 pb-3 md:grid-cols-2">
                                {courseEnablers.map(e => (
                                  <div
                                    key={e.id}
                                    className="border-accent/30 rounded-2xl border p-4 transition-all hover:border-accent/50 hover:shadow-md"
                                  >
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                      <div className="text-foreground min-w-0 truncate font-semibold">
                                        {e.title}
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span
                                          className={`rounded-full border px-2 py-0.5 text-xs ${e.completed ? 'border-green-500 text-green-500' : 'text-foreground border-slate-300'}`}
                                        >
                                          {e.completed
                                            ? t('trainee.detail.participated')
                                            : t('trainee.detail.notParticipated')}
                                        </span>
                                        <span
                                          className={`rounded-full border px-2 py-0.5 text-xs ${e.isActive ? 'border-blue-500 text-blue-500' : 'text-foreground border-slate-300'}`}
                                        >
                                          {e.isActive
                                            ? t('trainee.detail.active')
                                            : t('trainee.detail.inactive')}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {profile?.role === 'trainer' && (
                                        <button
                                          onClick={() =>
                                            toggleItem('ENABLER', e.id, !e.isActive)
                                          }
                                          className={`cursor-pointer rounded-md border px-2 py-1 text-sm transition-opacity hover:opacity-80 ${e.isActive ? 'border-yellow-500 text-yellow-500' : 'border-green-600 text-green-500'}`}
                                        >
                                          {e.isActive
                                            ? t('trainee.detail.deactivate')
                                            : t('trainee.detail.activate')}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-muted-foreground py-4 text-center text-sm">
                      {enablerFilter !== 'all'
                        ? t('trainee.detail.noFilterResults')
                        : t('trainee.detail.noEnablers')}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Enabler Quizzes by difficulty */}
            <section className="border-accent/20 rounded-2xl border p-4">
              <button
                type="button"
                onClick={() => toggleSection('lessonQuizzes')}
                className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-lg p-1 transition-colors hover:bg-accent/5"
              >
                <h3 className="text-foreground text-xl font-bold">
                  {t('trainee.detail.lessonQuizzes')}
                </h3>
                <ChevronDown
                  className={`h-5 w-5 text-muted-foreground transition-transform ${openSections.lessonQuizzes ? 'rotate-180' : ''
                    }`}
                />
              </button>
              {openSections.lessonQuizzes && (
                <div className="mt-4">
                  {overview?.enablerQuizzes?.length ? (
                    <div className="space-y-2">
                      {overview.enablerQuizzes.map(q => (
                        <div
                          key={`${q.enablerId}-${q.quizId}`}
                          className="border-accent/30 flex items-center justify-between rounded-2xl border p-4 transition-all hover:border-accent/50 hover:shadow-md"
                        >
                          <div>
                            <div className="text-foreground font-medium">
                              {q.enablerTitle} — {q.difficulty}
                            </div>
                            <div className="text-foreground text-sm">
                              {t('trainee.detail.attempts')}{' '}
                              {q.attemptNumber ?? 0} ·{' '}
                              {t('trainee.detail.result')}{' '}
                              {typeof q.lastScore === 'number'
                                ? `${q.lastScore}%`
                                : '—'}{' '}
                              {q.isReviewed === false
                                ? `· ${t('trainee.detail.forReview')}`
                                : ''}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-muted-foreground flex flex-col items-center gap-2 py-6 text-sm">
                      <BookOpen className="h-8 w-8 opacity-30" />
                      {t('trainee.detail.noEnablerQuizzes')}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Use Cases */}
            <section className="border-accent/20 rounded-2xl border p-4">
              <button
                type="button"
                onClick={() => toggleSection('useCases')}
                className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-lg p-1 transition-colors hover:bg-accent/5"
              >
                <h3 className="text-foreground text-xl font-bold">
                  {t('trainee.detail.useCases')}
                </h3>
                <ChevronDown
                  className={`h-5 w-5 text-muted-foreground transition-transform ${openSections.useCases ? 'rotate-180' : ''
                    }`}
                />
              </button>
              {openSections.useCases && (
                <div className="mt-4">
                  {overview?.useCases?.length ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {overview.useCases.map(u => (
                        <div
                          key={u.id}
                          className="border-accent/30 rounded-2xl border p-4 transition-all hover:border-accent/50 hover:shadow-md"
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="text-foreground min-w-0 truncate font-semibold">
                              {u.title}
                            </div>
                            <div className="flex items-center gap-2">
                              <span
                                className={`rounded-full border px-2 py-0.5 text-xs ${u.status === 'PENDING' ? 'border-yellow-500 text-yellow-500' : u.status ? 'border-green-500 text-green-500' : 'text-foreground border-slate-300'}`}
                              >
                                {u.status ??
                                  t('trainee.detail.notSubmitted')}
                              </span>
                              <span
                                className={`rounded-full border px-2 py-0.5 text-xs ${u.isActive ? 'border-blue-500 text-blue-500' : 'text-foreground border-slate-300'}`}
                              >
                                {u.isActive
                                  ? t('trainee.detail.active')
                                  : t('trainee.detail.inactive')}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {profile?.role === 'trainer' && (
                              <button
                                onClick={() =>
                                  toggleItem('USE_CASE', u.id, !u.isActive)
                                }
                                className={`cursor-pointer rounded-md border px-2 py-1 text-sm transition-opacity hover:opacity-80 ${u.isActive ? 'border-yellow-500 text-yellow-500' : 'border-green-600 text-green-500'}`}
                              >
                                {u.isActive
                                  ? t('trainee.detail.deactivate')
                                  : t('trainee.detail.activate')}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-muted-foreground flex flex-col items-center gap-2 py-6 text-sm">
                      <FileCheck2 className="h-8 w-8 opacity-30" />
                      {t('trainee.detail.noUseCases')}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Global (Big) Quizzes */}
            <section className="border-accent/20 rounded-2xl border p-4">
              <button
                type="button"
                onClick={() => toggleSection('globalQuizzes')}
                className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-lg p-1 transition-colors hover:bg-accent/5"
              >
                <h3 className="text-foreground text-xl font-bold">
                  {t('trainee.detail.globalQuizzes')}
                </h3>
                <ChevronDown
                  className={`h-5 w-5 text-muted-foreground transition-transform ${openSections.globalQuizzes ? 'rotate-180' : ''
                    }`}
                />
              </button>
              {openSections.globalQuizzes && (
                <div className="mt-4">
                  {overview?.globalQuizzes?.length ? (
                    <div className="space-y-2">
                      {overview.globalQuizzes.map(q => (
                        <div
                          key={q.quizId}
                          className="border-accent/30 flex items-center justify-between rounded-2xl border p-4 transition-all hover:border-accent/50 hover:shadow-md"
                        >
                          <div>
                            <div className="text-foreground font-medium">
                              {q.title}
                            </div>
                            <div className="text-foreground text-sm">
                              {t('trainee.detail.attempts')}{' '}
                              {q.attemptNumber ?? 0} ·{' '}
                              {t('trainee.detail.result')}{' '}
                              {typeof q.lastScore === 'number'
                                ? `${q.lastScore}%`
                                : '—'}{' '}
                              {q.isReviewed === false
                                ? `· ${t('trainee.detail.forReview')}`
                                : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {profile?.role === 'trainer' && (
                              <button
                                onClick={() =>
                                  toggleItem('GLOBAL_QUIZ', q.quizId, false)
                                }
                                className="cursor-pointer rounded-md border border-yellow-500 px-2 py-1 text-sm text-yellow-500 transition-opacity hover:opacity-80"
                              >
                                {t('trainee.detail.remove')}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-muted-foreground flex flex-col items-center gap-2 py-6 text-sm">
                      <Award className="h-8 w-8 opacity-30" />
                      {t('trainee.detail.noGlobalQuizzes')}
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
