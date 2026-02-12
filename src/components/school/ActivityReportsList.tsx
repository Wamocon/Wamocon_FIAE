'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSearchParams } from 'next/navigation';
import {
    ClipboardCheck,
    Plus,
    Send,
    Check,
    X,
    Clock,
    FileText,
    Download,
    AlertCircle,
    ChevronRight,
    Edit,
    RefreshCw,
    ArrowLeft,
} from 'lucide-react';

interface ActivityReport {
    id: string;
    ausbildungsjahr: number;
    weekNumber: number;
    year: number;
    periodStart: string;
    periodEnd: string;
    abteilung: string | null;
    status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
    submittedAt: string | null;
    reviewedAt: string | null;
    reviewerFeedback: string | null;
    pdfUrl: string | null;
    createdAt: string;
}

interface ReportStats {
    total: number;
    draft: number;
    submitted: number;
    approved: number;
    rejected: number;
}

const STATUS_CONFIG = {
    DRAFT: {
        labelKey: 'status.draft',
        bg: 'bg-muted',
        text: 'text-muted-foreground',
        border: 'border-border',
        icon: Edit,
    },
    SUBMITTED: {
        labelKey: 'status.submitted',
        bg: 'bg-amber-500/20',
        text: 'text-amber-600 dark:text-amber-400',
        border: 'border-amber-500/30',
        icon: Clock,
    },
    APPROVED: {
        labelKey: 'status.approved',
        bg: 'bg-green-500/20',
        text: 'text-green-600 dark:text-green-400',
        border: 'border-green-500/30',
        icon: Check,
    },
    REJECTED: {
        labelKey: 'status.rejected',
        bg: 'bg-destructive/20',
        text: 'text-destructive',
        border: 'border-destructive/30',
        icon: X,
    },
};

export function ActivityReportsList() {
    const { profile } = useAuth();
    const { t } = useLanguage();
    const searchParams = useSearchParams();

    const [reports, setReports] = useState<ActivityReport[]>([]);
    const [stats, setStats] = useState<ReportStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [selectedReport, setSelectedReport] = useState<string | null>(
        searchParams.get('report')
    );
    const [filterStatus, setFilterStatus] = useState<string>('all');

    useEffect(() => {
        if (!profile?.id) return;
        loadReports();
    }, [profile?.id, filterStatus]);

    const loadReports = async () => {
        if (!profile?.id) return;
        setLoading(true);
        setError(null);

        try {
            let url = `/api/trainee/school/reports?traineeId=${profile.id}`;
            if (filterStatus !== 'all') {
                url += `&status=${filterStatus}`;
            }

            const res = await fetch(url);
            if (!res.ok) throw new Error(t('reports.error.load'));
            const data = await res.json();

            setReports(data.reports || []);
            setStats(data.meta?.stats || null);
        } catch (e: any) {
            setError(e.message);
            setReports([]);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateReport = async () => {
        if (!profile?.id) return;
        setCreating(true);
        setError(null);

        try {
            const res = await fetch('/api/trainee/school/reports', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    traineeId: profile.id,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                if (res.status === 409) {
                    setError(t('reports.error.weekExists'));
                    if (data.existingId) {
                        setSelectedReport(data.existingId);
                    }
                    return;
                }
                throw new Error(data.error || t('reports.error.create'));
            }

            await loadReports();
            setSelectedReport(data.id);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setCreating(false);
        }
    };

    const formatWeekPeriod = (start: string, end: string) => {
        const s = new Date(start);
        const e = new Date(end);
        return `${s.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} - ${e.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
    };

    if (loading && reports.length === 0) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent/30 border-t-accent" />
            </div>
        );
    }

    if (selectedReport) {
        return (
            <ActivityReportDetail
                reportId={selectedReport}
                onBack={() => {
                    setSelectedReport(null);
                    loadReports();
                }}
            />
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-foreground">{t('reports.title')}</h2>
                    <p className="text-sm text-muted-foreground">
                        {t('reports.weeklyDoc')}
                    </p>
                </div>

                <button
                    onClick={handleCreateReport}
                    disabled={creating}
                    className="btn-accent flex items-center gap-2 px-4 py-2 rounded-xl font-medium disabled:opacity-50"
                >
                    {creating ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                        <Plus className="h-4 w-4" />
                    )}
                    <span>{t('reports.newWeek')}</span>
                </button>
            </div>

            {/* Stats */}
            {stats && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className="p-3 rounded-xl glass-effect text-center">
                        <p className="text-2xl font-bold text-foreground">{stats.total}</p>
                        <p className="text-xs text-muted-foreground">{t('reports.total')}</p>
                    </div>
                    <div
                        className={`p-3 rounded-xl cursor-pointer transition-colors border ${filterStatus === 'DRAFT'
                                ? 'bg-accent/20 border-accent'
                                : 'glass-effect'
                            }`}
                        onClick={() => setFilterStatus(filterStatus === 'DRAFT' ? 'all' : 'DRAFT')}
                    >
                        <p className="text-2xl font-bold text-foreground">{stats.draft}</p>
                        <p className="text-xs text-muted-foreground">{t('reports.drafts')}</p>
                    </div>
                    <div
                        className={`p-3 rounded-xl cursor-pointer transition-colors border ${filterStatus === 'SUBMITTED'
                                ? 'bg-accent/20 border-accent'
                                : 'glass-effect'
                            }`}
                        onClick={() => setFilterStatus(filterStatus === 'SUBMITTED' ? 'all' : 'SUBMITTED')}
                    >
                        <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.submitted}</p>
                        <p className="text-xs text-muted-foreground">{t('reports.submitted')}</p>
                    </div>
                    <div
                        className={`p-3 rounded-xl cursor-pointer transition-colors border ${filterStatus === 'APPROVED'
                                ? 'bg-accent/20 border-accent'
                                : 'glass-effect'
                            }`}
                        onClick={() => setFilterStatus(filterStatus === 'APPROVED' ? 'all' : 'APPROVED')}
                    >
                        <p className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.approved}</p>
                        <p className="text-xs text-muted-foreground">{t('reports.approved')}</p>
                    </div>
                    <div
                        className={`p-3 rounded-xl cursor-pointer transition-colors border ${filterStatus === 'REJECTED'
                                ? 'bg-accent/20 border-accent'
                                : 'glass-effect'
                            }`}
                        onClick={() => setFilterStatus(filterStatus === 'REJECTED' ? 'all' : 'REJECTED')}
                    >
                        <p className="text-2xl font-bold text-destructive">{stats.rejected}</p>
                        <p className="text-xs text-muted-foreground">{t('reports.rejected')}</p>
                    </div>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                    <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
                    <p className="text-sm text-destructive">{error}</p>
                    <button onClick={() => setError(null)} className="ml-auto p-1 hover:bg-destructive/10 rounded">
                        <X className="h-4 w-4 text-destructive" />
                    </button>
                </div>
            )}

            {/* Reports List */}
            {reports.length === 0 ? (
                <div className="text-center py-12 glass-effect rounded-2xl">
                    <ClipboardCheck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">{t('reports.none')}</p>
                    <button
                        onClick={handleCreateReport}
                        className="mt-4 text-accent hover:underline text-sm"
                    >
                        {t('reports.createFirst')}
                    </button>
                </div>
            ) : (
                <div className="space-y-3">
                    {reports.map((report) => {
                        const status = STATUS_CONFIG[report.status];
                        const Icon = status.icon;

                        return (
                            <div
                                key={report.id}
                                onClick={() => setSelectedReport(report.id)}
                                className="p-4 rounded-xl glass-effect cursor-pointer transition-all group hover:border-accent/50"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className={`p-2 rounded-lg ${status.bg} ${status.text}`}>
                                            <Icon className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <p className="font-semibold text-foreground">
                                                {t('reports.week')} {report.weekNumber} / {report.year}
                                            </p>
                                            <p className="text-sm text-muted-foreground">
                                                {formatWeekPeriod(report.periodStart, report.periodEnd)}
                                                <span className="mx-2">•</span>
                                                {report.ausbildungsjahr}. {t('reports.trainingYear')}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3">
                                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${status.bg} ${status.text}`}>
                                            {t(status.labelKey)}
                                        </span>

                                        {report.pdfUrl && report.status === 'APPROVED' && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    window.open(report.pdfUrl!, '_blank');
                                                }}
                                                className="p-2 rounded-lg bg-card hover:bg-muted transition-colors border border-border"
                                                title={t('reports.downloadPdf')}
                                            >
                                                <Download className="h-4 w-4 text-foreground" />
                                            </button>
                                        )}

                                        <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-accent transition-colors" />
                                    </div>
                                </div>

                                {report.status === 'REJECTED' && report.reviewerFeedback && (
                                    <div className="mt-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                                        <p className="text-xs text-destructive">
                                            <strong>{t('reports.feedback')}</strong> {report.reviewerFeedback}
                                        </p>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// Detail View Component
function ActivityReportDetail({
    reportId,
    onBack,
}: {
    reportId: string;
    onBack: () => void;
}) {
    const { profile } = useAuth();
    const { t } = useLanguage();
    const [report, setReport] = useState<any>(null);
    const [entries, setEntries] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form state
    const [betrieblicheTaetigkeit, setBetrieblicheTaetigkeit] = useState('');
    const [rahmenplanRef, setRahmenplanRef] = useState('');
    const [betrieblicheStunden, setBetrieblicheStunden] = useState('');
    const [unterweisungenThemen, setUnterweisungenThemen] = useState('');
    const [unterweisungenStunden, setUnterweisungenStunden] = useState('');
    const [berufsschulThemen, setBerufsschulThemen] = useState('');
    const [berufsschulStunden, setBerufsschulStunden] = useState('');

    useEffect(() => {
        loadReport();
    }, [reportId]);

    const loadReport = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/trainee/school/reports/${reportId}`);
            if (!res.ok) throw new Error(t('reports.error.load'));
            const data = await res.json();

            setReport(data.report);
            setEntries(data.entries || []);

            if (data.entries?.length > 0) {
                const e = data.entries[0];
                setBetrieblicheTaetigkeit(e.betrieblicheTaetigkeit || '');
                setRahmenplanRef(e.rahmenplanRef || '');
                setBetrieblicheStunden(e.betrieblicheStunden?.toString() || '');
                setUnterweisungenThemen(e.unterweisungenThemen || '');
                setUnterweisungenStunden(e.unterweisungenStunden?.toString() || '');
                setBerufsschulThemen(e.berufsschulThemen || '');
                setBerufsschulStunden(e.berufsschulStunden?.toString() || '');
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setError(null);

        try {
            if (entries.length > 0) {
                await fetch(`/api/trainee/school/reports/${reportId}/entries`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entries: [{
                            id: entries[0].id,
                            betrieblicheTaetigkeit,
                            rahmenplanRef,
                            betrieblicheStunden: betrieblicheStunden ? parseFloat(betrieblicheStunden) : null,
                            unterweisungenThemen,
                            unterweisungenStunden: unterweisungenStunden ? parseFloat(unterweisungenStunden) : null,
                            berufsschulThemen,
                            berufsschulStunden: berufsschulStunden ? parseFloat(berufsschulStunden) : null,
                        }],
                    }),
                });
            } else {
                await fetch(`/api/trainee/school/reports/${reportId}/entries`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        betrieblicheTaetigkeit,
                        rahmenplanRef,
                        betrieblicheStunden: betrieblicheStunden ? parseFloat(betrieblicheStunden) : null,
                        unterweisungenThemen,
                        unterweisungenStunden: unterweisungenStunden ? parseFloat(unterweisungenStunden) : null,
                        berufsschulThemen,
                        berufsschulStunden: berufsschulStunden ? parseFloat(berufsschulStunden) : null,
                    }),
                });
            }

            await loadReport();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const handleSubmit = async () => {
        if (!confirm(t('reports.submitConfirm'))) return;

        setSubmitting(true);
        setError(null);

        try {
            await handleSave();

            const res = await fetch(`/api/trainee/school/reports/${reportId}/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ traineeConfirmation: true }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || t('reports.error.submit'));
            }

            await loadReport();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent/30 border-t-accent" />
            </div>
        );
    }

    if (!report) {
        return (
            <div className="text-center py-12 glass-effect rounded-2xl">
                <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
                <p className="text-destructive">{t('reports.notFound')}</p>
                <button onClick={onBack} className="mt-4 text-accent hover:underline">
                    {t('reports.backToList')}
                </button>
            </div>
        );
    }

    const isEditable = report.status === 'DRAFT' || report.status === 'REJECTED';
    const status = STATUS_CONFIG[report.status as keyof typeof STATUS_CONFIG];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-2 rounded-lg bg-card border border-border hover:bg-muted transition-colors text-foreground"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </button>
                    <div>
                        <h2 className="text-xl font-bold text-foreground">
                            {t('reports.activityReport')} {t('reports.week')} {report.weekNumber} / {report.year}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            {new Date(report.periodStart).toLocaleDateString('de-DE')} - {new Date(report.periodEnd).toLocaleDateString('de-DE')}
                        </p>
                    </div>
                </div>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${status.bg} ${status.text}`}>
                    {t(status.labelKey)}
                </span>
            </div>

            {/* Error */}
            {error && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                    <AlertCircle className="h-5 w-5 text-destructive" />
                    <p className="text-sm text-destructive">{error}</p>
                </div>
            )}

            {/* Rejection Feedback */}
            {report.status === 'REJECTED' && report.reviewerFeedback && (
                <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                    <p className="text-sm text-destructive">
                        <strong>{t('reports.trainerFeedback')}</strong> {report.reviewerFeedback}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                        {t('reports.revise')}
                    </p>
                </div>
            )}

            {/* Form */}
            <div className="space-y-6">
                {/* Section 1: Betriebliche Tätigkeiten */}
                <div className="p-5 rounded-xl glass-effect border-l-4 border-l-blue-500">
                    <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                        <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        {t('reports.operationalActivities')}
                    </h3>
                    <textarea
                        value={betrieblicheTaetigkeit}
                        onChange={(e) => setBetrieblicheTaetigkeit(e.target.value)}
                        disabled={!isEditable}
                        className="w-full h-32 px-4 py-3 rounded-xl resize-none disabled:opacity-50"
                        placeholder={t('reports.describeActivities')}
                    />
                    <div className="grid grid-cols-2 gap-4 mt-3">
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">
                                {t('reports.curriculumReference')}
                            </label>
                            <input
                                type="text"
                                value={rahmenplanRef}
                                onChange={(e) => setRahmenplanRef(e.target.value)}
                                disabled={!isEditable}
                                className="w-full px-4 py-2 rounded-xl text-sm disabled:opacity-50"
                                placeholder={t('reports.curriculumPlaceholder')}
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">{t('reports.hours')}</label>
                            <input
                                type="number"
                                value={betrieblicheStunden}
                                onChange={(e) => setBetrieblicheStunden(e.target.value)}
                                disabled={!isEditable}
                                className="w-full px-4 py-2 rounded-xl text-sm disabled:opacity-50"
                                placeholder="40"
                            />
                        </div>
                    </div>
                </div>

                {/* Section 2: Unterweisungen */}
                <div className="p-5 rounded-xl glass-effect border-l-4 border-l-green-500">
                    <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                        <FileText className="h-4 w-4 text-green-600 dark:text-green-400" />
                        {t('reports.instructionsTraining')}
                    </h3>
                    <textarea
                        value={unterweisungenThemen}
                        onChange={(e) => setUnterweisungenThemen(e.target.value)}
                        disabled={!isEditable}
                        className="w-full h-24 px-4 py-3 rounded-xl resize-none disabled:opacity-50"
                        placeholder={t('reports.instructionsPlaceholder')}
                    />
                    <div className="mt-3">
                        <label className="block text-xs text-muted-foreground mb-1">{t('reports.hours')}</label>
                        <input
                            type="number"
                            value={unterweisungenStunden}
                            onChange={(e) => setUnterweisungenStunden(e.target.value)}
                            disabled={!isEditable}
                            className="w-32 px-4 py-2 rounded-xl text-sm disabled:opacity-50"
                            placeholder="0"
                        />
                    </div>
                </div>

                {/* Section 3: Berufsschulunterricht */}
                <div className="p-5 rounded-xl glass-effect border-l-4 border-l-violet-500">
                    <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                        <FileText className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                        {t('reports.schoolTopics')}
                    </h3>
                    <textarea
                        value={berufsschulThemen}
                        onChange={(e) => setBerufsschulThemen(e.target.value)}
                        disabled={!isEditable}
                        className="w-full h-24 px-4 py-3 rounded-xl resize-none disabled:opacity-50"
                        placeholder={t('reports.schoolTopicsPlaceholder')}
                    />
                    <div className="mt-3">
                        <label className="block text-xs text-muted-foreground mb-1">{t('reports.hours')}</label>
                        <input
                            type="number"
                            value={berufsschulStunden}
                            onChange={(e) => setBerufsschulStunden(e.target.value)}
                            disabled={!isEditable}
                            className="w-32 px-4 py-2 rounded-xl text-sm disabled:opacity-50"
                            placeholder="0"
                        />
                    </div>
                </div>
            </div>

            {/* Actions */}
            {isEditable && (
                <div className="flex items-center justify-between pt-4 border-t border-border">
                    <p className="text-xs text-muted-foreground">
                        {t('reports.confirmAccuracy')}
                    </p>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl glass-effect text-foreground text-sm font-medium disabled:opacity-50"
                        >
                            {saving ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                                <Edit className="h-4 w-4" />
                            )}
                            <span>{t('reports.saving')}</span>
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={submitting || !betrieblicheTaetigkeit.trim()}
                            className="btn-accent flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
                        >
                            {submitting ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                                <Send className="h-4 w-4" />
                            )}
                            <span>{t('reports.submitting')}</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Download PDF for approved reports */}
            {report.status === 'APPROVED' && (
                <div className="flex items-center justify-center pt-4 border-t border-border">
                    <button
                        onClick={() => {
                            toast(t('reports.pdfDownloadPending'));
                        }}
                        className="flex items-center gap-2 px-6 py-3 rounded-xl bg-green-500/20 hover:bg-green-500/30 text-green-600 dark:text-green-400 font-medium transition-colors"
                    >
                        <Download className="h-5 w-5" />
                        <span>{t('reports.downloadPdf')}</span>
                    </button>
                </div>
            )}
        </div>
    );
}
