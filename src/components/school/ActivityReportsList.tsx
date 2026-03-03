'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
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

      const res = await fetch(url, { cache: 'no-store' });
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
        <LoadingSpinner size="md" />
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
          <h2 className="text-foreground text-xl font-bold">
            {t('reports.title')}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t('reports.weeklyDoc')}
          </p>
        </div>

        <button
          onClick={handleCreateReport}
          disabled={creating}
          className="btn-accent flex items-center gap-2 rounded-xl px-4 py-2 font-medium disabled:opacity-50"
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
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <div className="glass-effect rounded-xl p-3 text-center">
            <p className="text-foreground text-2xl font-bold">{stats.total}</p>
            <p className="text-muted-foreground text-xs">
              {t('reports.total')}
            </p>
          </div>
          <div
            className={`cursor-pointer rounded-xl border p-3 transition-colors ${
              filterStatus === 'DRAFT'
                ? 'bg-accent/20 border-accent'
                : 'glass-effect'
            }`}
            onClick={() =>
              setFilterStatus(filterStatus === 'DRAFT' ? 'all' : 'DRAFT')
            }
          >
            <p className="text-foreground text-2xl font-bold">{stats.draft}</p>
            <p className="text-muted-foreground text-xs">
              {t('reports.drafts')}
            </p>
          </div>
          <div
            className={`cursor-pointer rounded-xl border p-3 transition-colors ${
              filterStatus === 'SUBMITTED'
                ? 'bg-accent/20 border-accent'
                : 'glass-effect'
            }`}
            onClick={() =>
              setFilterStatus(
                filterStatus === 'SUBMITTED' ? 'all' : 'SUBMITTED'
              )
            }
          >
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {stats.submitted}
            </p>
            <p className="text-muted-foreground text-xs">
              {t('reports.submitted')}
            </p>
          </div>
          <div
            className={`cursor-pointer rounded-xl border p-3 transition-colors ${
              filterStatus === 'APPROVED'
                ? 'bg-accent/20 border-accent'
                : 'glass-effect'
            }`}
            onClick={() =>
              setFilterStatus(filterStatus === 'APPROVED' ? 'all' : 'APPROVED')
            }
          >
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {stats.approved}
            </p>
            <p className="text-muted-foreground text-xs">
              {t('reports.approved')}
            </p>
          </div>
          <div
            className={`cursor-pointer rounded-xl border p-3 transition-colors ${
              filterStatus === 'REJECTED'
                ? 'bg-accent/20 border-accent'
                : 'glass-effect'
            }`}
            onClick={() =>
              setFilterStatus(filterStatus === 'REJECTED' ? 'all' : 'REJECTED')
            }
          >
            <p className="text-destructive text-2xl font-bold">
              {stats.rejected}
            </p>
            <p className="text-muted-foreground text-xs">
              {t('reports.rejected')}
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-destructive/10 border-destructive/20 flex items-center gap-3 rounded-xl border p-4">
          <AlertCircle className="text-destructive h-5 w-5 flex-shrink-0" />
          <p className="text-destructive text-sm">{error}</p>
          <button
            onClick={() => setError(null)}
            className="hover:bg-destructive/10 ml-auto rounded p-1"
          >
            <X className="text-destructive h-4 w-4" />
          </button>
        </div>
      )}

      {/* Reports List */}
      {reports.length === 0 ? (
        <div className="glass-effect rounded-2xl py-12 text-center">
          <ClipboardCheck className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
          <p className="text-muted-foreground">{t('reports.none')}</p>
          <button
            onClick={handleCreateReport}
            className="text-accent mt-4 text-sm hover:underline"
          >
            {t('reports.createFirst')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map(report => {
            const status = STATUS_CONFIG[report.status];
            const Icon = status.icon;

            return (
              <div
                key={report.id}
                onClick={() => setSelectedReport(report.id)}
                className="glass-effect group hover:border-accent/50 cursor-pointer rounded-xl p-4 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div
                      className={`rounded-lg p-2 ${status.bg} ${status.text}`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-foreground font-semibold">
                        {t('reports.week')} {report.weekNumber} / {report.year}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {formatWeekPeriod(report.periodStart, report.periodEnd)}
                        <span className="mx-2">•</span>
                        {report.ausbildungsjahr}. {t('reports.trainingYear')}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${status.bg} ${status.text}`}
                    >
                      {t(status.labelKey)}
                    </span>

                    {report.pdfUrl && report.status === 'APPROVED' && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          window.open(report.pdfUrl!, '_blank');
                        }}
                        className="bg-card hover:bg-muted border-border rounded-lg border p-2 transition-colors"
                        title={t('reports.downloadPdf')}
                      >
                        <Download className="text-foreground h-4 w-4" />
                      </button>
                    )}

                    <ChevronRight className="text-muted-foreground group-hover:text-accent h-5 w-5 transition-colors" />
                  </div>
                </div>

                {report.status === 'REJECTED' && report.reviewerFeedback && (
                  <div className="bg-destructive/10 border-destructive/20 mt-3 rounded-lg border p-3">
                    <p className="text-destructive text-xs">
                      <strong>{t('reports.feedback')}</strong>{' '}
                      {report.reviewerFeedback}
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
      const res = await fetch(`/api/trainee/school/reports/${reportId}`, {
        cache: 'no-store',
      });
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
            entries: [
              {
                id: entries[0].id,
                betrieblicheTaetigkeit,
                rahmenplanRef,
                betrieblicheStunden: betrieblicheStunden
                  ? parseFloat(betrieblicheStunden)
                  : null,
                unterweisungenThemen,
                unterweisungenStunden: unterweisungenStunden
                  ? parseFloat(unterweisungenStunden)
                  : null,
                berufsschulThemen,
                berufsschulStunden: berufsschulStunden
                  ? parseFloat(berufsschulStunden)
                  : null,
              },
            ],
          }),
        });
      } else {
        await fetch(`/api/trainee/school/reports/${reportId}/entries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            betrieblicheTaetigkeit,
            rahmenplanRef,
            betrieblicheStunden: betrieblicheStunden
              ? parseFloat(betrieblicheStunden)
              : null,
            unterweisungenThemen,
            unterweisungenStunden: unterweisungenStunden
              ? parseFloat(unterweisungenStunden)
              : null,
            berufsschulThemen,
            berufsschulStunden: berufsschulStunden
              ? parseFloat(berufsschulStunden)
              : null,
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

      const res = await fetch(
        `/api/trainee/school/reports/${reportId}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ traineeConfirmation: true }),
        }
      );

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
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="glass-effect rounded-2xl py-12 text-center">
        <AlertCircle className="text-destructive mx-auto mb-4 h-12 w-12" />
        <p className="text-destructive">{t('reports.notFound')}</p>
        <button onClick={onBack} className="text-accent mt-4 hover:underline">
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
            className="bg-card border-border hover:bg-muted text-foreground rounded-lg border p-2 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h2 className="text-foreground text-xl font-bold">
              {t('reports.activityReport')} {t('reports.week')}{' '}
              {report.weekNumber} / {report.year}
            </h2>
            <p className="text-muted-foreground text-sm">
              {new Date(report.periodStart).toLocaleDateString('de-DE')} -{' '}
              {new Date(report.periodEnd).toLocaleDateString('de-DE')}
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${status.bg} ${status.text}`}
        >
          {t(status.labelKey)}
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-destructive/10 border-destructive/20 flex items-center gap-3 rounded-xl border p-4">
          <AlertCircle className="text-destructive h-5 w-5" />
          <p className="text-destructive text-sm">{error}</p>
        </div>
      )}

      {/* Rejection Feedback */}
      {report.status === 'REJECTED' && report.reviewerFeedback && (
        <div className="bg-destructive/10 border-destructive/20 rounded-xl border p-4">
          <p className="text-destructive text-sm">
            <strong>{t('reports.trainerFeedback')}</strong>{' '}
            {report.reviewerFeedback}
          </p>
          <p className="text-muted-foreground mt-2 text-xs">
            {t('reports.revise')}
          </p>
        </div>
      )}

      {/* Form */}
      <div className="space-y-6">
        {/* Section 1: Betriebliche Tätigkeiten */}
        <div className="glass-effect rounded-xl border-l-4 border-l-blue-500 p-5">
          <h3 className="text-foreground mb-3 flex items-center gap-2 font-semibold">
            <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            {t('reports.operationalActivities')}
          </h3>
          <textarea
            value={betrieblicheTaetigkeit}
            onChange={e => setBetrieblicheTaetigkeit(e.target.value)}
            disabled={!isEditable}
            className="h-32 w-full resize-none rounded-xl px-4 py-3 disabled:opacity-50"
            placeholder={t('reports.describeActivities')}
          />
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <label className="text-muted-foreground mb-1 block text-xs">
                {t('reports.curriculumReference')}
              </label>
              <input
                type="text"
                value={rahmenplanRef}
                onChange={e => setRahmenplanRef(e.target.value)}
                disabled={!isEditable}
                className="w-full rounded-xl px-4 py-2 text-sm disabled:opacity-50"
                placeholder={t('reports.curriculumPlaceholder')}
              />
            </div>
            <div>
              <label className="text-muted-foreground mb-1 block text-xs">
                {t('reports.hours')}
              </label>
              <input
                type="number"
                value={betrieblicheStunden}
                onChange={e => setBetrieblicheStunden(e.target.value)}
                disabled={!isEditable}
                className="w-full rounded-xl px-4 py-2 text-sm disabled:opacity-50"
                placeholder="40"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Unterweisungen */}
        <div className="glass-effect rounded-xl border-l-4 border-l-green-500 p-5">
          <h3 className="text-foreground mb-3 flex items-center gap-2 font-semibold">
            <FileText className="h-4 w-4 text-green-600 dark:text-green-400" />
            {t('reports.instructionsTraining')}
          </h3>
          <textarea
            value={unterweisungenThemen}
            onChange={e => setUnterweisungenThemen(e.target.value)}
            disabled={!isEditable}
            className="h-24 w-full resize-none rounded-xl px-4 py-3 disabled:opacity-50"
            placeholder={t('reports.instructionsPlaceholder')}
          />
          <div className="mt-3">
            <label className="text-muted-foreground mb-1 block text-xs">
              {t('reports.hours')}
            </label>
            <input
              type="number"
              value={unterweisungenStunden}
              onChange={e => setUnterweisungenStunden(e.target.value)}
              disabled={!isEditable}
              className="w-32 rounded-xl px-4 py-2 text-sm disabled:opacity-50"
              placeholder="0"
            />
          </div>
        </div>

        {/* Section 3: Berufsschulunterricht */}
        <div className="glass-effect rounded-xl border-l-4 border-l-violet-500 p-5">
          <h3 className="text-foreground mb-3 flex items-center gap-2 font-semibold">
            <FileText className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            {t('reports.schoolTopics')}
          </h3>
          <textarea
            value={berufsschulThemen}
            onChange={e => setBerufsschulThemen(e.target.value)}
            disabled={!isEditable}
            className="h-24 w-full resize-none rounded-xl px-4 py-3 disabled:opacity-50"
            placeholder={t('reports.schoolTopicsPlaceholder')}
          />
          <div className="mt-3">
            <label className="text-muted-foreground mb-1 block text-xs">
              {t('reports.hours')}
            </label>
            <input
              type="number"
              value={berufsschulStunden}
              onChange={e => setBerufsschulStunden(e.target.value)}
              disabled={!isEditable}
              className="w-32 rounded-xl px-4 py-2 text-sm disabled:opacity-50"
              placeholder="0"
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      {isEditable && (
        <div className="border-border flex items-center justify-between border-t pt-4">
          <p className="text-muted-foreground text-xs">
            {t('reports.confirmAccuracy')}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="glass-effect text-foreground flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50"
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
              className="btn-accent flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50"
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
        <div className="border-border flex items-center justify-center border-t pt-4">
          <button
            onClick={() => {
              toast(t('reports.pdfDownloadPending'));
            }}
            className="flex items-center gap-2 rounded-xl bg-green-500/20 px-6 py-3 font-medium text-green-600 transition-colors hover:bg-green-500/30 dark:text-green-400"
          >
            <Download className="h-5 w-5" />
            <span>{t('reports.downloadPdf')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
