'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
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
import { generateActivityReportPDF } from '@/utils/generateReportPDF';

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
    useCase?: TrainingUseCase;
    component?: TrainingComponent;
}

export default function TraineeActivityReportsPage() {
    const { profile, loading: authLoading } = useAuth();
    const router = useRouter();

    // State
    const [reports, setReports] = useState<ActivityReport[]>([]);
    const [components, setComponents] = useState<TrainingComponent[]>([]);
    const [useCases, setUseCases] = useState<TrainingUseCase[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Modal states
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [selectedReport, setSelectedReport] = useState<ActivityReport | null>(null);
    const [reportEntries, setReportEntries] = useState<ReportUseCaseEntry[]>([]);

    // Edit state
    const [editingReport, setEditingReport] = useState<ActivityReport | null>(null);
    const [editingEntries, setEditingEntries] = useState<ReportUseCaseEntry[]>([]);

    // Load data
    useEffect(() => {
        if (!profile || authLoading) return;

        if (profile.role !== 'trainee') {
            router.push('/trainer/activity-reports');
            return;
        }

        loadData();
    }, [profile?.id, authLoading, router]);

    const loadData = async () => {
        if (!profile) return;

        try {
            setLoading(true);

            // Load components, use cases, and reports in parallel
            const [componentsRes, useCasesRes, reportsRes] = await Promise.all([
                fetch('/api/training-components'),
                fetch('/api/training-use-cases'),
                fetch(`/api/activity-reports?userId=${profile.id}`),
            ]);

            if (!componentsRes.ok || !useCasesRes.ok || !reportsRes.ok) {
                throw new Error('Fehler beim Laden der Daten');
            }

            const [componentsData, useCasesData, reportsData] = await Promise.all([
                componentsRes.json(),
                useCasesRes.json(),
                reportsRes.json(),
            ]);

            setComponents(componentsData.components || []);
            setUseCases(useCasesData.useCases || []);
            setReports(reportsData.reports || []);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
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

    // Get current ISO week number
    const getCurrentWeek = () => {
        const now = new Date();
        const start = new Date(now.getFullYear(), 0, 1);
        const diff = now.getTime() - start.getTime();
        const oneWeek = 604800000;
        return Math.ceil((diff / oneWeek) + 1);
    };

    // Get status badge
    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'DRAFT':
                return <span className="px-2 py-1 rounded-full text-xs bg-muted text-muted-foreground">Entwurf</span>;
            case 'SUBMITTED':
                return <span className="px-2 py-1 rounded-full text-xs bg-blue-500/20 text-blue-400">Eingereicht</span>;
            case 'APPROVED':
                return <span className="px-2 py-1 rounded-full text-xs bg-green-500/20 text-green-400">Genehmigt</span>;
            case 'REJECTED':
                return <span className="px-2 py-1 rounded-full text-xs bg-red-500/20 text-red-400">Abgelehnt</span>;
            default:
                return null;
        }
    };

    const handleDeleteReport = async (e: React.MouseEvent, reportId: string) => {
        e.stopPropagation();
        if (!confirm('Möchten Sie diesen Entwurf wirklich löschen?')) return;

        try {
            const res = await fetch(`/api/activity-reports/${reportId}`, {
                method: 'DELETE',
            });

            if (!res.ok) throw new Error('Fehler beim Löschen');

            setReports(reports.filter(r => r.id !== reportId));
        } catch (err: any) {
            alert(err.message);
        }
    };

    const handleEditReport = async (e: React.MouseEvent, report: ActivityReport) => {
        e.stopPropagation();
        try {
            // Fetch entries for this report
            const res = await fetch(`/api/activity-reports/${report.id}/entries`);
            if (!res.ok) throw new Error('Fehler beim Laden der Einträge');

            const data = await res.json();
            setEditingReport(report);
            setEditingEntries(data.entries || []);
            setShowCreateModal(true);
        } catch (err: any) {
            alert(err.message);
        }
    };

    const handleDownloadPDF = async (e: React.MouseEvent, report: ActivityReport) => {
        e.stopPropagation();
        try {
            // Fetch entries for this report
            const entriesRes = await fetch(`/api/activity-reports/${report.id}/entries`);
            if (!entriesRes.ok) throw new Error('Fehler beim Laden der Einträge');
            const entriesData = await entriesRes.json();

            // Prepare report data for PDF
            const reportData = {
                id: report.id,
                traineeId: report.traineeId,
                traineeName: profile?.full_name || 'Unbekannt',
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
            };

            await generateActivityReportPDF(reportData, useCases, components);
        } catch (err: any) {
            alert('Fehler beim Erstellen des PDFs: ' + err.message);
        }
    };

    if (authLoading || loading) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="animate-spin h-8 w-8 border-4 border-accent border-t-transparent rounded-full" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6">
                <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 text-destructive">
                    {error}
                </div>
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
                        <h1 className="text-2xl font-bold text-foreground">Tätigkeitsnachweis</h1>
                        <p className="text-muted-foreground text-sm">
                            Wöchentliche Ausbildungsnachweise erstellen und verwalten
                        </p>
                    </div>
                </div>

                <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent/90 transition-colors"
                >
                    <Plus className="h-4 w-4" />
                    Neuer Nachweis
                </button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="glass-effect rounded-xl p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-500/20">
                            <FileText className="h-5 w-5 text-blue-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-foreground">{reports.length}</p>
                            <p className="text-sm text-muted-foreground">Gesamt</p>
                        </div>
                    </div>
                </div>

                <div className="glass-effect rounded-xl p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-yellow-500/20">
                            <Clock className="h-5 w-5 text-yellow-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-foreground">
                                {reports.filter(r => r.status === 'DRAFT').length}
                            </p>
                            <p className="text-sm text-muted-foreground">Entwürfe</p>
                        </div>
                    </div>
                </div>

                <div className="glass-effect rounded-xl p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-500/20">
                            <Send className="h-5 w-5 text-blue-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-foreground">
                                {reports.filter(r => r.status === 'SUBMITTED').length}
                            </p>
                            <p className="text-sm text-muted-foreground">Eingereicht</p>
                        </div>
                    </div>
                </div>

                <div className="glass-effect rounded-xl p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-green-500/20">
                            <Check className="h-5 w-5 text-green-400" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-foreground">
                                {reports.filter(r => r.status === 'APPROVED').length}
                            </p>
                            <p className="text-sm text-muted-foreground">Genehmigt</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Reports List */}
            <div className="glass-effect rounded-xl overflow-hidden">
                <div className="p-4 border-b border-border/50">
                    <h2 className="text-lg font-semibold text-foreground">Meine Nachweise</h2>
                </div>

                {reports.length === 0 ? (
                    <div className="p-8 text-center">
                        <ClipboardList className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-foreground mb-2">Noch keine Nachweise</h3>
                        <p className="text-muted-foreground mb-4">
                            Erstellen Sie Ihren ersten wöchentlichen Tätigkeitsnachweis
                        </p>
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent/90"
                        >
                            Ersten Nachweis erstellen
                        </button>
                    </div>
                ) : (
                    <div className="divide-y divide-border/50">
                        {reports
                            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                            .map(report => (
                                <div
                                    key={report.id}
                                    onClick={() => setSelectedReport(report)}
                                    className="p-4 hover:bg-muted/50 cursor-pointer transition-colors"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="p-2 rounded-lg bg-accent/20">
                                                <Calendar className="h-5 w-5 text-accent" />
                                            </div>
                                            <div>
                                                <h3 className="font-medium text-foreground">
                                                    KW {report.weekNumber} / {report.year}
                                                </h3>
                                                <p className="text-sm text-muted-foreground">
                                                    {report.ausbildungsjahr}. Ausbildungsjahr
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-3">
                                            {getStatusBadge(report.status)}
                                            <ChevronRight className="h-5 w-5 text-muted-foreground" />
                                        </div>
                                    </div>
                                    {/* Actions for Drafts */}
                                    {report.status === 'DRAFT' && (
                                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
                                            <button
                                                onClick={(e) => handleEditReport(e, report)}
                                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                                            >
                                                <Edit3 className="h-3 w-3" />
                                                Bearbeiten
                                            </button>
                                            <button
                                                onClick={(e) => handleDeleteReport(e, report.id)}
                                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                                            >
                                                <Trash2 className="h-3 w-3" />
                                                Löschen
                                            </button>
                                        </div>
                                    )}

                                    {/* Download Button for Approved Reports */}
                                    {report.status === 'APPROVED' && (
                                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
                                            <button
                                                onClick={(e) => handleDownloadPDF(e, report)}
                                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/10 text-green-500 hover:bg-green-500/20 transition-colors"
                                            >
                                                <Download className="h-3 w-3" />
                                                PDF herunterladen
                                            </button>
                                        </div>
                                    )}

                                    {report.status === 'REJECTED' && report.reviewerFeedback && (
                                        <div className="mt-3 p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
                                            <div className="flex items-center gap-2 text-destructive text-sm">
                                                <AlertTriangle className="h-4 w-4" />
                                                <span className="font-medium">Feedback:</span>
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
                    currentWeek={editingReport ? editingReport.weekNumber : getCurrentWeek()}
                    currentYear={editingReport ? editingReport.year : new Date().getFullYear()}
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
    const [weekNumber, setWeekNumber] = useState(currentWeek);
    const [year, setYear] = useState(currentYear);
    const [ausbildungsjahr, setAusbildungsjahr] = useState(initialReport?.ausbildungsjahr || 1);
    const [entries, setEntries] = useState<{
        useCaseId: string;
        actualHours: number;
        notes: string;
    }[]>(initialEntries?.map(e => ({
        useCaseId: e.useCaseId,
        actualHours: e.actualHours,
        notes: e.notes || ''
    })) || []);
    const [expandedComponents, setExpandedComponents] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Use case hour tracking for overbooking prevention
    const [useCaseHours, setUseCaseHours] = useState<Record<string, { totalHours: number; usedHours: number; remainingHours: number }>>({});
    const [loadingHours, setLoadingHours] = useState(true);

    // Fetch used hours on mount
    useEffect(() => {
        const fetchUseCaseHours = async () => {
            try {
                const excludeParam = initialReport?.id ? `&excludeReportId=${initialReport.id}` : '';
                const res = await fetch(`/api/trainee/use-case-hours?traineeId=${userId}${excludeParam}`);
                if (res.ok) {
                    const data = await res.json();
                    const hoursMap: Record<string, { totalHours: number; usedHours: number; remainingHours: number }> = {};
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
        r => r.weekNumber === weekNumber && r.year === year && r.id !== initialReport?.id
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
        setEntries([...entries, {
            useCaseId: useCase.id,
            actualHours: 0,
            notes: '',
        }]);
    };

    const updateEntry = (useCaseId: string, field: 'actualHours' | 'notes', value: number | string) => {
        setEntries(entries.map(e =>
            e.useCaseId === useCaseId ? { ...e, [field]: value } : e
        ));
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

    const handleSave = async (submit: boolean = false) => {
        try {
            setSaving(true);
            setError(null);

            // Calculate period start and end based on week number
            const startOfYear = new Date(year, 0, 1);
            const daysOffset = (weekNumber - 1) * 7;
            const periodStart = new Date(startOfYear.getTime() + daysOffset * 86400000);
            const periodEnd = new Date(periodStart.getTime() + 6 * 86400000);

            const url = initialReport ? `/api/activity-reports/${initialReport.id}` : '/api/activity-reports';
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
                throw new Error(data.error || 'Fehler beim Speichern');
            }

            onCreated();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-card border border-border rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-border/50 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-foreground">
                            {initialReport ? 'Tätigkeitsnachweis bearbeiten' : 'Neuer Tätigkeitsnachweis'}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            Wählen Sie Komponenten und Use Cases aus dem Ausbildungsrahmenplan
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors">
                        <X className="h-5 w-5 text-muted-foreground" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {duplicateExists && (
                        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-yellow-500 text-sm flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                            Ein Nachweis für KW {weekNumber}/{year} existiert bereits. Bitte wählen Sie eine andere Kalenderwoche.
                        </div>
                    )}

                    {hasOverbooking && (
                        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-destructive text-sm flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                            Eine oder mehrere Tätigkeiten überschreiten die verfügbaren Stunden. Bitte korrigieren Sie die IST-Stunden.
                        </div>
                    )}

                    {error && (
                        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-destructive text-sm">
                            {error}
                        </div>
                    )}

                    {/* Period Selection */}
                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-foreground mb-2">Kalenderwoche</label>
                            <input
                                type="number"
                                min={1}
                                max={52}
                                value={weekNumber}
                                onChange={e => setWeekNumber(Number(e.target.value))}
                                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-foreground mb-2">Jahr</label>
                            <input
                                type="number"
                                min={2020}
                                max={2030}
                                value={year}
                                onChange={e => setYear(Number(e.target.value))}
                                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground"
                            />
                        </div>


                    </div>

                    {/* Selected Entries */}
                    {entries.length > 0 && (
                        <div className="space-y-3">
                            <h3 className="text-lg font-semibold text-foreground">Ausgewählte Tätigkeiten</h3>
                            {entries.map(entry => {
                                const useCase = getUseCaseById(entry.useCaseId);
                                const component = useCase ? getComponentById(useCase.componentId) : null;
                                const isOverbooked = checkOverbooked(entry.useCaseId, entry.actualHours);

                                return (
                                    <div
                                        key={entry.useCaseId}
                                        className={`p-4 rounded-lg border ${isOverbooked ? 'border-yellow-500/50 bg-yellow-500/10' : 'border-border bg-muted/30'}`}
                                    >
                                        <div className="flex items-start justify-between mb-3">
                                            <div className="flex-1">
                                                <p className="text-xs text-muted-foreground mb-1">
                                                    {component?.title}
                                                </p>
                                                <p className="font-medium text-foreground">
                                                    {useCase?.letter}) {useCase?.description}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => removeEntry(entry.useCaseId)}
                                                className="p-1 hover:bg-destructive/20 rounded text-destructive"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>

                                        <div className="grid grid-cols-3 gap-4">
                                            <div>
                                                <label className="text-xs text-muted-foreground">Plan (Sollzeit)</label>
                                                <p className="font-medium text-foreground">{useCase?.plannedHours} Std</p>
                                            </div>
                                            <div>
                                                <label className="text-xs text-muted-foreground block mb-1">IST-Stunden</label>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    step={0.5}
                                                    value={entry.actualHours}
                                                    onChange={e => updateEntry(entry.useCaseId, 'actualHours', Number(e.target.value))}
                                                    className={`w-full px-3 py-1.5 bg-background border rounded text-foreground ${isOverbooked ? 'border-yellow-500' : 'border-border'
                                                        }`}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-muted-foreground block mb-1">Notizen</label>
                                                <input
                                                    type="text"
                                                    value={entry.notes}
                                                    onChange={e => updateEntry(entry.useCaseId, 'notes', e.target.value)}
                                                    placeholder="Optional"
                                                    className="w-full px-3 py-1.5 bg-background border border-border rounded text-foreground"
                                                />
                                            </div>
                                        </div>

                                        {isOverbooked && (
                                            <div className="mt-2 flex items-center gap-2 text-yellow-500 text-sm">
                                                <AlertTriangle className="h-4 w-4" />
                                                <span>Überbucht: {(entry.actualHours - (useCase?.plannedHours || 0)).toFixed(1)} Std über Sollzeit</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Totals */}
                            <div className="p-4 bg-muted/50 rounded-lg flex items-center justify-between">
                                <div className="flex items-center gap-6">
                                    <div>
                                        <p className="text-xs text-muted-foreground">Plan Gesamt</p>
                                        <p className="text-lg font-bold text-foreground">{totalPlannedHours} Std</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground">IST Gesamt</p>
                                        <p className={`text-lg font-bold ${totalActualHours > totalPlannedHours ? 'text-yellow-500' : 'text-foreground'}`}>
                                            {totalActualHours} Std
                                        </p>
                                    </div>
                                </div>
                                {totalActualHours > totalPlannedHours && (
                                    <div className="flex items-center gap-2 text-yellow-500">
                                        <AlertTriangle className="h-5 w-5" />
                                        <span className="font-medium">+{(totalActualHours - totalPlannedHours).toFixed(1)} Std</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Component/Use Case Selector */}
                    <div className="space-y-3">
                        <h3 className="text-lg font-semibold text-foreground">Tätigkeit hinzufügen</h3>
                        <div className="space-y-2 max-h-96 overflow-y-auto border border-border rounded-lg p-2">

                            {/* Section 1: 1. - 18. Monat */}
                            <div className="mb-4">
                                <h4 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-2 px-2">1. bis 18. Ausbildungsmonat</h4>
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
                                <h4 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-2 px-2">19. bis 36. Ausbildungsmonat</h4>
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
                                <h4 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-2 px-2">Integrative Fertigkeiten (Gesamte Ausbildung)</h4>
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
                <div className="p-6 border-t border-border/50 flex items-center justify-between">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Abbrechen
                    </button>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => handleSave(false)}
                            disabled={saving || entries.length === 0 || duplicateExists || hasOverbooking}
                            className="flex items-center gap-2 px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 disabled:opacity-50 transition-colors"
                        >
                            <Save className="h-4 w-4" />
                            Als Entwurf speichern
                        </button>
                        <button
                            onClick={() => handleSave(true)}
                            disabled={saving || entries.length === 0 || duplicateExists || hasOverbooking}
                            className="flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-lg hover:bg-accent/90 disabled:opacity-50 transition-colors"
                        >
                            <Send className="h-4 w-4" />
                            Einreichen
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
    const [entries, setEntries] = useState<ReportUseCaseEntry[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadEntries();
    }, [report.id]);

    const loadEntries = async () => {
        try {
            const res = await fetch(`/api/activity-reports/${report.id}/entries`);
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-card border border-border rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-border/50 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-foreground">
                            KW {report.weekNumber} / {report.year}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            {report.ausbildungsjahr}. Ausbildungsjahr
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors">
                        <X className="h-5 w-5 text-muted-foreground" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="animate-spin h-8 w-8 border-4 border-accent border-t-transparent rounded-full" />
                        </div>
                    ) : entries.length === 0 ? (
                        <p className="text-center text-muted-foreground py-12">
                            Keine Einträge vorhanden
                        </p>
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
                                        <p className="text-xs text-muted-foreground mb-1">
                                            {component?.title}
                                        </p>
                                        <p className="font-medium text-foreground mb-3">
                                            {useCase?.letter}) {useCase?.description}
                                        </p>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <p className="text-xs text-muted-foreground">Plan (Sollzeit)</p>
                                                <p className="font-medium text-foreground">{entry.plannedHours} Std</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-muted-foreground">IST-Stunden</p>
                                                <p className={`font-medium ${entry.isOverbooked ? 'text-yellow-500' : 'text-foreground'}`}>
                                                    {entry.actualHours} Std
                                                </p>
                                            </div>
                                        </div>

                                        {entry.notes && (
                                            <p className="mt-2 text-sm text-muted-foreground">
                                                Notizen: {entry.notes}
                                            </p>
                                        )}

                                        {entry.isOverbooked && (
                                            <div className="mt-2 flex items-center gap-2 text-yellow-500 text-sm">
                                                <AlertTriangle className="h-4 w-4" />
                                                <span>Überbucht</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {report.reviewerFeedback && (
                        <div className="mt-6 p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
                            <h4 className="font-medium text-destructive mb-2">Feedback vom Ausbilder</h4>
                            <p className="text-sm text-destructive/80">{report.reviewerFeedback}</p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-border/50 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors"
                    >
                        Schließen
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
    useCaseHours?: Record<string, { totalHours: number; usedHours: number; remainingHours: number }>;
}

function ComponentItem({ component, isExpanded, onToggle, useCases, entries, onAddEntry, useCaseHours }: ComponentItemProps) {
    return (
        <div className="border-b border-border/50 last:border-b-0">
            <button
                onClick={onToggle}
                className="w-full p-3 flex items-center gap-3 hover:bg-muted/50 transition-colors text-left"
            >
                {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <div className="flex-1">
                    <p className="font-medium text-foreground text-sm">{component.title}</p>
                    <p className="text-xs text-muted-foreground">
                        {component.code} • {component.totalHours} Std gesamt
                    </p>
                </div>
            </button>

            {isExpanded && (
                <div className="pl-10 pb-2 space-y-1">
                    {useCases
                        .sort((a, b) => a.orderIndex - b.orderIndex)
                        .map(useCase => {
                            const isSelected = entries.some(e => e.useCaseId === useCase.id);
                            const ucHours = useCaseHours?.[useCase.id];
                            const isExhausted = ucHours && ucHours.remainingHours <= 0;
                            const remainingText = ucHours ? `${ucHours.remainingHours} Std übrig` : '';

                            return (
                                <button
                                    key={useCase.id}
                                    onClick={() => !isSelected && !isExhausted && onAddEntry(useCase)}
                                    disabled={isSelected || isExhausted}
                                    className={`w-full p-2 text-left rounded text-sm transition-colors ${isSelected
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
                                                <span className="text-xs bg-destructive/20 text-destructive px-2 py-0.5 rounded">Erschöpft</span>
                                            ) : ucHours ? (
                                                <span className={`text-xs ${ucHours.remainingHours <= 10 ? 'text-yellow-500' : 'text-muted-foreground'}`}>
                                                    {remainingText}
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground text-xs">({useCase.plannedHours} Std)</span>
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

