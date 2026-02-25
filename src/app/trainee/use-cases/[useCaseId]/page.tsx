'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, CheckCircle, Clock, AlertCircle } from 'lucide-react';

export default function TraineeUseCaseDetailPage() {
  const params = useParams<{ useCaseId: string }>();
  const useCaseId = params?.useCaseId as string;
  const { profile } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  type UseCaseResponse = {
    useCase: {
      id: string; title: string; descriptionText: string; isActive?: boolean;
      durationValue?: number | null; durationUnit?: 'DAYS' | 'WEEKS' | null;
      activatedAt?: string | null; courseId?: string; courseTitle?: string;
    } | null;
    submission: {
      id: string; submissionText?: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED';
      trainerFeedback?: string | null; links?: Array<{ url: string; description?: string | null }>;
    } | null;
  };
  type DocsResponse = { documents: Array<{ id: string; title: string; storageUrl: string; documentType: string }> };

  const ucUrl = profile?.id && useCaseId ? `/api/trainee/use-cases/${useCaseId}?traineeId=${profile.id}` : null;
  const docsUrl = profile?.id && useCaseId ? `/api/trainee/use-cases/${useCaseId}/documents?traineeId=${profile.id}` : null;

  const { data: ucData, isLoading: loading, error: queryError } = useApiQuery<UseCaseResponse>(ucUrl);
  const { data: docsData } = useApiQuery<DocsResponse>(docsUrl);

  const useCase = ucData?.useCase || null;
  const submission = ucData?.submission || null;
  const documents = docsData?.documents || [];

  // Form state — synced from server data on load, editable by user
  const [submissionText, setSubmissionText] = useState('');
  const [links, setLinks] = useState<Array<{ url: string; description?: string }>>([{ url: '', description: '' }]);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPdfUrl, setSelectedPdfUrl] = useState<string | null>(null);

  // Sync form fields when server data loads/changes
  useEffect(() => {
    const sub = ucData?.submission;
    if (sub) {
      setSubmissionText(sub.submissionText || '');
      const mapped = (sub.links || []).map((l: any) => ({ url: l.url as string, description: (l.description as string) || '' }));
      setLinks(mapped.length ? mapped : [{ url: '', description: '' }]);
    }
  }, [ucData]);

  // Determine if editing is allowed
  const canEdit = !submission || submission.status === 'REJECTED';

  const submit = async () => {
    if (!profile?.id) return setError(t('useCase.profileMissing'));
    setSaving(true);
    setSuccess(null);
    setError(null);
    try {
      const body = {
        traineeId: profile.id,
        submissionText: submissionText || null,
        links: links.filter((l) => l.url && l.url.trim()),
      };
      const r = await fetch(`/api/trainee/use-cases/${useCaseId}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(t('useCase.submitFailed'));
      setSuccess(t('useCase.submitSuccess'));

      // Optimistically update query data
      if (ucUrl) {
        queryClient.setQueryData<UseCaseResponse>([ucUrl], (old) => {
          if (!old) return old;
          return {
            ...old,
            submission: {
              id: old.submission?.id || 'temp-id',
              status: 'PENDING',
              submissionText: submissionText,
              links: links.filter((l) => l.url && l.url.trim()),
              trainerFeedback: null,
            }
          };
        });
        queryClient.invalidateQueries({ queryKey: [ucUrl] });
      }
    } catch (e: any) {
      setError(e?.message || t('error.unknown'));
    } finally {
      setSaving(false);
    }
  };

  if (!profile) return <div className="p-6">{t('courses.loginPrompt')}</div>;
  if (loading) return <div className="p-6">{t('common.loading')}</div>;
  if (queryError) return <div className="p-6 text-red-500">{queryError.message}</div>;
  if (!useCase) return <div className="p-6">{t('common.notFound')}</div>;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="rounded-3xl border border-accent/30 bg-card p-5">
        <h1 className="text-foreground text-2xl font-bold">{useCase.title}</h1>
        <p className="text-muted-foreground mt-2 whitespace-pre-line">{useCase.descriptionText}</p>

        {/* PDF Documents List */}
        {documents.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {documents.map((doc) => (
              <button
                key={doc.id}
                onClick={() => setSelectedPdfUrl(prev => prev === doc.storageUrl ? null : doc.storageUrl)}
                className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200 max-w-full ${selectedPdfUrl === doc.storageUrl ? 'bg-accent/15 text-accent border border-accent/40' : 'bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:shadow-lg hover:scale-[1.02]'}`}
              >
                <ChevronLeft className={`h-4 w-4 shrink-0 transition-transform duration-200 ${selectedPdfUrl === doc.storageUrl ? 'rotate-[-90deg]' : 'rotate-90'}`} />
                <span className="truncate">{doc.title}</span>
              </button>
            ))}
          </div>
        )}

        {/* Inline PDF Viewer */}
        {selectedPdfUrl && (
          <div className="mt-4 animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="relative w-full h-[80vh] rounded-xl overflow-hidden border border-accent/30 bg-card shadow-2xl">
              <iframe
                src={`${selectedPdfUrl}#toolbar=1&navpanes=0&view=FitH`}
                className="w-full h-full"
                title="PDF Viewer"
              />
            </div>
          </div>
        )}

        {useCase.isActive && useCase.durationValue && useCase.activatedAt && (
          <div className="mt-4 text-sm pt-4 border-t border-accent/10">
            {(() => {
              const started = new Date(useCase.activatedAt as string).getTime();
              const now = Date.now();
              const daysElapsed = Math.floor((now - started) / (1000 * 60 * 60 * 24));
              const total = Number(useCase.durationValue || 0);
              const left = Math.max(0, total - daysElapsed);
              const dueDate = new Date(started + total * 24 * 60 * 60 * 1000);
              return <span className="text-muted-foreground">{t('useCase.timeRemaining')} <span className={left < 3 ? 'text-red-400 font-bold' : 'text-foreground'}>{left} {t('useCase.days')}</span> • {t('useCase.dueOn')} {dueDate.toLocaleDateString()}</span>;
            })()}
          </div>
        )}
      </div>

      {success && <div className="rounded-md border border-green-500/40 bg-green-500/10 p-3 text-green-300">{success}</div>}
      {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-red-300">{error}</div>}

      {/* Status Banner */}
      {submission?.status === 'APPROVED' && (
        <div className="rounded-2xl border border-green-500/40 bg-green-500/10 p-4 flex items-start gap-3">
          <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-green-600 dark:text-green-400">{t('useCase.approved')}</div>
            <div className="text-sm text-green-600/80 dark:text-green-400/80">{t('useCase.approvedDesc')}</div>
          </div>
        </div>
      )}

      {submission?.status === 'PENDING' && (
        <div className="rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-4 flex items-start gap-3">
          <Clock className="h-5 w-5 text-yellow-500 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-yellow-600 dark:text-yellow-400">{t('useCase.pending')}</div>
            <div className="text-sm text-yellow-600/80 dark:text-yellow-400/80">{t('useCase.pendingDesc')}</div>
          </div>
        </div>
      )}

      {submission?.status === 'REJECTED' && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold text-red-600 dark:text-red-400">{t('useCase.rejected')}</div>
            <div className="text-sm text-red-600/80 dark:text-red-400/80 mb-2">{t('useCase.rejectedDesc')}</div>
            {submission.trainerFeedback && (
              <div className="mt-2 rounded-xl border border-red-500/20 bg-red-500/5 p-3">
                <div className="text-xs font-medium text-red-600/70 dark:text-red-400/70 mb-1">{t('useCase.trainerFeedback')}</div>
                <p className="text-sm text-foreground whitespace-pre-line">{submission.trainerFeedback}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-4 rounded-3xl border border-accent/30 bg-card p-5">

        <div>
          <label className="mb-1 block text-sm font-medium">{t('useCase.submission')}</label>
          <textarea
            value={submissionText}
            onChange={(e) => setSubmissionText(e.target.value)}
            className={`w-full rounded-xl border border-accent/30 bg-muted px-3 py-2 text-foreground ${!canEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
            rows={6}
            disabled={!canEdit}
          />
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium">{t('useCase.links')}</div>
          {links.map((l, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <input
                className={`rounded-xl border border-accent/30 bg-muted px-3 py-2 md:col-span-2 text-foreground ${!canEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
                placeholder={t('useCase.linkPlaceholder')}
                value={l.url}
                onChange={(e) => setLinks((prev) => prev.map((x, idx) => idx === i ? { ...x, url: e.target.value } : x))}
                disabled={!canEdit}
              />
              <input
                className={`rounded-xl border border-accent/30 bg-muted px-3 py-2 text-foreground ${!canEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
                placeholder={t('useCase.descriptionPlaceholder')}
                value={l.description || ''}
                onChange={(e) => setLinks((prev) => prev.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))}
                disabled={!canEdit}
              />
            </div>
          ))}
          {canEdit && (
            <div className="flex gap-2">
              <button className="rounded-md border border-accent/30 px-3 py-2 text-sm hover:bg-background/60" onClick={() => setLinks((prev) => [...prev, { url: '', description: '' }])}>+ {t('useCase.addLink')}</button>
              {links.length > 1 && (
                <button className="rounded-md border border-accent/30 px-3 py-2 text-sm hover:bg-background/60" onClick={() => setLinks((prev) => prev.slice(0, -1))}>{t('useCase.removeLastLink')}</button>
              )}
            </div>
          )}
        </div>
        {canEdit && (
          <div className="flex justify-end">
            <button disabled={saving} onClick={submit} className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
              {submission?.status === 'REJECTED' ? t('useCase.resubmit') : t('useCase.submit')}
            </button>
          </div>
        )}
      </div>

      {/* Link back to module */}
      {useCase.courseId && (
        <div className="flex justify-center mt-8 pb-8">
          <Link href={`/trainee/modules/${useCase.courseId}`} className="text-muted-foreground hover:text-accent transition-colors flex items-center gap-2 text-sm font-medium">
            <ChevronLeft className="h-4 w-4" />
            {t('useCase.backToModule')} {useCase.courseTitle || 'Modul'}
          </Link>
        </div>
      )}
    </div>
  );
}
