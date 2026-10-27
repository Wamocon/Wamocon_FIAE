'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  UploadAbortedError,
  candidatesFromFiles,
  createUploadClient,
  type UploadCandidate,
  type UploadSummary,
} from '@/lib/content-upload/staging/client';
import { LIMITS } from '@/lib/content-upload/staging/config';
import { ProcessingPanel } from '@/components/admin/content-upload/ProcessingPanel';
import {
  fileCodeLabel,
  formatBytes,
} from '@/components/admin/content-upload/labels';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  NOTICE_ERROR,
  NOTICE_WARN,
} from '@/components/admin/content-upload/styles';
import { useThrottledAnnouncement } from '@/components/admin/content-upload/useAnnouncer';

const EXTENSION = /\.(docx|pdf)$/i;

type Phase = 'hashing' | 'announcing' | 'uploading' | 'completing';
type State = 'idle' | 'uploading' | 'paused' | 'processing' | 'error';

type Props = {
  runId: string;
  /** The queue is empty and the run goes on to the review. */
  onFinished: () => void;
  /** The heading takes the focus when the uploader appears (after a run was created). */
  focusOnMount?: boolean;
  /** Replaced in the tests. */
  client?: ReturnType<typeof createUploadClient>;
};

/**
 * Chooses a folder or files and brings them into the run: hash, announce, signed
 * upload straight into the private bucket, report as done, then the queue is
 * worked by the ProcessingPanel. After an abort the same files are chosen again
 * and nothing is uploaded twice (the server's announce is idempotent).
 */
export function RunUploader({
  runId,
  onFinished,
  focusOnMount = false,
  client: injected,
}: Props) {
  const { t } = useLanguage();
  const client = useMemo(() => injected ?? createUploadClient(), [injected]);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const filesInput = useRef<HTMLInputElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusOnMount) heading.current?.focus();
  }, [focusOnMount]);
  // leaving the page ends the hashing and the upload: nothing runs on in the background
  useEffect(() => () => abort.current?.abort(), []);
  const [selected, setSelected] = useState<UploadCandidate[]>([]);
  const [otherCount, setOtherCount] = useState(0);
  const [state, setState] = useState<State>('idle');
  const [phase, setPhase] = useState<Phase>('hashing');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [live, announce] = useThrottledAnnouncement(5000);

  const choose = (list: FileList | null) => {
    const all = candidatesFromFiles(list ?? []);
    const wanted = all.filter(c => EXTENSION.test(c.file.name));
    setSelected(wanted);
    setOtherCount(all.length - wanted.length);
    setSummary(null);
    setState('idle');
  };

  const totalBytes = selected.reduce((sum, c) => sum + c.file.size, 0);
  const tooLarge = selected.filter(
    c => c.file.size > LIMITS.maxFileBytes
  ).length;
  const tooMany = selected.length > LIMITS.maxFilesPerRun;

  const begin = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setState('uploading');
    try {
      const result = await client.uploadFiles(runId, selected, {
        signal: controller.signal,
        onProgress: event => {
          setPhase(event.phase);
          setProgress({ done: event.done, total: event.total });
          announce(
            `${t(`contentUpload.upload.phase.${event.phase}`)}: ${t(
              'contentUpload.upload.of',
              { done: event.done, total: event.total }
            )}`
          );
        },
      });
      setSummary(result);
      setState('processing');
    } catch (error) {
      if (error instanceof UploadAbortedError || controller.signal.aborted) {
        setState('paused');
        return;
      }
      setState('error');
      announce(t('contentUpload.upload.error'), true);
    }
  };

  const pause = () => {
    abort.current?.abort();
    // the page says so at once, the hashing of the file in hand may take a moment
    setState('paused');
  };
  const problems = summary
    ? summary.rejected.length + summary.failed.length
    : 0;

  return (
    <section aria-labelledby="uploader-title" className="space-y-4">
      <h2
        id="uploader-title"
        ref={heading}
        tabIndex={-1}
        className="text-foreground text-xl font-bold focus:outline-none"
      >
        {t('contentUpload.upload.title')}
      </h2>

      {state !== 'processing' && (
        <>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={BTN_SECONDARY}
              disabled={state === 'uploading'}
              onClick={() => folderInput.current?.click()}
            >
              {t('contentUpload.upload.pickFolder')}
            </button>
            <button
              type="button"
              className={BTN_SECONDARY}
              disabled={state === 'uploading'}
              onClick={() => filesInput.current?.click()}
            >
              {t('contentUpload.upload.pickFiles')}
            </button>
            {/* the folder input needs the non standard attribute webkitdirectory */}
            <input
              ref={el => {
                folderInput.current = el;
                el?.setAttribute('webkitdirectory', '');
              }}
              type="file"
              multiple
              hidden
              data-testid="folder-input"
              aria-label={t('contentUpload.upload.pickFolder')}
              onChange={e => {
                choose(e.target.files);
                e.target.value = '';
              }}
            />
            <input
              ref={filesInput}
              type="file"
              multiple
              hidden
              accept=".docx,.pdf"
              data-testid="files-input"
              aria-label={t('contentUpload.upload.pickFiles')}
              onChange={e => {
                choose(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          <p className="text-muted text-sm">
            {t('contentUpload.upload.allowed', {
              size: Math.round(LIMITS.maxFileBytes / (1024 * 1024)),
              count: LIMITS.maxFilesPerRun,
            })}
          </p>

          {selected.length > 0 && (
            <div className="text-foreground text-sm" data-testid="selection">
              <p>
                {t('contentUpload.upload.selected', {
                  count: selected.length,
                  size: formatBytes(totalBytes),
                })}
              </p>
              {otherCount > 0 && (
                <p className="text-muted">
                  {t('contentUpload.upload.otherSkipped', {
                    count: otherCount,
                  })}
                </p>
              )}
            </div>
          )}
          {tooMany && (
            <p role="alert" className={NOTICE_ERROR}>
              {t('contentUpload.upload.tooMany', {
                count: LIMITS.maxFilesPerRun,
              })}
            </p>
          )}
          {tooLarge > 0 && (
            <p className={NOTICE_WARN}>
              {t('contentUpload.upload.tooLarge', { count: tooLarge })}
            </p>
          )}
          {selected.length === 0 && otherCount > 0 && (
            <p role="alert" className={NOTICE_WARN}>
              {t('contentUpload.upload.nothingUsable')}
            </p>
          )}

          {state === 'uploading' && (
            <div>
              <progress
                className="h-3 w-full"
                value={progress.done}
                max={Math.max(progress.total, 1)}
                aria-label={t(`contentUpload.upload.phase.${phase}`)}
              />
              <p className="text-foreground mt-1 text-sm">
                {t(`contentUpload.upload.phase.${phase}`)}:{' '}
                {t('contentUpload.upload.of', progress)}
              </p>
            </div>
          )}
          {state === 'paused' && (
            <p className={NOTICE_WARN}>{t('contentUpload.upload.paused')}</p>
          )}
          {state === 'error' && (
            <p role="alert" className={NOTICE_ERROR}>
              {t('contentUpload.upload.error')}
            </p>
          )}

          <div className="flex gap-3">
            {state === 'uploading' ? (
              <button type="button" onClick={pause} className={BTN_SECONDARY}>
                {t('contentUpload.upload.pause')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void begin()}
                disabled={selected.length === 0 || tooMany}
                className={BTN_PRIMARY}
              >
                {state === 'paused' || state === 'error'
                  ? t('contentUpload.upload.resume')
                  : t('contentUpload.upload.start')}
              </button>
            )}
          </div>
        </>
      )}

      {summary && (
        <div className="text-foreground text-sm" data-testid="summary">
          <p>
            {t('contentUpload.upload.summary', {
              uploaded: summary.uploaded,
              merged: summary.merged,
            })}
          </p>
          {problems > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer font-medium">
                {t('contentUpload.upload.problems', { count: problems })}
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-6">
                {[...summary.rejected, ...summary.failed]
                  .slice(0, 100)
                  .map((p, i) => (
                    <li key={`${p.path}-${i}`}>
                      <span className="break-all">{p.path}</span>
                      {': '}
                      {fileCodeLabel(t, p.code)}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {state === 'processing' && (
        <ProcessingPanel
          runId={runId}
          autoStart
          onDone={onFinished}
          client={client}
        />
      )}

      <div aria-live="polite" role="status" className="sr-only">
        {live}
      </div>
    </section>
  );
}
