'use client';

import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
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
  createdAt: string;
}

interface ReportUseCaseEntry {
  id: string;
  reportId: string;
  useCaseId: string;
  plannedHours: number;
  actualHours: number;
  isOverbooked: boolean;
  notes: string | null;
  // Grading fields
  trainerGrade?: number;
  gradeComment?: string | null;
  isGradeApproved?: boolean;
  useCase?: TrainingUseCase;
  component?: TrainingComponent;
}

export default function TraineeActivityReportsPage() {
  const { profile, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  const queryClient = useQueryClient();

  // Redirect non-trainee users
  useEffect(() => {
    if (!profile || authLoading) return;
    if (profile.role !== 'trainee') router.push('/trainer/activity-reports');
  }, [profile?.id, authLoading, router]);

  // Data fetching via React Query (cached, deduped, auto-refresh on focus)
  const reportsUrl = profile?.id ? `/api/activity-reports?userId=${profile.id}` : null;
  const { data: compData } = useApiQuery<{ components: TrainingComponent[] }>('/api/training-components');
  const { data: ucData } = useApiQuery<{ useCases: TrainingUseCase[] }>('/api/training-use-cases');
  const { data: reportData, isLoading: reportsLoading, error: reportsError } = useApiQuery<{ reports: ActivityReport[] }>(reportsUrl);

  const components = compData?.components || [];
  const useCases = ucData?.useCases || [];
  const reports = reportData?.reports || [];
  const loading = reportsLoading;
  const error = reportsError?.message || null;

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

  // Get current ISO week number (proper ISO 8601 calculation)
  const getCurrentWeek = () => {
    const now = new Date();
    const d = new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
    );
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  };

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
      const res = await fetch(`/api/activity-reports/${report.id}/entries`, { cache: 'no-store' });
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

      // Prepare soft skills
      const softSkills =
        evalData?.softskillRatings?.map((r: any) => ({
          name: r.criterion.name,
          selfRating: r.rating.selfRating,
          trainerRating: r.rating.trainerRating,
        })) || [];

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
        reviewerName: null, // Would need to fetch trainer name if available
        entries: entriesData.entries || [],
        // Grading Data
        selfRating: evalData?.evaluation?.selfRating,
        selfComment: evalData?.evaluation?.selfComment,
        trainerRating: evalData?.evaluation?.trainerRating,
        trainerComment: evalData?.evaluation?.trainerComment,
        softSkills: softSkills,
      };

      await (
        await import('@/utils/generateReportPDF')
      ).generateActivityReportPDF(reportData, useCases, components);
    } catch (err: any) {
      toast.error(t('reports.error.pdfGeneration') + ' ' + err.message);
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
          className={`glass-effect rounded-xl p-4 text-left transition-all hover:scale-[1.02] ${filterStatus === 'ALL' ? 'ring-primary bg-primary/5 ring-2' : ''
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
          className={`glass-effect rounded-xl p-4 text-left transition-all hover:scale-[1.02] ${filterStatus === 'SUBMITTED'
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
          className={`glass-effect rounded-xl p-4 text-left transition-all hover:scale-[1.02] ${filterStatus === 'APPROVED'
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
                  className="hover:bg-muted/50 cursor-pointer rounded-xl p-4 transition-all duration-200 hover:shadow-md hover:scale-[1.005]"
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
                          {report.ausbildungsjahr}. {t('reports.trainingYear')}
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
            editingReport ? editingReport.weekNumber : getCurrentWeek()
          }
          currentYear={
            editingReport ? editingReport.year : new Date().getFullYear()
          }
          initialReport={editingReport}
          initialEntries={editingEntries}
          existingReports={reports}
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
  userId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useLanguage();
  const [weekNumber, setWeekNumber] = useState(currentWeek);
  const [year, setYear] = useState(currentYear);
  const [ausbildungsjahr, setAusbildungsjahr] = useState(
    initialReport?.ausbildungsjahr || 1
  );
  const [entries, setEntries] = useState<
    {
      useCaseId: string;
      actualHours: number;
      notes: string;
    }[]
  >(
    initialEntries?.map(e => ({
      useCaseId: e.useCaseId,
      actualHours: e.actualHours,
      notes: e.notes || '',
    })) || []
  );
  const [expandedComponents, setExpandedComponents] = useState<Set<string>>(
    new Set()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use case hour tracking for overbooking prevention
  const [useCaseHours, setUseCaseHours] = useState<
    Record<
      string,
      { totalHours: number; usedHours: number; remainingHours: number }
    >
  >({});
  const [loadingHours, setLoadingHours] = useState(true);

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
      },
    ]);
  };

  const updateEntry = (
    useCaseId: string,
    field: 'actualHours' | 'notes',
    value: number | string
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

  // Validation helpers
  const periodValid =
    weekNumber >= 1 &&
    weekNumber <= 52 &&
    year >= 2020 &&
    year <= 2030 &&
    !!ausbildungsjahr;

  const entriesValid =
    entries.length > 0 &&
    entries.every(
      e => e.actualHours > 0 && typeof e.actualHours === 'number' && e.notes.trim().length > 0
    );

  const canSubmit =
    !saving &&
    !duplicateExists &&
    !hasOverbooking &&
    periodValid &&
    entriesValid;

  const handleSave = async (submit: boolean = false) => {
    try {
      setSaving(true);
      setError(null);

      // Calculate period start and end based on ISO week number
      // Get January 4th (always in ISO week 1)
      const jan4 = new Date(year, 0, 4);
      const dayOfWeek = jan4.getDay() || 7;

      // Get Monday of week 1
      const week1Monday = new Date(jan4);
      week1Monday.setDate(jan4.getDate() - dayOfWeek + 1);

      // Calculate target week's Monday
      const periodStart = new Date(week1Monday);
      periodStart.setDate(week1Monday.getDate() + (weekNumber - 1) * 7);

      // Sunday of the same week (6 days after Monday)
      const periodEnd = new Date(periodStart);
      periodEnd.setDate(periodStart.getDate() + 6);

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
          })),
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

          {error && (
            <div className="bg-destructive/10 border-destructive/30 text-destructive rounded-lg border p-3 text-sm">
              {error}
            </div>
          )}

          {/* Period Selection */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-foreground mb-2 block text-sm font-medium">
                {t('reports.calendarWeek')}
              </label>
              <input
                type="number"
                min={1}
                max={52}
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
                max={2030}
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
                              Number(e.target.value)
                            )
                          }
                          className={`bg-background text-foreground w-full rounded border px-3 py-1.5 ${isOverbooked ? 'border-yellow-500' : 'border-border'
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
                          rows={2}
                          className="bg-background border-border text-foreground w-full resize-none rounded border px-3 py-1.5"
                        />
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
                  </div>
                );
              })}

              {/* Totals */}
              <div className="bg-muted/50 flex items-center justify-between rounded-lg p-4">
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
                      className={`text-lg font-bold ${totalActualHours > totalPlannedHours ? 'text-yellow-500' : 'text-foreground'}`}
                    >
                      {totalActualHours} {t('reports.hours')}
                    </p>
                  </div>
                </div>
                {totalActualHours > totalPlannedHours && (
                  <div className="flex items-center gap-2 text-yellow-500">
                    <AlertTriangle className="h-5 w-5" />
                    <span className="font-medium">
                      +{(totalActualHours - totalPlannedHours).toFixed(1)}{' '}
                      {t('reports.hours')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Component/Use Case Selector */}
          <div className="space-y-3">
            <h3 className="text-foreground text-lg font-semibold">
              {t('reports.addActivity')}
            </h3>
            <div className="border-border max-h-96 space-y-2 overflow-y-auto rounded-lg border p-2">
              {/* Section 1: 1. - 18. Monat */}
              <div className="mb-4">
                <h4 className="text-muted-foreground mb-2 px-2 text-sm font-bold tracking-wider uppercase">
                  {t('reports.monthRange1')}
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

              {/* Section 2: 19. - 36. Monat */}
              <div className="mb-4">
                <h4 className="text-muted-foreground mb-2 px-2 text-sm font-bold tracking-wider uppercase">
                  {t('reports.monthRange2')}
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
                  {t('reports.monthRange3')}
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
                hasOverbooking
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

// Report Detail Modal Component (placeholder - will be expanded)
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
  const [entries, setEntries] = useState<ReportUseCaseEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEntries();
  }, [report.id]);

  const loadEntries = async () => {
    try {
      const res = await fetch(`/api/activity-reports/${report.id}/entries`, { cache: 'no-store' });
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

  const getUseCaseById = (id: string) => useCases.find(uc => uc.id === id);
  const getComponentById = (id: string) => components.find(c => c.id === id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="bg-card border-border flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border">
        {/* Header */}
        <div className="border-border/50 flex items-center justify-between border-b p-6">
          <div>
            <h2 className="text-foreground text-xl font-bold">
              {t('reports.week')} {report.weekNumber} / {report.year}
            </h2>
            <p className="text-muted-foreground text-sm">
              {report.ausbildungsjahr}. {t('reports.trainingYear')}
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

                    {/* Show trainer grade if approved */}
                    {entry.trainerGrade && (
                      <div className="bg-accent/10 border-accent/20 mt-3 rounded-lg border p-3">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground text-xs">
                              {t('reports.trainerGrade')}
                            </span>
                            <span
                              className={`inline-flex h-8 w-8 items-center justify-center rounded-full font-bold text-white ${entry.trainerGrade <= 2
                                ? 'bg-green-500'
                                : entry.trainerGrade <= 4
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                                }`}
                            >
                              {entry.trainerGrade}
                            </span>
                          </div>
                          {entry.gradeComment && (
                            <p className="text-foreground flex-1 text-sm italic">
                              "{entry.gradeComment}"
                            </p>
                          )}
                        </div>
                      </div>
                    )}

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

          {report.reviewerFeedback && (
            <div className="bg-destructive/10 border-destructive/30 mt-6 rounded-lg border p-4">
              <h4 className="text-destructive mb-2 font-medium">
                {t('reports.trainerFeedback').replace(':', '')}
              </h4>
              <p className="text-destructive/80 text-sm">
                {report.reviewerFeedback}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-border/50 flex justify-end border-t p-6">
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
        className="hover:bg-muted/50 flex w-full items-center gap-3 p-3 text-left transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="text-muted-foreground h-4 w-4" />
        ) : (
          <ChevronRight className="text-muted-foreground h-4 w-4" />
        )}
        <div className="flex-1">
          <p className="text-foreground text-sm font-medium">
            {component.title}
          </p>
          <p className="text-muted-foreground text-xs">
            {component.code} • {component.totalHours} {t('reports.hoursTotal')}
          </p>
        </div>
      </button>

      {isExpanded && (
        <div className="space-y-1 pb-2 pl-10">
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
                  className={`w-full rounded p-2 text-left text-sm transition-colors ${isSelected
                    ? 'bg-accent/20 text-accent cursor-not-allowed'
                    : isExhausted
                      ? 'bg-muted/30 text-muted-foreground cursor-not-allowed opacity-60'
                      : 'hover:bg-muted/50 text-foreground'
                    }`}
                >
                  <div className="flex items-center justify-between">
                    <span>
                      <span className="font-medium">{useCase.letter})</span>{' '}
                      {useCase.description}
                    </span>
                    <span className="flex items-center gap-2">
                      {isExhausted ? (
                        <span className="bg-destructive/20 text-destructive rounded px-2 py-0.5 text-xs">
                          {t('reports.exhausted')}
                        </span>
                      ) : ucHours ? (
                        <span
                          className={`text-xs ${ucHours.remainingHours <= 10 ? 'text-yellow-500' : 'text-muted-foreground'}`}
                        >
                          {remainingText}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">
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
