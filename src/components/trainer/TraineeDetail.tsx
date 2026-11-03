'use client';

import { authFetch } from '@/lib/authFetch';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { isTrainerLevelRole } from '@/lib/auth/roles';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBreadcrumbs } from '@/contexts/BreadcrumbContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import toast from 'react-hot-toast';
import {
  FileCheck2,
  TrendingUp,
  Award,
  BookOpen,
  Download,
  Share2,
  ChevronDown,
  User,
} from 'lucide-react';
import { getAusbildungDurationLabel } from '@/lib/ausbildung/duration';
import { EnablerStateBadge } from '@/components/trainee/EnablerStateBadge';
import { Modal } from '@/components/admin/content-upload/Modal';
import { CourseGroupSection } from '@/components/trainer/CourseGroupSection';
import {
  ENABLER_FILTERS,
  FULL_NAME_MAX,
  classifyShareFailure,
  courseHeading,
  difficultyTextKey,
  groupByCourse,
  initialsOf,
  isWebAddress,
  matchesEnablerFilter,
  nameProblem,
  submissionStatusTextKey,
  type EnablerFilter,
} from '@/lib/trainer/trainee-detail-view';
import {
  buildTraineeReport,
  renderTraineeReportPdf,
} from '@/lib/trainer/trainee-report';
import { useCatalog } from '@/contexts/CatalogContext';
import { catalogDisplayTitle } from '@/lib/catalog/display-title';
import { formatReportDate } from '@/lib/trainer/trainee-detail-view';

interface TraineeDetailProps {
  traineeId: string;
}

type OverviewStats = {
  progressPct: number;
  completedEnablers: number;
  totalEnablers: number;
  pending: { quizzes: number; useCases: number };
};

type TraineeOverview = {
  stats: OverviewStats;
  enablers: Array<{
    id: string;
    title: string;
    courseId: string;
    courseTitle: string;
    courseCode?: string | null;
    completed: boolean;
    isActive: boolean;
    /** Status of the latest summary of the trainee, null without one */
    summaryStatus?: string | null;
    /** Order of work: locked, open or completed (none for an inactive enabler) */
    state?: 'locked' | 'open' | 'completed' | null;
    lockReason?: 'SEQUENCE' | 'MANUAL' | null;
    lockedBy?: { id: string; title: string } | null;
    /** true: released out of turn, false: locked, null: the order applies */
    override?: boolean | null;
    /** Whether the order applies to this trainee at all */
    sequenceEnforced?: boolean;
    link: string;
  }>;
  useCases: Array<{
    id: string;
    title: string;
    courseId?: string;
    courseTitle?: string;
    courseCode?: string | null;
    status: string | null;
    isActive: boolean;
    attemptNumber?: number | null;
    link: string;
  }>;
  summaries: Array<{
    enablerId: string;
    enablerTitle: string;
    courseId?: string;
    courseTitle?: string;
    courseCode?: string | null;
    status: string;
    attemptNumber?: number | null;
    submittedAt?: string | null;
  }>;
  enablerQuizzes: Array<{
    enablerId: string;
    enablerTitle: string;
    courseId?: string;
    courseTitle?: string;
    courseCode?: string | null;
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
    isActive: boolean;
    link: string;
  }>;
};

type OverviewEnabler = TraineeOverview['enablers'][number];
type OrderAction = 'lock' | 'release' | 'reset';

const EMPTY_STATS: OverviewStats = {
  progressPct: 0,
  completedEnablers: 0,
  totalEnablers: 0,
  pending: { quizzes: 0, useCases: 0 },
};

const normalizeOverview = (data: any): TraineeOverview => ({
  stats: {
    ...EMPTY_STATS,
    ...(data?.stats ?? {}),
    pending: {
      ...EMPTY_STATS.pending,
      ...(data?.stats?.pending ?? {}),
    },
  },
  enablers: Array.isArray(data?.enablers) ? data.enablers : [],
  useCases: Array.isArray(data?.useCases) ? data.useCases : [],
  summaries: Array.isArray(data?.summaries) ? data.summaries : [],
  enablerQuizzes: Array.isArray(data?.enablerQuizzes)
    ? data.enablerQuizzes
    : [],
  globalQuizzes: Array.isArray(data?.globalQuizzes)
    ? data.globalQuizzes.map((quiz: any) => ({
        ...quiz,
        isActive: quiz?.isActive !== false,
      }))
    : [],
});

const formatDurationLabel = (years?: number | null) =>
  getAusbildungDurationLabel(years);

/** A quiz the trainee made at least one attempt at. */
const isWorkedQuiz = (q: {
  lastScore: number | null;
  attemptNumber: number | null;
}) => (q.attemptNumber ?? 0) > 0 || typeof q.lastScore === 'number';

const SUMMARY_BADGE_CLASS: Record<string, string> = {
  APPROVED: 'border-green-600 text-green-700 dark:text-green-400',
  REJECTED: 'border-red-600 text-red-700 dark:text-red-400',
  PENDING: 'border-yellow-600 text-yellow-700 dark:text-yellow-400',
};

export default function TraineeDetail({ traineeId }: TraineeDetailProps) {
  const router = useRouter();
  const { profile } = useAuth() as any;
  const { t, language } = useLanguage();
  const { breadcrumbs, setBreadcrumbs } = useBreadcrumbs();
  const locale = language === 'en' ? 'en-GB' : 'de-DE';
  const { catalogs, activeCode } = useCatalog();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trainee, setTrainee] = useState<{
    id: string;
    full_name: string;
    avatar_url?: string | null;
    training_start_date?: string | null;
    ausbildung_duration_years?: number | null;
    assigned_trainer_id?: string | null;
    progress: number;
  } | null>(null);
  const [edit, setEdit] = useState({
    full_name: '',
    avatar_url: '',
    start_of_training_date: '',
    ausbildung_duration_years: 3,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [overview, setOverview] = useState<TraineeOverview | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const trainerId = profile?.id;
        if (!trainerId) return;

        const res = await authFetch(`/api/trainer/trainees/${traineeId}`, {
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
          ausbildung_duration_years:
            data.trainee?.ausbildung_duration_years ?? 3,
        });
        // Load overview
        const oRes = await authFetch(
          `/api/trainer/trainees/${traineeId}/overview`,
          { cache: 'no-store' }
        );
        if (oRes.ok) {
          const oData = await oRes.json();
          setOverview(normalizeOverview(oData));
        }
      } catch (e: any) {
        setError(e?.message || t('error.unknown'));
      } finally {
        setLoading(false);
      }
    };
    if (traineeId && profile?.id) load();
  }, [traineeId, t, profile?.id]);

  // The title of the page is the name of the trainee (it said only "Details")
  const traineeName = trainee?.full_name?.trim() || '';
  useEffect(() => {
    if (!traineeName) return;
    const href = `/trainer/trainees/${traineeId}`;
    const current = breadcrumbs.find(item => item.href === href);
    if (current && current.label !== traineeName) {
      setBreadcrumbs(
        breadcrumbs.map(item =>
          item.href === href ? { ...item, label: traineeName } : item
        )
      );
    }
  }, [traineeName, traineeId, breadcrumbs, setBreadcrumbs]);

  const generatePdfBlob = async () => {
    // The same figures as the detail page (the overview of the trainee), not
    // the figure of the profile request: one progress value per trainee
    const source: TraineeOverview = overview ?? normalizeOverview(null);
    const lines = buildTraineeReport({
      trainee: {
        fullName: trainee?.full_name || '',
        startDate: trainee?.training_start_date,
        durationLabel: formatDurationLabel(trainee?.ausbildung_duration_years),
        occupation: (() => {
          const active = catalogs?.find(c => c.code === activeCode);
          return active
            ? catalogDisplayTitle(t, active.code, active.title)
            : null;
        })(),
      },
      overview: {
        ...source,
        stats: overview
          ? source.stats
          : {
              ...source.stats,
              progressPct: trainee?.progress ?? 0,
            },
      },
      t,
      locale,
    });
    const bytes = await renderTraineeReportPdf(lines, {
      pageLabel: (page, pages) => t('trainee.detail.pdfPage', { page, pages }),
      brand: { name: t('sidebar.title'), subtitle: t('sidebar.subtitle') },
      footerNote: `${t('trainee.detail.pdfCreatedOn')} ${formatReportDate(new Date(), locale)}`,
      // the logo of the app (also its icon), the report stays without it if
      // it cannot be loaded
      logo: '/WMC_Logo.png',
    });
    // bytes is a Uint8Array - convert to a plain ArrayBuffer slice to satisfy strict BlobPart typing
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    return new Blob([ab], { type: 'application/pdf' });
  };

  const [exporting, setExporting] = useState(false);

  const pdfFileName = () => `${trainee?.full_name || 'trainee'}.pdf`;

  const downloadBlob = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = pdfFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = async () => {
    try {
      setExporting(true);
      downloadBlob(await generatePdfBlob());
    } catch (e: any) {
      console.error(e);
      toast.error(t('trainee.detail.exportError'));
    } finally {
      setExporting(false);
    }
  };

  const handleSharePdf = async () => {
    let blob: Blob;
    try {
      setExporting(true);
      blob = await generatePdfBlob();
    } catch (e: any) {
      console.error(e);
      toast.error(t('trainee.detail.shareError'));
      setExporting(false);
      return;
    }
    try {
      const file = new File([blob], pdfFileName(), {
        type: 'application/pdf',
      });
      // Use Web Share API if available
      const nav: any = navigator as any;
      if (
        typeof nav?.share === 'function' &&
        nav.canShare?.({ files: [file] })
      ) {
        await nav.share({
          files: [file],
          title: `${t('trainee.detail.shareTitle')} ${trainee?.full_name || ''}`,
          text: t('trainee.detail.shareText'),
        });
      } else {
        // Fallback to download, with the reason
        downloadBlob(blob);
        toast(t('trainee.detail.shareUnavailable'), { duration: 8000 });
      }
    } catch (e: any) {
      // The browser refuses with "Permission denied" (no user gesture left,
      // a policy of the page) or the trainer closes the share sheet. Neither
      // shows a raw English text: a refusal falls back to the download.
      const failure = classifyShareFailure(e);
      if (failure !== 'cancelled') {
        console.error(e);
        downloadBlob(blob);
        toast(
          failure === 'denied'
            ? t('trainee.detail.shareDenied')
            : t('trainee.detail.shareFailed'),
          { duration: 8000 }
        );
      }
    } finally {
      setExporting(false);
    }
  };

  const saveErrorText = (code: unknown) => {
    switch (code) {
      case 'FULL_NAME_REQUIRED':
        return t('trainee.detail.nameRequired');
      case 'FULL_NAME_TOO_LONG':
        return t('trainee.detail.nameTooLong', { max: FULL_NAME_MAX });
      case 'AVATAR_URL_INVALID':
        return t('trainee.detail.avatarUrlInvalid');
      default:
        return t('trainee.detail.saveError');
    }
  };

  const handleSave = async () => {
    if (!profile?.id || !trainee?.id) return;
    // The name is required: the same check as the server (WMCNL-2985)
    const problem = nameProblem(edit.full_name);
    if (problem) {
      setSaveError(
        problem === 'empty'
          ? t('trainee.detail.nameRequired')
          : t('trainee.detail.nameTooLong', { max: FULL_NAME_MAX })
      );
      return;
    }
    if (!isWebAddress(edit.avatar_url)) {
      setSaveError(t('trainee.detail.avatarUrlInvalid'));
      return;
    }
    try {
      setSaving(true);
      setSaveError(null);
      const payload: any = {
        full_name: edit.full_name.trim(),
        avatar_url: edit.avatar_url.trim(),
      };
      if (edit.start_of_training_date)
        payload.start_of_training_date = edit.start_of_training_date;
      payload.ausbildung_duration_years = edit.ausbildung_duration_years;
      const res = await authFetch(`/api/trainer/trainees/${trainee.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setSaveError(saveErrorText(body?.code));
        return;
      }
      const data = await res.json();
      setTrainee(prev => ({
        ...prev!,
        full_name: data.trainee.full_name,
        avatar_url: data.trainee.avatar_url,
        training_start_date: data.trainee.training_start_date,
        ausbildung_duration_years: data.trainee.ausbildung_duration_years,
      }));
      setEdit(prev => ({
        ...prev,
        full_name: data.trainee.full_name || '',
        avatar_url: data.trainee.avatar_url || '',
      }));
      toast.success(t('trainee.detail.saved'));
    } catch (e: any) {
      console.error(e);
      setSaveError(t('trainee.detail.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const [openSections, setOpenSections] = useState({
    modules: true,
    lessonQuizzes: false,
    useCases: false,
    summaries: false,
    globalQuizzes: false,
  });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const [enablerFilter, setEnablerFilter] = useState<EnablerFilter>('all');
  const [onlyWorkedQuizzes, setOnlyWorkedQuizzes] = useState(false);
  const [onlySubmittedUseCases, setOnlySubmittedUseCases] = useState(true);
  const [openCourses, setOpenCourses] = useState<Set<string> | null>(null);

  const toggleCourse = (courseKey: string) => {
    setOpenCourses(prev => {
      const base = prev ?? new Set<string>();
      const next = new Set(base);
      if (next.has(courseKey)) next.delete(courseKey);
      else next.add(courseKey);
      return next;
    });
  };

  // By course (its id, not its title) in the order of the training plan
  const enablerGroups = useMemo(() => {
    if (!overview?.enablers) return [];
    return groupByCourse(
      overview.enablers.filter(e => matchesEnablerFilter(e, enablerFilter)),
      t('trainee.detail.unknownCourse')
    );
  }, [overview?.enablers, enablerFilter, t]);

  // Default: all courses expanded on first load
  useEffect(() => {
    if (openCourses === null && enablerGroups.length > 0) {
      setOpenCourses(new Set(enablerGroups.map(g => g.key)));
    }
  }, [enablerGroups, openCourses]);

  const quizGroups = useMemo(
    () =>
      groupByCourse(
        (overview?.enablerQuizzes ?? []).filter(
          q => !onlyWorkedQuizzes || isWorkedQuiz(q)
        ),
        t('trainee.detail.unknownCourse')
      ),
    [overview?.enablerQuizzes, onlyWorkedQuizzes, t]
  );

  const useCaseGroups = useMemo(
    () =>
      groupByCourse(
        (overview?.useCases ?? []).filter(
          u => !onlySubmittedUseCases || u.status
        ),
        t('trainee.detail.unknownCourse')
      ),
    [overview?.useCases, onlySubmittedUseCases, t]
  );

  const summaryGroups = useMemo(
    () =>
      groupByCourse(
        overview?.summaries ?? [],
        t('trainee.detail.unknownCourse')
      ),
    [overview?.summaries, t]
  );

  // Helpers
  // The enabler whose exception is being saved (the buttons wait)
  const [busyEnabler, setBusyEnabler] = useState<string | null>(null);
  // The change of the order that waits for the answer of the trainer
  const [pendingOrder, setPendingOrder] = useState<{
    enabler: OverviewEnabler;
    action: OrderAction;
  } | null>(null);

  // isActive null (only for an enabler) removes the exception to the order
  const toggleItem = async (
    itemType: 'ENABLER' | 'USE_CASE' | 'GLOBAL_QUIZ',
    itemId: string,
    isActive: boolean | null
  ): Promise<boolean> => {
    if (!trainee?.id) return false;
    if (itemType === 'ENABLER') setBusyEnabler(itemId);
    let saved = false;

    // Optimistic update (an enabler shows the new state after the reload: the
    // state follows from the order of work, not from the switch alone)
    setOverview(prev => {
      if (!prev) return prev;
      const next: TraineeOverview = {
        ...prev,
        enablers: prev.enablers ?? [],
        useCases: prev.useCases ?? [],
        globalQuizzes: prev.globalQuizzes ?? [],
      };
      if (itemType === 'USE_CASE') {
        next.useCases = next.useCases.map(u =>
          u.id === itemId ? { ...u, isActive: !!isActive } : u
        );
      } else if (itemType === 'GLOBAL_QUIZ') {
        next.globalQuizzes = next.globalQuizzes.map(q =>
          q.quizId === itemId ? { ...q, isActive: !!isActive } : q
        );
      }
      return next;
    });

    try {
      const payload: any = { itemType, itemId, isActive };
      const res = await authFetch(
        `/api/trainer/trainees/${trainee.id}/activate`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) throw new Error('Failed to toggle active state');
      saved = true;

      // Background refresh to ensure consistency
      const oRes = await authFetch(
        `/api/trainer/trainees/${trainee.id}/overview`,
        {
          cache: 'no-store',
        }
      );
      if (oRes.ok) {
        const oData = await oRes.json();
        setOverview(normalizeOverview(oData));
      }
    } catch (e) {
      console.error(e);
      toast.error(
        itemType === 'ENABLER'
          ? t('trainee.detail.order.failed')
          : t('error.unknown')
      );
      // Revert: full reload on error
      const oRes = await authFetch(
        `/api/trainer/trainees/${trainee.id}/overview`,
        {
          cache: 'no-store',
        }
      );
      if (oRes.ok) {
        const oData = await oRes.json();
        setOverview(normalizeOverview(oData));
      }
    } finally {
      setBusyEnabler(null);
    }
    return saved;
  };

  const ORDER_ACTIONS: Record<
    OrderAction,
    { value: boolean | null; title: string; text: string; done: string }
  > = {
    lock: {
      value: false,
      title: 'trainee.detail.order.confirmLockTitle',
      text: 'trainee.detail.order.confirmLockText',
      done: 'trainee.detail.order.savedLocked',
    },
    release: {
      value: true,
      title: 'trainee.detail.order.confirmReleaseTitle',
      text: 'trainee.detail.order.confirmReleaseText',
      done: 'trainee.detail.order.savedReleased',
    },
    reset: {
      value: null,
      title: 'trainee.detail.order.confirmResetTitle',
      text: 'trainee.detail.order.confirmResetText',
      done: 'trainee.detail.order.savedReset',
    },
  };

  const confirmOrderChange = async () => {
    if (!pendingOrder) return;
    const { enabler, action } = pendingOrder;
    setPendingOrder(null);
    const ok = await toggleItem(
      'ENABLER',
      enabler.id,
      ORDER_ACTIONS[action].value
    );
    if (ok) {
      toast.success(t(ORDER_ACTIONS[action].done, { title: enabler.title }));
    }
  };

  const overviewStats = overview?.stats ?? EMPTY_STATS;
  const canEditOrder = !!profile && isTrainerLevelRole(profile.role);

  const filterLabel = (f: EnablerFilter) =>
    f === 'all'
      ? t('trainee.detail.filterAll')
      : f === 'completed'
        ? t('trainee.detail.filterCompleted')
        : f === 'open'
          ? t('trainee.detail.filterOpen')
          : f === 'locked'
            ? t('trainee.detail.filterLocked')
            : t('trainee.detail.filterInactive');

  const orderButton = (
    e: OverviewEnabler,
    action: OrderAction,
    labelKey: string,
    className: string
  ) => (
    <button
      type="button"
      disabled={busyEnabler === e.id}
      aria-busy={busyEnabler === e.id}
      aria-label={`${t(labelKey)}: ${e.title}`}
      onClick={() => setPendingOrder({ enabler: e, action })}
      className={`text-foreground min-h-[44px] cursor-pointer rounded-md border px-3 py-2 text-sm transition-opacity hover:opacity-80 disabled:cursor-wait disabled:opacity-50 ${className}`}
    >
      {t(labelKey)}
    </button>
  );

  const submissionBadge = (status: string | null | undefined) => (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs ${
        status
          ? (SUMMARY_BADGE_CLASS[String(status).toUpperCase()] ??
            'text-foreground border-slate-300')
          : 'text-foreground border-slate-300'
      }`}
    >
      {t(submissionStatusTextKey(status))}
    </span>
  );

  if (loading || (!profile?.id && !error)) {
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

  if (error && !trainee) {
    return (
      <div className="mx-auto max-w-7xl space-y-8 p-6">
        <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="bg-destructive/10 flex h-16 w-16 items-center justify-center rounded-full">
              <TrendingUp className="text-destructive h-8 w-8" />
            </div>
            <h2 className="text-foreground text-xl font-bold">{error}</h2>
            <button
              onClick={() => router.back()}
              className="text-muted bg-muted/30 hover:bg-muted/50 rounded-2xl px-6 py-2 transition-all duration-200"
            >
              {t('common.back') || 'Back'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const pendingAction = pendingOrder
    ? ORDER_ACTIONS[pendingOrder.action]
    : null;
  const initials = initialsOf(trainee?.full_name);

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-6">
            <div className="relative">
              <Avatar className="border-accent/30 h-24 w-24 rounded-3xl border-4 shadow-lg">
                {trainee?.avatar_url ? (
                  <AvatarImage
                    src={trainee.avatar_url}
                    alt={t('trainee.detail.avatarAlt', {
                      name: trainee.full_name,
                    })}
                    className="object-cover"
                  />
                ) : null}
                <AvatarFallback className="text-muted rounded-3xl text-2xl font-semibold">
                  {initials || <User className="h-8 w-8" aria-hidden="true" />}
                </AvatarFallback>
              </Avatar>
              <div className="absolute -right-2 -bottom-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-green-500">
                <div className="h-3 w-3 rounded-full bg-white"></div>
              </div>
            </div>
            <div>
              <h1 className="text-foreground mb-2 text-3xl font-bold">
                {trainee?.full_name || t('trainee.detail.trainee')}
              </h1>
              <div className="flex flex-wrap items-center gap-4">
                <span className="bg-accent/20 text-accent rounded-full px-3 py-1 text-sm font-medium">
                  {t('trainee.detail.trainee')}
                </span>
                <span className="rounded-full border border-blue-500/40 bg-blue-500/10 px-3 py-1 text-sm font-medium text-blue-500">
                  {formatDurationLabel(trainee?.ausbildung_duration_years)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowEdit(v => !v)}
              aria-expanded={showEdit}
              className="text-muted bg-muted/30 hover:bg-muted/50 flex items-center gap-2 rounded-2xl px-4 py-2 whitespace-nowrap transition-all duration-200"
            >
              {showEdit
                ? t('trainee.detail.hideEdit')
                : t('trainee.detail.edit')}
            </button>
            <button
              onClick={handleSharePdf}
              disabled={exporting}
              className="text-muted bg-muted/30 hover:bg-muted/50 flex items-center gap-2 rounded-2xl px-4 py-2 whitespace-nowrap transition-all duration-200 disabled:opacity-60"
            >
              <Share2 className="h-4 w-4" />
              {exporting
                ? t('trainee.detail.sharing')
                : t('trainee.detail.share')}
            </button>
            <button
              onClick={handleDownloadPdf}
              disabled={exporting}
              className="text-muted bg-muted/30 hover:bg-muted/50 flex items-center gap-2 rounded-2xl px-4 py-2 whitespace-nowrap transition-all duration-200 disabled:opacity-60"
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
          {profile &&
            isTrainerLevelRole(profile.role) &&
            trainee &&
            showEdit && (
              <div className="border-accent/30 bg-background mb-8 rounded-2xl border p-6">
                <h3 className="text-foreground mb-4 text-lg font-semibold">
                  {t('trainee.detail.editDetails')}
                </h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <label
                      htmlFor="trainee-full-name"
                      className="text-foreground mb-1 block text-sm"
                    >
                      {t('trainee.detail.fullName')}
                    </label>
                    <input
                      id="trainee-full-name"
                      required
                      aria-required="true"
                      aria-invalid={!!saveError && !edit.full_name.trim()}
                      maxLength={FULL_NAME_MAX}
                      className="bg-background text-foreground w-full rounded-xl border px-3 py-2"
                      value={edit.full_name}
                      onChange={e =>
                        setEdit(p => ({ ...p, full_name: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="trainee-avatar-url"
                      className="text-foreground mb-1 block text-sm"
                    >
                      {t('trainee.detail.avatarUrl')}
                    </label>
                    <input
                      id="trainee-avatar-url"
                      type="url"
                      inputMode="url"
                      className="bg-background text-foreground w-full rounded-xl border px-3 py-2"
                      value={edit.avatar_url}
                      onChange={e =>
                        setEdit(p => ({ ...p, avatar_url: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="trainee-training-start"
                      className="text-foreground mb-1 block text-sm"
                    >
                      {t('trainee.detail.trainingStart')}
                    </label>
                    <input
                      id="trainee-training-start"
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
                  <div>
                    <label
                      htmlFor="trainee-duration"
                      className="text-foreground mb-1 block text-sm"
                    >
                      {t('trainee.detail.durationYears')}
                    </label>
                    <select
                      id="trainee-duration"
                      className="bg-background text-foreground w-full rounded-xl border px-3 py-2"
                      value={edit.ausbildung_duration_years}
                      onChange={e =>
                        setEdit(p => ({
                          ...p,
                          ausbildung_duration_years: Number(e.target.value),
                        }))
                      }
                    >
                      <option value={2}>{t('trainee.detail.duration2')}</option>
                      <option value={3}>{t('trainee.detail.duration3')}</option>
                    </select>
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
                  {saveError && (
                    <div role="alert" className="text-sm text-red-600">
                      {saveError}
                    </div>
                  )}
                </div>
              </div>
            )}

          {/* Redesigned third row content */}
          <div className="space-y-4">
            {/* Enablers (Themenkreise) grouped by course */}
            <section className="border-accent/20 rounded-2xl border p-4">
              <button
                type="button"
                onClick={() => toggleSection('modules')}
                className="hover:bg-accent/5 flex w-full cursor-pointer items-center justify-between gap-4 rounded-lg p-1 transition-colors"
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
                          style={{
                            width: `${overviewStats.progressPct}%`,
                          }}
                        />
                      </div>
                      <span className="text-foreground text-sm font-medium">
                        {overviewStats.completedEnablers}/
                        {overviewStats.totalEnablers}
                      </span>
                    </div>
                  </div>
                </div>
                <ChevronDown
                  className={`text-muted-foreground h-5 w-5 transition-transform ${
                    openSections.modules ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {openSections.modules && (
                <div className="mt-4">
                  {/* Filter controls: the words of the badge on the card */}
                  <div className="mb-4 flex flex-wrap gap-2">
                    {ENABLER_FILTERS.map(f => (
                      <button
                        key={f}
                        type="button"
                        aria-pressed={enablerFilter === f}
                        onClick={() => setEnablerFilter(f)}
                        className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-all ${
                          enablerFilter === f
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        {filterLabel(f)}
                      </button>
                    ))}
                  </div>

                  <p className="text-muted-foreground mb-3 text-sm">
                    <span className="text-foreground font-medium">
                      {t('trainee.detail.order.title')}:
                    </span>{' '}
                    {t('trainee.detail.order.hint')}
                  </p>

                  {enablerGroups.length ? (
                    <div className="space-y-3">
                      {enablerGroups.map(group => {
                        const courseEnablers = group.items;
                        const completedInCourse = courseEnablers.filter(
                          e => e.completed
                        ).length;
                        const totalInCourse = courseEnablers.length;
                        const coursePct =
                          totalInCourse > 0
                            ? Math.round(
                                (completedInCourse / totalInCourse) * 100
                              )
                            : 0;
                        const isOpen =
                          openCourses === null || openCourses.has(group.key);
                        return (
                          <div
                            key={group.key}
                            className="border-accent/20 rounded-xl border"
                          >
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              onClick={() => toggleCourse(group.key)}
                              className="hover:bg-accent/5 flex w-full cursor-pointer items-center gap-3 rounded-xl p-3 transition-colors"
                            >
                              <ChevronDown
                                className={`text-muted-foreground h-4 w-4 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                              />
                              <div className="flex flex-1 items-center justify-between gap-2">
                                <span className="text-foreground text-left text-sm font-semibold">
                                  {courseHeading(group, enablerGroups)}
                                </span>
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
                                    data-testid="enabler-card"
                                    className="border-accent/30 hover:border-accent/50 rounded-2xl border p-4 transition-all hover:shadow-md"
                                  >
                                    <div className="text-foreground mb-2 font-semibold">
                                      {e.title}
                                    </div>
                                    {/* Order of work: the state of the enabler and the exception per trainee */}
                                    {!e.isActive ? (
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-foreground rounded-full border border-slate-300 px-2 py-0.5 text-xs">
                                          {t('trainee.detail.inactive')}
                                        </span>
                                        <p className="text-muted-foreground text-xs">
                                          {t('trainee.detail.order.inactive')}
                                        </p>
                                      </div>
                                    ) : (
                                      <div className="flex flex-wrap items-center gap-2">
                                        {e.state && (
                                          <EnablerStateBadge
                                            state={e.state}
                                            reason={e.lockReason}
                                            lockedByTitle={e.lockedBy?.title}
                                          />
                                        )}
                                        {e.summaryStatus && (
                                          <span
                                            data-testid="summary-status"
                                            className={`rounded-full border px-2 py-0.5 text-xs ${SUMMARY_BADGE_CLASS[e.summaryStatus] ?? 'text-foreground border-slate-300'}`}
                                          >
                                            {t('trainee.detail.summaryStatus')}:{' '}
                                            {t(
                                              submissionStatusTextKey(
                                                e.summaryStatus
                                              )
                                            )}
                                          </span>
                                        )}
                                        {e.override === true && (
                                          <span className="text-foreground rounded-full border border-blue-500 px-2 py-0.5 text-xs">
                                            {t(
                                              'trainee.detail.order.manualReleased'
                                            )}
                                          </span>
                                        )}
                                        {e.override === false && (
                                          <span className="text-foreground rounded-full border border-amber-600 px-2 py-0.5 text-xs">
                                            {t(
                                              'trainee.detail.order.manualLocked'
                                            )}
                                          </span>
                                        )}
                                        {canEditOrder && (
                                          <>
                                            {/* Every enabler can be locked directly, also one released out of turn */}
                                            {(e.override === null ||
                                              e.override === undefined) &&
                                              e.state === 'locked' &&
                                              orderButton(
                                                e,
                                                'release',
                                                'trainee.detail.order.releaseOut',
                                                'border-green-600'
                                              )}
                                            {(e.override === null ||
                                              e.override === undefined) &&
                                              e.state === 'open' &&
                                              orderButton(
                                                e,
                                                'lock',
                                                'trainee.detail.order.lock',
                                                'border-amber-600'
                                              )}
                                            {e.override === true &&
                                              orderButton(
                                                e,
                                                'lock',
                                                'trainee.detail.order.lock',
                                                'border-amber-600'
                                              )}
                                            {e.override === false &&
                                              orderButton(
                                                e,
                                                'release',
                                                'trainee.detail.order.releaseOut',
                                                'border-green-600'
                                              )}
                                            {(e.override === true ||
                                              e.override === false) &&
                                              orderButton(
                                                e,
                                                'reset',
                                                'trainee.detail.order.reset',
                                                'border-slate-500'
                                              )}
                                          </>
                                        )}
                                      </div>
                                    )}
                                    {e.isActive &&
                                      e.summaryStatus === 'REJECTED' && (
                                        <p className="text-muted-foreground mt-2 text-xs">
                                          {t(
                                            'trainee.detail.summaryReworkNote'
                                          )}
                                        </p>
                                      )}
                                    {e.isActive &&
                                      e.sequenceEnforced === false && (
                                        <p className="text-muted-foreground mt-2 text-xs">
                                          {t(
                                            'trainee.detail.order.notEnforced'
                                          )}
                                        </p>
                                      )}
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

            {/* Enabler quizzes by course and enabler */}
            <section className="border-accent/20 rounded-2xl border p-4">
              <button
                type="button"
                onClick={() => toggleSection('lessonQuizzes')}
                className="hover:bg-accent/5 flex w-full cursor-pointer items-center justify-between gap-4 rounded-lg p-1 transition-colors"
              >
                <div className="flex flex-1 items-center justify-between gap-3">
                  <h3 className="text-foreground text-xl font-bold">
                    {t('trainee.detail.lessonQuizzes')}
                  </h3>
                  <span className="text-muted-foreground text-sm">
                    {t('trainee.detail.workedCount', {
                      worked: (overview?.enablerQuizzes ?? []).filter(
                        isWorkedQuiz
                      ).length,
                      total: overview?.enablerQuizzes?.length ?? 0,
                    })}
                  </span>
                </div>
                <ChevronDown
                  className={`text-muted-foreground h-5 w-5 transition-transform ${
                    openSections.lessonQuizzes ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {openSections.lessonQuizzes && (
                <div className="mt-4">
                  {overview?.enablerQuizzes?.length ? (
                    <>
                      <label className="text-foreground mb-3 flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={onlyWorkedQuizzes}
                          onChange={e => setOnlyWorkedQuizzes(e.target.checked)}
                        />
                        {t('trainee.detail.onlyWorked')}
                      </label>
                      {quizGroups.length ? (
                        <CourseGroupSection
                          key={String(onlyWorkedQuizzes)}
                          groups={quizGroups}
                          defaultOpen={false}
                          testIdPrefix="lesson-quizzes"
                          counter={items =>
                            t('trainee.detail.workedCount', {
                              worked: items.filter(isWorkedQuiz).length,
                              total: items.length,
                            })
                          }
                        >
                          {items => {
                            // one block per enabler, its levels low to high
                            const byEnabler = new Map<string, typeof items>();
                            for (const q of items) {
                              const list = byEnabler.get(q.enablerId);
                              if (list) list.push(q);
                              else byEnabler.set(q.enablerId, [q]);
                            }
                            return (
                              <div className="space-y-2">
                                {Array.from(byEnabler.entries()).map(
                                  ([enablerId, quizzes]) => (
                                    <div
                                      key={enablerId}
                                      className="border-accent/30 rounded-2xl border p-3"
                                    >
                                      <div className="text-foreground mb-1 font-medium">
                                        {quizzes[0].enablerTitle}
                                      </div>
                                      <ul className="space-y-1">
                                        {quizzes.map(q => (
                                          <li
                                            key={q.quizId}
                                            className="text-foreground text-sm"
                                          >
                                            <span className="font-medium">
                                              {t(
                                                difficultyTextKey(q.difficulty)
                                              )}
                                            </span>
                                            {': '}
                                            {t('trainee.detail.attempts')}{' '}
                                            {q.attemptNumber ?? 0} ·{' '}
                                            {t('trainee.detail.result')}{' '}
                                            {typeof q.lastScore === 'number'
                                              ? `${q.lastScore}%`
                                              : '—'}{' '}
                                            {q.isReviewed === false
                                              ? `· ${t('trainee.detail.forReview')}`
                                              : ''}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )
                                )}
                              </div>
                            );
                          }}
                        </CourseGroupSection>
                      ) : (
                        <div className="text-muted-foreground py-4 text-center text-sm">
                          {t('trainee.detail.noWorkedQuizzes')}
                        </div>
                      )}
                    </>
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
                className="hover:bg-accent/5 flex w-full cursor-pointer items-center justify-between gap-4 rounded-lg p-1 transition-colors"
              >
                <div className="flex flex-1 items-center justify-between gap-3">
                  <h3 className="text-foreground text-xl font-bold">
                    {t('trainee.detail.useCases')}
                  </h3>
                  <span className="text-muted-foreground text-sm">
                    {t('trainee.detail.submittedCount', {
                      submitted: (overview?.useCases ?? []).filter(
                        u => u.status
                      ).length,
                      total: overview?.useCases?.length ?? 0,
                    })}
                  </span>
                </div>
                <ChevronDown
                  className={`text-muted-foreground h-5 w-5 transition-transform ${
                    openSections.useCases ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {openSections.useCases && (
                <div className="mt-4">
                  {overview?.useCases?.length ? (
                    <>
                      <label className="text-foreground mb-3 flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={onlySubmittedUseCases}
                          onChange={e =>
                            setOnlySubmittedUseCases(e.target.checked)
                          }
                        />
                        {t('trainee.detail.onlySubmitted')}
                      </label>
                      {useCaseGroups.length ? (
                        <CourseGroupSection
                          key={String(onlySubmittedUseCases)}
                          groups={useCaseGroups}
                          defaultOpen={onlySubmittedUseCases}
                          testIdPrefix="use-cases"
                          counter={items =>
                            t('trainee.detail.submittedCount', {
                              submitted: items.filter(u => u.status).length,
                              total: items.length,
                            })
                          }
                        >
                          {items => (
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                              {items.map(u => (
                                <div
                                  key={u.id}
                                  className="border-accent/30 hover:border-accent/50 rounded-2xl border p-4 transition-all hover:shadow-md"
                                >
                                  <div className="mb-2 flex items-center justify-between gap-2">
                                    <div className="text-foreground min-w-0 font-semibold">
                                      {u.title}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {submissionBadge(u.status)}
                                      {!u.isActive && (
                                        <span className="text-foreground rounded-full border border-slate-300 px-2 py-0.5 text-xs">
                                          {t('trainee.detail.inactive')}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {canEditOrder && (
                                      <button
                                        onClick={() =>
                                          toggleItem(
                                            'USE_CASE',
                                            u.id,
                                            !u.isActive
                                          )
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
                          )}
                        </CourseGroupSection>
                      ) : (
                        <div className="text-muted-foreground py-4 text-center text-sm">
                          {t('trainee.detail.noSubmittedUseCases')}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-muted-foreground flex flex-col items-center gap-2 py-6 text-sm">
                      <FileCheck2 className="h-8 w-8 opacity-30" />
                      {t('trainee.detail.noUseCases')}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Summaries (with reflection) of the themes */}
            <section className="border-accent/20 rounded-2xl border p-4">
              <button
                type="button"
                onClick={() => toggleSection('summaries')}
                className="hover:bg-accent/5 flex w-full cursor-pointer items-center justify-between gap-4 rounded-lg p-1 transition-colors"
              >
                <div className="flex flex-1 items-center justify-between gap-3">
                  <h3 className="text-foreground text-xl font-bold">
                    {t('trainee.detail.summaries')}
                  </h3>
                  <span className="text-muted-foreground text-sm">
                    {t('trainee.detail.submittedCount', {
                      submitted: overview?.summaries?.length ?? 0,
                      total: (overview?.enablers ?? []).filter(e => e.isActive)
                        .length,
                    })}
                  </span>
                </div>
                <ChevronDown
                  className={`text-muted-foreground h-5 w-5 transition-transform ${
                    openSections.summaries ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {openSections.summaries && (
                <div className="mt-4">
                  {summaryGroups.length ? (
                    <CourseGroupSection
                      groups={summaryGroups}
                      defaultOpen
                      testIdPrefix="summaries"
                      counter={items =>
                        t('trainee.detail.submittedCount', {
                          submitted: items.length,
                          total: items.length,
                        })
                      }
                    >
                      {items => (
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          {items.map(s => (
                            <div
                              key={s.enablerId}
                              className="border-accent/30 rounded-2xl border p-4"
                            >
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <div className="text-foreground min-w-0 font-semibold">
                                  {s.enablerTitle}
                                </div>
                                {submissionBadge(s.status)}
                              </div>
                              {s.attemptNumber ? (
                                <div className="text-muted-foreground text-xs">
                                  {t('trainee.detail.summaryAttempt', {
                                    number: s.attemptNumber,
                                  })}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </CourseGroupSection>
                  ) : (
                    <div className="text-muted-foreground flex flex-col items-center gap-2 py-6 text-sm">
                      <FileCheck2 className="h-8 w-8 opacity-30" />
                      {t('trainee.detail.noSummaries')}
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
                className="hover:bg-accent/5 flex w-full cursor-pointer items-center justify-between gap-4 rounded-lg p-1 transition-colors"
              >
                <h3 className="text-foreground text-xl font-bold">
                  {t('trainee.detail.globalQuizzes')}
                </h3>
                <ChevronDown
                  className={`text-muted-foreground h-5 w-5 transition-transform ${
                    openSections.globalQuizzes ? 'rotate-180' : ''
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
                          className="border-accent/30 hover:border-accent/50 flex items-center justify-between rounded-2xl border p-4 transition-all hover:shadow-md"
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
                            {canEditOrder && (
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

      {/* Confirmation before the order of work changes for the trainee */}
      {pendingOrder && pendingAction && (
        <Modal
          titleId="order-confirm-title"
          descriptionId="order-confirm-text"
          onClose={() => setPendingOrder(null)}
        >
          <h2
            id="order-confirm-title"
            className="text-foreground mb-2 text-lg font-semibold"
          >
            {t(pendingAction.title)}
          </h2>
          <p id="order-confirm-text" className="text-foreground mb-6 text-sm">
            {t(pendingAction.text, { title: pendingOrder.enabler.title })}
          </p>
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              data-initial-focus
              onClick={() => setPendingOrder(null)}
              className="text-foreground bg-muted/30 hover:bg-muted/50 min-h-[44px] cursor-pointer rounded-xl px-4 py-2 text-sm"
            >
              {t('trainee.detail.order.cancel')}
            </button>
            <button
              type="button"
              onClick={confirmOrderChange}
              className="min-h-[44px] cursor-pointer rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              {t('trainee.detail.order.confirm')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
