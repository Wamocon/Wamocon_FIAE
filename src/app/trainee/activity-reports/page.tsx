'use client';

import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  getPhaseMonthRange,
  normalizeDurationYears,
  type AusbildungDurationYears,
  type TrainingPhase,
} from '@/lib/ausbildung/duration';
import { getISOWeekDates, getISOWeekInfo } from '@/lib/date/iso-week';
import { normalizePlannedHours } from '@/lib/ausbildung/planned-hours';
import {
  ClipboardList,
  Plus,
  Calendar,
  Clock,
  AlertTriangle,
  Check,
  Send,
  ChevronDown,
  ChevronRight,
  FileText,
  X,
  Save,
  Trash2,
  Edit3,
  Download,
  MessageSquare,
} from 'lucide-react';

// Types
interface TrainingComponent {
  id: string;
  code: string;
  title: string;
  description: string | null;
  totalWeeks: number;
  totalHours: number;
  trainingYear: number | null;
  orderIndex: number;
}

interface TrainingUseCase {
  id: string;
  componentId: string;
  letter: string;
  description: string;
  plannedHours: number;
  orderIndex: number;
}

interface ActivityReport {
  id: string;
  traineeId: string;
  ausbildungsjahr: number;
  weekNumber: number;
  year: number;
  periodStart: string;
  periodEnd: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  submittedAt: string | null;
  reviewerFeedback: string | null;
  traineeSignedAt: string | null;
  trainerSignedAt: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  createdAt: string;
  skillSelfRatings?: Record<string, string> | null;
}

interface ReportUseCaseEntry {
  id: string;
  reportId: string;
  useCaseId: string;
  plannedHours: number;
  actualHours: number;
  isOverbooked: boolean;
  notes: string | null;
  // Grading fields (trainee self-grade + trainer grade)
  traineeGrade?: string | number | null;
  trainerGrade?: string | number | null;
  gradeComment?: string | null;
  useCase?: TrainingUseCase;
  component?: TrainingComponent;
}

export default function TraineeActivityReportsPage() {
  const { profile, loading: authLoading, refreshProfile } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  const queryClient = useQueryClient();

  // Redirect non-trainee users
  useEffect(() => {
    if (!profile || authLoading) return;
    if (profile.role !== 'trainee') router.push('/trainer/activity-reports');
  }, [profile?.id, authLoading, router]);

  useEffect(() => {
    if (!profile?.id || authLoading) return;
    void refreshProfile().finally(() => {
      queryClient.invalidateQueries({
        predicate: query =>
          typeof query.queryKey[0] === 'string' &&
          query.queryKey[0].startsWith('/api/activity-reports'),
      });
    });
  }, [profile?.id, authLoading, refreshProfile, queryClient]);

  // Data fetching via React Query (cached, deduped, auto-refresh on focus)
  const reportsUrl = profile?.id
    ? `/api/activity-reports?userId=${profile.id}&limit=500`
    : null;
  const { data: compData } = useApiQuery<{ components: TrainingComponent[] }>(
    '/api/training-components'
  );
  const { data: ucData } = useApiQuery<{ useCases: TrainingUseCase[] }>(
    '/api/training-use-cases'
  );
  const {
    data: reportData,
    isLoading: reportsLoading,
    error: reportsError,
  } = useApiQuery<{ reports: ActivityReport[] }>(reportsUrl, {
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: 'always',
  });

  const components = compData?.components || [];
  const useCases = useMemo(
    () =>
      (ucData?.useCases || []).map(useCase => ({
        ...useCase,
        plannedHours: normalizePlannedHours({
          plannedHours: useCase.plannedHours,
        }),
      })),
    [ucData?.useCases]
  );
  const reports = reportData?.reports || [];
  const loading = reportsLoading;
  const error = reportsError?.message || null;
  const profileDurationYears =
    (profile as { ausbildungDurationYears?: number | null } | null)
      ?.ausbildungDurationYears ?? profile?.ausbildung_duration_years;
  const durationYears = normalizeDurationYears(
    profileDurationYears
  );

  const formatPhaseLabel = (phase: number) => {
    if (phase === 3) return t('reports.integrativePhase');
    const range = getPhaseMonthRange(durationYears, phase as TrainingPhase);
    return t('reports.phaseRange')
      .replace('{phase}', String(phase))
      .replace('{start}', String(range.startMonth))
      .replace('{end}', String(range.endMonth));
  };

  // State
  const [filterStatus, setFilterStatus] = useState<
    'ALL' | 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'
  >('ALL');

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedReport, setSelectedReport] = useState<ActivityReport | null>(
    null
  );
  const [reportEntries, setReportEntries] = useState<ReportUseCaseEntry[]>([]);

  // Edit state
  const [editingReport, setEditingReport] = useState<ActivityReport | null>(
    null
  );
  const [editingEntries, setEditingEntries] = useState<ReportUseCaseEntry[]>(
    []
  );

  const loadData = () => {
    if (reportsUrl) queryClient.invalidateQueries({ queryKey: [reportsUrl] });
  };

  // Group use cases by component
  const useCasesByComponent = useMemo(() => {
    const grouped: Record<string, TrainingUseCase[]> = {};
    useCases.forEach(uc => {
      if (!grouped[uc.componentId]) {
        grouped[uc.componentId] = [];
      }
      grouped[uc.componentId].push(uc);
    });
    return grouped;
  }, [useCases]);

  const getCurrentReportPeriod = () => getISOWeekInfo();

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return (
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-1 text-xs">
            {t('reports.status.draft')}
          </span>
        );
      case 'SUBMITTED':
        return (
          <span className="rounded-full bg-blue-500/20 px-2 py-1 text-xs text-blue-400">
            {t('reports.status.submitted')}
          </span>
        );
      case 'APPROVED':
        return (
          <span className="rounded-full bg-green-500/20 px-2 py-1 text-xs text-green-400">
            {t('reports.status.approved')}
          </span>
        );
      case 'REJECTED':
        return (
          <span className="rounded-full bg-red-500/20 px-2 py-1 text-xs text-red-400">
            {t('reports.status.rejected')}
          </span>
        );
      default:
        return null;
    }
  };

  const handleDeleteReport = async (e: React.MouseEvent, reportId: string) => {
    e.stopPropagation();
    if (!confirm(t('reports.deleteConfirm'))) return;

    try {
      const res = await fetch(`/api/activity-reports/${reportId}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error(t('reports.error.delete'));

      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleEditReport = async (
    e: React.MouseEvent,
    report: ActivityReport
  ) => {
    e.stopPropagation();
    try {
      // Fetch entries for this report
      const res = await fetch(`/api/activity-reports/${report.id}/entries`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(t('reports.error.loadEntries'));

      const data = await res.json();
      setEditingReport(report);
      setEditingEntries(data.entries || []);
      setShowCreateModal(true);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const fetchEvaluationData = async (
    reportId: string,
    year: number,
    week: number
  ) => {
    try {
      if (!profile?.id) return null;

      // 1. Get all evaluations to find the ID
      const resLists = await fetch(
        `/api/trainee/evaluations?userId=${profile.id}`,
        { cache: 'no-store' }
      );
      if (!resLists.ok) return null;
      const { evaluations } = await resLists.json();
      const evaluation = evaluations.find(
        (e: any) => e.year === year && e.weekNumber === week
      );

      // If no evaluation found or it's not approved yet, we might still want to show self ratings if they exist
      if (!evaluation) return null;

      // 2. Get full details including Soft Skills
      // Trainee can see their own evaluation details
      const resDetails = await fetch(
        `/api/trainee/evaluations/${evaluation.id}`,
        { cache: 'no-store' }
      );
      if (!resDetails.ok) return null;
      return await resDetails.json();
    } catch (e) {
      console.error('Error fetching evaluation for PDF:', e);
      return null;
    }
  };

  const handleDownloadPDF = async (
    e: React.MouseEvent,
    report: ActivityReport
  ) => {
    e.stopPropagation();
    try {
      // Fetch entries for this report
      const entriesRes = await fetch(
        `/api/activity-reports/${report.id}/entries`,
        { cache: 'no-store' }
      );
      if (!entriesRes.ok) throw new Error(t('reports.error.loadEntries'));
      const entriesData = await entriesRes.json();

      // Fetch evaluation data
      const evalData = await fetchEvaluationData(
        report.id,
        report.year,
        report.weekNumber
      );

      // Build softSkills averages from evaluation data
      let softSkills:
        | {
            fachkompetenz: number | null;
            methodenkompetenz: number | null;
            personalkompetenz: number | null;
            overallAverage: number | null;
          }
        | undefined;
      if (evalData?.softskillRatings && evalData.softskillRatings.length > 0) {
        const byArea: Record<string, number[]> = {};
        for (const sr of evalData.softskillRatings) {
          const area = (
            sr.criterion?.competencyArea as string | undefined
          )?.toUpperCase();
          const raw = sr.rating?.trainerRating;
          const rating = raw != null ? Number(raw) : null;
          if (area && rating != null && !isNaN(rating)) {
            if (!byArea[area]) byArea[area] = [];
            byArea[area].push(rating);
          }
        }
        const avg = (arr?: number[]) =>
          arr && arr.length > 0
            ? arr.reduce((a: number, b: number) => a + b, 0) / arr.length
            : null;
        const fk = avg(byArea['FACHKOMPETENZ']);
        const mk = avg(byArea['METHODENKOMPETENZ']);
        const pk = avg(byArea['PERSONALKOMPETENZ']);
        const allRatings = [
          ...(byArea['FACHKOMPETENZ'] || []),
          ...(byArea['METHODENKOMPETENZ'] || []),
          ...(byArea['PERSONALKOMPETENZ'] || []),
        ];
        softSkills = {
          fachkompetenz: fk,
          methodenkompetenz: mk,
          personalkompetenz: pk,
          overallAverage: avg(allRatings),
        };
      }

      // Prepare report data for PDF
      const reportData = {
        id: report.id,
        traineeId: report.traineeId,
        traineeName: profile?.full_name || t('profile.unknown'),
        traineeEmail: profile?.email || '',
        ausbildungsjahr: report.ausbildungsjahr,
        weekNumber: report.weekNumber,
        year: report.year,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
        status: report.status,
        submittedAt: report.submittedAt,
        traineeSignedAt: report.traineeSignedAt,
        trainerSignedAt: report.trainerSignedAt,
        reviewerId: report.reviewerId,
        reviewerName: report.reviewerName || null,
        entries: entriesData.entries || [],
        // Optional trainer comment
        trainerComment: evalData?.evaluation?.trainerComment,
        softSkills,
      };

      await (
        await import('@/utils/generateReportPDF')
      ).generateActivityReportPDF(reportData, useCases, components);
    } catch (err: any) {
      toast.error(t('reports.error.pdfGeneration'));
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="border-accent h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-destructive/10 border-destructive/30 text-destructive rounded-lg border p-4">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-accent/20 rounded-xl p-3">
            <ClipboardList className="text-accent h-6 w-6" />
          </div>
          <div>
            <h1 className="text-foreground text-2xl font-bold">
              {t('reports.title')}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t('reports.description')}
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-2 rounded-lg px-4 py-2 transition-colors"
        >
          <Plus className="h-4 w-4" />
          {t('reports.new')}
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <button
          onClick={() => setFilterStatus('ALL')}
          className={`glass-effect rounded-xl p-4 text-left transition-all hover:scale-[1.02] ${
            filterStatus === 'ALL' ? 'ring-primary bg-primary/5 ring-2' : ''
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/20 p-2">
              <FileText className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-foreground text-2xl font-bold">
                {reports.length}
              </p>
              <p className="text-muted-foreground text-sm">
                {t('reports.total')}
              </p>
            </div>
          </div>
        </button>

        <button
          onClick={() => setFilterStatus('SUBMITTED')}
          className={`glass-effect rounded-xl p-4 text-left transition-all hover:scale-[1.02] ${
            filterStatus === 'SUBMITTED'
              ? 'bg-blue-400/5 ring-2 ring-blue-400'
              : ''
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/20 p-2">
              <Send className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-foreground text-2xl font-bold">
                {reports.filter(r => r.status === 'SUBMITTED').length}
              </p>
              <p className="text-muted-foreground text-sm">
                {t('reports.status.submitted')}
              </p>
            </div>
          </div>
        </button>

        <button
          onClick={() => setFilterStatus('APPROVED')}
          className={`glass-effect rounded-xl p-4 text-left transition-all hover:scale-[1.02] ${
            filterStatus === 'APPROVED'
              ? 'bg-green-400/5 ring-2 ring-green-400'
              : ''
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/20 p-2">
              <Check className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-foreground text-2xl font-bold">
                {reports.filter(r => r.status === 'APPROVED').length}
              </p>
              <p className="text-muted-foreground text-sm">
                {t('reports.status.approved')}
              </p>
            </div>
          </div>
        </button>
      </div>

      {/* Reports List */}
      <div className="glass-effect overflow-hidden rounded-xl">
        <div className="border-border/50 flex items-center justify-between border-b p-4">
          <h2 className="text-foreground text-lg font-semibold">
            {t('reports.myReports')}
          </h2>
          {filterStatus !== 'ALL' && (
            <button
              onClick={() => setFilterStatus('ALL')}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
            >
              <X className="h-3 w-3" />
              {t('reports.resetFilter')}
            </button>
          )}
        </div>

        {reports.length === 0 ? (
          <div className="p-8 text-center">
            <ClipboardList className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
            <h3 className="text-foreground mb-2 text-lg font-medium">
              {t('reports.noReports')}
            </h3>
            <p className="text-muted-foreground mb-4">
              {t('reports.createFirstPrompt')}
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-lg px-4 py-2"
            >
              {t('reports.createFirstReport')}
            </button>
          </div>
        ) : (
          <div className="divide-border/50 divide-y">
            {reports
              .filter(r => filterStatus === 'ALL' || r.status === filterStatus)
              .sort(
                (a, b) =>
                  new Date(b.createdAt).getTime() -
                  new Date(a.createdAt).getTime()
              )
              .map(report => (
                <div
                  key={report.id}
                  onClick={() => setSelectedReport(report)}
                  className="hover:bg-muted/50 cursor-pointer rounded-xl p-4 transition-all duration-200 hover:scale-[1.005] hover:shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="bg-accent/20 rounded-lg p-2">
                        <Calendar className="text-accent h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-foreground font-medium">
                          {t('reports.week')} {report.weekNumber} /{' '}
                          {report.year}
                        </h3>
                        <p className="text-muted-foreground text-sm">
                          {formatPhaseLabel(report.ausbildungsjahr)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {getStatusBadge(report.status)}
                      <ChevronRight className="text-muted-foreground h-5 w-5" />
                    </div>
                  </div>
                  {/* Actions for Drafts */}
                  {(report.status === 'DRAFT' ||
                    report.status === 'REJECTED') && (
                    <div className="border-border/50 mt-3 flex items-center gap-2 border-t pt-3">
                      <button
                        onClick={e => handleEditReport(e, report)}
                        className="bg-accent/10 text-accent hover:bg-accent/20 flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                      >
                        <Edit3 className="h-3 w-3" />
                        {report.status === 'REJECTED'
                          ? t('reports.resubmit')
                          : t('common.edit')}
                      </button>
                      <button
                        onClick={e => handleDeleteReport(e, report.id)}
                        className="bg-destructive/10 text-destructive hover:bg-destructive/20 flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                        {t('common.delete')}
                      </button>
                    </div>
                  )}

                  {/* Download Button for Approved Reports */}
                  {report.status === 'APPROVED' && (
                    <div className="border-border/50 mt-3 flex items-center gap-2 border-t pt-3">
                      <button
                        onClick={e => handleDownloadPDF(e, report)}
                        className="flex items-center gap-1 rounded-lg bg-green-500/10 px-3 py-1.5 text-xs font-medium text-green-500 transition-colors hover:bg-green-500/20"
                      >
                        <Download className="h-3 w-3" />
                        {t('reports.downloadPdf')}
                      </button>
                    </div>
                  )}

                  {report.status === 'REJECTED' && report.reviewerFeedback && (
                    <div className="bg-destructive/10 border-destructive/30 mt-3 rounded-lg border p-3">
                      <div className="text-destructive flex items-center gap-2 text-sm">
                        <AlertTriangle className="h-4 w-4" />
                        <span className="font-medium">
                          {t('reports.feedback')}
                        </span>
                        {report.reviewerFeedback}
                      </div>
                    </div>
                  )}

                  {report.status !== 'REJECTED' && report.reviewerFeedback && (
                    <div className="bg-accent/10 border-accent/30 mt-3 rounded-lg border p-3">
                      <div className="text-foreground flex items-center gap-2 text-sm">
                        <MessageSquare className="text-accent h-4 w-4" />
                        <span className="font-medium">
                          {t('reports.trainerComment')}
                        </span>
                        <span className="text-muted-foreground">
                          {report.reviewerFeedback}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Create Modal - Will be implemented as a separate component */}
      {showCreateModal && (
        <CreateReportModal
          components={components}
          useCasesByComponent={useCasesByComponent}
          currentWeek={
            editingReport
              ? editingReport.weekNumber
              : getCurrentReportPeriod().week
          }
          currentYear={
            editingReport ? editingReport.year : getCurrentReportPeriod().year
          }
          initialReport={editingReport}
          initialEntries={editingEntries}
          existingReports={reports}
          durationYears={durationYears}
          userId={profile?.id || ''}
          onClose={() => {
            setShowCreateModal(false);
            setEditingReport(null);
            setEditingEntries([]);
          }}
          onCreated={() => {
            setShowCreateModal(false);
            setEditingReport(null);
            setEditingEntries([]);
            loadData();
          }}
        />
      )}

      {/* Report Detail Modal */}
      {selectedReport && (
        <ReportDetailModal
          report={selectedReport}
          components={components}
          useCases={useCases}
          useCasesByComponent={useCasesByComponent}
          onClose={() => setSelectedReport(null)}
          onUpdated={() => {
            setSelectedReport(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}

// Create Report Modal Component
function CreateReportModal({
  components,
  useCasesByComponent,
  currentWeek,
  currentYear,
  initialReport,
  initialEntries,
  existingReports,
  durationYears,
  userId,
  onClose,
  onCreated,
}: {
  components: TrainingComponent[];
  useCasesByComponent: Record<string, TrainingUseCase[]>;
  currentWeek: number;
  currentYear: number;
  initialReport?: ActivityReport | null;
  initialEntries?: ReportUseCaseEntry[];
  existingReports: ActivityReport[];
  durationYears: AusbildungDurationYears;
  userId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useLanguage();
  const [weekNumber, setWeekNumber] = useState(currentWeek);
  const [year, setYear] = useState(currentYear);
  const [ausbildungsjahr] = useState(
    initialReport?.ausbildungsjahr || 1
  );
  const [entries, setEntries] = useState<
    {
      useCaseId: string;
      actualHours: number;
      notes: string;
      traineeGrade: string | null;
    }[]
  >(
    initialEntries?.map(e => ({
      useCaseId: e.useCaseId,
      actualHours: e.actualHours,
      notes: e.notes || '',
      traineeGrade: e.traineeGrade ? String(e.traineeGrade) : null,
    })) || []
  );
  const [expandedComponents, setExpandedComponents] = useState<Set<string>>(
    new Set()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatModalPhaseLabel = (phase: TrainingPhase) => {
    const range = getPhaseMonthRange(durationYears, phase);
    return t('reports.phaseRange')
      .replace('{phase}', String(phase))
      .replace('{start}', String(range.startMonth))
      .replace('{end}', String(range.endMonth));
  };

  // Use case hour tracking for overbooking prevention
  const [useCaseHours, setUseCaseHours] = useState<
    Record<
      string,
      { totalHours: number; usedHours: number; remainingHours: number }
    >
  >({});
  const [loadingHours, setLoadingHours] = useState(true);

  // Skill self-ratings for 3 competency areas
  const COMPETENCY_AREAS = [
    'FACHKOMPETENZ',
    'METHODENKOMPETENZ',
    'PERSONALKOMPETENZ',
  ] as const;
  const [skillSelfRatings, setSkillSelfRatings] = useState<
    Record<string, string | null>
  >(() => {
    const initial = (initialReport as any)?.skillSelfRatings;
    if (initial && typeof initial === 'object') {
      return {
        FACHKOMPETENZ: initial.FACHKOMPETENZ || null,
        METHODENKOMPETENZ: initial.METHODENKOMPETENZ || null,
        PERSONALKOMPETENZ: initial.PERSONALKOMPETENZ || null,
      };
    }
    return {
      FACHKOMPETENZ: null,
      METHODENKOMPETENZ: null,
      PERSONALKOMPETENZ: null,
    };
  });

  // Fetch used hours on mount
  useEffect(() => {
    const fetchUseCaseHours = async () => {
      try {
        const excludeParam = initialReport?.id
          ? `&excludeReportId=${initialReport.id}`
          : '';
        const res = await fetch(
          `/api/trainee/use-case-hours?traineeId=${userId}${excludeParam}`,
          { cache: 'no-store' }
        );
        if (res.ok) {
          const data = await res.json();
          const hoursMap: Record<
            string,
            { totalHours: number; usedHours: number; remainingHours: number }
          > = {};
          data.useCaseHours?.forEach((uc: any) => {
            hoursMap[uc.useCaseId] = {
              totalHours: uc.totalHours,
              usedHours: uc.usedHours,
              remainingHours: uc.remainingHours,
            };
          });
          setUseCaseHours(hoursMap);
        }
      } catch (err) {
        console.error('Failed to fetch use case hours:', err);
      } finally {
        setLoadingHours(false);
      }
    };
    if (userId) fetchUseCaseHours();
  }, [userId, initialReport?.id]);

  // Check for duplicate report (same week/year, not editing own report)
  const duplicateExists = existingReports.some(
    r =>
      r.weekNumber === weekNumber &&
      r.year === year &&
      r.id !== initialReport?.id
  );

  // Check if any entry exceeds remaining hours
  const hasOverbooking = entries.some(e => {
    const ucHours = useCaseHours[e.useCaseId];
    if (!ucHours) return false;
    return e.actualHours > ucHours.remainingHours;
  });

  // 40h/week maximum check (§ 8 JArbSchG)
  const MAX_WEEKLY_HOURS = 40;

  // Get remaining hours for a use case (considering current entries)
  const getRemainingHours = (useCaseId: string): number => {
    const ucHours = useCaseHours[useCaseId];
    if (!ucHours) return 999; // Unknown, allow
    return ucHours.remainingHours;
  };

  // Check if use case is exhausted (0 remaining)
  const isExhausted = (useCaseId: string): boolean => {
    const ucHours = useCaseHours[useCaseId];
    if (!ucHours) return false;
    return ucHours.remainingHours <= 0;
  };

  const toggleComponent = (componentId: string) => {
    const newExpanded = new Set(expandedComponents);
    if (newExpanded.has(componentId)) {
      newExpanded.delete(componentId);
    } else {
      newExpanded.add(componentId);
    }
    setExpandedComponents(newExpanded);
  };

  const addEntry = (useCase: TrainingUseCase) => {
    if (entries.some(e => e.useCaseId === useCase.id)) return;
    setEntries([
      ...entries,
      {
        useCaseId: useCase.id,
        actualHours: 0,
        notes: '',
        traineeGrade: null,
      },
    ]);
  };

  const updateEntry = (
    useCaseId: string,
    field: 'actualHours' | 'notes' | 'traineeGrade',
    value: number | string | null
  ) => {
    setEntries(
      entries.map(e =>
        e.useCaseId === useCaseId ? { ...e, [field]: value } : e
      )
    );
  };

  const removeEntry = (useCaseId: string) => {
    setEntries(entries.filter(e => e.useCaseId !== useCaseId));
  };

  const getUseCaseById = (id: string) => {
    for (const ucs of Object.values(useCasesByComponent)) {
      const found = ucs.find(uc => uc.id === id);
      if (found) return found;
    }
    return null;
  };

  const getComponentById = (id: string) => components.find(c => c.id === id);

  // Check for overbooking
  const checkOverbooked = (useCaseId: string, actualHours: number) => {
    const useCase = getUseCaseById(useCaseId);
    return useCase && actualHours > useCase.plannedHours;
  };

  // Calculate totals
  const totalPlannedHours = entries.reduce((sum, e) => {
    const uc = getUseCaseById(e.useCaseId);
    return sum + (uc?.plannedHours || 0);
  }, 0);

  const totalActualHours = entries.reduce((sum, e) => sum + e.actualHours, 0);
  const exceeds40h = totalActualHours > MAX_WEEKLY_HOURS;

  // Validation helpers
  const periodValid =
    weekNumber >= 1 &&
    weekNumber <= 53 &&
    year >= 2020 &&
    year <= 2100;

  const entriesValid =
    entries.length > 0 &&
    entries.every(
      e =>
        e.actualHours > 0 &&
        typeof e.actualHours === 'number' &&
        e.notes.trim().length > 0
    );

  const allSkillsRated = COMPETENCY_AREAS.every(area => skillSelfRatings[area]);

  const canSubmit =
    !saving &&
    !duplicateExists &&
    !hasOverbooking &&
    !exceeds40h &&
    periodValid &&
    entriesValid &&
    allSkillsRated;

  const handleSave = async (submit: boolean = false) => {
    try {
      setSaving(true);
      setError(null);

      // Client-side validation with clear error messages
      if (entries.length === 0) {
        setError(
          t('reports.error.noEntries') ||
            'Bitte fügen Sie mindestens eine Tätigkeit hinzu.'
        );
        setSaving(false);
        return;
      }

      const missingHours = entries.filter(
        e => !e.actualHours || e.actualHours <= 0
      );
      if (missingHours.length > 0) {
        setError(
          t('reports.error.missingHours') ||
            'Bitte tragen Sie für alle Tätigkeiten die IST-Stunden ein (> 0).'
        );
        setSaving(false);
        return;
      }

      const missingNotes = entries.filter(
        e => !e.notes || e.notes.trim().length === 0
      );
      if (submit && missingNotes.length > 0) {
        setError(
          t('reports.error.missingNotes') ||
            'Bitte beschreiben Sie für alle Tätigkeiten, was Sie gelernt haben.'
        );
        setSaving(false);
        return;
      }

      if (!periodValid) {
        setError(
          'Bitte geben Sie eine gültige Kalenderwoche (1-53) und Jahr an.'
        );
        setSaving(false);
        return;
      }

      // 40h/week maximum check
      if (totalActualHours > MAX_WEEKLY_HOURS) {
        setError(
          `Maximale Wochenstunden überschritten: ${totalActualHours} Std. eingetragen, aber maximal ${MAX_WEEKLY_HOURS} Std. pro Woche zulässig (§ 8 JArbSchG).`
        );
        setSaving(false);
        return;
      }

      // Mandatory skill self-ratings when submitting
      if (submit && !COMPETENCY_AREAS.every(area => skillSelfRatings[area])) {
        setError(
          'Bitte bewerten Sie alle Kompetenzbereiche (Fachkompetenz, Methodenkompetenz, Personalkompetenz) mit einer Note 1-6.'
        );
        setSaving(false);
        return;
      }

      const { start: periodStart, end: periodEnd } = getISOWeekDates(
        weekNumber,
        year
      );

      const url = initialReport
        ? `/api/activity-reports/${initialReport.id}`
        : '/api/activity-reports';
      const method = initialReport ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          weekNumber,
          year,
          ausbildungsjahr,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          entries: entries.map(e => ({
            useCaseId: e.useCaseId,
            plannedHours: getUseCaseById(e.useCaseId)?.plannedHours || 0,
            actualHours: e.actualHours,
            isOverbooked: checkOverbooked(e.useCaseId, e.actualHours),
            notes: e.notes || null,
            traineeGrade: e.traineeGrade || null,
          })),
          skillSelfRatings,
          submit,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t('reports.error.save'));
      }

      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="bg-card border-border flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border">
        {/* Header */}
        <div className="border-border/50 flex items-center justify-between border-b p-6">
          <div>
            <h2 className="text-foreground text-xl font-bold">
              {initialReport ? t('reports.modal.edit') : t('reports.modal.new')}
            </h2>
            <p className="text-muted-foreground text-sm">
              {t('reports.modal.instructions')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="hover:bg-muted rounded-lg p-2 transition-colors"
          >
            <X className="text-muted-foreground h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {duplicateExists && (
            <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-500">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {t('reports.modal.duplicate')
                .replace('{week}', String(weekNumber))
                .replace('{year}', String(year))}
            </div>
          )}

          {hasOverbooking && (
            <div className="bg-destructive/10 border-destructive/30 text-destructive flex items-center gap-2 rounded-lg border p-3 text-sm">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {t('reports.modal.overbooking')}
            </div>
          )}

          {exceeds40h && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {t('reports.error.exceeds40h')
                .replace('{hours}', String(totalActualHours))
                .replace('{max}', String(MAX_WEEKLY_HOURS))}
            </div>
          )}

          {error && (
            <div className="bg-destructive/10 border-destructive/30 text-destructive rounded-lg border p-3 text-sm">
              {error}
            </div>
          )}

          {/* Period Selection */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-foreground mb-2 block text-sm font-medium">
                {t('reports.calendarWeek')}
              </label>
              <input
                type="number"
                min={1}
                max={53}
                value={weekNumber}
                onChange={e => setWeekNumber(Number(e.target.value))}
                className="bg-background border-border text-foreground w-full rounded-lg border px-3 py-2"
              />
            </div>
            <div>
              <label className="text-foreground mb-2 block text-sm font-medium">
                {t('reports.yearLabel')}
              </label>
              <input
                type="number"
                min={2020}
                max={2100}
                value={year}
                onChange={e => setYear(Number(e.target.value))}
                className="bg-background border-border text-foreground w-full rounded-lg border px-3 py-2"
              />
            </div>
          </div>

          {/* Selected Entries */}
          {entries.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-foreground text-lg font-semibold">
                {t('reports.selectedActivities')}
              </h3>
              {entries.map(entry => {
                const useCase = getUseCaseById(entry.useCaseId);
                const component = useCase
                  ? getComponentById(useCase.componentId)
                  : null;
                const isOverbooked = checkOverbooked(
                  entry.useCaseId,
                  entry.actualHours
                );

                return (
                  <div
                    key={entry.useCaseId}
                    className={`rounded-lg border p-4 ${isOverbooked ? 'border-yellow-500/50 bg-yellow-500/10' : 'border-border bg-muted/30'}`}
                  >
                    <div className="mb-3 flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-muted-foreground mb-1 text-xs">
                          {component?.title}
                        </p>
                        <p className="text-foreground font-medium">
                          {useCase?.letter}) {useCase?.description}
                        </p>
                      </div>
                      <button
                        onClick={() => removeEntry(entry.useCaseId)}
                        className="hover:bg-destructive/20 text-destructive rounded p-1"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="text-muted-foreground text-xs">
                          {t('reports.plannedHours')}
                        </label>
                        <p className="text-foreground font-medium">
                          {useCase?.plannedHours} {t('reports.hours')}
                        </p>
                        {/* Remaining hours indicator */}
                        {(() => {
                          const ucHours = useCaseHours[entry.useCaseId];
                          if (!ucHours) return null;
                          const remaining = ucHours.remainingHours;
                          const usedPercent = Math.min(
                            100,
                            ((ucHours.usedHours + entry.actualHours) /
                              ucHours.totalHours) *
                              100
                          );
                          const wouldExceed = entry.actualHours > remaining;
                          return (
                            <div className="mt-1.5">
                              <div className="mb-0.5 flex items-center justify-between">
                                <span
                                  className={`text-[10px] ${wouldExceed ? 'font-medium text-red-400' : 'text-muted-foreground'}`}
                                >
                                  {remaining.toFixed(1)}{' '}
                                  {t('reports.hoursRemaining')}
                                </span>
                              </div>
                              <div className="bg-muted/50 h-1.5 w-full overflow-hidden rounded-full">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    wouldExceed
                                      ? 'bg-red-500'
                                      : usedPercent > 80
                                        ? 'bg-yellow-500'
                                        : 'bg-green-500'
                                  }`}
                                  style={{
                                    width: `${Math.min(100, usedPercent)}%`,
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                      <div>
                        <label className="text-muted-foreground mb-1 block text-xs">
                          {t('reports.actualHours')}
                        </label>
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          value={entry.actualHours}
                          onChange={e =>
                            updateEntry(
                              entry.useCaseId,
                              'actualHours',
                              Math.max(0, Number(e.target.value) || 0)
                            )
                          }
                          className={`bg-background text-foreground w-full rounded border px-3 py-1.5 ${
                            isOverbooked ? 'border-yellow-500' : 'border-border'
                          }`}
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="text-muted-foreground mb-1 block text-xs">
                          {t('reports.notesLabel')}
                        </label>
                        <textarea
                          value={entry.notes}
                          onChange={e =>
                            updateEntry(
                              entry.useCaseId,
                              'notes',
                              e.target.value
                            )
                          }
                          placeholder={t('reports.notesPlaceholder')}
                          rows={3}
                          className="bg-background border-border text-foreground min-h-[60px] w-full resize-y rounded border px-3 py-1.5"
                        />
                      </div>
                    </div>

                    {/* Trainee Self-Grading */}
                    <div className="border-border/30 mt-3 border-t pt-3">
                      <label className="text-muted-foreground mb-2 block text-xs">
                        {t('reports.selfGrade')}
                      </label>
                      <div className="flex items-center gap-1.5">
                        {(['1', '2', '3', '4', '5', '6'] as const).map(
                          grade => {
                            const isSelected = entry.traineeGrade === grade;
                            return (
                              <button
                                key={grade}
                                type="button"
                                onClick={() =>
                                  updateEntry(
                                    entry.useCaseId,
                                    'traineeGrade',
                                    isSelected ? null : grade
                                  )
                                }
                                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-all duration-150 ${
                                  isSelected
                                    ? Number(grade) <= 2
                                      ? 'scale-110 bg-green-500 text-white ring-2 ring-green-400/50'
                                      : Number(grade) <= 4
                                        ? 'scale-110 bg-yellow-500 text-white ring-2 ring-yellow-400/50'
                                        : 'scale-110 bg-red-500 text-white ring-2 ring-red-400/50'
                                    : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                                }`}
                              >
                                {grade}
                              </button>
                            );
                          }
                        )}
                        {entry.traineeGrade && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            {entry.traineeGrade === '1'
                              ? t('reports.gradeLabels.1')
                              : entry.traineeGrade === '2'
                                ? t('reports.gradeLabels.2')
                                : entry.traineeGrade === '3'
                                  ? t('reports.gradeLabels.3')
                                  : entry.traineeGrade === '4'
                                    ? t('reports.gradeLabels.4')
                                    : entry.traineeGrade === '5'
                                      ? t('reports.gradeLabels.5')
                                      : t('reports.gradeLabels.6')}
                          </span>
                        )}
                      </div>
                    </div>

                    {isOverbooked && (
                      <div className="mt-2 flex items-center gap-2 text-sm text-yellow-500">
                        <AlertTriangle className="h-4 w-4" />
                        <span>
                          {t('reports.overbookedDetails').replace(
                            '{hours}',
                            (
                              entry.actualHours - (useCase?.plannedHours || 0)
                            ).toFixed(1)
                          )}
                        </span>
                      </div>
                    )}

                    {/* Exceeded remaining hours warning */}
                    {(() => {
                      const ucHours = useCaseHours[entry.useCaseId];
                      if (
                        !ucHours ||
                        entry.actualHours <= ucHours.remainingHours
                      )
                        return null;
                      return (
                        <div className="mt-2 flex items-center gap-2 text-sm text-red-400">
                          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                          <span>
                            {t('reports.exceedsRemaining')
                              .replace('{entered}', String(entry.actualHours))
                              .replace(
                                '{remaining}',
                                ucHours.remainingHours.toFixed(1)
                              )
                              .replace('{total}', String(ucHours.totalHours))}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}

              {/* Totals */}
              <div
                className={`rounded-lg p-4 ${exceeds40h ? 'border border-red-500/30 bg-red-500/5' : 'bg-muted/50'}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    <div>
                      <p className="text-muted-foreground text-xs">
                        {t('reports.totalPlanned')}
                      </p>
                      <p className="text-foreground text-lg font-bold">
                        {totalPlannedHours} {t('reports.hours')}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">
                        {t('reports.totalActual')}
                      </p>
                      <p
                        className={`text-lg font-bold ${exceeds40h ? 'text-red-500' : totalActualHours > totalPlannedHours ? 'text-yellow-500' : 'text-foreground'}`}
                      >
                        {totalActualHours} / {MAX_WEEKLY_HOURS}{' '}
                        {t('reports.hours')}
                      </p>
                    </div>
                  </div>
                  {totalActualHours > totalPlannedHours && !exceeds40h && (
                    <div className="flex items-center gap-2 text-yellow-500">
                      <AlertTriangle className="h-5 w-5" />
                      <span className="font-medium">
                        +{(totalActualHours - totalPlannedHours).toFixed(1)}{' '}
                        {t('reports.hours')}
                      </span>
                    </div>
                  )}
                  {exceeds40h && (
                    <div className="flex items-center gap-2 text-red-500">
                      <AlertTriangle className="h-5 w-5" />
                      <span className="text-sm font-medium">
                        +{(totalActualHours - MAX_WEEKLY_HOURS).toFixed(1)}{' '}
                        {t('reports.hours')} über Limit
                      </span>
                    </div>
                  )}
                </div>
                {/* Weekly hours progress bar */}
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">
                      {t('reports.weeklyHoursLimit')}
                    </span>
                    <span
                      className={`text-xs font-medium ${exceeds40h ? 'text-red-500' : totalActualHours > 32 ? 'text-yellow-500' : 'text-green-500'}`}
                    >
                      {totalActualHours} / {MAX_WEEKLY_HOURS} Std.
                    </span>
                  </div>
                  <div className="bg-muted/50 h-2 w-full overflow-hidden rounded-full">
                    <div
                      className={`h-full rounded-full transition-all ${exceeds40h ? 'bg-red-500' : totalActualHours > 32 ? 'bg-yellow-500' : 'bg-green-500'}`}
                      style={{
                        width: `${Math.min(100, (totalActualHours / MAX_WEEKLY_HOURS) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Skill Self-Rating Section */}
          <div className="border-border rounded-xl border p-4">
            <h3 className="text-foreground mb-1 text-lg font-semibold">
              {t('reports.skillSelfRating')}
            </h3>
            <p className="text-muted-foreground mb-4 text-xs">
              {t('reports.skillSelfRatingInfo')}
            </p>
            <div className="space-y-3">
              {COMPETENCY_AREAS.map(area => {
                const areaLabels: Record<string, string> = {
                  FACHKOMPETENZ: t('reports.fachkompetenz'),
                  METHODENKOMPETENZ: t('reports.methodenkompetenz'),
                  PERSONALKOMPETENZ: t('reports.personalkompetenz'),
                };
                const areaDescriptions: Record<string, string> = {
                  FACHKOMPETENZ: 'Sorgfalt, Qualitätsbewusstsein',
                  METHODENKOMPETENZ:
                    'Problemlösung, Zeitmanagement, Analytisches Denken',
                  PERSONALKOMPETENZ:
                    'Zuverlässigkeit, Selbstständigkeit, Lernbereitschaft',
                };
                const selectedGrade = skillSelfRatings[area];

                return (
                  <div
                    key={area}
                    className="border-border/50 bg-card hover:bg-muted/20 rounded-xl border p-4 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h4 className="text-foreground text-sm font-semibold">
                          {areaLabels[area] || area}
                        </h4>
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          {areaDescriptions[area]}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {(['1', '2', '3', '4', '5', '6'] as const).map(
                          grade => {
                            const isSelected = selectedGrade === grade;
                            return (
                              <button
                                key={grade}
                                type="button"
                                onClick={() =>
                                  setSkillSelfRatings(prev => ({
                                    ...prev,
                                    [area]: isSelected ? null : grade,
                                  }))
                                }
                                className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-semibold transition-all duration-150 ${
                                  isSelected
                                    ? Number(grade) <= 2
                                      ? 'scale-110 bg-green-500 text-white shadow-md ring-2 shadow-green-500/30 ring-green-400/50'
                                      : Number(grade) <= 4
                                        ? 'scale-110 bg-yellow-500 text-white shadow-md ring-2 shadow-yellow-500/30 ring-yellow-400/50'
                                        : 'scale-110 bg-red-500 text-white shadow-md ring-2 shadow-red-500/30 ring-red-400/50'
                                    : 'bg-muted hover:bg-muted-foreground/10 text-muted-foreground hover:text-foreground border-border/50 border'
                                }`}
                              >
                                {grade}
                              </button>
                            );
                          }
                        )}
                      </div>
                    </div>
                    {selectedGrade && (
                      <div className="mt-2 text-right">
                        <span
                          className={`text-xs font-medium ${
                            Number(selectedGrade) <= 2
                              ? 'text-green-500'
                              : Number(selectedGrade) <= 4
                                ? 'text-yellow-500'
                                : 'text-red-500'
                          }`}
                        >
                          {selectedGrade === '1'
                            ? t('reports.gradeLabels.1')
                            : selectedGrade === '2'
                              ? t('reports.gradeLabels.2')
                              : selectedGrade === '3'
                                ? t('reports.gradeLabels.3')
                                : selectedGrade === '4'
                                  ? t('reports.gradeLabels.4')
                                  : selectedGrade === '5'
                                    ? t('reports.gradeLabels.5')
                                    : t('reports.gradeLabels.6')}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Component/Use Case Selector */}
          <div className="space-y-3">
            <h3 className="text-foreground text-lg font-semibold">
              {t('reports.addActivity')}
            </h3>
            <div className="border-border max-h-96 space-y-2 overflow-y-auto rounded-lg border p-2">
              {/* Section 1: duration-aware module phase 1 */}
              <div className="mb-4">
                <h4 className="text-muted-foreground mb-2 px-2 text-sm font-bold tracking-wider uppercase">
                  {formatModalPhaseLabel(1)}
                </h4>
                {components
                  .filter(c => c.trainingYear === 1)
                  .sort((a, b) => a.orderIndex - b.orderIndex)
                  .map(component => (
                    <ComponentItem
                      key={component.id}
                      component={component}
                      isExpanded={expandedComponents.has(component.id)}
                      onToggle={() => toggleComponent(component.id)}
                      useCases={useCasesByComponent[component.id] || []}
                      entries={entries}
                      onAddEntry={addEntry}
                      useCaseHours={useCaseHours}
                    />
                  ))}
              </div>

              {/* Section 2: duration-aware module phase 2 */}
              <div className="mb-4">
                <h4 className="text-muted-foreground mb-2 px-2 text-sm font-bold tracking-wider uppercase">
                  {formatModalPhaseLabel(2)}
                </h4>
                {components
                  .filter(c => c.trainingYear === 2)
                  .sort((a, b) => a.orderIndex - b.orderIndex)
                  .map(component => (
                    <ComponentItem
                      key={component.id}
                      component={component}
                      isExpanded={expandedComponents.has(component.id)}
                      onToggle={() => toggleComponent(component.id)}
                      useCases={useCasesByComponent[component.id] || []}
                      entries={entries}
                      onAddEntry={addEntry}
                      useCaseHours={useCaseHours}
                    />
                  ))}
              </div>

              {/* Section 3: Integrative */}
              <div className="mb-4">
                <h4 className="text-muted-foreground mb-2 px-2 text-sm font-bold tracking-wider uppercase">
                  {t('reports.integrativePhase')}
                </h4>
                {components
                  .filter(c => c.trainingYear === 3 || !c.trainingYear) // Fallback for any others
                  .sort((a, b) => a.orderIndex - b.orderIndex)
                  .map(component => (
                    <ComponentItem
                      key={component.id}
                      component={component}
                      isExpanded={expandedComponents.has(component.id)}
                      onToggle={() => toggleComponent(component.id)}
                      useCases={useCasesByComponent[component.id] || []}
                      entries={entries}
                      onAddEntry={addEntry}
                      useCaseHours={useCaseHours}
                    />
                  ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-border/50 flex items-center justify-between border-t p-6">
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground px-4 py-2 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleSave(false)}
              disabled={
                saving ||
                entries.length === 0 ||
                duplicateExists ||
                hasOverbooking ||
                exceeds40h
              }
              className="bg-muted text-foreground hover:bg-muted/80 flex items-center gap-2 rounded-lg px-4 py-2 transition-colors disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {t('reports.saveAsDraft')}
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={!canSubmit}
              className="bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-2 rounded-lg px-4 py-2 transition-colors disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {t('common.submit')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Report Detail Modal Component
function ReportDetailModal({
  report,
  components,
  useCases,
  useCasesByComponent,
  onClose,
  onUpdated,
}: {
  report: ActivityReport;
  components: TrainingComponent[];
  useCases: TrainingUseCase[];
  useCasesByComponent: Record<string, TrainingUseCase[]>;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const [entries, setEntries] = useState<ReportUseCaseEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Skill self-ratings state
  const COMPETENCY_AREAS_DETAIL = [
    'FACHKOMPETENZ',
    'METHODENKOMPETENZ',
    'PERSONALKOMPETENZ',
  ] as const;
  const [skillSelfRatings, setSkillSelfRatings] = useState<
    Record<string, string | null>
  >({
    FACHKOMPETENZ: null,
    METHODENKOMPETENZ: null,
    PERSONALKOMPETENZ: null,
  });
  const [trainerSkillRatings, setTrainerSkillRatings] = useState<
    Record<string, string | null>
  >({
    FACHKOMPETENZ: null,
    METHODENKOMPETENZ: null,
    PERSONALKOMPETENZ: null,
  });
  const [savingSkills, setSavingSkills] = useState(false);
  const [skillsSaved, setSkillsSaved] = useState(false);

  const [locallySubmitted, setLocallySubmitted] = useState(false);

  // One-time submission: check if skills were already submitted (from DB or just saved)
  const isSkillsSubmitted =
    locallySubmitted ||
    Boolean(
      report.skillSelfRatings &&
      typeof report.skillSelfRatings === 'object' &&
      Object.values(report.skillSelfRatings).some(v => v)
    );

  useEffect(() => {
    loadEntries();
    loadSkillRatings();
  }, [report.id]);

  // Initialize skill self-ratings from report
  useEffect(() => {
    if (
      report.skillSelfRatings &&
      typeof report.skillSelfRatings === 'object'
    ) {
      setSkillSelfRatings({
        FACHKOMPETENZ: report.skillSelfRatings.FACHKOMPETENZ || null,
        METHODENKOMPETENZ: report.skillSelfRatings.METHODENKOMPETENZ || null,
        PERSONALKOMPETENZ: report.skillSelfRatings.PERSONALKOMPETENZ || null,
      });
    }
  }, [report.skillSelfRatings]);

  const loadEntries = async () => {
    try {
      const res = await fetch(`/api/activity-reports/${report.id}/entries`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } catch (err) {
      console.error('Error loading entries:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load trainer skill ratings from weekly evaluations
  const loadSkillRatings = async () => {
    try {
      const res = await fetch(
        `/api/weekly-evaluations?activityReportId=${report.id}`,
        {
          cache: 'no-store',
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.softskillRatings && data.softskillRatings.length > 0) {
          const ratings: Record<string, string | null> = {
            FACHKOMPETENZ: null,
            METHODENKOMPETENZ: null,
            PERSONALKOMPETENZ: null,
          };
          for (const r of data.softskillRatings) {
            if (r.competencyArea && r.trainerRating) {
              ratings[r.competencyArea] = String(r.trainerRating);
            }
          }
          setTrainerSkillRatings(ratings);
        }
      }
    } catch (err) {
      console.error('Error loading skill ratings:', err);
    }
  };

  const handleSaveSkillRatings = async () => {
    if (!profile?.id) return;
    setSavingSkills(true);
    try {
      const res = await fetch(
        `/api/activity-reports/${report.id}/skill-ratings`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: profile.id,
            skillSelfRatings,
          }),
        }
      );
      if (res.ok) {
        setLocallySubmitted(true);
        setSkillsSaved(true);
        setTimeout(() => setSkillsSaved(false), 3000);
      } else {
        const data = await res.json();
        toast.error(data.error || 'Fehler beim Speichern');
      }
    } catch (err) {
      toast.error('Fehler beim Speichern');
    } finally {
      setSavingSkills(false);
    }
  };

  const handleSubmitDraftReport = async () => {
    if (!profile?.id || report.status !== 'DRAFT') return;

    const missingNotes = entries.filter(
      entry => !entry.notes || entry.notes.trim().length === 0
    );
    const missingGrades = entries.filter(entry => !entry.traineeGrade);
    const missingSkills = COMPETENCY_AREAS_DETAIL.filter(
      area => !skillSelfRatings[area]
    );

    if (missingNotes.length > 0 || missingGrades.length > 0 || missingSkills.length > 0) {
      toast.error('Bitte fülle Notizen, Selbstbewertungen und Kompetenzbewertungen vollständig aus.');
      return;
    }

    setSavingSkills(true);
    try {
      const res = await fetch(`/api/activity-reports/${report.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: profile.id,
          weekNumber: report.weekNumber,
          year: report.year,
          ausbildungsjahr: report.ausbildungsjahr,
          periodStart: report.periodStart,
          periodEnd: report.periodEnd,
          entries: entries.map(entry => ({
            useCaseId: entry.useCaseId,
            plannedHours: entry.plannedHours,
            actualHours: entry.actualHours,
            isOverbooked: entry.isOverbooked,
            notes: entry.notes,
            traineeGrade: entry.traineeGrade,
          })),
          skillSelfRatings,
          submit: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t('reports.error.save'));
      }

      toast.success(t('reports.status.submitted'));
      onUpdated();
      onClose();
    } catch (err: any) {
      toast.error(err.message || t('reports.error.save'));
    } finally {
      setSavingSkills(false);
    }
  };

  const getUseCaseById = (id: string) => useCases.find(uc => uc.id === id);
  const getComponentById = (id: string) => components.find(c => c.id === id);
  const detailProfileDurationYears =
    (profile as { ausbildungDurationYears?: number | null } | null)
      ?.ausbildungDurationYears ?? profile?.ausbildung_duration_years;
  const detailDurationYears = normalizeDurationYears(
    detailProfileDurationYears
  );
  const formatDetailPhaseLabel = (phase: number) => {
    if (phase === 3) return t('reports.integrativePhase');
    const range = getPhaseMonthRange(
      detailDurationYears,
      phase as TrainingPhase
    );
    return t('reports.phaseRange')
      .replace('{phase}', String(phase))
      .replace('{start}', String(range.startMonth))
      .replace('{end}', String(range.endMonth));
  };

  const areaLabels: Record<string, string> = {
    FACHKOMPETENZ: t('reports.fachkompetenz'),
    METHODENKOMPETENZ: t('reports.methodenkompetenz'),
    PERSONALKOMPETENZ: t('reports.personalkompetenz'),
  };
  const areaDescriptions: Record<string, string> = {
    FACHKOMPETENZ: 'Sorgfalt, Qualitätsbewusstsein',
    METHODENKOMPETENZ: 'Problemlösung, Zeitmanagement, Analytisches Denken',
    PERSONALKOMPETENZ: 'Zuverlässigkeit, Selbstständigkeit, Lernbereitschaft',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="bg-card border-border flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border">
        {/* Header */}
        <div className="border-border/50 flex items-center justify-between border-b p-6">
          <div>
            <h2 className="text-foreground text-xl font-bold">
              {t('nav.activityReports')}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('reports.week')} {report.weekNumber} / {report.year} &middot;{' '}
              {formatDetailPhaseLabel(report.ausbildungsjahr)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="hover:bg-muted rounded-lg p-2 transition-colors"
          >
            <X className="text-muted-foreground h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="border-accent h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
            </div>
          ) : entries.length === 0 ? (
            <p className="text-muted-foreground py-12 text-center">
              {t('reports.noEntries')}
            </p>
          ) : (
            <div className="space-y-4">
              {entries.map(entry => {
                const useCase = getUseCaseById(entry.useCaseId);
                const component = useCase
                  ? getComponentById(useCase.componentId)
                  : null;

                return (
                  <div
                    key={entry.id}
                    className={`rounded-lg border p-4 ${entry.isOverbooked ? 'border-yellow-500/50 bg-yellow-500/10' : 'border-border bg-muted/30'}`}
                  >
                    <p className="text-muted-foreground mb-1 text-xs">
                      {component?.title}
                    </p>
                    <p className="text-foreground mb-3 font-medium">
                      {useCase?.letter}) {useCase?.description}
                    </p>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-muted-foreground text-xs">
                          {t('reports.plannedHours')}
                        </p>
                        <p className="text-foreground font-medium">
                          {entry.plannedHours} {t('reports.hours')}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">
                          {t('reports.actualHours')}
                        </p>
                        <p
                          className={`font-medium ${entry.isOverbooked ? 'text-yellow-500' : 'text-foreground'}`}
                        >
                          {entry.actualHours} {t('reports.hours')}
                        </p>
                      </div>
                    </div>

                    {entry.notes && (
                      <p className="text-muted-foreground mt-2 text-sm">
                        {t('reports.notesLabel')}: {entry.notes}
                      </p>
                    )}

                    {/* Grades row: trainee self-grade + trainer grade side by side */}
                    <div className="bg-muted/30 border-border/30 mt-3 rounded-lg border p-3">
                      <div className="flex flex-wrap items-center gap-6">
                        {/* Trainee self-grade */}
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground text-xs">
                            {t('reports.selfGradeLabel')}
                          </span>
                          {entry.traineeGrade ? (
                            <span
                              className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold text-white ${
                                Number(entry.traineeGrade) <= 2
                                  ? 'bg-green-500'
                                  : Number(entry.traineeGrade) <= 4
                                    ? 'bg-yellow-500'
                                    : 'bg-red-500'
                              }`}
                            >
                              {entry.traineeGrade}
                            </span>
                          ) : (
                            <span
                              className="bg-muted text-muted-foreground border-border/50 inline-flex h-7 w-7 items-center justify-center rounded-full border text-sm font-bold"
                              title={t('reports.gradePending')}
                            >
                              –
                            </span>
                          )}
                        </div>

                        {/* Trainer grade or pending */}
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground text-xs">
                            {t('reports.trainerGrade')}
                          </span>
                          {entry.trainerGrade ? (
                            <span
                              className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold text-white ${
                                Number(entry.trainerGrade) <= 2
                                  ? 'bg-green-500'
                                  : Number(entry.trainerGrade) <= 4
                                    ? 'bg-yellow-500'
                                    : 'bg-red-500'
                              }`}
                            >
                              {entry.trainerGrade}
                            </span>
                          ) : (
                            <span
                              className="bg-muted text-muted-foreground border-border/50 inline-flex h-7 w-7 items-center justify-center rounded-full border text-sm font-bold"
                              title={t('reports.gradePending')}
                            >
                              ?
                            </span>
                          )}
                        </div>

                        {/* Grade comment from trainer */}
                        {entry.gradeComment && (
                          <p className="text-muted-foreground flex-1 text-xs italic">
                            &quot;{entry.gradeComment}&quot;
                          </p>
                        )}
                      </div>
                    </div>

                    {entry.isOverbooked && (
                      <div className="mt-2 flex items-center gap-2 text-sm text-yellow-500">
                        <AlertTriangle className="h-4 w-4" />
                        <span>{t('reports.overbooked')}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Skill Self-Rating Section */}
          <div className="border-border mt-6 rounded-xl border p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-foreground text-lg font-semibold">
                  {t('reports.skillSelfRating')}
                </h3>
                <p className="text-muted-foreground text-xs">
                  {t('reports.skillSelfRatingInfo')}
                </p>
              </div>
              {isSkillsSubmitted && !skillsSaved && (
                <span className="text-muted-foreground flex items-center gap-1 text-xs">
                  <Check className="h-3.5 w-3.5" /> Abgegeben
                </span>
              )}
              {skillsSaved && (
                <span className="flex items-center gap-1 text-xs text-green-500">
                  <Check className="h-3.5 w-3.5" /> Gespeichert
                </span>
              )}
            </div>
            <div className="space-y-3">
              {COMPETENCY_AREAS_DETAIL.map(area => {
                const selfGrade = skillSelfRatings[area];
                const trainerGrade = trainerSkillRatings[area];

                return (
                  <div
                    key={area}
                    className="border-border/50 bg-card hover:bg-muted/20 rounded-xl border p-4 transition-colors"
                  >
                    <div className="mb-3">
                      <h4 className="text-foreground text-sm font-semibold">
                        {areaLabels[area] || area}
                      </h4>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {areaDescriptions[area]}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-4">
                      {/* Trainee self-rating - editable only if not yet submitted */}
                      <div>
                        <span className="text-muted-foreground mb-1.5 block text-[10px] font-medium tracking-wider uppercase">
                          {t('reports.selfGradeLabel')}
                        </span>
                        {isSkillsSubmitted ? (
                          /* Read-only badge after submission */
                          selfGrade ? (
                            <span
                              className={`inline-flex h-8 w-8 items-center justify-center rounded-xl text-sm font-bold ${
                                Number(selfGrade) <= 2
                                  ? 'bg-green-500/15 text-green-500 ring-1 ring-green-500/20'
                                  : Number(selfGrade) <= 4
                                    ? 'bg-yellow-500/15 text-yellow-500 ring-1 ring-yellow-500/20'
                                    : 'bg-red-500/15 text-red-500 ring-1 ring-red-500/20'
                              }`}
                            >
                              {selfGrade}
                            </span>
                          ) : (
                            <span className="bg-muted/50 text-muted-foreground/30 inline-flex h-8 w-8 items-center justify-center rounded-xl font-bold">
                              –
                            </span>
                          )
                        ) : (
                          <div className="flex items-center gap-1">
                            {(['1', '2', '3', '4', '5', '6'] as const).map(
                              grade => {
                                const isSelected = selfGrade === grade;
                                return (
                                  <button
                                    key={grade}
                                    type="button"
                                    onClick={() =>
                                      setSkillSelfRatings(prev => ({
                                        ...prev,
                                        [area]: isSelected ? null : grade,
                                      }))
                                    }
                                    className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold transition-all duration-150 ${
                                      isSelected
                                        ? Number(grade) <= 2
                                          ? 'scale-110 bg-green-500 text-white shadow-md ring-2 shadow-green-500/30 ring-green-400/50'
                                          : Number(grade) <= 4
                                            ? 'scale-110 bg-yellow-500 text-white shadow-md ring-2 shadow-yellow-500/30 ring-yellow-400/50'
                                            : 'scale-110 bg-red-500 text-white shadow-md ring-2 shadow-red-500/30 ring-red-400/50'
                                        : 'bg-muted hover:bg-muted-foreground/10 text-muted-foreground hover:text-foreground border-border/50 border'
                                    }`}
                                  >
                                    {grade}
                                  </button>
                                );
                              }
                            )}
                          </div>
                        )}
                      </div>

                      {/* Trainer rating - read only */}
                      <div>
                        <span className="text-muted-foreground mb-1.5 block text-[10px] font-medium tracking-wider uppercase">
                          {t('reports.trainerGrade')}
                        </span>
                        {trainerGrade ? (
                          <span
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-xl text-sm font-bold ${
                              Number(trainerGrade) <= 2
                                ? 'bg-green-500/15 text-green-500 ring-1 ring-green-500/20'
                                : Number(trainerGrade) <= 4
                                  ? 'bg-yellow-500/15 text-yellow-500 ring-1 ring-yellow-500/20'
                                  : 'bg-red-500/15 text-red-500 ring-1 ring-red-500/20'
                            }`}
                          >
                            {trainerGrade}
                          </span>
                        ) : (
                          <span
                            className="bg-muted/50 text-muted-foreground/30 inline-flex h-8 w-8 items-center justify-center rounded-xl font-bold"
                            title={t('reports.gradePending')}
                          >
                            ?
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Save button - only shown if not yet submitted */}
            {!isSkillsSubmitted && (
              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleSaveSkillRatings}
                  disabled={savingSkills}
                  className="bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors disabled:opacity-50"
                >
                  {savingSkills ? (
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {t('reports.skillSelfRating').replace(' *', '')} speichern
                </button>
              </div>
            )}
          </div>

          {report.reviewerFeedback && (
            <div
              className={`mt-6 rounded-lg border p-4 ${
                report.status === 'REJECTED'
                  ? 'bg-destructive/10 border-destructive/30'
                  : 'bg-accent/10 border-accent/30'
              }`}
            >
              <h4
                className={`mb-2 font-medium ${
                  report.status === 'REJECTED'
                    ? 'text-destructive'
                    : 'text-foreground'
                }`}
              >
                {report.status === 'REJECTED'
                  ? t('reports.trainerFeedback').replace(':', '')
                  : t('reports.trainerComment')}
              </h4>
              <p
                className={`text-sm ${
                  report.status === 'REJECTED'
                    ? 'text-destructive/80'
                    : 'text-muted-foreground'
                }`}
              >
                {report.reviewerFeedback}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-border/50 flex justify-end gap-3 border-t p-6">
          {report.status === 'DRAFT' && (
            <button
              onClick={handleSubmitDraftReport}
              disabled={savingSkills}
              className="bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-2 rounded-lg px-4 py-2 transition-colors disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {t('common.submit')}
            </button>
          )}
          <button
            onClick={onClose}
            className="bg-muted text-foreground hover:bg-muted/80 rounded-lg px-4 py-2 transition-colors"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ComponentItemProps {
  component: TrainingComponent;
  isExpanded: boolean;
  onToggle: () => void;
  useCases: TrainingUseCase[];
  entries: any[];
  onAddEntry: (useCase: TrainingUseCase) => void;
  useCaseHours?: Record<
    string,
    { totalHours: number; usedHours: number; remainingHours: number }
  >;
}

function ComponentItem({
  component,
  isExpanded,
  onToggle,
  useCases,
  entries,
  onAddEntry,
  useCaseHours,
}: ComponentItemProps) {
  const { t } = useLanguage();
  return (
    <div className="border-border/50 border-b last:border-b-0">
      <button
        onClick={onToggle}
        className="hover:bg-muted/50 group flex w-full cursor-pointer items-center gap-3 p-3 text-left transition-all duration-150"
      >
        <div className="bg-muted/50 group-hover:bg-accent/20 flex h-6 w-6 items-center justify-center rounded-md transition-colors">
          {isExpanded ? (
            <ChevronDown className="text-muted-foreground group-hover:text-accent h-4 w-4 transition-colors" />
          ) : (
            <ChevronRight className="text-muted-foreground group-hover:text-accent h-4 w-4 transition-colors" />
          )}
        </div>
        <div className="flex-1">
          <p className="text-foreground group-hover:text-accent text-sm font-medium transition-colors">
            {component.title}
          </p>
          <p className="text-muted-foreground text-xs">
            {component.code} • {component.totalHours} {t('reports.hoursTotal')}
          </p>
        </div>
      </button>

      {isExpanded && (
        <div className="space-y-1 pr-2 pb-3 pl-8">
          {useCases
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map(useCase => {
              const isSelected = entries.some(e => e.useCaseId === useCase.id);
              const ucHours = useCaseHours?.[useCase.id];
              const isExhausted = ucHours && ucHours.remainingHours <= 0;
              const remainingText = ucHours
                ? `${ucHours.remainingHours} ${t('reports.hoursRemaining')}`
                : '';

              return (
                <button
                  key={useCase.id}
                  onClick={() =>
                    !isSelected && !isExhausted && onAddEntry(useCase)
                  }
                  disabled={isSelected || isExhausted}
                  className={`group/item w-full rounded-lg px-3 py-2.5 text-left text-sm transition-all duration-150 ${
                    isSelected
                      ? 'bg-accent/15 text-accent border-accent/30 cursor-default border'
                      : isExhausted
                        ? 'bg-muted/20 text-muted-foreground cursor-not-allowed opacity-50'
                        : 'hover:bg-accent/10 hover:border-accent/20 text-foreground cursor-pointer border border-transparent hover:translate-x-1'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      {isSelected ? (
                        <div className="bg-accent/20 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full">
                          <Check className="text-accent h-3 w-3" />
                        </div>
                      ) : isExhausted ? (
                        <div className="bg-destructive/20 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full">
                          <X className="text-destructive h-3 w-3" />
                        </div>
                      ) : (
                        <div className="bg-muted/50 group-hover/item:bg-accent/20 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-colors">
                          <Plus className="text-muted-foreground group-hover/item:text-accent h-3 w-3 transition-colors" />
                        </div>
                      )}
                      <span
                        className={`${!isSelected && !isExhausted ? 'group-hover/item:text-accent' : ''} transition-colors`}
                      >
                        <span className="font-medium">{useCase.letter})</span>{' '}
                        {useCase.description}
                      </span>
                    </div>
                    <span className="flex flex-shrink-0 items-center gap-2">
                      {isExhausted ? (
                        <span className="bg-destructive/20 text-destructive rounded-full px-2 py-0.5 text-xs font-medium">
                          {t('reports.exhausted')}
                        </span>
                      ) : ucHours ? (
                        <span
                          className={`text-xs whitespace-nowrap ${ucHours.remainingHours <= 10 ? 'text-yellow-500' : 'text-muted-foreground'}`}
                        >
                          {remainingText}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs whitespace-nowrap">
                          ({useCase.plannedHours} {t('reports.hours')})
                        </span>
                      )}
                    </span>
                  </div>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
