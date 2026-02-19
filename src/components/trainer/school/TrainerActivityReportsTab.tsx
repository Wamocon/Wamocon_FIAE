'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
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
  DRAFT: {
    label: 'Entwurf',
    bg: 'bg-slate-500/20',
    text: 'text-slate-600 dark:text-slate-400',
  },
  SUBMITTED: {
    label: 'Eingereicht',
    bg: 'bg-amber-500/20',
    text: 'text-amber-600 dark:text-amber-400',
  },
  APPROVED: {
    label: 'Genehmigt',
    bg: 'bg-green-500/20',
    text: 'text-green-600 dark:text-green-400',
  },
  REJECTED: {
    label: 'Abgelehnt',
    bg: 'bg-rose-500/20',
    text: 'text-rose-600 dark:text-rose-400',
  },
};

export function TrainerActivityReportsTab() {
  const { profile } = useAuth();
  const { t } = useLanguage();
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
        const res = await fetch(
          `/api/trainer/school/activity-reports?trainerId=${trainerId}&status=${statusFilter}`
        );
        if (res.ok) {
          const data = await res.json();
          setReports(data.reports || []);
        }
      } catch (e) {
        setError(t('reports.error.loadData'));
      } finally {
        setLoading(false);
      }
    }
    loadReports();
  }, [profile?.id, statusFilter]);

  const handleReview = async (
    reportId: string,
    action: 'approve' | 'reject',
    feedback?: string
  ) => {
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
      setError(t('reports.error.processing'));
    }
  };

  const pendingCount = reports.filter(r => r.status === 'SUBMITTED').length;

  return (
    <div className="space-y-6">
      {/* Filter */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Filter className="text-muted-foreground h-5 w-5" />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-background border-border text-foreground min-w-[160px] rounded-xl border px-4 py-2.5"
          >
            <option value="SUBMITTED">Ausstehend ({pendingCount})</option>
            <option value="APPROVED">Genehmigt</option>
            <option value="REJECTED">Abgelehnt</option>
            <option value="">Alle</option>
          </select>
        </div>
        {pendingCount > 0 && (
          <div className="rounded-lg bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-600 dark:text-amber-400">
            {pendingCount} Nachweis(e) zur Prüfung
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="border-accent/30 border-t-accent h-10 w-10 animate-spin rounded-full border-4" />
        </div>
      ) : reports.length === 0 ? (
        <div className="py-16 text-center">
          <ClipboardCheck className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
          <h3 className="text-foreground mb-2 text-lg font-bold">
            {t('reports.noReports')}
          </h3>
          <p className="text-muted-foreground">
            {t('reports.noReportsWithStatus')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map(report => {
            const statusConfig = STATUS_CONFIG[report.status];
            return (
              <div
                key={report.id}
                className="bg-muted/30 border-border hover:bg-muted/50 cursor-pointer rounded-xl border p-4 transition-colors"
                onClick={() => {
                  setSelectedReport(report);
                  setShowReviewModal(true);
                }}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="bg-accent/10 rounded-lg p-2.5">
                      <User className="text-accent h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="text-foreground font-medium">
                        {report.traineeName}
                      </h4>
                      <div className="text-muted-foreground mt-1 flex items-center gap-3 text-xs">
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
                    <span
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium ${statusConfig.bg} ${statusConfig.text}`}
                    >
                      {statusConfig.label}
                    </span>
                    {report.status === 'SUBMITTED' && (
                      <div className="flex gap-1">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            handleReview(report.id, 'approve');
                          }}
                          className="rounded-lg bg-green-500/10 p-2 text-green-600 transition hover:bg-green-500/20"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setSelectedReport(report);
                            setShowReviewModal(true);
                          }}
                          className="rounded-lg bg-rose-500/10 p-2 text-rose-600 transition hover:bg-rose-500/20"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                    <ChevronRight className="text-muted-foreground h-5 w-5" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="bg-destructive/10 border-destructive/20 flex items-center gap-3 rounded-xl border p-4">
          <AlertCircle className="text-destructive h-5 w-5" />
          <p className="text-destructive text-sm">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="text-destructive h-4 w-4" />
          </button>
        </div>
      )}

      {showReviewModal && selectedReport && (
        <ReviewModal
          report={selectedReport}
          onClose={() => {
            setShowReviewModal(false);
            setSelectedReport(null);
          }}
          onReview={handleReview}
        />
      )}
    </div>
  );
}

import { GradeInputSection } from '@/components/trainer/arbeitszeugnis/GradeInputSection';

// ... existing imports

function ReviewModal({
  report,
  onClose,
  onReview,
}: {
  report: Report;
  onClose: () => void;
  onReview: (
    reportId: string,
    action: 'approve' | 'reject',
    feedback?: string
  ) => void;
}) {
  const [feedback, setFeedback] = useState('');
  const [action, setAction] = useState<'approve' | 'reject' | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  useEffect(() => {
    async function fetchEntries() {
      setLoadingEntries(true);
      try {
        const res = await fetch(
          `/api/trainer/arbeitszeugnis/grade?reportId=${report.id}`
        );
        if (res.ok) {
          const data = await res.json();
          setEntries(
            data.entries.map((e: any) => ({
              entryId: e.id,
              useCaseLetter: e.useCaseLetter || '',
              useCaseDescription:
                e.useCaseDescription || 'Keine Beschreibung verfügbar',
              actualHours: e.actualHours,
              currentGrade: e.trainerGrade,
              comment: e.gradeComment,
            }))
          );
        }
      } catch (error) {
        console.error('Error fetching entries for grading:', error);
      } finally {
        setLoadingEntries(false);
      }
    }

    // Only fetch if we are in a state where grading makes sense (e.g. approving)
    // Or just always fetch to show current grades.
    if (report.status !== 'REJECTED') {
      fetchEntries();
    }
  }, [report.id, report.status]);

  const handleSubmit = () => {
    if (!action) return;
    if (action === 'reject' && !feedback.trim()) {
      toast.error('Bitte geben Sie einen Grund für die Ablehnung an.');
      return;
    }
    onReview(report.id, action, feedback || undefined);
  };

  // Helper to refresh entries after save
  const handleGradesSaved = () => {
    // Optionally refetch or just show success
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm">
      <div className="bg-card border-border my-8 w-full max-w-2xl overflow-hidden rounded-2xl border shadow-2xl">
        <div className="border-border bg-card sticky top-0 z-10 border-b p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold">Tätigkeitsnachweis prüfen</h3>
              <p className="text-muted-foreground mt-1 text-sm">
                {report.traineeName} • KW {report.weekNumber}/{report.year}
              </p>
            </div>
            <button onClick={onClose} className="hover:bg-muted rounded-lg p-2">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="space-y-6 p-6">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-green-500/10 p-3">
              <p className="text-lg font-bold text-green-600">
                {report.betrieblicheStunden}h
              </p>
              <p className="text-muted-foreground text-xs">Betrieblich</p>
            </div>
            <div className="rounded-xl bg-blue-500/10 p-3">
              <p className="text-lg font-bold text-blue-600">
                {report.unterweisungenStunden}h
              </p>
              <p className="text-muted-foreground text-xs">Unterweisungen</p>
            </div>
            <div className="bg-accent/10 rounded-xl p-3">
              <p className="text-accent text-lg font-bold">
                {report.berufsschulStunden}h
              </p>
              <p className="text-muted-foreground text-xs">Berufsschule</p>
            </div>
          </div>

          {/* Grade Input Section */}
          <div className="border-border border-t pt-6">
            {loadingEntries ? (
              <div className="text-muted-foreground py-4 text-center">
                Lade Einträge zur Bewertung...
              </div>
            ) : (
              <GradeInputSection
                reportId={report.id}
                entries={entries}
                onGradesSaved={handleGradesSaved}
                isReadOnly={
                  report.status === 'APPROVED' || report.status === 'REJECTED'
                } // Or logic based on permissions
              />
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              Feedback (erforderlich bei Ablehnung)
            </label>
            <textarea
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              className="bg-muted border-border min-h-[100px] w-full rounded-xl border px-4 py-3"
              placeholder="Anmerkungen oder Begründung..."
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => {
                setAction('reject');
              }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 font-medium transition ${action === 'reject' ? 'bg-destructive text-destructive-foreground' : 'bg-destructive/10 text-destructive hover:bg-destructive/20'}`}
            >
              <X className="h-4 w-4" />
              Ablehnen
            </button>
            <button
              onClick={() => {
                setAction('approve');
              }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 font-medium transition ${action === 'approve' ? 'text-primary-foreground bg-green-600 dark:text-white' : 'bg-green-600/10 text-green-600 hover:bg-green-600/20'}`}
            >
              <Check className="h-4 w-4" />
              Genehmigen
            </button>
          </div>

          {action && (
            <button
              onClick={handleSubmit}
              className="btn-accent w-full rounded-xl px-4 py-3 font-medium"
            >
              Bestätigen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
