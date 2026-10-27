'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { authFetch } from '@/lib/authFetch';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  CONTENT_METRICS,
  CONTENT_TARGET_MAX,
  type CatalogContentStats,
  type ContentMetricId,
} from '@/lib/catalog/content-targets';

type Props = {
  catalog: CatalogContentStats;
  /** Called after the targets were saved, so the statistics reload. */
  onSaved: () => void;
  /** Called to close the form without saving. */
  onClose: () => void;
};

const WHOLE_NUMBER = /^\d+$/;

/**
 * Platform admin only: the targets (Soll) of one training catalog. One field per
 * kind of content, a whole number from 0 to 100000, an empty field means "no
 * target". Saving replaces the whole set (PUT .../content-targets). The route
 * checks the right and the values again, this form only helps to get them
 * right.
 */
export function ContentTargetsForm({ catalog, onSaved, onClose }: Props) {
  const { t } = useLanguage();
  const formId = useId();
  const firstRef = useRef<HTMLInputElement | null>(null);
  const [values, setValues] = useState<Record<ContentMetricId, string>>(() => {
    const initial = {} as Record<ContentMetricId, string>;
    for (const id of CONTENT_METRICS) {
      const target = catalog.metrics.find(m => m.id === id)?.target;
      initial[id] = target === null || target === undefined ? '' : String(target);
    }
    return initial;
  });
  const [errors, setErrors] = useState<ContentMetricId[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The keyboard user lands in the form that was just opened
  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const label = (id: ContentMetricId) => t(`contentStats.metric.${id}`);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const invalid = CONTENT_METRICS.filter(id => {
      const text = values[id].trim();
      return (
        text !== '' &&
        (!WHOLE_NUMBER.test(text) || Number(text) > CONTENT_TARGET_MAX)
      );
    });
    setErrors(invalid);
    setFailure(null);
    if (invalid.length > 0) return;

    const targets: Record<string, number | null> = {};
    for (const id of CONTENT_METRICS) {
      const text = values[id].trim();
      targets[id] = text === '' ? null : Number(text);
    }
    setSaving(true);
    try {
      const res = await authFetch(
        `/api/admin/catalogs/${catalog.catalogId}/content-targets`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targets }),
        }
      );
      if (!res.ok) {
        let code: unknown = null;
        try {
          code = (await res.json())?.code;
        } catch {
          code = null;
        }
        throw new Error(
          code === 'CATALOG_NOT_FOUND'
            ? t('contentStats.form.catalogNotFound')
            : t('contentStats.form.saveFailed')
        );
      }
      toast.success(t('contentStats.form.saved'));
      onSaved();
    } catch (e: unknown) {
      setFailure(
        e instanceof Error ? e.message : t('contentStats.form.saveFailed')
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby={`${formId}-title`}
      className="bg-background/60 border-border mt-4 rounded-2xl border p-4"
    >
      <h3 id={`${formId}-title`} className="text-foreground font-semibold">
        {t('contentStats.form.title', { name: catalog.title })}
      </h3>
      <p id={`${formId}-hint`} className="text-muted mt-1 text-sm">
        {t('contentStats.form.hint')}
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CONTENT_METRICS.map((id, index) => {
          const inputId = `${formId}-${id}`;
          const hasError = errors.includes(id);
          return (
            <div key={id}>
              <label
                htmlFor={inputId}
                className="text-foreground mb-1 block text-sm font-medium"
              >
                {label(id)}
              </label>
              <input
                id={inputId}
                ref={index === 0 ? firstRef : undefined}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={values[id]}
                onChange={e => {
                  const next = e.target.value;
                  setValues(v => ({ ...v, [id]: next }));
                }}
                aria-invalid={hasError}
                aria-describedby={`${formId}-hint${hasError ? ` ${inputId}-error` : ''}`}
                className="bg-background border-border text-foreground focus:ring-accent aria-[invalid=true]:border-red-600 w-full rounded-xl border px-3 py-2 tabular-nums focus:outline-none focus:ring-2"
              />
              {hasError && (
                <p
                  id={`${inputId}-error`}
                  className="mt-1 text-sm text-red-700 dark:text-red-400"
                >
                  {t('contentStats.form.invalid', { label: label(id) })}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
        {errors.length > 0 && !failure
          ? t('contentStats.form.invalid', { label: label(errors[0]) })
          : failure}
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="text-muted hover:text-foreground rounded-xl px-4 py-2 transition-colors"
        >
          {t('contentStats.form.cancel')}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-xl px-5 py-2 font-medium transition-colors disabled:opacity-50"
        >
          {saving ? t('contentStats.form.saving') : t('contentStats.form.save')}
        </button>
      </div>
    </form>
  );
}
