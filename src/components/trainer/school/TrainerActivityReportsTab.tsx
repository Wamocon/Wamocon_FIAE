'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
    ClipboardCheck,
    Check,
    X,
    AlertCircle,
    Calendar,
    User,
    Clock,
    MessageSquare,
    ChevronDown,
    ChevronRight,
    Filter,
} from 'lucide-react';

interface Report {
    id: string;
    traineeId: string;
    traineeName: string;
    weekNumber: number;
    year: number;
    status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
    submittedAt: string | null;
    totalHours: number;
    betrieblicheStunden: number;
    unterweisungenStunden: number;
    berufsschulStunden: number;
}

const STATUS_CONFIG = {
    DRAFT: { label: 'Entwurf', bg: 'bg-slate-500/20', text: 'text-slate-600 dark:text-slate-400' },
    SUBMITTED: { label: 'Eingereicht', bg: 'bg-amber-500/20', text: 'text-amber-600 dark:text-amber-400' },
    APPROVED: { label: 'Genehmigt', bg: 'bg-green-500/20', text: 'text-green-600 dark:text-green-400' },
    REJECTED: { label: 'Abgelehnt', bg: 'bg-rose-500/20', text: 'text-rose-600 dark:text-rose-400' },
};

export function TrainerActivityReportsTab() {
    const { profile } = useAuth();
    const [reports, setReports] = useState<Report[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<string>('SUBMITTED');
    const [selectedReport, setSelectedReport] = useState<Report | null>(null);
    const [showReviewModal, setShowReviewModal] = useState(false);

    useEffect(() => {
        if (!profile?.id) return;
        const trainerId = profile.id;
        async function loadReports() {
            setLoading(true);
            try {
                const res = await fetch(`/api/trainer/school/activity-reports?trainerId=${trainerId}&status=${statusFilter}`);
                if (res.ok) {
                    const data = await res.json();
                    setReports(data.reports || []);
                }
            } catch (e) {
                setError('Fehler beim Laden der Berichte');
            } finally {
                setLoading(false);
            }
        }
        loadReports();
    }, [profile?.id, statusFilter]);

    const handleReview = async (reportId: string, action: 'approve' | 'reject', feedback?: string) => {
        if (!profile?.id) return;
        try {
            const res = await fetch(`/api/trainer/activity-reports/${reportId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, trainerId: profile.id, feedback }),
            });
            if (res.ok) {
                setReports(prev => prev.filter(r => r.id !== reportId));
                setShowReviewModal(false);
                setSelectedReport(null);
            }
        } catch (e) {
            setError('Fehler beim Verarbeiten');
        }
    };

    const pendingCount = reports.filter(r => r.status === 'SUBMITTED').length;

    return (
        <div className="space-y-6">
            {/* Filter */}
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div className="flex items-center gap-3">
                    <Filter className="h-5 w-5 text-muted-foreground" />
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="px-4 py-2.5 rounded-xl bg-background border border-border text-foreground min-w-[160px]"
                    >
                        <option value="SUBMITTED">Ausstehend ({pendingCount})</option>
                        <option value="APPROVED">Genehmigt</option>
                        <option value="REJECTED">Abgelehnt</option>
                        <option value="">Alle</option>
                    </select>
                </div>
                {pendingCount > 0 && (
                    <div className="px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 text-sm font-medium">
                        {pendingCount} Nachweis(e) zur Prüfung
                    </div>
                )}
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-16">
                    <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent/30 border-t-accent" />
                </div>
            ) : reports.length === 0 ? (
                <div className="text-center py-16">
                    <ClipboardCheck className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-bold text-foreground mb-2">Keine Nachweise</h3>
                    <p className="text-muted-foreground">Keine Tätigkeitsnachweise mit diesem Status gefunden.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {reports.map(report => {
                        const statusConfig = STATUS_CONFIG[report.status];
                        return (
                            <div
                                key={report.id}
                                className="p-4 rounded-xl bg-muted/30 border border-border hover:bg-muted/50 transition-colors cursor-pointer"
                                onClick={() => { setSelectedReport(report); setShowReviewModal(true); }}
                            >
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-4">
                                        <div className="p-2.5 rounded-lg bg-accent/10">
                                            <User className="h-5 w-5 text-accent" />
                                        </div>
                                        <div>
                                            <h4 className="font-medium text-foreground">{report.traineeName}</h4>
                                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                                <span className="flex items-center gap-1">
                                                    <Calendar className="h-3 w-3" />
                                                    KW {report.weekNumber}/{report.year}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <Clock className="h-3 w-3" />
                                                    {report.totalHours}h gesamt
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${statusConfig.bg} ${statusConfig.text}`}>
                                            {statusConfig.label}
                                        </span>
                                        {report.status === 'SUBMITTED' && (
                                            <div className="flex gap-1">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleReview(report.id, 'approve'); }}
                                                    className="p-2 rounded-lg bg-green-500/10 text-green-600 hover:bg-green-500/20 transition"
                                                >
                                                    <Check className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setSelectedReport(report); setShowReviewModal(true); }}
                                                    className="p-2 rounded-lg bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 transition"
                                                >
                                                    <X className="h-4 w-4" />
                                                </button>
                                            </div>
                                        )}
                                        <ChevronRight className="h-5 w-5 text-muted-foreground" />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {error && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                    <AlertCircle className="h-5 w-5 text-destructive" />
                    <p className="text-sm text-destructive">{error}</p>
                    <button onClick={() => setError(null)} className="ml-auto"><X className="h-4 w-4 text-destructive" /></button>
                </div>
            )}

            {showReviewModal && selectedReport && (
                <ReviewModal
                    report={selectedReport}
                    onClose={() => { setShowReviewModal(false); setSelectedReport(null); }}
                    onReview={handleReview}
                />
            )}
        </div>
    );
}

function ReviewModal({ report, onClose, onReview }: {
    report: Report;
    onClose: () => void;
    onReview: (reportId: string, action: 'approve' | 'reject', feedback?: string) => void;
}) {
    const [feedback, setFeedback] = useState('');
    const [action, setAction] = useState<'approve' | 'reject' | null>(null);

    const handleSubmit = () => {
        if (!action) return;
        if (action === 'reject' && !feedback.trim()) {
            alert('Bitte geben Sie einen Grund für die Ablehnung an.');
            return;
        }
        onReview(report.id, action, feedback || undefined);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl overflow-hidden">
                <div className="p-6 border-b border-border">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-bold">Tätigkeitsnachweis prüfen</h3>
                            <p className="text-sm text-muted-foreground mt-1">
                                {report.traineeName} • KW {report.weekNumber}/{report.year}
                            </p>
                        </div>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted"><X className="h-5 w-5" /></button>
                    </div>
                </div>

                <div className="p-6 space-y-4">
                    <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="p-3 rounded-xl bg-green-500/10">
                            <p className="text-lg font-bold text-green-600">{report.betrieblicheStunden}h</p>
                            <p className="text-xs text-muted-foreground">Betrieblich</p>
                        </div>
                        <div className="p-3 rounded-xl bg-blue-500/10">
                            <p className="text-lg font-bold text-blue-600">{report.unterweisungenStunden}h</p>
                            <p className="text-xs text-muted-foreground">Unterweisungen</p>
                        </div>
                        <div className="p-3 rounded-xl bg-accent/10">
                            <p className="text-lg font-bold text-accent">{report.berufsschulStunden}h</p>
                            <p className="text-xs text-muted-foreground">Berufsschule</p>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">Feedback (erforderlich bei Ablehnung)</label>
                        <textarea
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl bg-muted border border-border min-h-[100px]"
                            placeholder="Anmerkungen oder Begründung..."
                        />
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={() => { setAction('reject'); }}
                            className={`flex-1 px-4 py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition ${action === 'reject' ? 'bg-rose-500 text-white' : 'bg-rose-500/10 text-rose-600 hover:bg-rose-500/20'}`}
                        >
                            <X className="h-4 w-4" />Ablehnen
                        </button>
                        <button
                            onClick={() => { setAction('approve'); }}
                            className={`flex-1 px-4 py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition ${action === 'approve' ? 'bg-green-500 text-white' : 'bg-green-500/10 text-green-600 hover:bg-green-500/20'}`}
                        >
                            <Check className="h-4 w-4" />Genehmigen
                        </button>
                    </div>

                    {action && (
                        <button
                            onClick={handleSubmit}
                            className="w-full btn-accent px-4 py-3 rounded-xl font-medium"
                        >
                            Bestätigen
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
