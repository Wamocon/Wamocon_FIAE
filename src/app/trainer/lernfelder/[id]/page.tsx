'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  ArrowLeft,
  Layers,
  BookOpen,
  Clock,
  ChevronRight,
  Edit2,
  Trash2,
} from 'lucide-react';
import { use } from 'react';

interface UseCase {
  id: string;
  title: string;
  courseId: string | null;
  descriptionText: string | null;
  orderIndex: number;
  durationValue: number | null;
  durationUnit: string | null;
  isActive: boolean;
  year: number | null;
  trainingStage: string | null;
  lernfelder: string[] | null;
}

interface Lernfeld {
  id: string;
  title: string;
  description: string | null;
  label: string;
  createdAt: string;
  updatedAt: string;
}

export default function LernfeldDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { t } = useLanguage();
  const { profile } = useAuth();
  const [lernfeld, setLernfeld] = useState<Lernfeld | null>(null);
  const [useCases, setUseCases] = useState<UseCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/trainer/lernfelder/${id}`, { cache: 'no-store' })
      .then(res => {
        if (!res.ok) throw new Error('Not found');
        return res.json();
      })
      .then(data => {
        setLernfeld(data.lernfeld);
        setUseCases(data.useCases || []);
        setEditTitle(data.lernfeld?.title || '');
        setEditDescription(data.lernfeld?.description || '');
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError('Lernfeld nicht gefunden');
        setLoading(false);
      });
  }, [id]);

  const handleUpdate = async () => {
    if (!editTitle || !lernfeld) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/trainer/lernfelder/${id}?trainerId=${profile?.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: editTitle,
            description: editDescription,
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        setLernfeld(prev => (prev ? { ...prev, ...data.lernfeld } : null));
        setShowEditModal(false);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(t('lernfelder.deleteConfirm'))) return;
    try {
      const res = await fetch(
        `/api/trainer/lernfelder/${id}?trainerId=${profile?.id}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        router.push('/trainer/school');
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (error || !lernfeld) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <p className="text-muted">{error || 'Nicht gefunden'}</p>
        <button
          onClick={() => router.push('/trainer/school')}
          className="text-accent flex items-center gap-2 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('common.back')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header with Back Button */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push('/trainer/school')}
          className="text-muted hover:text-foreground flex items-center gap-2 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
          <span>{t('common.back')}</span>
        </button>
      </div>

      {/* Lernfeld Header Card */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="from-accent to-primary shadow-accent/25 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br shadow-lg">
              <Layers className="text-primary-foreground h-7 w-7" />
            </div>
            <div>
              <div className="mb-1 flex items-center gap-3">
                <span className="bg-accent text-accent-foreground rounded-full px-3 py-1 text-xs font-bold">
                  {lernfeld.label}
                </span>
              </div>
              <h1 className="text-foreground text-2xl font-bold">
                {lernfeld.title}
              </h1>
              {lernfeld.description && (
                <p className="text-muted mt-2 max-w-2xl">
                  {lernfeld.description}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowEditModal(true)}
              className="bg-accent/10 text-accent hover:bg-accent/20 flex items-center gap-2 rounded-xl px-4 py-2 transition-colors"
            >
              <Edit2 className="h-4 w-4" />
              {t('common.edit')}
            </button>
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 rounded-xl bg-red-500/10 px-4 py-2 text-red-500 transition-colors hover:bg-red-500/20"
            >
              <Trash2 className="h-4 w-4" />
              {t('common.delete')}
            </button>
          </div>
        </div>
      </div>

      {/* Use Cases Section */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen className="text-accent h-5 w-5" />
            <h2 className="text-foreground text-xl font-semibold">
              {t('lernfelder.useCases')} ({useCases.length})
            </h2>
          </div>
        </div>

        {useCases.length > 0 ? (
          <div className="space-y-3">
            {useCases.map(uc => (
              <div
                key={uc.id}
                onClick={() => router.push(`/trainer/use-cases/${uc.id}`)}
                className="group bg-muted/20 hover:bg-muted/30 border-accent/10 hover:border-accent/30 flex cursor-pointer items-center justify-between rounded-xl border p-4 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <h3 className="text-foreground truncate font-medium">
                    {uc.title}
                  </h3>
                  {uc.descriptionText && (
                    <p className="text-muted mt-1 truncate text-sm">
                      {uc.descriptionText}
                    </p>
                  )}
                  <div className="text-muted mt-2 flex items-center gap-4 text-xs">
                    {uc.durationValue && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {uc.durationValue} {uc.durationUnit || 'h'}
                      </span>
                    )}
                    {uc.year && (
                      <span className="bg-accent/20 rounded-full px-2 py-0.5">
                        {t('content.year')} {uc.year}
                      </span>
                    )}
                    {uc.trainingStage && (
                      <span className="bg-primary/20 rounded-full px-2 py-0.5">
                        {uc.trainingStage}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="text-muted group-hover:text-accent h-5 w-5 transition-colors" />
              </div>
            ))}
          </div>
        ) : (
          <div className="py-12 text-center">
            <div className="from-accent/20 to-primary/20 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br">
              <BookOpen className="text-accent h-8 w-8" />
            </div>
            <h3 className="text-foreground mb-2 text-lg font-semibold">
              {t('lernfelder.noUseCases') || 'Keine Use Cases'}
            </h3>
            <p className="text-muted text-sm">
              {t('lernfelder.noUseCasesDescription') ||
                'Diesem Lernfeld sind noch keine Use Cases zugeordnet.'}
            </p>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="glass-effect border-accent/30 mx-4 w-full max-w-md rounded-3xl border p-6 shadow-2xl">
            <h3 className="text-foreground mb-4 text-xl font-semibold">
              {t('lernfelder.edit')}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-foreground mb-1 block text-sm font-medium">
                  {t('lernfelder.titleLabel')}
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="bg-background/50 border-accent/30 text-foreground focus:ring-accent w-full rounded-xl border px-4 py-2 focus:ring-2 focus:outline-none"
                  placeholder={t('lernfelder.titlePlaceholder')}
                />
              </div>
              <div>
                <label className="text-foreground mb-1 block text-sm font-medium">
                  {t('lernfelder.descriptionLabel') || 'Beschreibung'}
                </label>
                <textarea
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  rows={3}
                  className="bg-background/50 border-accent/30 text-foreground focus:ring-accent w-full resize-none rounded-xl border px-4 py-2 focus:ring-2 focus:outline-none"
                  placeholder={
                    t('lernfelder.descriptionPlaceholder') ||
                    'Beschreibung eingeben...'
                  }
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowEditModal(false)}
                className="text-muted hover:text-foreground rounded-xl px-4 py-2 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleUpdate}
                disabled={submitting || !editTitle}
                className="from-accent to-primary text-primary-foreground rounded-xl bg-gradient-to-r px-4 py-2 font-medium disabled:opacity-50"
              >
                {submitting ? '...' : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
