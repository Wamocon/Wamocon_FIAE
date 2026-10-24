'use client';

import { useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/authFetch';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  DEFAULT_CATALOG_CODE,
  type OrganizationCatalogEntry,
} from '@/components/admin/catalogAdminApi';

type Props = {
  organizationId: string;
  /** The chosen catalog id, empty when no choice is needed. */
  value: string;
  onChange: (catalogId: string) => void;
};

/**
 * The occupation field of the form that creates a trainee. It only appears
 * when the organization has more than one usable occupation (active on the
 * platform and enabled for the organization). With one occupation the API
 * applies it by itself, so the form stays as it was. While the field is shown
 * an occupation is always chosen, FIAE first (the default occupation).
 * The occupations come from GET /api/admin/organizations/[orgId]/catalogs.
 */
export function NewUserOccupationSelect({
  organizationId,
  value,
  onChange,
}: Props) {
  const { t } = useLanguage();
  const [entries, setEntries] = useState<OrganizationCatalogEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    setEntries([]);
    if (!organizationId) return;
    (async () => {
      try {
        const res = await authFetch(
          `/api/admin/organizations/${organizationId}/catalogs`,
          { cache: 'no-store' }
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setEntries(data.catalogs || []);
      } catch {
        // Without the list the field stays hidden and the default applies
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const usable = useMemo(
    () => entries.filter(entry => entry.isActive && entry.isEnabled),
    [entries]
  );
  const visible = usable.length > 1;
  const defaultId = useMemo(
    () =>
      (usable.find(entry => entry.code === DEFAULT_CATALOG_CODE) ?? usable[0])
        ?.trainingCatalogId ?? '',
    [usable]
  );

  useEffect(() => {
    if (!visible) {
      if (value !== '') onChange('');
      return;
    }
    if (!usable.some(entry => entry.trainingCatalogId === value)) {
      onChange(defaultId);
    }
  }, [visible, usable, value, defaultId, onChange]);

  if (!visible) return null;

  // Right from the first render the field shows an occupation that exists,
  // the effect above reports it to the form
  const selected = usable.some(entry => entry.trainingCatalogId === value)
    ? value
    : defaultId;
  const fieldId = 'new-user-occupation';
  return (
    <div>
      <label
        htmlFor={fieldId}
        className="text-foreground mb-1.5 block text-sm font-medium"
      >
        {t('admin.userCreate.occupation')} *
      </label>
      <select
        id={fieldId}
        value={selected}
        onChange={e => onChange(e.target.value)}
        className="bg-background border-border text-foreground focus:ring-accent w-full rounded-xl border px-4 py-3 focus:ring-2 focus:outline-none"
      >
        {usable.map(entry => (
          <option key={entry.trainingCatalogId} value={entry.trainingCatalogId}>
            {entry.title}
          </option>
        ))}
      </select>
      <p className="text-muted mt-1 text-xs">
        {t('admin.userCreate.occupationHint')}
      </p>
    </div>
  );
}
