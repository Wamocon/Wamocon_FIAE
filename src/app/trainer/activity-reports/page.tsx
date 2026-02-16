'use client';

import { useState, useEffect, useCallback } from 'react';
import JSZip from 'jszip';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useRouter } from 'next/navigation';
import {
  ClipboardList,
  AlertTriangle,
  Check,
  X,
  ChevronRight,
  Calendar,
  User,
  Clock,
  Send,
  FileText,
  MessageSquare,
  Download,
  Award,
  Star,
} from 'lucide-react';

interface TraineeProfile {
  id: string;
  fullName: string;
  email: string;
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
  trainee?: TraineeProfile;
  hasOverbooking?: boolean;
}

interface ReportUseCaseEntry {
  id: string;
  reportId: string;
  useCaseId: string;
  plannedHours: number;
  actualHours: number;
  isOverbooked: boolean;
  notes: string | null;
  trainerGrade?: number;
  gradeComment?: string | null;
  isGradeApproved?: boolean;
  gradeApprovedAt?: string | null;
}

interface SoftskillCriterion {
  id: string;
  code: string;
  name: string;
  description?: string;
  kLevel?: string;
  competencyArea: string;
  orderIndex: number;
}

interface SoftskillRating {
  criterionId: string;
  trainerRating: number;
  trainerComment?: string;
}

interface TrainingUseCase {
  id: string;
  componentId: string;
  letter: string;
  description: string;
  plannedHours: number;
}

interface TrainingComponent {
  id: string;
  code: string;
  title: string;
}

export default function TrainerActivityReportsPage() {
  const { profile, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  const [reports, setReports] = useState<ActivityReport[]>([]);
  const [trainees, setTrainees] = useState<Record<string, TraineeProfile>>({});
  const [useCases, setUseCases] = useState<TrainingUseCase[]>([]);
  const [components, setComponents] = useState<TrainingComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedReport, setSelectedReport] = useState<ActivityReport | null>(
    null
  );
  const [reportEntries, setReportEntries] = useState<ReportUseCaseEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  const [filter, setFilter] = useState<
    'all' | 'pending' | 'overbooked' | 'approved' | 'history'
  >('pending');
  const [traineeFilter, setTraineeFilter] = useState<string>('all');
  const [periodFilter, setPeriodFilter] = useState<'all' | '1-18' | '19-36'>(
    'all'
  );

  const loadData = useCallback(async (userId: string) => {
    try {
      setLoading(true);

      const [reportsRes, traineesRes, useCasesRes, componentsRes] =
        await Promise.all([
          fetch(`/api/activity-reports?userId=${userId}`),
          fetch(`/api/trainer/trainees?trainerProfileId=${userId}`),
          fetch('/api/training-use-cases'),
          fetch('/api/training-components'),
        ]);

      const [reportsData, traineesData, useCasesData, componentsData] =
        await Promise.all([
          reportsRes.ok ? reportsRes.json() : { reports: [] },
          traineesRes.ok ? traineesRes.json() : { trainees: [] },
          useCasesRes.ok ? useCasesRes.json() : { useCases: [] },
          componentsRes.ok ? componentsRes.json() : { components: [] },
        ]);

      // Build trainee lookup
      const traineeMap: Record<string, TraineeProfile> = {};
      (traineesData.trainees || []).forEach((t: any) => {
        traineeMap[t.id] = {
          id: t.id,
          fullName: t.fullName || t.full_name,
          email: t.email,
        };
      });

      setTrainees(traineeMap);
      setUseCases(useCasesData.useCases || []);
      setComponents(componentsData.components || []);

      // Reports now include hasOverbooking from the API - no N+1 calls needed
      const enhancedReports = (reportsData.reports || []).map(
        (r: ActivityReport) => ({
          ...r,
          trainee: traineeMap[r.traineeId],
          hasOverbooking: r.hasOverbooking || false,
        })
      );

      setReports(enhancedReports);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!profile?.id || authLoading) return;

    if (profile.role !== 'trainer') {
      router.push('/trainee/activity-reports');
      return;
    }

    loadData(profile.id);
  }, [profile?.id, authLoading, loadData]);

  const loadReportEntries = async (reportId: string) => {
    try {
      setLoadingEntries(true);
      const res = await fetch(`/api/activity-reports/${reportId}/entries`);
      if (res.ok) {
        const data = await res.json();
        setReportEntries(data.entries || []);
      }
    } catch (err) {
      console.error('Error loading entries:', err);
    } finally {
      setLoadingEntries(false);
    }
  };

  const handleSelectReport = async (report: ActivityReport) => {
    setSelectedReport(report);
    await loadReportEntries(report.id);
  };

  const handleApprove = async () => {
    if (!selectedReport || !profile) return;

    try {
      const res = await fetch(`/api/activity-reports/${selectedReport.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'APPROVED', userId: profile.id }),
      });

      if (!res.ok) throw new Error('Failed to approve');

      setSelectedReport(null);
      if (profile?.id) loadData(profile.id);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleReject = async (feedback: string) => {
    if (!selectedReport || !profile) return;

    try {
      const res = await fetch(`/api/activity-reports/${selectedReport.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'REJECTED',
          feedback,
          userId: profile.id,
        }),
      });

      if (!res.ok) throw new Error('Failed to reject');

      setSelectedReport(null);
      if (profile?.id) loadData(profile.id);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (reportId: string) => {
    if (!confirm(t('trainer.reports.deleteConfirm'))) return;

    try {
      const res = await fetch(`/api/activity-reports/${reportId}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error(t('trainer.reports.deleteError'));

      setSelectedReport(null);
      if (profile?.id) loadData(profile.id);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const fetchEvaluationData = async (
    userId: string,
    year: number,
    week: number
  ) => {
    try {
      // 1. Get all evaluations to find the ID
      const resLists = await fetch(`/api/trainee/evaluations?userId=${userId}`);
      if (!resLists.ok) return null;
      const { evaluations } = await resLists.json();
      const evaluation = evaluations.find(
        (e: any) => e.year === year && e.weekNumber === week
      );

      if (!evaluation) return null;

      // 2. Get full details including Soft Skills
      const resDetails = await fetch(
        `/api/trainer/evaluations/${evaluation.id}`
      );
      if (!resDetails.ok) return null;
      return await resDetails.json();
    } catch (e) {
      console.error('Error fetching evaluation for PDF:', e);
      return null;
    }
  };

  const handleDownloadPDF = async () => {
    if (!selectedReport) return;
    try {
      // Fetch validation data
      const evalData = await fetchEvaluationData(
        selectedReport.traineeId,
        selectedReport.year,
        selectedReport.weekNumber
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
        id: selectedReport.id,
        traineeId: selectedReport.traineeId,
        traineeName:
          trainees[selectedReport.traineeId]?.fullName ||
          t('trainer.reports.unknown'),
        traineeEmail: trainees[selectedReport.traineeId]?.email || '',
        ausbildungsjahr: selectedReport.ausbildungsjahr,
        weekNumber: selectedReport.weekNumber,
        year: selectedReport.year,
        periodStart: selectedReport.periodStart,
        periodEnd: selectedReport.periodEnd,
        status: selectedReport.status,
        submittedAt: selectedReport.submittedAt,
        traineeSignedAt: selectedReport.traineeSignedAt || null,
        trainerSignedAt: selectedReport.trainerSignedAt || null,
        reviewerId: selectedReport.reviewerId || null,
        reviewerName: profile?.full_name || t('trainer.reports.trainer'),
        entries: reportEntries,
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
      setError(t('trainer.reports.pdfError') + err.message);
    }
  };

  const handleMassExport = async () => {
    try {
      setError(null);
      const zip = new JSZip();
      const folderName = `Nachweise_Export_${new Date().toLocaleDateString('de-DE').replace(/\./g, '-')}`;
      const folder = zip.folder(folderName);

      let count = 0;

      // Export all filtered reports one by one
      for (const report of filteredReports) {
        // Fetch entries for this report
        const entriesRes = await fetch(
          `/api/activity-reports/${report.id}/entries`
        );
        const entriesData = entriesRes.ok
          ? await entriesRes.json()
          : { entries: [] };

        // Fetch evaluation data
        const evalData = await fetchEvaluationData(
          report.traineeId,
          report.year,
          report.weekNumber
        );

        const softSkills =
          evalData?.softskillRatings?.map((r: any) => ({
            name: r.criterion.name,
            selfRating: r.rating.selfRating,
            trainerRating: r.rating.trainerRating,
          })) || [];

        const reportData = {
          id: report.id,
          traineeId: report.traineeId,
          traineeName:
            trainees[report.traineeId]?.fullName ||
            t('trainer.reports.unknown'),
          traineeEmail: trainees[report.traineeId]?.email || '',
          ausbildungsjahr: report.ausbildungsjahr,
          weekNumber: report.weekNumber,
          year: report.year,
          periodStart: report.periodStart,
          periodEnd: report.periodEnd,
          status: report.status,
          submittedAt: report.submittedAt,
          traineeSignedAt: report.traineeSignedAt || null,
          trainerSignedAt: report.trainerSignedAt || null,
          reviewerId: report.reviewerId || null,
          reviewerName: profile?.full_name || t('trainer.reports.trainer'),
          entries: entriesData.entries || [],
          // Grading Data
          selfRating: evalData?.evaluation?.selfRating,
          selfComment: evalData?.evaluation?.selfComment,
          trainerRating: evalData?.evaluation?.trainerRating,
          trainerComment: evalData?.evaluation?.trainerComment,
          softSkills: softSkills,
        };

        const blob = await (
          await import('@/utils/generateReportPDF')
        ).generateActivityReportPDF(reportData, useCases, components, true);
        if (blob instanceof Blob) {
          const filename = `Tätigkeitsnachweis_KW${report.weekNumber}_${report.year}_${reportData.traineeName.replace(/\s+/g, '_')}.pdf`;
          folder?.file(filename, blob);
          count++;
        }
      }

      if (count > 0) {
        // Generate ZIP and download
        const zipContent = await zip.generateAsync({ type: 'blob' });
        const url = window.URL.createObjectURL(zipContent);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${folderName}.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (err: any) {
      setError(t('trainer.reports.exportError') + err.message);
    }
  };

  const getUseCaseById = (id: string) => useCases.find(uc => uc.id === id);
  const getComponentById = (id: string) => components.find(c => c.id === id);

  const getStatusBadge = (status: string, hasOverbooking?: boolean) => {
    if (status === 'SUBMITTED' && hasOverbooking) {
      return (
        <span className="flex items-center gap-1 rounded-full bg-yellow-500/20 px-2 py-1 text-xs text-yellow-400">
          <AlertTriangle className="h-3 w-3" />
          {t('trainer.reports.overbooked')}
        </span>
      );
    }

    switch (status) {
      case 'DRAFT':
        return (
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-1 text-xs">
            {t('trainer.reports.draft')}
          </span>
        );
      case 'SUBMITTED':
        return (
          <span className="rounded-full bg-blue-500/20 px-2 py-1 text-xs text-blue-400">
            {t('trainer.reports.pending')}
          </span>
        );
      case 'APPROVED':
        return (
          <span className="rounded-full bg-green-500/20 px-2 py-1 text-xs text-green-400">
            {t('trainer.reports.approved')}
          </span>
        );
      case 'REJECTED':
        return (
          <span className="rounded-full bg-red-500/20 px-2 py-1 text-xs text-red-400">
            {t('trainer.reports.rejected')}
          </span>
        );
      default:
        return null;
    }
  };

  // Filter reports
  const filteredReports = reports.filter(r => {
    // Status filter
    let matchesStatus = true;
    switch (filter) {
      case 'pending':
        matchesStatus = r.status === 'SUBMITTED';
        break;
      case 'overbooked':
        matchesStatus = r.status === 'SUBMITTED' && !!r.hasOverbooking;
        break;
      case 'approved':
        matchesStatus = r.status === 'APPROVED';
        break;
      case 'history':
        matchesStatus = r.status === 'APPROVED' || r.status === 'REJECTED';
        break;
      default:
        matchesStatus = true;
    }
    if (!matchesStatus) return false;

    // Trainee filter (only for history/approved/all)
    if (traineeFilter !== 'all' && r.traineeId !== traineeFilter) {
      return false;
    }

    // Period filter (only for history)
    if (filter === 'history' && periodFilter !== 'all') {
      if (periodFilter === '1-18' && r.ausbildungsjahr > 1) return false;
      if (periodFilter === '19-36' && r.ausbildungsjahr === 1) return false;
    }

    return true;
  });

  // Stats
  const pendingCount = reports.filter(r => r.status === 'SUBMITTED').length;
  const overbookedCount = reports.filter(
    r => r.status === 'SUBMITTED' && r.hasOverbooking
  ).length;
  const approvedCount = reports.filter(r => r.status === 'APPROVED').length;
  const historyCount = reports.filter(
    r => r.status === 'APPROVED' || r.status === 'REJECTED'
  ).length;

  // Get unique trainees for filter dropdown
  const traineeList = Object.values(trainees).sort((a, b) =>
    a.fullName.localeCompare(b.fullName)
  );

  if (authLoading || loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="border-accent h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
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
              {t('trainer.reports.title')}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t('trainer.reports.description')}
            </p>
          </div>
        </div>
        <button
          onClick={() =>
            router.push('/trainer/activity-reports/arbeitszeugnis')
          }
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2.5 font-medium text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl"
        >
          <Award className="h-5 w-5" />
          <span>Arbeitszeugnis erstellen</span>
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <button
          onClick={() => setFilter('pending')}
          className={`glass-effect rounded-xl p-4 text-left transition-colors ${filter === 'pending' ? 'ring-accent ring-2' : ''}`}
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/20 p-2">
              <Send className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-foreground text-2xl font-bold">
                {pendingCount}
              </p>
              <p className="text-muted-foreground text-sm">
                {t('trainer.reports.pending')}
              </p>
            </div>
          </div>
        </button>

        <button
          onClick={() => setFilter('approved')}
          className={`glass-effect rounded-xl p-4 text-left transition-colors ${filter === 'approved' ? 'ring-accent ring-2' : ''}`}
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/20 p-2">
              <Check className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-foreground text-2xl font-bold">
                {approvedCount}
              </p>
              <p className="text-muted-foreground text-sm">
                {t('trainer.reports.approved')}
              </p>
            </div>
          </div>
        </button>

        <button
          onClick={() => setFilter('history')}
          className={`glass-effect rounded-xl p-4 text-left transition-colors ${filter === 'history' ? 'ring-accent ring-2' : ''}`}
        >
          <div className="flex items-center gap-3">
            <div className="bg-accent/20 rounded-lg p-2">
              <FileText className="text-accent h-5 w-5" />
            </div>
            <div>
              <p className="text-foreground text-2xl font-bold">
                {historyCount}
              </p>
              <p className="text-muted-foreground text-sm">
                {t('trainer.reports.history')}
              </p>
            </div>
          </div>
        </button>
      </div>

      {/* History Filters - shown only in history mode */}
      {filter === 'history' && (
        <div className="flex flex-wrap items-center gap-4">
          {/* Trainee Filter */}
          <div className="flex items-center gap-2">
            <label className="text-muted-foreground text-sm">
              {t('trainer.reports.traineeLabel')}
            </label>
            <select
              value={traineeFilter}
              onChange={e => setTraineeFilter(e.target.value)}
              className="bg-muted border-border text-foreground rounded-lg border px-3 py-1.5 text-sm"
            >
              <option value="all">{t('trainer.reports.allTrainees')}</option>
              {traineeList.map(trainee => (
                <option key={trainee.id} value={trainee.id}>
                  {trainee.fullName}
                </option>
              ))}
            </select>
          </div>

          {/* Period Filter */}
          <div className="flex items-center gap-2">
            <label className="text-muted-foreground text-sm">
              {t('trainer.reports.periodLabel')}
            </label>
            <select
              value={periodFilter}
              onChange={e =>
                setPeriodFilter(e.target.value as 'all' | '1-18' | '19-36')
              }
              className="bg-muted border-border text-foreground rounded-lg border px-3 py-1.5 text-sm"
            >
              <option value="all">{t('trainer.reports.allPeriods')}</option>
              <option value="1-18">{t('trainer.reports.period1to18')}</option>
              <option value="19-36">{t('trainer.reports.period19to36')}</option>
            </select>
          </div>

          {/* Mass Export Button */}
          {filteredReports.length > 0 && (
            <button
              onClick={() => handleMassExport()}
              className="bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm"
            >
              <Download className="h-4 w-4" />
              {t('trainer.reports.exportAll').replace(
                '{count}',
                String(filteredReports.length)
              )}
            </button>
          )}
        </div>
      )}

      {/* Reports List */}
      <div className="glass-effect overflow-hidden rounded-xl">
        <div className="border-border/50 border-b p-4">
          <h2 className="text-foreground text-lg font-semibold">
            {filter === 'pending'
              ? t('trainer.reports.pendingReports')
              : filter === 'overbooked'
                ? t('trainer.reports.overbookedReports')
                : filter === 'approved'
                  ? t('trainer.reports.approvedReports')
                  : filter === 'history'
                    ? t('trainer.reports.historyReports')
                    : ''}
          </h2>
        </div>

        {filteredReports.length === 0 ? (
          <div className="p-8 text-center">
            <ClipboardList className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
            <p className="text-muted-foreground">
              {t('trainer.reports.noReports')}
            </p>
          </div>
        ) : (
          <div className="divide-border/50 divide-y">
            {filteredReports
              .sort(
                (a, b) =>
                  new Date(b.createdAt).getTime() -
                  new Date(a.createdAt).getTime()
              )
              .map(report => (
                <button
                  key={report.id}
                  onClick={() => handleSelectReport(report)}
                  className="hover:bg-muted/50 w-full p-4 text-left transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="bg-accent/20 rounded-lg p-2">
                        <User className="text-accent h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-foreground font-medium">
                          {report.trainee?.fullName ||
                            t('trainer.reports.unknown')}
                        </h3>
                        <div className="text-muted-foreground flex items-center gap-2 text-sm">
                          <Calendar className="h-3 w-3" />
                          <span>
                            {t('trainer.reports.week')
                              .replace('{week}', String(report.weekNumber))
                              .replace('{year}', String(report.year))}
                          </span>
                          <span>•</span>
                          <span>
                            {t('trainer.reports.trainingYear').replace(
                              '{year}',
                              String(report.ausbildungsjahr)
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {getStatusBadge(report.status, report.hasOverbooking)}
                      <ChevronRight className="text-muted-foreground h-5 w-5" />
                    </div>
                  </div>
                </button>
              ))}
          </div>
        )}
      </div>

      {/* Report Detail Modal */}
      {selectedReport && (
        <ReportReviewModal
          report={selectedReport}
          entries={reportEntries}
          loadingEntries={loadingEntries}
          useCases={useCases}
          components={components}
          getUseCaseById={getUseCaseById}
          getComponentById={getComponentById}
          onClose={() => setSelectedReport(null)}
          onApprove={handleApprove}
          onReject={handleReject}
          onDelete={() => handleDelete(selectedReport.id)}
          onDownloadPDF={handleDownloadPDF}
          trainerId={profile?.id || ''}
          reloadEntries={() => loadReportEntries(selectedReport.id)}
        />
      )}
    </div>
  );
}

// Review Modal Component
function ReportReviewModal({
  report,
  entries,
  loadingEntries,
  useCases,
  components,
  getUseCaseById,
  getComponentById,
  onClose,
  onApprove,
  onReject,
  onDelete,
  onDownloadPDF,
  trainerId,
  reloadEntries,
}: {
  report: ActivityReport;
  entries: ReportUseCaseEntry[];
  loadingEntries: boolean;
  useCases: TrainingUseCase[];
  components: TrainingComponent[];
  getUseCaseById: (id: string) => TrainingUseCase | undefined;
  getComponentById: (id: string) => TrainingComponent | undefined;
  onClose: () => void;
  onApprove: () => void;
  onReject: (feedback: string) => void;
  onDelete: () => void;
  onDownloadPDF: () => void;
  trainerId: string;
  reloadEntries: () => void;
}) {
  const { t } = useLanguage();
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [processing, setProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'details' | 'grades' | 'softskills'
  >('details');

  // Grading state
  const [entryGrades, setEntryGrades] = useState<
    Record<string, { grade: number; comment: string }>
  >({});
  const [savingGrades, setSavingGrades] = useState(false);
  const [gradesSaved, setGradesSaved] = useState(false);

  // Soft skills state
  const [softskillCriteria, setSoftskillCriteria] = useState<
    SoftskillCriterion[]
  >([]);
  const [softskillRatings, setSoftskillRatings] = useState<
    Record<string, { rating: number; comment: string }>
  >({});
  const [loadingSoftskills, setLoadingSoftskills] = useState(false);
  const [savingSoftskills, setSavingSoftskills] = useState(false);
  const [softskillsSaved, setSoftskillsSaved] = useState(false);

  const totalPlanned = entries.reduce((sum, e) => sum + e.plannedHours, 0);
  const totalActual = entries.reduce((sum, e) => sum + e.actualHours, 0);
  const hasOverbooking = entries.some(e => e.isOverbooked);

  const allEntriesGraded =
    entries.length > 0 && entries.every(entry => entryGrades[entry.id]?.grade);
  const allSoftskillsRated =
    softskillCriteria.length > 0 &&
    softskillCriteria.every(c => softskillRatings[c.id]?.rating);
  const canApprove = allEntriesGraded && allSoftskillsRated && softskillsSaved;
  const isLastTab = activeTab === 'softskills';
  const canProceedNext =
    activeTab === 'details'
      ? true
      : activeTab === 'grades'
        ? allEntriesGraded
        : false;

  const goNextTab = () => {
    if (activeTab === 'details') {
      setActiveTab('grades');
      return;
    }
    if (activeTab === 'grades') {
      setActiveTab('softskills');
    }
  };

  // Initialize grades from existing entries
  useEffect(() => {
    const initialGrades: Record<string, { grade: number; comment: string }> =
      {};
    entries.forEach(entry => {
      if (entry.trainerGrade) {
        initialGrades[entry.id] = {
          grade: entry.trainerGrade,
          comment: entry.gradeComment || '',
        };
      }
    });
    setEntryGrades(initialGrades);
  }, [entries]);

  // Load soft skill criteria when tab is opened
  useEffect(() => {
    if (activeTab === 'softskills' && softskillCriteria.length === 0) {
      loadSoftskillCriteria();
    }
  }, [activeTab]);

  useEffect(() => {
    setSoftskillsSaved(false);
  }, [softskillRatings]);

  const loadSoftskillCriteria = async () => {
    setLoadingSoftskills(true);
    try {
      // Load criteria
      const criteriaRes = await fetch('/api/softskill-criteria');
      if (criteriaRes.ok) {
        const data = await criteriaRes.json();
        setSoftskillCriteria(data.criteria || []);
      }

      // Load existing ratings for this report
      const ratingsRes = await fetch(
        `/api/weekly-evaluations?activityReportId=${report.id}`
      );
      if (ratingsRes.ok) {
        const data = await ratingsRes.json();
        const existingRatings: Record<
          string,
          { rating: number; comment: string }
        > = {};
        (data.softskillRatings || []).forEach((r: any) => {
          existingRatings[r.softskillCriterionId] = {
            rating: r.trainerRating,
            comment: r.trainerComment || '',
          };
        });
        setSoftskillRatings(existingRatings);
      }
    } catch (err) {
      console.error('Error loading softskills:', err);
    } finally {
      setLoadingSoftskills(false);
    }
  };

  const handleGradeChange = (entryId: string, grade: number) => {
    setEntryGrades(prev => ({
      ...prev,
      [entryId]: {
        ...prev[entryId],
        grade,
        comment: prev[entryId]?.comment || '',
      },
    }));
    setGradesSaved(false);
  };

  const handleGradeCommentChange = (entryId: string, comment: string) => {
    setEntryGrades(prev => ({
      ...prev,
      [entryId]: {
        ...prev[entryId],
        comment,
        grade: prev[entryId]?.grade || 3,
      },
    }));
    setGradesSaved(false);
  };

  const handleSoftskillRatingChange = (criterionId: string, rating: number) => {
    setSoftskillRatings(prev => ({
      ...prev,
      [criterionId]: {
        ...prev[criterionId],
        rating,
        comment: prev[criterionId]?.comment || '',
      },
    }));
  };

  const handleSoftskillCommentChange = (
    criterionId: string,
    comment: string
  ) => {
    setSoftskillRatings(prev => ({
      ...prev,
      [criterionId]: {
        ...prev[criterionId],
        comment,
        rating: prev[criterionId]?.rating || 3,
      },
    }));
  };

  const saveGrades = async () => {
    setSavingGrades(true);
    try {
      const gradesToSave = Object.entries(entryGrades)
        .filter(([_, val]) => val.grade)
        .map(([entryId, val]) => ({
          entryId,
          grade: val.grade,
          comment: val.comment,
        }));

      if (gradesToSave.length > 0) {
        const res = await fetch(`/api/activity-reports/${report.id}/entries`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entryGrades: gradesToSave, trainerId }),
        });
        if (res.ok) {
          setGradesSaved(true);
          reloadEntries();
          toast.success(t('trainer.reports.modal.gradesSaved'));
        } else {
          toast.error(t('trainer.reports.modal.gradesSaveError'));
        }
      }
    } catch (err) {
      console.error('Error saving grades:', err);
      toast.error(t('trainer.reports.modal.gradesSaveError'));
    } finally {
      setSavingGrades(false);
    }
  };

  const saveSoftskills = async () => {
    setSavingSoftskills(true);
    try {
      const ratingsToSave = Object.entries(softskillRatings)
        .filter(([_, val]) => val.rating)
        .map(([criterionId, val]) => ({
          criterionId,
          trainerRating: val.rating,
          trainerComment: val.comment,
        }));

      const res = await fetch('/api/weekly-evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityReportId: report.id,
          traineeId: report.traineeId,
          trainerId,
          weekNumber: report.weekNumber,
          year: report.year,
          ausbildungsjahr: report.ausbildungsjahr,
          trainerRating: 3,
          softskillRatings: ratingsToSave,
        }),
      });

      if (res.ok) {
        setSoftskillsSaved(true);
        toast.success(t('trainer.reports.modal.softskillsSaved'));
      } else {
        toast.error(t('trainer.reports.modal.softskillsSaveError'));
      }
    } catch (err) {
      console.error('Error saving softskills:', err);
      toast.error(t('trainer.reports.modal.softskillsSaveError'));
    } finally {
      setSavingSoftskills(false);
    }
  };

  const handleApprove = async () => {
    // Validate: all entries must have grades
    if (!allEntriesGraded) {
      toast.error(t('trainer.reports.modal.gradesRequired'));
      setActiveTab('grades');
      return;
    }

    // Validate: soft skills should be rated
    if (!allSoftskillsRated) {
      toast.error(t('trainer.reports.modal.softskillsRequired'));
      setActiveTab('softskills');
      return;
    }

    setProcessing(true);
    try {
      // Save grades first
      await saveGrades();
      // Save softskills
      await saveSoftskills();
      // Approve - this will close the modal, so don't set state after
      toast.success(t('trainer.reports.modal.approveSuccess'));
      await onApprove();
      // Don't call setProcessing(false) here - modal is unmounted
    } catch (err) {
      console.error('Approval error:', err);
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!feedback.trim()) return;
    setProcessing(true);
    try {
      await onReject(feedback);
      // Don't call setProcessing(false) - modal is unmounted after reject
    } catch (err) {
      console.error('Rejection error:', err);
      setProcessing(false);
    }
  };

  const GradeSelector = ({
    value,
    onChange,
    size = 'md',
  }: {
    value: number | undefined;
    onChange: (v: number) => void;
    size?: 'sm' | 'md';
  }) => {
    const grades = [1, 2, 3, 4, 5, 6];
    const sizeClasses = size === 'sm' ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-sm';
    return (
      <div className="flex gap-1">
        {grades.map(g => (
          <button
            key={g}
            type="button"
            onClick={() => onChange(g)}
            className={`${sizeClasses} rounded-full font-medium transition-all ${
              value === g
                ? g <= 2
                  ? 'bg-green-500 text-white'
                  : g <= 4
                    ? 'bg-yellow-500 text-white'
                    : 'bg-red-500 text-white'
                : 'bg-muted hover:bg-muted/80 text-foreground'
            }`}
          >
            {g}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="bg-card border-border flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border">
        {/* Header */}
        <div className="border-border/50 border-b p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-foreground text-xl font-bold">
                {t('trainer.reports.modal.title')}
              </h2>
              <div className="text-muted-foreground mt-1 flex items-center gap-2 text-sm">
                <User className="h-4 w-4" />
                <span>{report.trainee?.fullName}</span>
                <span>•</span>
                <Calendar className="h-4 w-4" />
                <span>
                  {t('trainer.reports.week')
                    .replace('{week}', String(report.weekNumber))
                    .replace('{year}', String(report.year))}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="hover:bg-muted rounded-lg p-2 transition-colors"
            >
              <X className="text-muted-foreground h-5 w-5" />
            </button>
          </div>

          {/* Summary */}
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-muted-foreground text-xs">
                {t('trainer.reports.modal.planTotal')}
              </p>
              <p className="text-foreground text-lg font-bold">
                {totalPlanned} {t('trainer.reports.modal.hours')}
              </p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-muted-foreground text-xs">
                {t('trainer.reports.modal.actualTotal')}
              </p>
              <p
                className={`text-lg font-bold ${totalActual > totalPlanned ? 'text-yellow-500' : 'text-foreground'}`}
              >
                {totalActual} {t('trainer.reports.modal.hours')}
              </p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-muted-foreground text-xs">
                {t('trainer.reports.modal.difference')}
              </p>
              <p
                className={`text-lg font-bold ${totalActual > totalPlanned ? 'text-yellow-500' : 'text-green-500'}`}
              >
                {totalActual > totalPlanned ? '+' : ''}
                {(totalActual - totalPlanned).toFixed(1)}{' '}
                {t('trainer.reports.modal.hours')}
              </p>
            </div>
          </div>

          {hasOverbooking && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              <span className="text-sm font-medium text-yellow-500">
                {t('trainer.reports.modal.overbookedWarning')}
              </span>
            </div>
          )}

          {/* Tabs - Only show for SUBMITTED reports */}
          {report.status === 'SUBMITTED' && (
            <div className="border-border/30 mt-4 flex gap-2 border-b">
              <button
                onClick={() => setActiveTab('details')}
                className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'details'
                    ? 'border-accent text-accent'
                    : 'text-muted-foreground hover:text-foreground border-transparent'
                }`}
              >
                {t('trainer.reports.modal.tabDetails')}
              </button>
              <button
                onClick={() => setActiveTab('grades')}
                className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'grades'
                    ? 'border-accent text-accent'
                    : 'text-muted-foreground hover:text-foreground border-transparent'
                }`}
              >
                <Star className="h-4 w-4" />
                {t('trainer.reports.modal.tabGrades')}
              </button>
              <button
                onClick={() => setActiveTab('softskills')}
                className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'softskills'
                    ? 'border-accent text-accent'
                    : 'text-muted-foreground hover:text-foreground border-transparent'
                }`}
              >
                <Award className="h-4 w-4" />
                {t('trainer.reports.modal.tabSoftskills')}
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loadingEntries ? (
            <div className="flex items-center justify-center py-12">
              <div className="border-accent h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
            </div>
          ) : activeTab === 'details' ? (
            /* Details Tab */
            entries.length === 0 ? (
              <p className="text-muted-foreground py-12 text-center">
                {t('trainer.reports.modal.noEntries')}
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

                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <p className="text-muted-foreground text-xs">
                            {t('trainer.reports.modal.plan')}
                          </p>
                          <p className="text-foreground font-medium">
                            {entry.plannedHours}{' '}
                            {t('trainer.reports.modal.hours')}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs">
                            {t('trainer.reports.modal.actual')}
                          </p>
                          <p
                            className={`font-medium ${entry.isOverbooked ? 'text-yellow-500' : 'text-foreground'}`}
                          >
                            {entry.actualHours}{' '}
                            {t('trainer.reports.modal.hours')}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs">
                            {t('trainer.reports.modal.difference')}
                          </p>
                          <p
                            className={`font-medium ${entry.isOverbooked ? 'text-yellow-500' : 'text-green-500'}`}
                          >
                            {entry.isOverbooked ? '+' : ''}
                            {(entry.actualHours - entry.plannedHours).toFixed(
                              1
                            )}{' '}
                            {t('trainer.reports.modal.hours')}
                          </p>
                        </div>
                      </div>

                      {entry.notes && (
                        <div className="border-border/30 mt-3 border-t pt-3">
                          <p className="text-muted-foreground mb-1 flex items-center gap-1 text-xs">
                            <MessageSquare className="h-3 w-3" />
                            {t('trainer.reports.modal.traineeNotes')}
                          </p>
                          <p className="text-foreground bg-accent/10 rounded-lg p-2 text-sm italic">
                            "{entry.notes}"
                          </p>
                        </div>
                      )}

                      {entry.trainerGrade && (
                        <div className="border-border/30 mt-3 flex items-center gap-2 border-t pt-3">
                          <Star className="h-4 w-4 text-yellow-500" />
                          <span className="text-muted-foreground text-sm">
                            {t('trainer.reports.modal.graded')}:
                          </span>
                          <span
                            className={`font-bold ${
                              entry.trainerGrade <= 2
                                ? 'text-green-500'
                                : entry.trainerGrade <= 4
                                  ? 'text-yellow-500'
                                  : 'text-red-500'
                            }`}
                          >
                            {entry.trainerGrade}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : activeTab === 'grades' ? (
            /* Grades Tab */
            <div className="space-y-4">
              <div className="bg-accent/10 border-accent/20 mb-4 rounded-lg border p-4">
                <p className="text-foreground text-sm">
                  {t('trainer.reports.modal.gradeInfo')}
                </p>
              </div>
              {entries.map(entry => {
                const useCase = getUseCaseById(entry.useCaseId);
                const component = useCase
                  ? getComponentById(useCase.componentId)
                  : null;
                const currentGrade = entryGrades[entry.id];

                return (
                  <div
                    key={entry.id}
                    className="border-border bg-muted/30 rounded-lg border p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-muted-foreground mb-1 text-xs">
                          {component?.title}
                        </p>
                        <p className="text-foreground font-medium">
                          {useCase?.letter}) {useCase?.description}
                        </p>
                        <p className="text-muted-foreground mt-1 text-sm">
                          {entry.actualHours} {t('trainer.reports.modal.hours')}{' '}
                          (
                          {entry.actualHours - entry.plannedHours >= 0
                            ? '+'
                            : ''}
                          {(entry.actualHours - entry.plannedHours).toFixed(1)})
                        </p>
                        {entry.notes && (
                          <p className="text-accent bg-accent/10 mt-2 rounded p-2 text-sm italic">
                            "{entry.notes}"
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <div>
                          <p className="text-muted-foreground mb-1 text-right text-xs">
                            {t('trainer.reports.modal.grade')}
                          </p>
                          <GradeSelector
                            value={currentGrade?.grade}
                            onChange={g => handleGradeChange(entry.id, g)}
                          />
                        </div>
                      </div>
                    </div>
                    {currentGrade?.grade && (
                      <div className="mt-3">
                        <input
                          type="text"
                          value={currentGrade?.comment || ''}
                          onChange={e =>
                            handleGradeCommentChange(entry.id, e.target.value)
                          }
                          placeholder={t('trainer.reports.modal.gradeComment')}
                          className="bg-background border-border text-foreground w-full rounded-lg border px-3 py-2 text-sm"
                        />
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="flex justify-end pt-4">
                <button
                  onClick={saveGrades}
                  disabled={
                    savingGrades || Object.keys(entryGrades).length === 0
                  }
                  className="bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-2 rounded-lg px-4 py-2 disabled:opacity-50"
                >
                  <span className="h-4 w-4">
                    {savingGrades ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : gradesSaved ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Star className="h-4 w-4" />
                    )}
                  </span>
                  {gradesSaved
                    ? t('trainer.reports.modal.gradesSaved')
                    : t('trainer.reports.modal.saveGrades')}
                </button>
              </div>
            </div>
          ) : (
            /* Soft Skills Tab */
            <div className="space-y-4">
              {loadingSoftskills ? (
                <div className="flex items-center justify-center py-12">
                  <div className="border-accent h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
                </div>
              ) : softskillCriteria.length === 0 ? (
                <div className="py-12 text-center">
                  <Award className="text-muted-foreground mx-auto mb-3 h-12 w-12" />
                  <p className="text-muted-foreground">
                    {t('trainer.reports.modal.noSoftskills')}
                  </p>
                </div>
              ) : (
                <>
                  <div className="bg-accent/10 border-accent/20 mb-4 rounded-lg border p-4">
                    <p className="text-foreground text-sm">
                      {t('trainer.reports.modal.softskillInfo')}
                    </p>
                  </div>

                  {/* Group by competency area */}
                  {[
                    'FACHKOMPETENZ',
                    'METHODENKOMPETENZ',
                    'SOZIALKOMPETENZ',
                    'PERSONALKOMPETENZ',
                  ].map(area => {
                    const areaCriteria = softskillCriteria.filter(
                      c => c.competencyArea === area
                    );
                    if (areaCriteria.length === 0) return null;

                    const areaLabels: Record<string, string> = {
                      FACHKOMPETENZ: t('trainer.reports.modal.fachkompetenz'),
                      METHODENKOMPETENZ: t(
                        'trainer.reports.modal.methodenkompetenz'
                      ),
                      SOZIALKOMPETENZ: t(
                        'trainer.reports.modal.sozialkompetenz'
                      ),
                      PERSONALKOMPETENZ: t(
                        'trainer.reports.modal.personalkompetenz'
                      ),
                    };

                    return (
                      <div key={area} className="mb-6">
                        <h4 className="text-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
                          {areaLabels[area] || area}
                        </h4>
                        <div className="space-y-3">
                          {areaCriteria.map(criterion => {
                            const rating = softskillRatings[criterion.id];
                            return (
                              <div
                                key={criterion.id}
                                className="border-border bg-muted/30 flex items-center justify-between gap-4 rounded-lg border p-3"
                              >
                                <div className="flex-1">
                                  <p className="text-foreground text-sm font-medium">
                                    {criterion.code} - {criterion.name}
                                  </p>
                                  {criterion.description && (
                                    <p className="text-muted-foreground mt-0.5 text-xs">
                                      {criterion.description}
                                    </p>
                                  )}
                                </div>
                                <GradeSelector
                                  value={rating?.rating}
                                  onChange={r =>
                                    handleSoftskillRatingChange(criterion.id, r)
                                  }
                                  size="sm"
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  <div className="flex justify-end pt-4">
                    <button
                      onClick={saveSoftskills}
                      disabled={savingSoftskills || !allSoftskillsRated}
                      className="bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-2 rounded-lg px-4 py-2 disabled:opacity-50"
                    >
                      <span className="h-4 w-4">
                        {savingSoftskills ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        ) : (
                          <Award className="h-4 w-4" />
                        )}
                      </span>
                      {t('trainer.reports.modal.saveSoftskills')}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer - consolidated to prevent DOM reconciliation issues */}
        <div className="border-border/50 border-t p-6">
          {report.status === 'SUBMITTED' ? (
            showRejectForm ? (
              <div className="space-y-4">
                <div>
                  <label className="text-foreground mb-2 block text-sm font-medium">
                    {t('trainer.reports.modal.feedbackLabel')}
                  </label>
                  <textarea
                    value={feedback}
                    onChange={e => setFeedback(e.target.value)}
                    placeholder={t('trainer.reports.modal.feedbackPlaceholder')}
                    className="bg-background border-border text-foreground w-full resize-none rounded-lg border px-4 py-3"
                    rows={3}
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setShowRejectForm(false)}
                    className="text-muted-foreground hover:text-foreground px-4 py-2"
                  >
                    {t('trainer.reports.modal.cancel')}
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={!feedback.trim() || processing}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90 flex items-center gap-2 rounded-lg px-4 py-2 disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                    {t('trainer.reports.modal.reject')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex justify-between">
                <button
                  onClick={onClose}
                  className="text-muted-foreground hover:text-foreground px-4 py-2"
                >
                  {t('trainer.reports.modal.close')}
                </button>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowRejectForm(true)}
                    disabled={processing}
                    className="bg-destructive/20 text-destructive hover:bg-destructive/30 flex items-center gap-2 rounded-lg px-4 py-2"
                  >
                    <X className="h-4 w-4" />
                    {t('trainer.reports.modal.reject')}
                  </button>
                  {isLastTab ? (
                    <button
                      onClick={handleApprove}
                      disabled={processing || !canApprove}
                      className="text-primary-foreground flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 hover:bg-green-700 disabled:opacity-50 dark:text-white"
                    >
                      <span className="h-4 w-4">
                        {processing ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </span>
                      {t('trainer.reports.modal.approve')}
                    </button>
                  ) : (
                    <button
                      onClick={goNextTab}
                      disabled={processing || !canProceedNext}
                      className="bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-2 rounded-lg px-4 py-2 disabled:opacity-50"
                    >
                      <ChevronRight className="h-4 w-4" />
                      Next
                    </button>
                  )}
                </div>
              </div>
            )
          ) : report.status === 'APPROVED' ? (
            <div className="flex justify-between">
              <div className="flex items-center gap-2 text-green-500">
                <Check className="h-5 w-5" />
                <span className="font-medium">
                  {t('trainer.reports.modal.alreadyApproved')}
                </span>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={onDownloadPDF}
                  className="bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-2 rounded-lg px-4 py-2"
                >
                  <Download className="h-4 w-4" />
                  {t('trainer.reports.modal.downloadPdf')}
                </button>
                <button
                  onClick={onClose}
                  className="bg-muted text-foreground hover:bg-muted/80 rounded-lg px-4 py-2"
                >
                  {t('trainer.reports.modal.close')}
                </button>
              </div>
            </div>
          ) : report.status === 'REJECTED' ? (
            <>
              <div className="bg-destructive/10 border-destructive/30 mb-4 rounded-lg border p-4">
                <p className="text-destructive mb-1 text-sm font-medium">
                  {t('trainer.reports.rejected')}
                </p>
                <p className="text-destructive/80 text-sm">
                  {report.reviewerFeedback}
                </p>
              </div>
              <div className="flex justify-between">
                <button
                  onClick={onDelete}
                  className="bg-destructive/20 text-destructive hover:bg-destructive/30 flex items-center gap-2 rounded-lg px-4 py-2"
                >
                  <X className="h-4 w-4" />
                  {t('trainer.reports.modal.delete')}
                </button>
                <button
                  onClick={onClose}
                  className="bg-muted text-foreground hover:bg-muted/80 rounded-lg px-4 py-2"
                >
                  {t('trainer.reports.modal.close')}
                </button>
              </div>
            </>
          ) : (
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="bg-muted text-foreground hover:bg-muted/80 rounded-lg px-4 py-2"
              >
                {t('trainer.reports.modal.close')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
