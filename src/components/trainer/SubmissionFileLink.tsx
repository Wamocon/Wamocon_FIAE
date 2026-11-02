'use client';

import { useState } from 'react';
import { Eye, Paperclip } from 'lucide-react';
import { SubmissionFileViewer } from '@/components/submission/SubmissionFileViewer';
import { useLanguage } from '@/contexts/LanguageContext';
import { authFetch } from '@/lib/authFetch';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { readLinkAnswers } from '@/lib/submission-file/readLink';
import { previewKindOf, type PreviewKind } from '@/lib/submission-file/rules';

// The optional file of a use case submission (trainer side). One check per page whether
// the feature is on (the answer is cached by the query), then two buttons per submission:
// "ansehen" shows a PDF in the viewer of the app and a PNG or JPG as an image (WMCNL-2927),
// "herunterladen" keeps the file as it is. A Word or Excel file has no preview, the page
// says so and offers the download.
// The read link of the download is asked for when the button is pressed, it works for two
// minutes.

type Status = { enabled: boolean };
type State = 'idle' | 'busy' | 'none' | 'failed' | 'noPreview';

export function SubmissionFileLink({ submissionId }: { submissionId: string }) {
  const { t } = useLanguage();
  const { data } = useApiQuery<Status>('/api/me/submission-file');
  const [state, setState] = useState<State>('idle');
  const [preview, setPreview] = useState<{
    fileName: string;
    kind: PreviewKind;
  } | null>(null);
  if (!data?.enabled) return null;

  const base = `/api/trainer/reviews/use-cases/${submissionId}/file`;

  const open = async () => {
    setState('busy');
    try {
      const response = await authFetch(base);
      const json = (await response.json().catch(() => ({}))) as {
        file?: { url?: string } | null;
      };
      if (!response.ok) {
        setState('failed');
        return;
      }
      if (!json.file?.url) {
        setState('none');
        return;
      }
      // A link that the storage refuses (503) is said here, not lost in the background
      if (!(await readLinkAnswers(json.file.url))) {
        setState('failed');
        return;
      }
      setState('idle');
      // the link forces a download, so the page stays where it is (no popup to be blocked)
      window.location.assign(json.file.url);
    } catch {
      setState('failed');
    }
  };

  const view = async () => {
    setState('busy');
    try {
      // name only: the kind of the file decides whether there is a preview
      const response = await authFetch(`${base}?link=0`);
      const json = (await response.json().catch(() => ({}))) as {
        file?: { fileName?: string } | null;
      };
      if (!response.ok) {
        setState('failed');
        return;
      }
      const fileName = json.file?.fileName;
      if (!fileName) {
        setState('none');
        return;
      }
      const kind = previewKindOf(fileName);
      if (!kind) {
        setState('noPreview');
        return;
      }
      setState('idle');
      setPreview({ fileName, kind });
    } catch {
      setState('failed');
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        disabled={state === 'busy'}
        onClick={view}
        className="border-accent/30 hover:bg-accent/10 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 disabled:opacity-60"
      >
        <Eye className="h-3.5 w-3.5" />
        {t('submissionFile.trainerView')}
      </button>
      <button
        type="button"
        disabled={state === 'busy'}
        onClick={open}
        className="border-accent/30 hover:bg-accent/10 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 disabled:opacity-60"
      >
        <Paperclip className="h-3.5 w-3.5" />
        {t('submissionFile.trainerOpen')}
      </button>
      {state === 'none' && (
        <span role="status" className="text-muted-foreground">
          {t('submissionFile.trainerNone')}
        </span>
      )}
      {state === 'noPreview' && (
        <span role="status" className="text-muted-foreground">
          {t('submissionFile.noPreview')}
        </span>
      )}
      {state === 'failed' && (
        <span role="alert" className="text-red-500">
          {t('submissionFile.trainerFailed')}
        </span>
      )}
      {preview && (
        <SubmissionFileViewer
          open
          onClose={() => setPreview(null)}
          contentUrl={`${base}/content`}
          fileName={preview.fileName}
          kind={preview.kind}
        />
      )}
    </div>
  );
}
