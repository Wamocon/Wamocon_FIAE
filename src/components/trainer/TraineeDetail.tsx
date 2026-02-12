'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  FileCheck2,
  TrendingUp,
  Calendar,
  Award,
  BookOpen,
  Eye,
  MessageSquare,
  Download,
  Share2,
  MoreVertical,
} from 'lucide-react';

interface TraineeDetailProps {
  traineeId: string;
}

export default function TraineeDetail({ traineeId }: TraineeDetailProps) {
  const router = useRouter();
  const { profile } = useAuth() as any;
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<
    'overview' | 'progress' | 'submissions' | 'notes'
  >('overview');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trainee, setTrainee] = useState<{
    id: string;
    full_name: string;
    avatar_url?: string | null;
    training_start_date?: string | null;
    assigned_trainer_id?: string | null;
    progress: number;
  } | null>(null);
  const [edit, setEdit] = useState({
    full_name: '',
    avatar_url: '',
    start_of_training_date: '',
  });
  const [saving, setSaving] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [overview, setOverview] = useState<null | {
    stats: {
      progressPct: number;
      completedEnablers: number;
      totalEnablers: number;
      pending: { quizzes: number; useCases: number };
    };
    enablers: Array<{ id: string; title: string; completed: boolean; isActive: boolean; link: string }>;
    useCases: Array<{ id: string; title: string; status: string | null; isActive: boolean; attemptNumber?: number | null; link: string }>;
    enablerQuizzes: Array<{ enablerId: string; quizId: string; difficulty: string; lastScore: number | null; attemptNumber: number | null; isReviewed: boolean | null; link: string }>;
    globalQuizzes: Array<{ quizId: string; title: string; lastScore: number | null; attemptNumber: number | null; isReviewed: boolean | null; link: string }>;
  }>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/trainer/trainees/${traineeId}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(t('trainee.detail.loadError'));
        const data = await res.json();
        setTrainee(data.trainee);
        setEdit({
          full_name: data.trainee?.full_name || '',
          avatar_url: data.trainee?.avatar_url || '',
          start_of_training_date: data.trainee?.training_start_date ? String(data.trainee.training_start_date).slice(0, 10) : '',
        });
        // Load overview
        const oRes = await fetch(`/api/trainer/trainees/${traineeId}/overview`, { cache: 'no-store' });
        if (oRes.ok) {
          const oData = await oRes.json();
          setOverview(oData);
        }
      } catch (e: any) {
        setError(e?.message || t('error.unknown'));
      } finally {
        setLoading(false);
      }
    };
    if (traineeId) load();
  }, [traineeId, t]);



  const generatePdfBlob = async () => {
    // dynamically import to keep bundle small and avoid SSR issues
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]); // A4 portrait in points
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontSizeHeading = 18;
    const fontSize = 12;
    const left = 50;
    let y = 800;

    page.drawText(`${t('trainee.detail.pdfTrainee')} ${trainee?.full_name || ''}`, { x: left, y, size: fontSizeHeading, font });
    y -= 26;
    page.drawText(`ID: ${trainee?.id || ''}`, { x: left, y, size: fontSize, font });
    y -= 18;
    page.drawText(`${t('trainee.detail.trainingStart')}: ${trainee?.training_start_date || '—'}`, { x: left, y, size: fontSize, font });
    y -= 18;
    page.drawText(`${t('trainee.detail.pdfProgress')} ${trainee?.progress ?? 0}%`, { x: left, y, size: fontSize, font });
    y -= 26;

    page.drawText(t('trainee.detail.pdfQuickStats'), { x: left, y, size: fontSizeHeading, font });
    y -= 22;
    page.drawText(`${t('trainee.detail.pdfOverallProgress')} ${trainee?.progress ?? 0}%`, { x: left, y, size: fontSize, font });
    y -= 16;
    page.drawText(`${t('trainee.detail.pdfModulesCompleted')} —`, { x: left, y, size: fontSize, font });
    y -= 16;
    page.drawText(`${t('trainee.detail.pdfAverage')} 82%`, { x: left, y, size: fontSize, font });

    const pdfBytes = await pdfDoc.save();
    // pdfBytes is a Uint8Array - convert to a plain ArrayBuffer slice to satisfy strict BlobPart typing
    const ab = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
    const blob = new Blob([ab], { type: 'application/pdf' });
    return blob;
  };

  const [exporting, setExporting] = useState(false);

  const handleDownloadPdf = async () => {
    try {
      setExporting(true);
      const blob = await generatePdfBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${trainee?.full_name || 'trainee'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || t('trainee.detail.exportError'));
    } finally {
      setExporting(false);
    }
  };

  const handleSharePdf = async () => {
    try {
      setExporting(true);
      const blob = await generatePdfBlob();
      const file = new File([blob], `${trainee?.full_name || 'trainee'}.pdf`, { type: 'application/pdf' });
      // Use Web Share API if available
      const nav: any = navigator as any;
      if (nav?.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: `${t('trainee.detail.shareTitle')} ${trainee?.full_name || ''}`, text: t('trainee.detail.shareText') });
      } else {
        // Fallback to download
        handleDownloadPdf();
      }
    } catch (e: any) {
      console.error(e);
      alert(e?.message || t('trainee.detail.shareError'));
    } finally {
      setExporting(false);
    }
  };

  const handleSave = async () => {
    if (!profile?.id || !trainee?.id) return;
    try {
      setSaving(true);
      setError(null);
      const payload: any = {
        trainer_id: profile.id,
        full_name: edit.full_name,
        avatar_url: edit.avatar_url,
      };
      if (edit.start_of_training_date) payload.start_of_training_date = edit.start_of_training_date;
      const res = await fetch(`/api/trainer/trainees/${trainee.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(t('trainee.detail.saveError'));
      const data = await res.json();
      setTrainee((prev) => ({
        ...prev!,
        full_name: data.trainee.full_name,
        avatar_url: data.trainee.avatar_url,
        training_start_date: data.trainee.training_start_date,
      }));
    } catch (e: any) {
      setError(e?.message || t('error.unknown'));
    } finally {
      setSaving(false);
    }
  };

  // Helpers
  const toggleItem = async (
    itemType: 'ENABLER' | 'USE_CASE' | 'GLOBAL_QUIZ',
    itemId: string,
    isActive: boolean,
  ) => {
    if (!trainee?.id) return;
    const payload: any = { itemType, itemId, isActive };
    if (profile?.role === 'trainer' && profile?.id) payload.trainerId = profile.id;
    await fetch(`/api/trainer/trainees/${trainee.id}/activate`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    // refresh overview
    const oRes = await fetch(`/api/trainer/trainees/${trainee.id}/overview`, { cache: 'no-store' });
    if (oRes.ok) {
      const oData = await oRes.json();
      setOverview(oData);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-6">
            <div className="relative">
              {trainee?.avatar_url ? (
                <img
                  src={trainee.avatar_url}
                  alt={trainee.full_name}
                  className="border-accent/30 h-24 w-24 rounded-3xl border-4 object-cover shadow-lg"
                />
              ) : (
                <div className="border-accent/30 flex h-24 w-24 items-center justify-center rounded-3xl border-4 bg-muted text-muted shadow-lg">
                  <TrendingUp className="h-6 w-6" />
                </div>
              )}
              <div className="absolute -right-2 -bottom-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-green-500">
                <div className="h-3 w-3 rounded-full bg-white"></div>
              </div>
            </div>
            <div>
              <h1 className="text-foreground mb-2 text-3xl font-bold">
                {trainee?.full_name || t('trainee.detail.trainee')}
              </h1>
              <div className="flex items-center gap-4">
                <span className="bg-accent/20 text-accent rounded-full px-3 py-1 text-sm font-medium">
                  {t('trainee.detail.trainee')}
                </span>
                <span className="text-muted">ID: {trainee?.id}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowEdit((v) => !v)}
              className="text-muted bg-muted/30 hover:bg-muted/50 flex items-center gap-2 rounded-2xl px-4 py-2 transition-all duration-200"
            >
              {showEdit ? t('trainee.detail.hideEdit') : t('trainee.detail.edit')}
            </button>
            <button
              onClick={handleSharePdf}
              disabled={exporting}
              className="text-muted bg-muted/30 hover:bg-muted/50 flex items-center gap-2 rounded-2xl px-4 py-2 transition-all duration-200 disabled:opacity-60"
            >
              <Share2 className="h-4 w-4" />
              {exporting ? t('trainee.detail.sharing') : t('trainee.detail.share')}
            </button>
            <button
              onClick={handleDownloadPdf}
              disabled={exporting}
              className="text-muted bg-muted/30 hover:bg-muted/50 flex items-center gap-2 rounded-2xl px-4 py-2 transition-all duration-200 disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {exporting ? t('trainee.detail.exporting') : t('trainee.detail.export')}
            </button>
          </div>
        </div>
      </div>
      

      {/* Row 3: Assignments & Progress */}
      <div className="glass-effect bg-background border-accent/30 rounded-3xl border p-6 shadow-lg">
        <div className="p-8">
          {/* Edit form for trainers */}
          {profile?.role === 'trainer' && trainee && showEdit && (
            <div className="mb-8 rounded-2xl border border-accent/30 bg-background p-6">
              <h3 className="mb-4 text-lg font-semibold text-foreground">{t('trainee.detail.editDetails')}</h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm text-foreground">{t('trainee.detail.fullName')}</label>
                  <input
                    className="w-full rounded-xl border bg-background px-3 py-2 text-foreground"
                    value={edit.full_name}
                    onChange={(e) => setEdit((p) => ({ ...p, full_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-foreground">{t('trainee.detail.avatarUrl')}</label>
                  <input
                    className="w-full rounded-xl border bg-background px-3 py-2 text-foreground"
                    value={edit.avatar_url}
                    onChange={(e) => setEdit((p) => ({ ...p, avatar_url: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-foreground">{t('trainee.detail.trainingStart')}</label>
                  <input
                    type="date"
                    className="w-full rounded-xl border bg-background px-3 py-2 text-foreground"
                    value={edit.start_of_training_date}
                    onChange={(e) => setEdit((p) => ({ ...p, start_of_training_date: e.target.value }))}
                  />
                </div>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-foreground hover:bg-red-700 disabled:opacity-60"
                >
                  {saving ? t('trainee.detail.saving') : t('trainee.detail.save')}
                </button>
                {error && <div className="text-sm text-red-600">{error}</div>}
              </div>
            </div>
          )}

          {/* Redesigned third row content */}
          <div className="space-y-8">
            {/* Enablers (Modules) */}
            <section>
              <div className="mb-3 flex bg-background text-foreground items-center justify-between">
                <h3 className="text-xl font-bold text-foreground">{t('trainee.detail.modules')}</h3>
                <div className="text-sm text-foreground">{t('trainee.detail.completed')} {overview?.stats.completedEnablers ?? 0} / {overview?.stats.totalEnablers ?? 0}</div>
              </div>
              {overview?.enablers?.length ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {overview.enablers.map((e) => (
                    <div key={e.id} className="rounded-2xl border border-accent/30 p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="font-semibold text-foreground">{e.title}</div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs rounded-full px-2 py-0.5 border ${e.completed ? 'border-green-500 text-green-500' : 'border-slate-300 text-foreground'}`}>{e.completed ? t('trainee.detail.participated') : t('trainee.detail.notParticipated')}</span>
                          <span className={`text-xs rounded-full px-2 py-0.5 border ${e.isActive ? 'border-blue-500 text-blue-500' : 'border-slate-300 text-foreground'}`}>{e.isActive ? t('trainee.detail.active') : t('trainee.detail.inactive')}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {profile?.role === 'trainer' && (
                          <button onClick={() => toggleItem('ENABLER', e.id, !e.isActive)} className={`text-sm rounded-md px-2 py-1 border ${e.isActive ? 'border-yellow-500 text-yellow-500' : 'border-green-600 text-green-500'}`}>{e.isActive ? t('trainee.detail.deactivate') : t('trainee.detail.activate')}</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-foreground">{t('trainee.detail.noEnablers')}</div>
              )}
            </section>

            {/* Enabler Quizzes by difficulty */}
            <section>
              <h3 className="mb-3 text-xl font-bold text-foreground">{t('trainee.detail.lessonQuizzes')}</h3>
              {overview?.enablerQuizzes?.length ? (
                <div className="space-y-2">
                  {overview.enablerQuizzes.map((q) => (
                    <div key={`${q.enablerId}-${q.quizId}`} className="flex items-center justify-between rounded-2xl border border-accent/30 p-4">
                      <div>
                        <div className="text-foreground font-medium">{t('trainee.detail.difficulty')} {q.difficulty}</div>
                        <div className="text-foreground text-sm">{t('trainee.detail.attempts')} {q.attemptNumber ?? 0} · {t('trainee.detail.result')} {typeof q.lastScore === 'number' ? `${q.lastScore}%` : '—'} {q.isReviewed === false ? `· ${t('trainee.detail.forReview')}` : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-foreground">{t('trainee.detail.noEnablerQuizzes')}</div>
              )}
            </section>
            {/* Use Cases */}
            <section>
              <h3 className="mb-3 text-xl font-bold text-foreground">{t('trainee.detail.useCases')}</h3>
              {overview?.useCases?.length ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {overview.useCases.map((u) => (
                    <div key={u.id} className="rounded-2xl border border-accent/30 p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="font-semibold text-foreground">{u.title}</div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs rounded-full px-2 py-0.5 border ${u.status === 'PENDING' ? 'border-yellow-500 text-yellow-500' : u.status ? 'border-green-500 text-green-500' : 'border-slate-300 text-foreground'}`}>{u.status ?? t('trainee.detail.notSubmitted')}</span>
                          <span className={`text-xs rounded-full px-2 py-0.5 border ${u.isActive ? 'border-blue-500 text-blue-500' : 'border-slate-300 text-foreground'}`}>{u.isActive ? t('trainee.detail.active') : t('trainee.detail.inactive')}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {profile?.role === 'trainer' && (
                          <button onClick={() => toggleItem('USE_CASE', u.id, !u.isActive)} className={`text-sm rounded-md px-2 py-1 border ${u.isActive ? 'border-yellow-500 text-yellow-500' : 'border-green-600 text-green-500'}`}>{u.isActive ? t('trainee.detail.deactivate') : t('trainee.detail.activate')}</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-foreground">{t('trainee.detail.noUseCases')}</div>
              )}
            </section>

            {/* Global (Big) Quizzes */}
            <section>
              <h3 className="mb-3 text-xl font-bold text-foreground">{t('trainee.detail.globalQuizzes')}</h3>
              {overview?.globalQuizzes?.length ? (
                <div className="space-y-2">
                  {overview.globalQuizzes.map((q) => (
                    <div key={q.quizId} className="flex items-center justify-between rounded-2xl border border-accent/30 p-4">
                      <div>
                        <div className="text-foreground font-medium">{q.title}</div>
                        <div className="text-foreground text-sm">{t('trainee.detail.attempts')} {q.attemptNumber ?? 0} · {t('trainee.detail.result')} {typeof q.lastScore === 'number' ? `${q.lastScore}%` : '—'} {q.isReviewed === false ? `· ${t('trainee.detail.forReview')}` : ''}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {profile?.role === 'trainer' && (
                          <button onClick={() => toggleItem('GLOBAL_QUIZ', q.quizId, false)} className="text-sm rounded-md px-2 py-1 border border-yellow-500 text-yellow-500">{t('trainee.detail.remove')}</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-foreground">{t('trainee.detail.noGlobalQuizzes')}</div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
