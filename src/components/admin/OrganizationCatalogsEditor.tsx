'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { authFetch } from '@/lib/authFetch';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  catalogErrorMessage,
  type OrganizationCatalogEntry,
} from '@/components/admin/catalogAdminApi';

type Props = {
  organizationId: string;
  /** Change it to reload, for example after a catalog was switched on or off. */
  refreshKey?: number;
};

/**
 * Platform admin only: which training catalogs an organization may use. The
 * API refuses to switch off the last enabled catalog or one with enrolled
 * trainees (409), the reason is shown as a message.
 */
export function OrganizationCatalogsEditor({
  organizationId,
  refreshKey = 0,
}: Props) {
  const { t } = useLanguage();
  const [catalogs, setCatalogs] = useState<OrganizationCatalogEntry[] | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(
        `/api/admin/organizations/${organizationId}/catalogs`,
        { cache: 'no-store' }
      );
      if (!res.ok) throw new Error(t('admin.catalogs.loadFailed'));
      const data = await res.json();
      setCatalogs(data.catalogs || []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || t('error.unknown'));
    }
  }, [organizationId, t]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const toggle = async (entry: OrganizationCatalogEntry) => {
    setBusyId(entry.trainingCatalogId);
    try {
      const res = await authFetch(
        `/api/admin/organizations/${organizationId}/catalogs`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            catalogId: entry.trainingCatalogId,
            isEnabled: !entry.isEnabled,
          }),
        }
      );
      if (!res.ok) {
        throw new Error(
          await catalogErrorMessage(res, t, 'admin.catalogs.updateFailed')
        );
      }
      const data = await res.json();
      setCatalogs(data.catalogs || []);
      toast.success(t('admin.catalogs.orgUpdated'));
    } catch (e: any) {
      toast.error(e?.message || t('admin.catalogs.updateFailed'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mb-4">
      <div className="text-muted mb-2 text-xs">
        {t('admin.catalogs.orgTitle')}
      </div>
      {error && <div className="text-xs text-red-500">{error}</div>}
      <ul className="space-y-2">
        {(catalogs ?? []).map(entry => {
          const inputId = `org-${organizationId}-catalog-${entry.trainingCatalogId}`;
          return (
            <li
              key={entry.trainingCatalogId}
              className="bg-background/50 flex items-center justify-between gap-3 rounded-xl px-3 py-2"
            >
              <label
                htmlFor={inputId}
                className="text-foreground flex cursor-pointer items-center gap-2 text-sm"
              >
                <input
                  id={inputId}
                  type="checkbox"
                  checked={entry.isEnabled}
                  disabled={busyId !== null}
                  onChange={() => toggle(entry)}
                  className="accent-accent h-4 w-4 rounded"
                />
                <span>{entry.title}</span>
                <span className="bg-accent/10 rounded-full px-2 py-0.5 text-xs">
                  {entry.code}
                </span>
              </label>
              <span className="text-muted text-xs">
                {!entry.isActive && (
                  <span className="mr-2 text-amber-500">
                    {t('admin.catalogs.notActiveHint')}
                  </span>
                )}
                {t('admin.catalogs.trainees', { count: entry.traineeCount })}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
