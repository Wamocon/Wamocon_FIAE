'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import toast from 'react-hot-toast';
import { authFetch } from '@/lib/authFetch';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

type Counts = {
  courses: number;
  enablers: number;
  useCases: number;
  lessonQuizzes: number;
  globalQuizzes: number;
};

type RunResult = {
  mode: 'release' | 'lock';
  dryRun: boolean;
  changes: Counts;
  total: Counts;
  active: Counts;
  catalogActive: boolean;
  logged: boolean;
};

/** The numbers of the catalog, taken from a trial run (it writes nothing). */
type Overview = Pick<RunResult, 'total' | 'active' | 'catalogActive'>;

const KINDS: (keyof Counts)[] = [
  'courses',
  'enablers',
  'useCases',
  'lessonQuizzes',
  'globalQuizzes',
];

type Props = {
  catalogId: string;
  catalogCode: string;
  onClose: () => void;
};

/**
 * Platform admin only: release or lock the content of one training catalog
 * (courses, enablers, use cases, quizzes) in one step. The flow is always: look
 * at the numbers, trial run (counts what would change, writes nothing), type the
 * code of the catalog, run. A mode change or a typo resets the confirmation.
 * The route checks the right and the typed code again.
 */
export function ContentReleasePanel({
  catalogId,
  catalogCode,
  onClose,
}: Props) {
  const { t } = useLanguage();
  const id = useId();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [mode, setMode] = useState<'release' | 'lock'>('release');
  const [trial, setTrial] = useState<RunResult | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/admin/catalogs/${catalogId}/content-release`;

  const load = useCallback(async () => {
    try {
      const res = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'release', execute: false }),
      });
      if (!res.ok) throw new Error('load');
      setOverview((await res.json()) as Overview);
      setError(null);
    } catch {
      setError(t('contentRelease.loadFailed'));
    }
  }, [url, t]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (execute: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          execute,
          ...(execute ? { confirmCode: typed } : {}),
        }),
      });
      if (!res.ok) {
        let code: unknown = null;
        try {
          code = (await res.json())?.code;
        } catch {
          code = null;
        }
        throw new Error(
          code === 'CONFIRMATION_MISMATCH'
            ? t('contentRelease.mismatch')
            : code === 'DEFAULT_CATALOG_PROTECTED'
              ? t('contentRelease.defaultProtected')
              : t('contentRelease.runFailed')
        );
      }
      const result = (await res.json()) as RunResult;
      if (execute) {
        if (!result.logged) toast.error(t('contentRelease.notLogged'));
        toast.success(
          t(
            mode === 'release'
              ? 'contentRelease.released'
              : 'contentRelease.locked'
          )
        );
        setTrial(null);
        setTyped('');
        await load();
      } else {
        setTrial(result);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('contentRelease.runFailed'));
    } finally {
      setBusy(false);
    }
  };

  const changeCount = trial
    ? KINDS.reduce((sum, kind) => sum + trial.changes[kind], 0)
    : 0;
  const confirmed = typed.trim() === catalogCode;
  const canRun = trial !== null && trial.mode === mode && confirmed && !busy;

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="bg-background/60 border-border mt-2 rounded-2xl border p-4"
    >
      <h3 id={`${id}-title`} className="text-foreground font-semibold">
        {t('contentRelease.title', { code: catalogCode })}
      </h3>
      <p className="text-muted mt-1 text-sm">{t('contentRelease.hint')}</p>

      {!overview && !error && (
        <div className="py-3">
          <LoadingSpinner size="sm" />
        </div>
      )}

      {overview && (
        <>
          {!overview.catalogActive && (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
              {t('contentRelease.catalogInactive')}
            </p>
          )}
          <table className="mt-3 w-full text-sm tabular-nums">
            <caption className="sr-only">
              {t('contentRelease.tableCaption')}
            </caption>
            <thead>
              <tr className="text-muted text-left">
                <th scope="col" className="py-1 font-medium">
                  {t('contentRelease.kind')}
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  {t('contentRelease.exist')}
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  {t('contentRelease.visible')}
                </th>
                {trial && (
                  <th scope="col" className="py-1 text-right font-medium">
                    {t(
                      trial.mode === 'release'
                        ? 'contentRelease.willRelease'
                        : 'contentRelease.willLock'
                    )}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {KINDS.map(kind => (
                <tr key={kind} className="border-border border-t">
                  <th
                    scope="row"
                    className="text-foreground py-1 text-left font-normal"
                  >
                    {t(`contentRelease.kinds.${kind}`)}
                  </th>
                  <td className="py-1 text-right">{overview.total[kind]}</td>
                  <td className="py-1 text-right">{overview.active[kind]}</td>
                  {trial && (
                    <td className="text-foreground py-1 text-right font-semibold">
                      {trial.changes[kind]}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          <fieldset className="mt-4" disabled={busy}>
            <legend className="text-foreground mb-1 text-sm font-medium">
              {t('contentRelease.mode')}
            </legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {(['release', 'lock'] as const).map(value => (
                <label key={value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`${id}-mode`}
                    checked={mode === value}
                    onChange={() => {
                      setMode(value);
                      setTrial(null);
                      setTyped('');
                    }}
                    className="accent-accent h-4 w-4"
                  />
                  {t(`contentRelease.mode.${value}`)}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-4">
            <button
              type="button"
              onClick={() => run(false)}
              disabled={busy}
              className="text-foreground hover:bg-accent/10 border-border focus-visible:ring-accent min-h-[44px] rounded-xl border px-4 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
            >
              {t('contentRelease.trial')}
            </button>
          </div>

          {trial && (
            <div className="mt-4" role="status">
              <p className="text-foreground text-sm">
                {changeCount === 0
                  ? t('contentRelease.nothingToChange')
                  : t('contentRelease.trialResult', { count: changeCount })}
              </p>
              <label
                htmlFor={`${id}-confirm`}
                className="text-foreground mt-3 block text-sm font-medium"
              >
                {t('contentRelease.confirmLabel', { code: catalogCode })}
              </label>
              <input
                id={`${id}-confirm`}
                type="text"
                autoComplete="off"
                value={typed}
                onChange={e => setTyped(e.target.value)}
                className="bg-background border-border text-foreground focus:ring-accent mt-1 w-full max-w-xs rounded-xl border px-3 py-2 focus:ring-2 focus:outline-none"
              />
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => run(true)}
                  disabled={!canRun || changeCount === 0}
                  className="min-h-[44px] rounded-xl bg-red-700 px-5 py-2 text-sm font-medium text-white hover:bg-red-800 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none disabled:opacity-50"
                >
                  {t(
                    mode === 'release'
                      ? 'contentRelease.runRelease'
                      : 'contentRelease.runLock'
                  )}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <div role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
        {error}
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="text-muted hover:text-foreground focus-visible:ring-accent min-h-[44px] rounded-xl px-4 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          {t('contentRelease.close')}
        </button>
      </div>
    </section>
  );
}
