'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, X } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  catalogErrorMessage,
  type OrganizationCatalogEntry,
  type TraineeEnrollmentResponse,
} from '@/components/admin/catalogAdminApi';

type Props = {
  trainee: { id: string; name: string; organizationId: string | null };
  onClose: () => void;
  /** Called after the occupation was saved. */
  onSaved?: () => void;
};

/**
 * Platform admin only: set the occupation of one trainee. Only occupations that
 * are active and enabled for the organization of the trainee are offered. A
 * change removes the old enrollment, so the elective components the trainee
 * chose lapse, which the dialog says before saving.
 */
export function TraineeEnrollmentDialog({ trainee, onClose, onSaved }: Props) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState<TraineeEnrollmentResponse | null>(
    null
  );
  const [options, setOptions] = useState<OrganizationCatalogEntry[]>([]);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const enrollmentRes = await authFetch(
          `/api/admin/users/${trainee.id}/enrollment`,
          { cache: 'no-store' }
        );
        if (!enrollmentRes.ok) {
          throw new Error(
            await catalogErrorMessage(
              enrollmentRes,
              t,
              'admin.catalogs.enrollment.loadFailed'
            )
          );
        }
        const enrollment: TraineeEnrollmentResponse =
          await enrollmentRes.json();

        let usable: OrganizationCatalogEntry[] = [];
        if (trainee.organizationId) {
          const catalogsRes = await authFetch(
            `/api/admin/organizations/${trainee.organizationId}/catalogs`,
            { cache: 'no-store' }
          );
          if (!catalogsRes.ok) {
            throw new Error(t('admin.catalogs.enrollment.loadFailed'));
          }
          const data = await catalogsRes.json();
          usable = (data.catalogs || []).filter(
            (c: OrganizationCatalogEntry) => c.isActive && c.isEnabled
          );
        }
        if (cancelled) return;
        setCurrent(enrollment);
        setOptions(usable);
        // Start on the current occupation, or on the first offer if the
        // current one is no longer enabled for the organization
        setSelected(
          usable.some(
            o => o.trainingCatalogId === enrollment.effectiveCatalogId
          )
            ? enrollment.effectiveCatalogId
            : (usable[0]?.trainingCatalogId ?? '')
        );
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || t('admin.catalogs.enrollment.loadFailed'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [trainee.id, trainee.organizationId, t]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await authFetch(`/api/admin/users/${trainee.id}/enrollment`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalogId: selected }),
      });
      if (!res.ok) {
        throw new Error(
          await catalogErrorMessage(
            res,
            t,
            'admin.catalogs.enrollment.saveFailed'
          )
        );
      }
      const data: TraineeEnrollmentResponse = await res.json();
      toast.success(
        data.changed === false
          ? t('admin.catalogs.enrollment.unchanged')
          : t('admin.catalogs.enrollment.saved')
      );
      onSaved?.();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || t('admin.catalogs.enrollment.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const currentCatalog = options.find(
    o => o.trainingCatalogId === current?.effectiveCatalogId
  );
  const currentLabel =
    current?.enrollment?.title ?? currentCatalog?.title ?? 'FIAE';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="enrollment-dialog-title"
    >
      <div className="glass-effect border-accent/30 bg-background w-full max-w-lg rounded-3xl border p-8 shadow-lg">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2
              id="enrollment-dialog-title"
              className="text-foreground text-xl font-bold"
            >
              {t('admin.catalogs.enrollment.title')}
            </h2>
            <p className="text-muted text-sm">{trainee.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading && (
          <div className="flex justify-center py-6">
            <LoadingSpinner size="md" />
          </div>
        )}
        {error && <div className="text-sm text-red-500">{error}</div>}

        {!loading && !error && current && (
          <div className="space-y-5">
            <div>
              <div className="text-muted text-xs">
                {t('admin.catalogs.enrollment.current')}
              </div>
              <div className="text-foreground font-medium">
                {currentLabel}
                {current.isImplicit && (
                  <span className="text-muted ml-2 text-xs font-normal">
                    {t('admin.catalogs.enrollment.implicit')}
                  </span>
                )}
              </div>
            </div>

            {options.length === 0 ? (
              <p className="text-muted text-sm">
                {t('admin.catalogs.enrollment.noOptions')}
              </p>
            ) : (
              <div>
                <label
                  htmlFor="enrollment-catalog"
                  className="text-foreground mb-1.5 block text-sm font-medium"
                >
                  {t('admin.catalogs.enrollment.select')}
                </label>
                <select
                  id="enrollment-catalog"
                  value={selected}
                  onChange={e => setSelected(e.target.value)}
                  className="bg-background border-border text-foreground focus:ring-accent w-full rounded-xl border px-4 py-3 focus:ring-2 focus:outline-none"
                >
                  {options.map(o => (
                    <option
                      key={o.trainingCatalogId}
                      value={o.trainingCatalogId}
                    >
                      {o.title} ({o.code})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-600">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{t('admin.catalogs.enrollment.warning')}</p>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-muted hover:text-foreground rounded-xl px-5 py-2.5 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={
              saving ||
              loading ||
              !!error ||
              !selected ||
              options.length === 0 ||
              selected === current?.effectiveCatalogId
            }
            className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-xl px-6 py-2.5 font-medium transition-colors disabled:opacity-50"
          >
            {saving ? t('common.saving') : t('admin.catalogs.enrollment.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
