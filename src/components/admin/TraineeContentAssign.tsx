'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import toast from 'react-hot-toast';
import { authFetch } from '@/lib/authFetch';
import { useLanguage } from '@/contexts/LanguageContext';
import type { OrganizationCatalogEntry } from '@/components/admin/catalogAdminApi';

type SyncResult = {
  dryRun: boolean;
  trainees: number;
  traineesChanged: number;
  skippedNoOrganization: number;
  courseMembersMissing: number;
  quizAssignmentsMissing: number;
  courseMembersAdded: number;
  quizAssignmentsAdded: number;
};

type Props = {
  organizationId: string;
  /** The platform admin works on one organization at a time, an org admin only has their own. */
  refreshKey?: number;
};

/**
 * "Assign the trainees of this organization to the courses of the occupation".
 * One row per occupation that is enabled and active for the organization, with
 * a trial run (counts only) and then the assignment. The assignment only adds
 * (course members and global quiz assignments of the phase plan), it never
 * removes anything. The route limits an organization admin to the own
 * organization, this component only offers the action.
 */
export function TraineeContentAssign({
  organizationId,
  refreshKey = 0,
}: Props) {
  const { t } = useLanguage();
  const id = useId();
  const [catalogs, setCatalogs] = useState<OrganizationCatalogEntry[] | null>(
    null
  );
  const [open, setOpen] = useState<string | null>(null);
  const [trial, setTrial] = useState<SyncResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(
        `/api/admin/organizations/${organizationId}/catalogs`,
        { cache: 'no-store' }
      );
      if (!res.ok) throw new Error('load');
      const data = await res.json();
      setCatalogs(
        ((data.catalogs || []) as OrganizationCatalogEntry[]).filter(
          c => c.isEnabled && c.isActive
        )
      );
    } catch {
      setCatalogs([]);
    }
  }, [organizationId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const run = async (catalogId: string, execute: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(
        `/api/admin/catalogs/${catalogId}/trainee-content`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ execute, organizationId }),
        }
      );
      if (!res.ok) throw new Error('run');
      const result = (await res.json()) as SyncResult;
      if (execute) {
        toast.success(
          t('traineeContent.done', {
            courses: result.courseMembersAdded,
            quizzes: result.quizAssignmentsAdded,
          })
        );
        setTrial(null);
        setOpen(null);
      } else {
        setTrial(result);
      }
    } catch {
      setError(t('traineeContent.failed'));
    } finally {
      setBusy(false);
    }
  };

  if (!catalogs || catalogs.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="text-muted mb-2 text-xs">{t('traineeContent.title')}</div>
      <ul className="space-y-2">
        {catalogs.map(entry => {
          const panelId = `${id}-${entry.trainingCatalogId}`;
          const isOpen = open === entry.trainingCatalogId;
          return (
            <li
              key={entry.trainingCatalogId}
              className="bg-background/50 rounded-xl px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-foreground text-sm">
                  {entry.title}{' '}
                  <span className="bg-accent/10 rounded-full px-2 py-0.5 text-xs">
                    {entry.code}
                  </span>
                </span>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => {
                    setOpen(isOpen ? null : entry.trainingCatalogId);
                    setTrial(null);
                    setError(null);
                  }}
                  className="text-foreground hover:bg-accent/10 border-border focus-visible:ring-accent min-h-[44px] rounded-xl border px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
                >
                  {t('traineeContent.open')}
                </button>
              </div>
              {isOpen && (
                <div id={panelId} className="mt-3 text-sm">
                  <p className="text-muted">{t('traineeContent.hint')}</p>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => run(entry.trainingCatalogId, false)}
                      disabled={busy}
                      className="text-foreground hover:bg-accent/10 border-border focus-visible:ring-accent min-h-[44px] rounded-xl border px-4 py-2 font-medium focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                    >
                      {t('traineeContent.trial')}
                    </button>
                  </div>
                  {trial && (
                    <div role="status" className="mt-3">
                      <p className="text-foreground">
                        {t('traineeContent.trialResult', {
                          trainees: trial.trainees,
                          changed: trial.traineesChanged,
                          courses: trial.courseMembersMissing,
                          quizzes: trial.quizAssignmentsMissing,
                        })}
                      </p>
                      {trial.skippedNoOrganization > 0 && (
                        <p className="mt-1 text-amber-700 dark:text-amber-400">
                          {t('traineeContent.skipped', {
                            count: trial.skippedNoOrganization,
                          })}
                        </p>
                      )}
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => run(entry.trainingCatalogId, true)}
                          disabled={
                            busy ||
                            trial.courseMembersMissing +
                              trial.quizAssignmentsMissing ===
                              0
                          }
                          className="min-h-[44px] rounded-xl bg-green-700 px-5 py-2 font-medium text-white hover:bg-green-800 focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:outline-none disabled:opacity-50"
                        >
                          {t('traineeContent.run')}
                        </button>
                      </div>
                    </div>
                  )}
                  <div
                    role="alert"
                    className="mt-2 text-red-700 dark:text-red-400"
                  >
                    {error}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
