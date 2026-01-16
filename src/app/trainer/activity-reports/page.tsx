'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
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

            // Enhance reports with trainee info and check for overbooking
            const enhancedReports = await Promise.all(
                (reportsData.reports || []).map(async (r: ActivityReport) => {
                    // Fetch entries to check for overbooking
                    const entriesRes = await fetch(`/api/activity-reports/${r.id}/entries`);
                    const entriesData = entriesRes.ok ? await entriesRes.json() : { entries: [] };
                    const hasOverbooking = entriesData.entries?.some((e: ReportUseCaseEntry) => e.isOverbooked);

                    return {
                        ...r,
                        trainee: traineeMap[r.traineeId],
                        hasOverbooking,
                    };
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
        if (!confirm('Möchten Sie diesen Nachweis wirklich löschen?')) return;

        try {
            const res = await fetch(`/api/activity-reports/${reportId}`, {
                method: 'DELETE',
            });

            if (!res.ok) throw new Error('Fehler beim Löschen');

            setSelectedReport(null);
            if (profile?.id) loadData(profile.id);
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleDownloadPDF = async () => {
        if (!selectedReport) return;
        try {
            // Prepare report data for PDF
            const reportData = {
                id: selectedReport.id,
                traineeId: selectedReport.traineeId,
                traineeName: trainees[selectedReport.traineeId]?.fullName || 'Unbekannt',
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
                reviewerName: profile?.full_name || 'Ausbilder',
                entries: reportEntries,
            };

            await generateActivityReportPDF(reportData, useCases, components);
        } catch (err: any) {
            setError('Fehler beim Erstellen des PDFs: ' + err.message);
        }
    };

    const handleMassExport = async () => {
        try {
            setError(null);
            // Export all filtered reports one by one
            for (const report of filteredReports) {
                // Fetch entries for this report
                const entriesRes = await fetch(`/api/activity-reports/${report.id}/entries`);
                const entriesData = entriesRes.ok ? await entriesRes.json() : { entries: [] };

                const reportData = {
                    id: report.id,
                    traineeId: report.traineeId,
                    traineeName: trainees[report.traineeId]?.fullName || 'Unbekannt',
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
                    reviewerName: profile?.full_name || 'Ausbilder',
                    entries: entriesData.entries || [],
                };

                await generateActivityReportPDF(reportData, useCases, components);
                // Small delay between downloads to prevent browser blocking
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        } catch (err: any) {
            setError('Fehler beim Massenexport: ' + err.message);
        }
    };

    const getUseCaseById = (id: string) => useCases.find(uc => uc.id === id);
    const getComponentById = (id: string) => components.find(c => c.id === id);

    const getStatusBadge = (status: string, hasOverbooking?: boolean) => {
        if (status === 'SUBMITTED' && hasOverbooking) {
            return (
                <span className="px-2 py-1 rounded-full text-xs bg-yellow-500/20 text-yellow-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Überbucht
                </span>
            );
        }

        switch (status) {
            case 'DRAFT':
                return <span className="px-2 py-1 rounded-full text-xs bg-muted text-muted-foreground">Entwurf</span>;
            case 'SUBMITTED':
                return <span className="px-2 py-1 rounded-full text-xs bg-blue-500/20 text-blue-400">Zur Prüfung</span>;
            case 'APPROVED':
                return <span className="px-2 py-1 rounded-full text-xs bg-green-500/20 text-green-400">Genehmigt</span>;
            case 'REJECTED':
                return <span className="px-2 py-1 rounded-full text-xs bg-red-500/20 text-red-400">Abgelehnt</span>;
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
            <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-accent/20">
                    <ClipboardList className="h-6 w-6 text-accent" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Tätigkeitsnachweise</h1>
                    <p className="text-muted-foreground text-sm">
                        Prüfen und genehmigen Sie die wöchentlichen Ausbildungsnachweise
                    </p>
                </div>
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
                            <p className="text-sm text-muted-foreground">Zur Prüfung</p>
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
                            <p className="text-sm text-muted-foreground">Genehmigt</p>
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
                            <p className="text-sm text-muted-foreground">Historie</p>
                        </div>
                    </div>
                </button>
            </div>

            {/* History Filters - shown only in history mode */}
            {filter === 'history' && (
                <div className="flex flex-wrap items-center gap-4">
                    {/* Trainee Filter */}
                    <div className="flex items-center gap-2">
                        <label className="text-sm text-muted-foreground">Azubi:</label>
                        <select
                            value={traineeFilter}
                            onChange={(e) => setTraineeFilter(e.target.value)}
                            className="bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground"
                        >
                            <option value="all">Alle Azubis</option>
                            {traineeList.map(t => (
                                <option key={t.id} value={t.id}>{t.fullName}</option>
                            ))}
                        </select>
                    </div>

                    {/* Period Filter */}
                    <div className="flex items-center gap-2">
                        <label className="text-sm text-muted-foreground">Zeitraum:</label>
                        <select
                            value={periodFilter}
                            onChange={(e) => setPeriodFilter(e.target.value as 'all' | '1-18' | '19-36')}
                            className="bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground"
                        >
                            <option value="all">Alle Zeiträume</option>
                            <option value="1-18">1. bis 18. Monat</option>
                            <option value="19-36">19. bis 36. Monat</option>
                        </select>
                    </div>

                    {/* Mass Export Button */}
                    {filteredReports.length > 0 && (
                        <button
                            onClick={() => handleMassExport()}
                            className="flex items-center gap-2 px-4 py-1.5 bg-accent text-accent-foreground rounded-lg hover:bg-accent/90 text-sm"
                        >
                            <Download className="h-4 w-4" />
                            Alle exportieren ({filteredReports.length})
                        </button>
                    )}
                </div>
            )}

            {/* Reports List */}
            <div className="glass-effect rounded-xl overflow-hidden">
                <div className="p-4 border-b border-border/50">
                    <h2 className="text-lg font-semibold text-foreground">
                        {filter === 'pending' && 'Nachweise zur Prüfung'}
                        {filter === 'overbooked' && 'Überbuchte Nachweise'}
                        {filter === 'approved' && 'Genehmigte Nachweise'}
                        {filter === 'history' && 'Historie (Genehmigte & Abgelehnte)'}
                    </h2>
                </div>

                {filteredReports.length === 0 ? (
                    <div className="p-8 text-center">
                        <ClipboardList className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <p className="text-muted-foreground">Keine Nachweise gefunden</p>
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
                                                    {report.trainee?.fullName || 'Unbekannt'}
                                                </h3>
                                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                    <Calendar className="h-3 w-3" />
                                                    <span>KW {report.weekNumber} / {report.year}</span>
                                                    <span>•</span>
                                                    <span>{report.ausbildungsjahr}. Ausbildungsjahr</span>
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
}) {
    const [showRejectForm, setShowRejectForm] = useState(false);
    const [feedback, setFeedback] = useState('');
    const [processing, setProcessing] = useState(false);

    const totalPlanned = entries.reduce((sum, e) => sum + e.plannedHours, 0);
    const totalActual = entries.reduce((sum, e) => sum + e.actualHours, 0);
    const hasOverbooking = entries.some(e => e.isOverbooked);

    const handleApprove = async () => {
        setProcessing(true);
        await onApprove();
        setProcessing(false);
    };

    const handleReject = async () => {
        if (!feedback.trim()) return;
        setProcessing(true);
        await onReject(feedback);
        setProcessing(false);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-card border border-border rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-border/50">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-bold text-foreground">
                                Tätigkeitsnachweis prüfen
                            </h2>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                                <User className="h-4 w-4" />
                                <span>{report.trainee?.fullName}</span>
                                <span>•</span>
                                <Calendar className="h-4 w-4" />
                                <span>KW {report.weekNumber} / {report.year}</span>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors">
                            <X className="h-5 w-5 text-muted-foreground" />
                        </button>
                    </div>

                    {/* Summary */}
                    <div className="mt-4 grid grid-cols-3 gap-4">
                        <div className="p-3 bg-muted/50 rounded-lg">
                            <p className="text-xs text-muted-foreground">Plan Gesamt</p>
                            <p className="text-lg font-bold text-foreground">{totalPlanned} Std</p>
                        </div>
                        <div className="p-3 bg-muted/50 rounded-lg">
                            <p className="text-xs text-muted-foreground">IST Gesamt</p>
                            <p className={`text-lg font-bold ${totalActual > totalPlanned ? 'text-yellow-500' : 'text-foreground'}`}>
                                {totalActual} Std
                            </p>
                        </div>
                        <div className="p-3 bg-muted/50 rounded-lg">
                            <p className="text-xs text-muted-foreground">Differenz</p>
                            <p className={`text-lg font-bold ${totalActual > totalPlanned ? 'text-yellow-500' : 'text-green-500'}`}>
                                {totalActual > totalPlanned ? '+' : ''}{(totalActual - totalPlanned).toFixed(1)} Std
                            </p>
                        </div>
                    </div>

                    {hasOverbooking && (
                        <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-yellow-500" />
                            <span className="text-yellow-500 text-sm font-medium">
                                Dieser Nachweis enthält überbuchte Einträge
                            </span>
                        </div>
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {loadingEntries ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="animate-spin h-8 w-8 border-4 border-accent border-t-transparent rounded-full" />
                        </div>
                    ) : entries.length === 0 ? (
                        <p className="text-center text-muted-foreground py-12">Keine Einträge</p>
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
                                                <p className="text-xs text-muted-foreground">Plan</p>
                                                <p className="font-medium text-foreground">{entry.plannedHours} Std</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-muted-foreground">IST</p>
                                                <p className={`font-medium ${entry.isOverbooked ? 'text-yellow-500' : 'text-foreground'}`}>
                                                    {entry.actualHours} Std
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-muted-foreground">Differenz</p>
                                                <p className={`font-medium ${entry.isOverbooked ? 'text-yellow-500' : 'text-green-500'}`}>
                                                    {entry.isOverbooked ? '+' : ''}{(entry.actualHours - entry.plannedHours).toFixed(1)} Std
                                                </p>
                                            </div>
                                        </div>

                                        {entry.notes && (
                                            <p className="mt-2 text-sm text-muted-foreground">
                                                <MessageSquare className="h-3 w-3 inline mr-1" />
                                                {entry.notes}
                                            </p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                {report.status === 'SUBMITTED' && (
                    <div className="p-6 border-t border-border/50">
                        {showRejectForm ? (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-foreground mb-2">
                                        Feedback / Begründung für Ablehnung
                                    </label>
                                    <textarea
                                        value={feedback}
                                        onChange={e => setFeedback(e.target.value)}
                                        placeholder="Bitte geben Sie einen Grund für die Ablehnung an..."
                                        className="w-full px-4 py-3 bg-background border border-border rounded-lg text-foreground resize-none"
                                        rows={3}
                                    />
                                </div>
                                <div className="flex justify-end gap-3">
                                    <button
                                        onClick={() => setShowRejectForm(false)}
                                        className="px-4 py-2 text-muted-foreground hover:text-foreground"
                                    >
                                        Abbrechen
                                    </button>
                                    <button
                                        onClick={handleReject}
                                        disabled={!feedback.trim() || processing}
                                        className="flex items-center gap-2 px-4 py-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 disabled:opacity-50"
                                    >
                                        <X className="h-4 w-4" />
                                        Ablehnen
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex justify-between">
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2 text-muted-foreground hover:text-foreground"
                                >
                                    Schließen
                                </button>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setShowRejectForm(true)}
                                        disabled={processing}
                                        className="flex items-center gap-2 px-4 py-2 bg-destructive/20 text-destructive rounded-lg hover:bg-destructive/30"
                                    >
                                        <X className="h-4 w-4" />
                                        Ablehnen
                                    </button>
                                    <button
                                        onClick={handleApprove}
                                        disabled={processing}
                                        className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                                    >
                                        {processing ? (
                                            <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                                        ) : (
                                            <Check className="h-4 w-4" />
                                        )}
                                        Genehmigen
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {report.status === 'APPROVED' && (
                    <div className="p-6 border-t border-border/50 flex justify-between">
                        <div className="flex items-center gap-2 text-green-500">
                            <Check className="h-5 w-5" />
                            <span className="font-medium">Bereits genehmigt</span>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={onDownloadPDF}
                                className="flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent/90"
                            >
                                <Download className="h-4 w-4" />
                                PDF herunterladen
                            </button>
                            <button
                                onClick={onClose}
                                className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80"
                            >
                                Schließen
                            </button>
                        </div>
                    </div>
                )}

                {report.status === 'REJECTED' && (
                    <div className="p-6 border-t border-border/50">
                        <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg mb-4">
                            <p className="text-sm text-destructive font-medium mb-1">Abgelehnt</p>
                            <p className="text-sm text-destructive/80">{report.reviewerFeedback}</p>
                        </div>
                        <div className="flex justify-between">
                            <button
                                onClick={onDelete}
                                className="flex items-center gap-2 px-4 py-2 bg-destructive/20 text-destructive rounded-lg hover:bg-destructive/30"
                            >
                                <X className="h-4 w-4" />
                                Löschen
                            </button>
                            <button
                                onClick={onClose}
                                className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80"
                            >
                                Schließen
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
