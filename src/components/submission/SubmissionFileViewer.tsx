'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { FlipbookViewer } from '@/components/ui/FlipbookViewer';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useLanguage } from '@/contexts/LanguageContext';
import { authFetch } from '@/lib/authFetch';
import type { PreviewKind } from '@/lib/submission-file/rules';

// The preview of the file of a use case submission inside the platform
// (WMCNL-2927): a PDF in the viewer of the app, a PNG or JPG as an image. Word
// and Excel files have no preview, they are only downloaded (the callers do not
// open this component for them). The bytes come from a route of the app and are
// asked for with the session, so the page holds no address of the file.

type Props = {
  open: boolean;
  onClose: () => void;
  /** The route that delivers the file (the trainee or the trainer route). */
  contentUrl: string;
  fileName: string;
  kind: PreviewKind;
};

export function SubmissionFileViewer({
  open,
  onClose,
  contentUrl,
  fileName,
  kind,
}: Props) {
  const { t } = useLanguage();
  if (!open) return null;
  if (kind === 'pdf') {
    return (
      <FlipbookViewer
        pdfUrl={contentUrl}
        title={fileName}
        subtitle={t('submissionFile.previewSubtitle')}
        isOpen
        onClose={onClose}
        // the download stays a button of its own next to the file name, the
        // viewer draws the pages without a download or a link to the raw file
        allowDownload={false}
      />
    );
  }
  return (
    <ImageDialog
      contentUrl={contentUrl}
      fileName={fileName}
      onClose={onClose}
    />
  );
}

function ImageDialog({
  contentUrl,
  fileName,
  onClose,
}: {
  contentUrl: string;
  fileName: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; src: string }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: 'loading' });
    void (async () => {
      try {
        const response = await authFetch(contentUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error('not delivered');
        objectUrl = URL.createObjectURL(await response.blob());
        if (!cancelled) setState({ status: 'ready', src: objectUrl });
      } catch {
        if (!cancelled) setState({ status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [contentUrl]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={fileName}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 print:hidden"
      onClick={event => event.target === event.currentTarget && onClose()}
    >
      <div className="relative flex max-h-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">
              {fileName}
            </div>
            <div className="text-xs text-gray-400">
              {t('submissionFile.previewSubtitle')}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title={t('common.close')}
            aria-label={t('common.close')}
            className="rounded-xl border border-red-500/20 bg-red-500/10 p-2 text-red-400 transition-colors hover:bg-red-500/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-h-[200px] flex-1 items-center justify-center overflow-auto p-4">
          {state.status === 'loading' && <LoadingSpinner size="lg" />}
          {state.status === 'error' && (
            <p role="alert" className="text-sm text-red-400">
              {t('submissionFile.previewFailed')}
            </p>
          )}
          {state.status === 'ready' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={state.src}
              alt={fileName}
              className="max-h-[75vh] max-w-full object-contain"
              draggable={false}
            />
          )}
        </div>
      </div>
    </div>
  );
}
