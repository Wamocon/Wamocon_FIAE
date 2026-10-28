'use client';

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { ListOrdered } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { useLanguage } from '@/contexts/LanguageContext';

type Props = {
  catalogId: string;
};

/**
 * Platform admin only: the cut-off date of the order of work of one training
 * catalog (PUT .../sequence-rule). From this date on, a trainee who joins the
 * catalog works through the enablers of a course one after the other, trainees
 * who joined earlier work as before. Without a date the order is not switched
 * on. The date is set by hand here, never by a job. The route checks the right
 * and the value again.
 */
export function SequenceRulePanel({ catalogId }: Props) {
  const { t, language } = useLanguage();
  const id = useId();
  const [since, setSince] = useState<string | null | undefined>(undefined);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const url = `/api/admin/catalogs/${catalogId}/sequence-rule`;

  const load = useCallback(async () => {
    try {
      const res = await authFetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('load');
      const body = (await res.json()) as { since: string | null };
      setSince(body.since);
      setValue(body.since ? body.since.slice(0, 10) : '');
    } catch {
      setSince(undefined);
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async (next: string | null) => {
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ since: next }),
      });
      if (!res.ok) throw new Error('save');
      const body = (await res.json()) as { since: string | null };
      setSince(body.since);
      setValue(body.since ? body.since.slice(0, 10) : '');
      toast.success(
        next === null ? t('sequenceRule.removed') : t('sequenceRule.saved')
      );
    } catch {
      setError(t('sequenceRule.failed'));
    } finally {
      setSaving(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      setError(t('sequenceRule.invalid'));
      return;
    }
    void send(value);
  };

  const formatted = since
    ? new Date(since).toLocaleDateString(language, { timeZone: 'UTC' })
    : null;

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby={`${id}-title`}
      className="bg-background/60 border-border mt-4 rounded-2xl border p-4"
    >
      <h3
        id={`${id}-title`}
        className="text-foreground flex items-center gap-2 font-semibold"
      >
        <ListOrdered className="h-4 w-4" aria-hidden="true" />
        {t('sequenceRule.title')}
      </h3>
      <p className="text-muted mt-1 text-sm">{t('sequenceRule.hint')}</p>
      <p className="text-foreground mt-2 text-sm font-medium" role="status">
        {since === undefined
          ? ''
          : formatted
            ? t('sequenceRule.current', { date: formatted })
            : t('sequenceRule.notSet')}
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor={`${id}-date`}
            className="text-foreground mb-1 block text-sm font-medium"
          >
            {t('sequenceRule.dateLabel')}
          </label>
          <input
            id={`${id}-date`}
            type="date"
            value={value}
            onChange={e => setValue(e.target.value)}
            disabled={saving}
            aria-invalid={error === t('sequenceRule.invalid')}
            className="bg-background border-border text-foreground focus:ring-accent min-h-[44px] rounded-xl border px-3 py-2 focus:ring-2 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="min-h-[44px] rounded-xl bg-red-700 px-5 py-2 font-medium text-white transition-colors hover:bg-red-800 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none disabled:opacity-50"
        >
          {t('sequenceRule.save')}
        </button>
        {since && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void send(null)}
            className="text-foreground hover:bg-accent/10 border-border focus-visible:ring-accent min-h-[44px] rounded-xl border px-4 py-2 transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
          >
            {t('sequenceRule.remove')}
          </button>
        )}
      </div>
      <div role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
        {error}
      </div>
    </form>
  );
}
