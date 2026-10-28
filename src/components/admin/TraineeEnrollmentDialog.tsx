'use client';

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, X } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  catalogErrorMessage,
  type OrganizationCatalogEntry,
  type TraineeEnrollmentItem,
  type TraineeEnrollmentResponse,
} from '@/components/admin/catalogAdminApi';

type Props = {
  trainee: { id: string; name: string; organizationId: string | null };
  onClose: () => void;
  /** Called after a training was added or removed. */
  onSaved?: () => void;
};

/** yyyy-mm-dd as dd.mm.yyyy, anything else as it is. */
function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

/**
 * Platform admin only: the trainings (occupations) of one trainee. A trainee
 * can be enrolled in several, also at the same time. The dialog lists all of
 * them, adds one more (only occupations that are active, enabled for the
 * organization of the trainee and not yet in the list) and removes one, which
 * has to be confirmed. Adding does not change the other trainings. Removing
 * deletes the enrollment only: the elective components chosen for it lapse,
 * course and quiz assignments and submissions stay, which the dialog says.
 * The last training cannot be removed.
 */
export function TraineeEnrollmentDialog({ trainee, onClose, onSaved }: Props) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<TraineeEnrollmentResponse | null>(
    null
  );
  const [offered, setOffered] = useState<OrganizationCatalogEntry[]>([]);
  const [selected, setSelected] = useState('');
  const [startDate, setStartDate] = useState('');
  const [durationYears, setDurationYears] = useState('');
  const [confirming, setConfirming] = useState<TraineeEnrollmentItem | null>(
    null
  );

  const enrollments = useMemo(() => current?.enrollments ?? [], [current]);
  // A trainee without a row works in FIAE by default, FIAE can be added as a
  // real enrollment like any other
  const options = useMemo(() => {
    const enrolledIds = new Set(enrollments.map(e => e.trainingCatalogId));
    return offered.filter(o => !enrolledIds.has(o.trainingCatalogId));
  }, [offered, enrollments]);

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
        setOffered(usable);
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

  // Keep the choice on an offer that is still there
  useEffect(() => {
    if (!options.some(o => o.trainingCatalogId === selected)) {
      setSelected(options[0]?.trainingCatalogId ?? '');
    }
  }, [options, selected]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      // The open question is closed first, the dialog with the next key
      if (confirming) setConfirming(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy, confirming]);

  const add = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { catalogId: selected };
      if (startDate) body.startDate = startDate;
      if (durationYears) body.durationYears = Number(durationYears);
      const res = await authFetch(`/api/admin/users/${trainee.id}/enrollment`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
      setCurrent(data);
      setStartDate('');
      setDurationYears('');
      if (data.changed === false) {
        toast.success(t('admin.catalogs.enrollment.unchanged'));
      } else {
        toast.success(t('admin.catalogs.enrollment.saved'));
        onSaved?.();
      }
    } catch (e: any) {
      toast.error(e?.message || t('admin.catalogs.enrollment.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: TraineeEnrollmentItem) => {
    setBusy(true);
    try {
      const res = await authFetch(`/api/admin/users/${trainee.id}/enrollment`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          catalogId: item.trainingCatalogId,
          confirm: true,
        }),
      });
      if (!res.ok) {
        throw new Error(
          await catalogErrorMessage(
            res,
            t,
            'admin.catalogs.enrollment.removeFailed'
          )
        );
      }
      const data: TraineeEnrollmentResponse = await res.json();
      setCurrent(data);
      setConfirming(null);
      toast.success(t('admin.catalogs.enrollment.removed'));
      onSaved?.();
    } catch (e: any) {
      toast.error(e?.message || t('admin.catalogs.enrollment.removeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const termsText = (item: TraineeEnrollmentItem) =>
    t('admin.catalogs.enrollment.terms', {
      start: item.startDate
        ? formatDate(item.startDate)
        : t('admin.catalogs.enrollment.startOpen'),
      years: item.durationYears,
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="enrollment-dialog-title"
    >
      <div className="glass-effect border-accent/30 bg-background max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border p-8 shadow-lg">
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
            disabled={busy}
            aria-label={t('common.close')}
            className="text-muted hover:text-foreground disabled:opacity-50"
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
              <div className="text-muted mb-2 text-xs">
                {t('admin.catalogs.enrollment.current')}
              </div>
              {current.isImplicit ? (
                <div className="text-foreground font-medium">
                  FIAE
                  <span className="text-muted ml-2 text-xs font-normal">
                    {t('admin.catalogs.enrollment.implicit')}
                  </span>
                </div>
              ) : (
                <ul
                  aria-label={t('admin.catalogs.enrollment.current')}
                  className="space-y-2"
                >
                  {enrollments.map((item, index) => {
                    const isLast = enrollments.length < 2;
                    return (
                      <li
                        key={item.id}
                        className="bg-background/50 rounded-xl px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-foreground text-sm font-medium">
                              {item.title}
                              <span className="bg-accent/10 ml-2 rounded-full px-2 py-0.5 text-xs font-normal">
                                {item.code}
                              </span>
                              {index === 0 && (
                                <span className="text-muted ml-2 text-xs font-normal">
                                  {t('admin.catalogs.enrollment.primary')}
                                </span>
                              )}
                            </div>
                            <div className="text-muted text-xs">
                              {termsText(item)}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              if (!isLast) setConfirming(item);
                            }}
                            disabled={busy}
                            aria-disabled={isLast}
                            aria-label={`${t('admin.catalogs.enrollment.remove')}: ${item.title}`}
                            aria-describedby={
                              isLast ? `${item.id}-last` : undefined
                            }
                            title={
                              isLast
                                ? t('admin.catalogs.enrollment.removeLast')
                                : undefined
                            }
                            className={`rounded-lg px-3 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-40 ${
                              isLast ? 'cursor-not-allowed opacity-40' : ''
                            }`}
                          >
                            {t('admin.catalogs.enrollment.remove')}
                          </button>
                          {isLast && (
                            <span id={`${item.id}-last`} className="sr-only">
                              {t('admin.catalogs.enrollment.removeLast')}
                            </span>
                          )}
                        </div>
                        {confirming?.id === item.id && (
                          <div
                            role="group"
                            aria-label={t('admin.catalogs.enrollment.remove')}
                            className="mt-3 space-y-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500"
                          >
                            <p>
                              {t('admin.catalogs.enrollment.removeConfirm', {
                                name: item.title,
                              })}
                            </p>
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setConfirming(null)}
                                disabled={busy}
                                className="text-muted hover:text-foreground rounded-lg px-3 py-1.5 text-xs"
                              >
                                {t('common.cancel')}
                              </button>
                              <button
                                type="button"
                                onClick={() => remove(item)}
                                disabled={busy}
                                className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                              >
                                {t('admin.catalogs.enrollment.removeYes')}
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {options.length === 0 ? (
              <p className="text-muted text-sm">
                {offered.length === 0
                  ? t('admin.catalogs.enrollment.noOptions')
                  : t('admin.catalogs.enrollment.allEnrolled')}
              </p>
            ) : (
              <div className="space-y-3">
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
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="enrollment-start"
                      className="text-foreground mb-1.5 block text-sm font-medium"
                    >
                      {t('admin.catalogs.enrollment.startDate')}
                    </label>
                    <input
                      id="enrollment-start"
                      type="date"
                      value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                      className="bg-background border-border text-foreground focus:ring-accent w-full rounded-xl border px-4 py-3 focus:ring-2 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="enrollment-duration"
                      className="text-foreground mb-1.5 block text-sm font-medium"
                    >
                      {t('admin.catalogs.enrollment.duration')}
                    </label>
                    <select
                      id="enrollment-duration"
                      value={durationYears}
                      onChange={e => setDurationYears(e.target.value)}
                      className="bg-background border-border text-foreground focus:ring-accent w-full rounded-xl border px-4 py-3 focus:ring-2 focus:outline-none"
                    >
                      <option value="">
                        {t('admin.catalogs.enrollment.durationProfile')}
                      </option>
                      <option value="2">
                        {t('admin.catalogs.enrollment.years', { count: 2 })}
                      </option>
                      <option value="3">
                        {t('admin.catalogs.enrollment.years', { count: 3 })}
                      </option>
                    </select>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={add}
                    disabled={busy || !selected}
                    className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-xl px-6 py-2.5 font-medium transition-colors disabled:opacity-50"
                  >
                    {busy
                      ? t('common.saving')
                      : t('admin.catalogs.enrollment.save')}
                  </button>
                </div>
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
            disabled={busy}
            className="text-muted hover:text-foreground rounded-xl px-5 py-2.5 transition-colors"
          >
            {t('common.done')}
          </button>
        </div>
      </div>
    </div>
  );
}
