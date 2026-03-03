'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  ArrowLeft,
  BookOpen,
  Clock,
  Calendar,
  Layers,
  Save,
  FileText,
  Edit2,
  Eye,
  EyeOff,
} from 'lucide-react';

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

interface Document {
  id: string;
  title: string;
  storageUrl: string;
  documentType: string;
}

export default function TrainerUseCaseDetailPage() {
  const router = useRouter();
  const params = useParams<{ useCaseId: string }>();
  const useCaseId = params?.useCaseId as string;
  const { profile } = useAuth();
  const { t } = useLanguage();

  const [useCase, setUseCase] = useState<UseCase | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit mode
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDurationValue, setEditDurationValue] = useState<string>('');
  const [editDurationUnit, setEditDurationUnit] = useState<string>('DAYS');
  const [editYear, setEditYear] = useState<string[]>([]);
  const [editTrainingStage, setEditTrainingStage] = useState<string[]>([]);
  const [editIsActive, setEditIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      if (!useCaseId) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/trainer/use-cases/${useCaseId}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error('Not found');
        const data = await res.json();
        setUseCase(data.useCase);

        // Initialize edit fields
        setEditTitle(data.useCase.title || '');
        setEditDescription(data.useCase.descriptionText || '');
        setEditDurationValue(data.useCase.durationValue?.toString() || '');
        setEditDurationUnit(data.useCase.durationUnit || 'DAYS');
        setEditYear(
          Array.isArray(data.useCase.year)
            ? data.useCase.year.map(String)
            : data.useCase.year
              ? [String(data.useCase.year)]
              : []
        );
        setEditTrainingStage(
          Array.isArray(data.useCase.trainingStage)
            ? data.useCase.trainingStage.map(String)
            : data.useCase.trainingStage
              ? [String(data.useCase.trainingStage)]
              : []
        );
        setEditIsActive(data.useCase.isActive ?? true);

        // Fetch documents
        try {
          const docRes = await fetch(
            `/api/trainer/use-cases/${useCaseId}/documents`,
            { cache: 'no-store' }
          );
          if (docRes.ok) {
            const docData = await docRes.json();
            setDocuments(docData.documents || []);
          }
        } catch (e) {
          console.error('Error fetching documents', e);
        }
      } catch (e) {
        console.error(e);
        setError('Use Case nicht gefunden');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [useCaseId]);

  const handleSave = async () => {
    if (!profile?.id || !useCase) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/trainer/use-cases/${useCaseId}?trainerId=${profile.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: editTitle,
            descriptionText: editDescription,
            durationValue: editDurationValue
              ? parseInt(editDurationValue)
              : null,
            durationUnit: editDurationUnit || null,
            year: editYear.length > 0 ? editYear.map(Number) : null,
            trainingStage:
              editTrainingStage.length > 0
                ? editTrainingStage.map(Number)
                : null,
            isActive: editIsActive,
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        setUseCase(data.useCase);
        setIsEditing(false);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (error || !useCase) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <p className="text-muted">{error || 'Nicht gefunden'}</p>
        <button
          onClick={() => router.back()}
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
          onClick={() => router.back()}
          className="text-muted hover:text-foreground flex items-center gap-2 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
          <span>{t('common.back')}</span>
        </button>
      </div>

      {/* Use Case Header Card */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="from-accent to-primary shadow-accent/25 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br shadow-lg">
              <BookOpen className="text-primary-foreground h-7 w-7" />
            </div>
            <div className="flex-1">
              {isEditing ? (
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="bg-background/50 border-accent/30 text-foreground focus:ring-accent w-full rounded-xl border px-3 py-2 text-2xl font-bold focus:ring-2 focus:outline-none"
                />
              ) : (
                <h1 className="text-foreground text-2xl font-bold">
                  {useCase.title}
                </h1>
              )}

              {/* Status Badge */}
              <div className="mt-2 flex items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    useCase.isActive
                      ? 'bg-green-500/20 text-green-500'
                      : 'bg-muted/20 text-muted'
                  }`}
                >
                  {useCase.isActive
                    ? t('useCase.active') || 'Aktiv'
                    : t('useCase.inactive') || 'Inaktiv'}
                </span>
                {Array.isArray(useCase.year) &&
                  useCase.year.length > 0 &&
                  useCase.year.map(y => (
                    <span
                      key={y}
                      className="bg-accent/20 text-accent rounded-full px-3 py-1 text-xs font-medium"
                    >
                      {t('content.year')} {y}
                    </span>
                  ))}
                {!Array.isArray(useCase.year) && useCase.year && (
                  <span className="bg-accent/20 text-accent rounded-full px-3 py-1 text-xs font-medium">
                    {t('content.year')} {useCase.year}
                  </span>
                )}
                {Array.isArray(useCase.trainingStage) &&
                  useCase.trainingStage.length > 0 &&
                  useCase.trainingStage.map(s => (
                    <span
                      key={s}
                      className="bg-primary/20 text-primary rounded-full px-3 py-1 text-xs font-medium"
                    >
                      {t('trainer.content.stage' + s) || `Abschnitt ${s}`}
                    </span>
                  ))}
                {!Array.isArray(useCase.trainingStage) &&
                  useCase.trainingStage && (
                    <span className="bg-primary/20 text-primary rounded-full px-3 py-1 text-xs font-medium">
                      {useCase.trainingStage}
                    </span>
                  )}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={() => setIsEditing(false)}
                  className="text-muted hover:text-foreground rounded-xl px-4 py-2 transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="from-accent to-primary text-primary-foreground flex items-center gap-2 rounded-xl bg-gradient-to-r px-4 py-2 font-medium disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {saving ? '...' : t('common.save')}
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="bg-accent/10 text-accent hover:bg-accent/20 flex items-center gap-2 rounded-xl px-4 py-2 transition-colors"
              >
                <Edit2 className="h-4 w-4" />
                {t('common.edit')}
              </button>
            )}
          </div>
        </div>

        {/* Description */}
        <div className="mt-6">
          <label className="text-muted mb-2 block text-sm font-medium">
            {t('useCase.description') || 'Beschreibung'}
          </label>
          {isEditing ? (
            <textarea
              value={editDescription}
              onChange={e => setEditDescription(e.target.value)}
              rows={4}
              className="bg-background/50 border-accent/30 text-foreground focus:ring-accent w-full resize-none rounded-xl border px-4 py-3 focus:ring-2 focus:outline-none"
              placeholder={
                t('useCase.descriptionPlaceholder') ||
                'Beschreibung eingeben...'
              }
            />
          ) : (
            <p className="text-foreground bg-muted/10 rounded-xl p-4">
              {useCase.descriptionText || (
                <span className="text-muted italic">
                  {t('useCase.noDescription') || 'Keine Beschreibung'}
                </span>
              )}
            </p>
          )}
        </div>

        {/* Metadata Grid */}
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Duration */}
          <div className="bg-muted/10 rounded-xl p-4">
            <div className="text-muted mb-2 flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span className="text-sm font-medium">
                {t('useCase.duration') || 'Dauer'}
              </span>
            </div>
            {isEditing ? (
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  value={editDurationValue}
                  onChange={e => setEditDurationValue(e.target.value)}
                  className="bg-background/50 border-accent/30 text-foreground w-20 rounded-lg border px-3 py-2 text-sm"
                  placeholder="0"
                />
                <select
                  value={editDurationUnit}
                  onChange={e => setEditDurationUnit(e.target.value)}
                  className="bg-background/50 border-accent/30 text-foreground flex-1 rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="DAYS">{t('useCase.days') || 'Tage'}</option>
                  <option value="WEEKS">
                    {t('useCase.weeks') || 'Wochen'}
                  </option>
                </select>
              </div>
            ) : (
              <p className="text-foreground font-medium">
                {useCase.durationValue
                  ? `${useCase.durationValue} ${useCase.durationUnit === 'WEEKS' ? t('useCase.weeks') || 'Wochen' : t('useCase.days') || 'Tage'}`
                  : '-'}
              </p>
            )}
          </div>

          {/* Year */}
          <div className="bg-muted/10 rounded-xl p-4">
            <div className="text-muted mb-2 flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span className="text-sm font-medium">
                {t('content.year') || 'Lehrjahr'}
              </span>
            </div>
            {isEditing ? (
              <div className="flex flex-wrap gap-3">
                {(['1', '2', '3'] as const).map(yr => (
                  <label
                    key={yr}
                    className="flex cursor-pointer items-center gap-2"
                  >
                    <input
                      type="checkbox"
                      checked={editYear.includes(yr)}
                      onChange={e => {
                        if (e.target.checked)
                          setEditYear(prev => [...prev, yr]);
                        else setEditYear(prev => prev.filter(x => x !== yr));
                      }}
                      className="border-accent/30 text-accent rounded"
                    />
                    <span className="text-sm">
                      {t('content.year') || 'Jahr'} {yr}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-foreground font-medium">
                {Array.isArray(useCase.year) && useCase.year.length > 0
                  ? useCase.year
                      .map(y => `${t('content.year') || 'Jahr'} ${y}`)
                      .join(', ')
                  : useCase.year
                    ? `${t('content.year') || 'Jahr'} ${useCase.year}`
                    : '-'}
              </p>
            )}
          </div>

          {/* Active Status */}
          <div className="bg-muted/10 rounded-xl p-4">
            <div className="text-muted mb-2 flex items-center gap-2">
              {editIsActive ? (
                <Eye className="h-4 w-4" />
              ) : (
                <EyeOff className="h-4 w-4" />
              )}
              <span className="text-sm font-medium">
                {t('useCase.status') || 'Status'}
              </span>
            </div>
            {isEditing ? (
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={editIsActive}
                  onChange={e => setEditIsActive(e.target.checked)}
                  className="border-accent/30 text-accent focus:ring-accent h-5 w-5 rounded"
                />
                <span className="text-foreground text-sm">
                  {editIsActive
                    ? t('useCase.active') || 'Aktiv'
                    : t('useCase.inactive') || 'Inaktiv'}
                </span>
              </label>
            ) : (
              <p
                className={`font-medium ${useCase.isActive ? 'text-green-500' : 'text-muted'}`}
              >
                {useCase.isActive
                  ? t('useCase.active') || 'Aktiv'
                  : t('useCase.inactive') || 'Inaktiv'}
              </p>
            )}
          </div>
        </div>

        {/* Lernfelder */}
        {useCase.lernfelder && useCase.lernfelder.length > 0 && (
          <div className="mt-6">
            <div className="text-muted mb-3 flex items-center gap-2">
              <Layers className="h-4 w-4" />
              <span className="text-sm font-medium">
                {t('lernfelder.title') || 'Lernfelder'}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {useCase.lernfelder.map(lf => (
                <span
                  key={lf}
                  className="bg-accent/20 text-accent rounded-full px-3 py-1.5 text-sm font-medium"
                >
                  {lf}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Documents Section */}
      {documents.length > 0 && (
        <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
          <div className="mb-4 flex items-center gap-3">
            <FileText className="text-accent h-5 w-5" />
            <h2 className="text-foreground text-xl font-semibold">
              {t('useCase.documents') || 'Dokumente'} ({documents.length})
            </h2>
          </div>
          <div className="space-y-2">
            {documents.map(doc => (
              <a
                key={doc.id}
                href={doc.storageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-muted/20 hover:bg-muted/30 border-accent/10 flex items-center justify-between rounded-xl border p-3 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <FileText className="text-accent h-5 w-5" />
                  <span className="text-foreground">{doc.title}</span>
                </div>
                <span className="text-muted bg-accent/10 rounded-full px-2 py-1 text-xs">
                  {doc.documentType}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
