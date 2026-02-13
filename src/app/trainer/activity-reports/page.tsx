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
import { generateActivityReportPDF } from '@/utils/generateReportPDF';

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

    const [selectedReport, setSelectedReport] = useState<ActivityReport | null>(null);
    const [reportEntries, setReportEntries] = useState<ReportUseCaseEntry[]>([]);
    const [loadingEntries, setLoadingEntries] = useState(false);

    const [filter, setFilter] = useState<'all' | 'pending' | 'overbooked' | 'approved' | 'history'>('pending');
    const [traineeFilter, setTraineeFilter] = useState<string>('all');
    const [periodFilter, setPeriodFilter] = useState<'all' | '1-18' | '19-36'>('all');

    const loadData = useCallback(async (userId: string) => {
        try {
            setLoading(true);

            const [reportsRes, traineesRes, useCasesRes, componentsRes] = await Promise.all([
                fetch(`/api/activity-reports?userId=${userId}`),
                fetch(`/api/trainer/trainees?trainerProfileId=${userId}`),
                fetch('/api/training-use-cases'),
                fetch('/api/training-components'),
            ]);

            const [reportsData, traineesData, useCasesData, componentsData] = await Promise.all([
                reportsRes.ok ? reportsRes.json() : { reports: [] },
                traineesRes.ok ? traineesRes.json() : { trainees: [] },
                useCasesRes.ok ? useCasesRes.json() : { useCases: [] },
                componentsRes.ok ? componentsRes.json() : { components: [] },
            ]);

            // Build trainee lookup
            const traineeMap: Record<string, TraineeProfile> = {};
            (traineesData.trainees || []).forEach((t: any) => {
                traineeMap[t.id] = { id: t.id, fullName: t.fullName || t.full_name, email: t.email };
            });

            setTrainees(traineeMap);
            setUseCases(useCasesData.useCases || []);
            setComponents(componentsData.components || []);

            // Reports now include hasOverbooking from the API - no N+1 calls needed
            const enhancedReports = (reportsData.reports || []).map((r: ActivityReport) => ({
                ...r,
                trainee: traineeMap[r.traineeId],
                hasOverbooking: r.hasOverbooking || false,
            }));

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
                body: JSON.stringify({ status: 'REJECTED', feedback, userId: profile.id }),
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

    const fetchEvaluationData = async (userId: string, year: number, week: number) => {
        try {
            // 1. Get all evaluations to find the ID
            const resLists = await fetch(`/api/trainee/evaluations?userId=${userId}`);
            if (!resLists.ok) return null;
            const { evaluations } = await resLists.json();
            const evaluation = evaluations.find((e: any) => e.year === year && e.weekNumber === week);

            if (!evaluation) return null;

            // 2. Get full details including Soft Skills
            const resDetails = await fetch(`/api/trainer/evaluations/${evaluation.id}`);
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
            const softSkills = evalData?.softskillRatings?.map((r: any) => ({
                name: r.criterion.name,
                selfRating: r.rating.selfRating,
                trainerRating: r.rating.trainerRating
            })) || [];

            // Prepare report data for PDF
            const reportData = {
                id: selectedReport.id,
                traineeId: selectedReport.traineeId,
                traineeName: trainees[selectedReport.traineeId]?.fullName || t('trainer.reports.unknown'),
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

            await generateActivityReportPDF(reportData, useCases, components);
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
                const entriesRes = await fetch(`/api/activity-reports/${report.id}/entries`);
                const entriesData = entriesRes.ok ? await entriesRes.json() : { entries: [] };

                // Fetch evaluation data
                const evalData = await fetchEvaluationData(
                    report.traineeId,
                    report.year,
                    report.weekNumber
                );

                const softSkills = evalData?.softskillRatings?.map((r: any) => ({
                    name: r.criterion.name,
                    selfRating: r.rating.selfRating,
                    trainerRating: r.rating.trainerRating
                })) || [];

                const reportData = {
                    id: report.id,
                    traineeId: report.traineeId,
                    traineeName: trainees[report.traineeId]?.fullName || t('trainer.reports.unknown'),
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

                const blob = await generateActivityReportPDF(reportData, useCases, components, true);
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
                <span className="px-2 py-1 rounded-full text-xs bg-yellow-500/20 text-yellow-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {t('trainer.reports.overbooked')}
                </span>
            );
        }

        switch (status) {
            case 'DRAFT':
                return <span className="px-2 py-1 rounded-full text-xs bg-muted text-muted-foreground">{t('trainer.reports.draft')}</span>;
            case 'SUBMITTED':
                return <span className="px-2 py-1 rounded-full text-xs bg-blue-500/20 text-blue-400">{t('trainer.reports.pending')}</span>;
            case 'APPROVED':
                return <span className="px-2 py-1 rounded-full text-xs bg-green-500/20 text-green-400">{t('trainer.reports.approved')}</span>;
            case 'REJECTED':
                return <span className="px-2 py-1 rounded-full text-xs bg-red-500/20 text-red-400">{t('trainer.reports.rejected')}</span>;
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
    const overbookedCount = reports.filter(r => r.status === 'SUBMITTED' && r.hasOverbooking).length;
    const approvedCount = reports.filter(r => r.status === 'APPROVED').length;
    const historyCount = reports.filter(r => r.status === 'APPROVED' || r.status === 'REJECTED').length;

    // Get unique trainees for filter dropdown
    const traineeList = Object.values(trainees).sort((a, b) => a.fullName.localeCompare(b.fullName));

    if (authLoading || loading) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="animate-spin h-8 w-8 border-4 border-accent border-t-transparent rounded-full" />
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-accent/20">
                        <ClipboardList className="h-6 w-6 text-accent" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">{t('trainer.reports.title')}</h1>
                        <p className="text-muted-foreground text-sm">
                            {t('trainer.reports.description')}
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => router.push('/trainer/activity-reports/arbeitszeugnis')}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-medium shadow-lg hover:shadow-xl hover:scale-105 transition-all"
                >
                    <Award className="h-5 w-5" />
                    <span>Arbeitszeugnis erstellen</span>
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button
                    onClick={() => setFilter('pending')}
                    className={`glass-effect rounded-xl p-4 text-left transition-colors ${filter === 'pending' ? 'ring-2 ring-accent' : ''}`}
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-500/20">
                            <Send className="h-5 w-5 text-blue-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-foreground">{pendingCount}</p>
                            <p className="text-sm text-muted-foreground">{t('trainer.reports.pending')}</p>
                        </div>
                    </div>
                </button>

                <button
                    onClick={() => setFilter('approved')}
                    className={`glass-effect rounded-xl p-4 text-left transition-colors ${filter === 'approved' ? 'ring-2 ring-accent' : ''}`}
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-green-500/20">
                            <Check className="h-5 w-5 text-green-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-foreground">{approvedCount}</p>
                            <p className="text-sm text-muted-foreground">{t('trainer.reports.approved')}</p>
                        </div>
                    </div>
                </button>

                <button
                    onClick={() => setFilter('history')}
                    className={`glass-effect rounded-xl p-4 text-left transition-colors ${filter === 'history' ? 'ring-2 ring-accent' : ''}`}
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-accent/20">
                            <FileText className="h-5 w-5 text-accent" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-foreground">{historyCount}</p>
                            <p className="text-sm text-muted-foreground">{t('trainer.reports.history')}</p>
                        </div>
                    </div>
                </button>
            </div>

            {/* History Filters - shown only in history mode */}
            {filter === 'history' && (
                <div className="flex flex-wrap items-center gap-4">
                    {/* Trainee Filter */}
                    <div className="flex items-center gap-2">
                        <label className="text-sm text-muted-foreground">{t('trainer.reports.traineeLabel')}</label>
                        <select
                            value={traineeFilter}
                            onChange={(e) => setTraineeFilter(e.target.value)}
                            className="bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground"
                        >
                            <option value="all">{t('trainer.reports.allTrainees')}</option>
                            {traineeList.map(trainee => (
                                <option key={trainee.id} value={trainee.id}>{trainee.fullName}</option>
                            ))}
                        </select>
                    </div>

                    {/* Period Filter */}
                    <div className="flex items-center gap-2">
                        <label className="text-sm text-muted-foreground">{t('trainer.reports.periodLabel')}</label>
                        <select
                            value={periodFilter}
                            onChange={(e) => setPeriodFilter(e.target.value as 'all' | '1-18' | '19-36')}
                            className="bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground"
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
                            className="flex items-center gap-2 px-4 py-1.5 bg-accent text-accent-foreground rounded-lg hover:bg-accent/90 text-sm"
                        >
                            <Download className="h-4 w-4" />
                            {t('trainer.reports.exportAll').replace('{count}', String(filteredReports.length))}
                        </button>
                    )}
                </div>
            )}

            {/* Reports List */}
            <div className="glass-effect rounded-xl overflow-hidden">
                <div className="p-4 border-b border-border/50">
                    <h2 className="text-lg font-semibold text-foreground">
                        {filter === 'pending' ? t('trainer.reports.pendingReports') :
                         filter === 'overbooked' ? t('trainer.reports.overbookedReports') :
                         filter === 'approved' ? t('trainer.reports.approvedReports') :
                         filter === 'history' ? t('trainer.reports.historyReports') : ''}
                    </h2>
                </div>

                {filteredReports.length === 0 ? (
                    <div className="p-8 text-center">
                        <ClipboardList className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <p className="text-muted-foreground">{t('trainer.reports.noReports')}</p>
                    </div>
                ) : (
                    <div className="divide-y divide-border/50">
                        {filteredReports
                            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                            .map(report => (
                                <button
                                    key={report.id}
                                    onClick={() => handleSelectReport(report)}
                                    className="w-full p-4 hover:bg-muted/50 transition-colors text-left"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="p-2 rounded-lg bg-accent/20">
                                                <User className="h-5 w-5 text-accent" />
                                            </div>
                                            <div>
                                                <h3 className="font-medium text-foreground">
                                                    {report.trainee?.fullName || t('trainer.reports.unknown')}
                                                </h3>
                                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                    <Calendar className="h-3 w-3" />
                                                    <span>{t('trainer.reports.week').replace('{week}', String(report.weekNumber)).replace('{year}', String(report.year))}</span>
                                                    <span>•</span>
                                                    <span>{t('trainer.reports.trainingYear').replace('{year}', String(report.ausbildungsjahr))}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-3">
                                            {getStatusBadge(report.status, report.hasOverbooking)}
                                            <ChevronRight className="h-5 w-5 text-muted-foreground" />
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
    const [activeTab, setActiveTab] = useState<'details' | 'grades' | 'softskills'>('details');
    
    // Grading state
    const [entryGrades, setEntryGrades] = useState<Record<string, { grade: number; comment: string }>>({});
    const [savingGrades, setSavingGrades] = useState(false);
    const [gradesSaved, setGradesSaved] = useState(false);
    
    // Soft skills state
    const [softskillCriteria, setSoftskillCriteria] = useState<SoftskillCriterion[]>([]);
    const [softskillRatings, setSoftskillRatings] = useState<Record<string, { rating: number; comment: string }>>({});
    const [loadingSoftskills, setLoadingSoftskills] = useState(false);
    const [savingSoftskills, setSavingSoftskills] = useState(false);

    const totalPlanned = entries.reduce((sum, e) => sum + e.plannedHours, 0);
    const totalActual = entries.reduce((sum, e) => sum + e.actualHours, 0);
    const hasOverbooking = entries.some(e => e.isOverbooked);

    // Initialize grades from existing entries
    useEffect(() => {
        const initialGrades: Record<string, { grade: number; comment: string }> = {};
        entries.forEach(entry => {
            if (entry.trainerGrade) {
                initialGrades[entry.id] = {
                    grade: entry.trainerGrade,
                    comment: entry.gradeComment || ''
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
            const ratingsRes = await fetch(`/api/weekly-evaluations?activityReportId=${report.id}`);
            if (ratingsRes.ok) {
                const data = await ratingsRes.json();
                const existingRatings: Record<string, { rating: number; comment: string }> = {};
                (data.softskillRatings || []).forEach((r: any) => {
                    existingRatings[r.softskillCriterionId] = {
                        rating: r.trainerRating,
                        comment: r.trainerComment || ''
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
            [entryId]: { ...prev[entryId], grade, comment: prev[entryId]?.comment || '' }
        }));
        setGradesSaved(false);
    };

    const handleGradeCommentChange = (entryId: string, comment: string) => {
        setEntryGrades(prev => ({
            ...prev,
            [entryId]: { ...prev[entryId], comment, grade: prev[entryId]?.grade || 3 }
        }));
        setGradesSaved(false);
    };

    const handleSoftskillRatingChange = (criterionId: string, rating: number) => {
        setSoftskillRatings(prev => ({
            ...prev,
            [criterionId]: { ...prev[criterionId], rating, comment: prev[criterionId]?.comment || '' }
        }));
    };

    const handleSoftskillCommentChange = (criterionId: string, comment: string) => {
        setSoftskillRatings(prev => ({
            ...prev,
            [criterionId]: { ...prev[criterionId], comment, rating: prev[criterionId]?.rating || 3 }
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
                    comment: val.comment
                }));

            if (gradesToSave.length > 0) {
                const res = await fetch(`/api/activity-reports/${report.id}/entries`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entryGrades: gradesToSave, trainerId })
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
                    trainerComment: val.comment
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
                    softskillRatings: ratingsToSave
                })
            });
            
            if (res.ok) {
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
        const allEntriesGraded = entries.every(entry => entryGrades[entry.id]?.grade);
        if (!allEntriesGraded) {
            toast.error(t('trainer.reports.modal.gradesRequired'));
            setActiveTab('grades');
            return;
        }
        
        // Validate: at least some soft skills should be rated
        const softskillsRated = Object.keys(softskillRatings).filter(k => softskillRatings[k]?.rating).length;
        if (softskillsRated === 0) {
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

    const GradeSelector = ({ value, onChange, size = 'md' }: { value: number | undefined; onChange: (v: number) => void; size?: 'sm' | 'md' }) => {
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
                                ? g <= 2 ? 'bg-green-500 text-white' : g <= 4 ? 'bg-yellow-500 text-white' : 'bg-red-500 text-white'
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-card border border-border rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-border/50">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-bold text-foreground">
                                {t('trainer.reports.modal.title')}
                            </h2>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                                <User className="h-4 w-4" />
                                <span>{report.trainee?.fullName}</span>
                                <span>•</span>
                                <Calendar className="h-4 w-4" />
                                <span>{t('trainer.reports.week').replace('{week}', String(report.weekNumber)).replace('{year}', String(report.year))}</span>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors">
                            <X className="h-5 w-5 text-muted-foreground" />
                        </button>
                    </div>

                    {/* Summary */}
                    <div className="mt-4 grid grid-cols-3 gap-4">
                        <div className="p-3 bg-muted/50 rounded-lg">
                            <p className="text-xs text-muted-foreground">{t('trainer.reports.modal.planTotal')}</p>
                            <p className="text-lg font-bold text-foreground">{totalPlanned} {t('trainer.reports.modal.hours')}</p>
                        </div>
                        <div className="p-3 bg-muted/50 rounded-lg">
                            <p className="text-xs text-muted-foreground">{t('trainer.reports.modal.actualTotal')}</p>
                            <p className={`text-lg font-bold ${totalActual > totalPlanned ? 'text-yellow-500' : 'text-foreground'}`}>
                                {totalActual} {t('trainer.reports.modal.hours')}
                            </p>
                        </div>
                        <div className="p-3 bg-muted/50 rounded-lg">
                            <p className="text-xs text-muted-foreground">{t('trainer.reports.modal.difference')}</p>
                            <p className={`text-lg font-bold ${totalActual > totalPlanned ? 'text-yellow-500' : 'text-green-500'}`}>
                                {totalActual > totalPlanned ? '+' : ''}{(totalActual - totalPlanned).toFixed(1)} {t('trainer.reports.modal.hours')}
                            </p>
                        </div>
                    </div>

                    {hasOverbooking && (
                        <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-yellow-500" />
                            <span className="text-yellow-500 text-sm font-medium">
                                {t('trainer.reports.modal.overbookedWarning')}
                            </span>
                        </div>
                    )}

                    {/* Tabs - Only show for SUBMITTED reports */}
                    {report.status === 'SUBMITTED' && (
                        <div className="mt-4 flex gap-2 border-b border-border/30">
                            <button
                                onClick={() => setActiveTab('details')}
                                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === 'details' 
                                        ? 'border-accent text-accent' 
                                        : 'border-transparent text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {t('trainer.reports.modal.tabDetails')}
                            </button>
                            <button
                                onClick={() => setActiveTab('grades')}
                                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                                    activeTab === 'grades' 
                                        ? 'border-accent text-accent' 
                                        : 'border-transparent text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                <Star className="h-4 w-4" />
                                {t('trainer.reports.modal.tabGrades')}
                            </button>
                            <button
                                onClick={() => setActiveTab('softskills')}
                                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                                    activeTab === 'softskills' 
                                        ? 'border-accent text-accent' 
                                        : 'border-transparent text-muted-foreground hover:text-foreground'
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
                            <div className="animate-spin h-8 w-8 border-4 border-accent border-t-transparent rounded-full" />
                        </div>
                    ) : activeTab === 'details' ? (
                        /* Details Tab */
                        entries.length === 0 ? (
                            <p className="text-center text-muted-foreground py-12">{t('trainer.reports.modal.noEntries')}</p>
                        ) : (
                            <div className="space-y-4">
                                {entries.map(entry => {
                                    const useCase = getUseCaseById(entry.useCaseId);
                                    const component = useCase ? getComponentById(useCase.componentId) : null;

                                    return (
                                        <div
                                            key={entry.id}
                                            className={`p-4 rounded-lg border ${entry.isOverbooked ? 'border-yellow-500/50 bg-yellow-500/10' : 'border-border bg-muted/30'}`}
                                        >
                                            <p className="text-xs text-muted-foreground mb-1">{component?.title}</p>
                                            <p className="font-medium text-foreground mb-3">
                                                {useCase?.letter}) {useCase?.description}
                                            </p>

                                            <div className="grid grid-cols-3 gap-4">
                                                <div>
                                                    <p className="text-xs text-muted-foreground">{t('trainer.reports.modal.plan')}</p>
                                                    <p className="font-medium text-foreground">{entry.plannedHours} {t('trainer.reports.modal.hours')}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-muted-foreground">{t('trainer.reports.modal.actual')}</p>
                                                    <p className={`font-medium ${entry.isOverbooked ? 'text-yellow-500' : 'text-foreground'}`}>
                                                        {entry.actualHours} {t('trainer.reports.modal.hours')}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-muted-foreground">{t('trainer.reports.modal.difference')}</p>
                                                    <p className={`font-medium ${entry.isOverbooked ? 'text-yellow-500' : 'text-green-500'}`}>
                                                        {entry.isOverbooked ? '+' : ''}{(entry.actualHours - entry.plannedHours).toFixed(1)} {t('trainer.reports.modal.hours')}
                                                    </p>
                                                </div>
                                            </div>

                                            {entry.notes && (
                                                <div className="mt-3 pt-3 border-t border-border/30">
                                                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                                                        <MessageSquare className="h-3 w-3" />
                                                        {t('trainer.reports.modal.traineeNotes')}
                                                    </p>
                                                    <p className="text-sm text-foreground bg-accent/10 p-2 rounded-lg italic">
                                                        "{entry.notes}"
                                                    </p>
                                                </div>
                                            )}

                                            {entry.trainerGrade && (
                                                <div className="mt-3 pt-3 border-t border-border/30 flex items-center gap-2">
                                                    <Star className="h-4 w-4 text-yellow-500" />
                                                    <span className="text-sm text-muted-foreground">{t('trainer.reports.modal.graded')}:</span>
                                                    <span className={`font-bold ${
                                                        entry.trainerGrade <= 2 ? 'text-green-500' : 
                                                        entry.trainerGrade <= 4 ? 'text-yellow-500' : 'text-red-500'
                                                    }`}>{entry.trainerGrade}</span>
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
                            <div className="p-4 bg-accent/10 border border-accent/20 rounded-lg mb-4">
                                <p className="text-sm text-foreground">
                                    {t('trainer.reports.modal.gradeInfo')}
                                </p>
                            </div>
                            {entries.map(entry => {
                                const useCase = getUseCaseById(entry.useCaseId);
                                const component = useCase ? getComponentById(useCase.componentId) : null;
                                const currentGrade = entryGrades[entry.id];

                                return (
                                    <div key={entry.id} className="p-4 rounded-lg border border-border bg-muted/30">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex-1">
                                                <p className="text-xs text-muted-foreground mb-1">{component?.title}</p>
                                                <p className="font-medium text-foreground">
                                                    {useCase?.letter}) {useCase?.description}
                                                </p>
                                                <p className="text-sm text-muted-foreground mt-1">
                                                    {entry.actualHours} {t('trainer.reports.modal.hours')} ({entry.actualHours - entry.plannedHours >= 0 ? '+' : ''}{(entry.actualHours - entry.plannedHours).toFixed(1)})
                                                </p>
                                                {entry.notes && (
                                                    <p className="text-sm text-accent mt-2 bg-accent/10 p-2 rounded italic">
                                                        "{entry.notes}"
                                                    </p>
                                                )}
                                            </div>
                                            <div className="flex flex-col items-end gap-2">
                                                <div>
                                                    <p className="text-xs text-muted-foreground mb-1 text-right">{t('trainer.reports.modal.grade')}</p>
                                                    <GradeSelector
                                                        value={currentGrade?.grade}
                                                        onChange={(g) => handleGradeChange(entry.id, g)}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                        {currentGrade?.grade && (
                                            <div className="mt-3">
                                                <input
                                                    type="text"
                                                    value={currentGrade?.comment || ''}
                                                    onChange={(e) => handleGradeCommentChange(entry.id, e.target.value)}
                                                    placeholder={t('trainer.reports.modal.gradeComment')}
                                                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground"
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            
                            <div className="flex justify-end pt-4">
                                <button
                                    onClick={saveGrades}
                                    disabled={savingGrades || Object.keys(entryGrades).length === 0}
                                    className="flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent/90 disabled:opacity-50"
                                >
                                    <span className="w-4 h-4">
                                        {savingGrades ? (
                                            <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                                        ) : gradesSaved ? (
                                            <Check className="h-4 w-4" />
                                        ) : (
                                            <Star className="h-4 w-4" />
                                        )}
                                    </span>
                                    {gradesSaved ? t('trainer.reports.modal.gradesSaved') : t('trainer.reports.modal.saveGrades')}
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* Soft Skills Tab */
                        <div className="space-y-4">
                            {loadingSoftskills ? (
                                <div className="flex items-center justify-center py-12">
                                    <div className="animate-spin h-8 w-8 border-4 border-accent border-t-transparent rounded-full" />
                                </div>
                            ) : softskillCriteria.length === 0 ? (
                                <div className="text-center py-12">
                                    <Award className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                                    <p className="text-muted-foreground">{t('trainer.reports.modal.noSoftskills')}</p>
                                </div>
                            ) : (
                                <>
                                    <div className="p-4 bg-accent/10 border border-accent/20 rounded-lg mb-4">
                                        <p className="text-sm text-foreground">
                                            {t('trainer.reports.modal.softskillInfo')}
                                        </p>
                                    </div>
                                    
                                    {/* Group by competency area */}
                                    {['FACHKOMPETENZ', 'METHODENKOMPETENZ', 'SOZIALKOMPETENZ', 'PERSONALKOMPETENZ'].map(area => {
                                        const areaCriteria = softskillCriteria.filter(c => c.competencyArea === area);
                                        if (areaCriteria.length === 0) return null;
                                        
                                        const areaLabels: Record<string, string> = {
                                            'FACHKOMPETENZ': t('trainer.reports.modal.fachkompetenz'),
                                            'METHODENKOMPETENZ': t('trainer.reports.modal.methodenkompetenz'),
                                            'SOZIALKOMPETENZ': t('trainer.reports.modal.sozialkompetenz'),
                                            'PERSONALKOMPETENZ': t('trainer.reports.modal.personalkompetenz'),
                                        };

                                        return (
                                            <div key={area} className="mb-6">
                                                <h4 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wide">
                                                    {areaLabels[area] || area}
                                                </h4>
                                                <div className="space-y-3">
                                                    {areaCriteria.map(criterion => {
                                                        const rating = softskillRatings[criterion.id];
                                                        return (
                                                            <div key={criterion.id} className="p-3 rounded-lg border border-border bg-muted/30 flex items-center justify-between gap-4">
                                                                <div className="flex-1">
                                                                    <p className="font-medium text-foreground text-sm">
                                                                        {criterion.code} - {criterion.name}
                                                                    </p>
                                                                    {criterion.description && (
                                                                        <p className="text-xs text-muted-foreground mt-0.5">{criterion.description}</p>
                                                                    )}
                                                                </div>
                                                                <GradeSelector
                                                                    value={rating?.rating}
                                                                    onChange={(r) => handleSoftskillRatingChange(criterion.id, r)}
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
                                            disabled={savingSoftskills || Object.keys(softskillRatings).length === 0}
                                            className="flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent/90 disabled:opacity-50"
                                        >
                                            <span className="w-4 h-4">
                                                {savingSoftskills ? (
                                                    <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
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
                <div className="p-6 border-t border-border/50">
                    {report.status === 'SUBMITTED' ? (
                        showRejectForm ? (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-foreground mb-2">
                                        {t('trainer.reports.modal.feedbackLabel')}
                                    </label>
                                    <textarea
                                        value={feedback}
                                        onChange={e => setFeedback(e.target.value)}
                                        placeholder={t('trainer.reports.modal.feedbackPlaceholder')}
                                        className="w-full px-4 py-3 bg-background border border-border rounded-lg text-foreground resize-none"
                                        rows={3}
                                    />
                                </div>
                                <div className="flex justify-end gap-3">
                                    <button
                                        onClick={() => setShowRejectForm(false)}
                                        className="px-4 py-2 text-muted-foreground hover:text-foreground"
                                    >
                                        {t('trainer.reports.modal.cancel')}
                                    </button>
                                    <button
                                        onClick={handleReject}
                                        disabled={!feedback.trim() || processing}
                                        className="flex items-center gap-2 px-4 py-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 disabled:opacity-50"
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
                                    className="px-4 py-2 text-muted-foreground hover:text-foreground"
                                >
                                    {t('trainer.reports.modal.close')}
                                </button>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setShowRejectForm(true)}
                                        disabled={processing}
                                        className="flex items-center gap-2 px-4 py-2 bg-destructive/20 text-destructive rounded-lg hover:bg-destructive/30"
                                    >
                                        <X className="h-4 w-4" />
                                        {t('trainer.reports.modal.reject')}
                                    </button>
                                    <button
                                        onClick={handleApprove}
                                        disabled={processing}
                                        className="flex items-center gap-2 px-4 py-2 bg-green-600 text-primary-foreground dark:text-white rounded-lg hover:bg-green-700"
                                    >
                                        <span className="w-4 h-4">
                                            {processing ? (
                                                <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                                            ) : (
                                                <Check className="h-4 w-4" />
                                            )}
                                        </span>
                                        {t('trainer.reports.modal.approve')}
                                    </button>
                                </div>
                            </div>
                        )
                    ) : report.status === 'APPROVED' ? (
                        <div className="flex justify-between">
                            <div className="flex items-center gap-2 text-green-500">
                                <Check className="h-5 w-5" />
                                <span className="font-medium">{t('trainer.reports.modal.alreadyApproved')}</span>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={onDownloadPDF}
                                    className="flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent/90"
                                >
                                    <Download className="h-4 w-4" />
                                    {t('trainer.reports.modal.downloadPdf')}
                                </button>
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80"
                                >
                                    {t('trainer.reports.modal.close')}
                                </button>
                            </div>
                        </div>
                    ) : report.status === 'REJECTED' ? (
                        <>
                            <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg mb-4">
                                <p className="text-sm text-destructive font-medium mb-1">{t('trainer.reports.rejected')}</p>
                                <p className="text-sm text-destructive/80">{report.reviewerFeedback}</p>
                            </div>
                            <div className="flex justify-between">
                                <button
                                    onClick={onDelete}
                                    className="flex items-center gap-2 px-4 py-2 bg-destructive/20 text-destructive rounded-lg hover:bg-destructive/30"
                                >
                                    <X className="h-4 w-4" />
                                    {t('trainer.reports.modal.delete')}
                                </button>
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80"
                                >
                                    {t('trainer.reports.modal.close')}
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="flex justify-end">
                            <button
                                onClick={onClose}
                                className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80"
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
