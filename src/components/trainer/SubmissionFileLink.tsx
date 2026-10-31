'use client';

import { useState } from 'react';
import { Paperclip } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { authFetch } from '@/lib/authFetch';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

// The optional file of a use case submission (trainer side). One check per page whether
// the feature is on (the answer is cached by the query), then a button per submission.
// The read link is asked for when the button is pressed, it works for two minutes.

type Status = { enabled: boolean };

export function SubmissionFileLink({ submissionId }: { submissionId: string }) {
  const { t } = useLanguage();
  const { data } = useApiQuery<Status>('/api/me/submission-file');
  const [state, setState] = useState<'idle' | 'busy' | 'none' | 'failed'>(
    'idle'
  );
  if (!data?.enabled) return null;

  const open = async () => {
    setState('busy');
    try {
      const response = await authFetch(
        `/api/trainer/reviews/use-cases/${submissionId}/file`
      );
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
      setState('idle');
      // the link forces a download, so the page stays where it is (no popup to be blocked)
      window.location.assign(json.file.url);
    } catch {
      setState('failed');
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
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
      {state === 'failed' && (
        <span role="alert" className="text-red-500">
          {t('submissionFile.trainerFailed')}
        </span>
      )}
    </div>
  );
}
