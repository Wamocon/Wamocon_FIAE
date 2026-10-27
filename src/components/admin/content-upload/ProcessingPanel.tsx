'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  UploadAbortedError,
  createUploadClient,
} from '@/lib/content-upload/staging/client';
import type { RunProgress } from '@/lib/content-upload/staging/types';
import type { FileStatus } from '@/lib/content-upload/staging/status';
import { useThrottledAnnouncement } from '@/components/admin/content-upload/useAnnouncer';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  NOTICE_ERROR,
} from '@/components/admin/content-upload/styles';

/** Files that still wait for a step of the queue. */
const PENDING: readonly FileStatus[] = [
  'announced',
  'uploaded',
  'verified',
  'extracted',
  'ki_pending',
];

/** What the progress counters say: files to process, files done, files still waiting. */
export function processingFigures(progress: RunProgress | null) {
  if (!progress) return { total: 0, done: 0, pending: 0 };
  const counts = progress.counts;
  const total =
    progress.totalFiles - (counts.merged ?? 0) - (counts.expired ?? 0);
  const pending = PENDING.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
  return { total, pending, done: Math.max(0, total - pending) };
}

type Props = {
  runId: string;
  /** Start working the queue as soon as the panel is shown. */
  autoStart?: boolean;
  /** The queue is empty: the run goes on to the review. */
  onDone: () => void;
  /** Replaced in the tests. */
  client?: ReturnType<typeof createUploadClient>;
};

type State = 'idle' | 'running' | 'paused' | 'done' | 'error';

/**
 * The queue of the run is worked by the browser: there is no cron, so this panel
 * calls the pump route in a loop while the page is open (concept 2.4, 6.6). It shows
 * how far the run is, can be paused and continued, and tells the screen reader about
 * the progress every five seconds, and about a fault at once.
 */
export function ProcessingPanel({
  runId,
  autoStart = false,
  onDone,
  client: injected,
}: Props) {
  const { t } = useLanguage();
  const client = useMemo(() => injected ?? createUploadClient(), [injected]);
  const [state, setState] = useState<State>('idle');
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [live, announce] = useThrottledAnnouncement(5000);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const refresh = useCallback(async () => {
    const run = await client.getRun(runId);
    if (!mounted.current) return null;
    setProgress(run.progress);
    const figures = processingFigures(run.progress);
    announce(
      t('contentUpload.progress.processed', {
        done: figures.done,
        total: figures.total,
      })
    );
    return figures;
  }, [client, runId, announce, t]);

  const start = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState('running');
    try {
      await refresh();
      const result = await client.processRun(runId, {
        signal: controller.signal,
        onProgress: () => {
          void refresh().catch(() => undefined);
        },
      });
      await refresh();
      // a newer start (or the end of the page) has taken over
      if (!mounted.current || abort.current !== controller) return;
      if (result.done) {
        setState('done');
        announce(t('contentUpload.progress.done'), true);
        doneRef.current();
      } else {
        setState('paused');
      }
    } catch (error) {
      if (!mounted.current || abort.current !== controller) return;
      if (error instanceof UploadAbortedError || controller.signal.aborted) {
        setState('paused');
        return;
      }
      setState('error');
      announce(t('contentUpload.progress.error'), true);
    }
  }, [client, runId, refresh, announce, t]);

  const pause = () => abort.current?.abort();

  useEffect(() => {
    mounted.current = true;
    if (autoStart) void start();
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
    // the panel starts once, for the run it was shown for
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const { total, done } = processingFigures(progress);

  return (
    <section
      aria-labelledby="processing-title"
      className="border-border rounded-2xl border p-5"
    >
      <h2 id="processing-title" className="text-foreground text-lg font-bold">
        {t('contentUpload.progress.title')}
      </h2>
      <p className="text-muted mt-1 text-sm">
        {state === 'running'
          ? t('contentUpload.progress.running')
          : state === 'paused'
            ? t('contentUpload.progress.paused')
            : state === 'done'
              ? t('contentUpload.progress.done')
              : t('contentUpload.progress.idle')}
      </p>
      <div className="mt-4">
        <progress
          className="h-3 w-full"
          value={done}
          max={Math.max(total, 1)}
          aria-label={t('contentUpload.progress.title')}
        />
        <p className="text-foreground mt-1 text-sm">
          {t('contentUpload.progress.processed', { done, total })}
        </p>
      </div>
      {state === 'error' && (
        <p role="alert" className={`${NOTICE_ERROR} mt-4`}>
          {t('contentUpload.progress.error')}
        </p>
      )}
      <div className="mt-4 flex gap-3">
        {state === 'running' ? (
          <button type="button" onClick={pause} className={BTN_SECONDARY}>
            {t('contentUpload.progress.pause')}
          </button>
        ) : (
          state !== 'done' && (
            <button
              type="button"
              onClick={() => void start()}
              className={BTN_PRIMARY}
            >
              {t('contentUpload.progress.resume')}
            </button>
          )
        )}
      </div>
      {/* Read out at most every five seconds, a fault at once */}
      <div aria-live="polite" role="status" className="sr-only">
        {live}
      </div>
    </section>
  );
}
