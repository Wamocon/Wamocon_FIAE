'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Paperclip } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { authFetch } from '@/lib/authFetch';
import { apiQueryKey, useApiQuery } from '@/lib/hooks/useApiQuery';
import {
  MAX_SUBMISSION_FILE_BYTES,
  MEGABYTE,
  SUBMISSION_EXTENSIONS,
  checkAnnouncedFile,
} from '@/lib/submission-file/rules';

// The optional file of a use case submission (trainee side). The browser asks the server
// for an upload address (the server checks name, size and type and picks the path),
// uploads the file straight to the private storage, and tells the server when it is
// done (the server then checks the bytes). The page only shows the field when the
// server says the feature is on.

type FileResponse = {
  enabled: boolean;
  file: { fileName: string; size: number | null; uploadedAt: string } | null;
};

type UploadAnswer = {
  upload?: {
    bucket: string;
    uploadId: string;
    path: string;
    token: string;
    fileName: string;
    contentType: string;
  };
  code?: string;
};

const KNOWN_ERRORS = new Set([
  'FILE_NAME_INVALID',
  'UNSUPPORTED_TYPE',
  'TYPE_MISMATCH',
  'EMPTY_FILE',
  'TOO_LARGE',
  'SUBMISSION_LOCKED',
  'RATE_LIMITED',
  'NOT_UPLOADED',
]);

const ACCEPT = SUBMISSION_EXTENSIONS.map(ext => `.${ext}`)
  .concat('.jpeg')
  .join(',');

export function SubmissionFileField({
  useCaseId,
  canEdit,
}: {
  useCaseId: string;
  canEdit: boolean;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  const base = `/api/trainee/use-cases/${useCaseId}/submission-file`;
  const { data } = useApiQuery<FileResponse>(base);
  if (!data?.enabled) return null;

  const errorText = (code?: string) => {
    if (code && KNOWN_ERRORS.has(code))
      return t(`submissionFile.error.${code}`);
    if (code && /^NOT_A_|^NOT_AN_/.test(code)) {
      return t('submissionFile.error.CONTENT_MISMATCH');
    }
    return t('submissionFile.error.generic');
  };

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: apiQueryKey(base).slice(0, 1) });

  const post = async (url: string, body: unknown) => {
    const response = await authFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as UploadAnswer & {
      file?: unknown;
    };
    return { response, json };
  };

  const upload = async (file: File) => {
    setMessage(null);
    const checked = checkAnnouncedFile({
      fileName: file.name,
      size: file.size,
      contentType: file.type,
    });
    if (!checked.ok) {
      setMessage({ ok: false, text: errorText(checked.code) });
      return;
    }
    setBusy(true);
    try {
      const announced = await post(`${base}/upload-url`, {
        fileName: file.name,
        size: file.size,
        contentType: file.type || undefined,
      });
      const target = announced.json.upload;
      if (!announced.response.ok || !target) {
        setMessage({ ok: false, text: errorText(announced.json.code) });
        return;
      }
      // Loaded on first use: the storage client of the browser
      const { supabase } = await import('@/lib/supabase');
      const { error } = await supabase.storage
        .from(target.bucket)
        .uploadToSignedUrl(target.path, target.token, file, {
          contentType: target.contentType,
        });
      if (error) {
        setMessage({ ok: false, text: errorText() });
        return;
      }
      const done = await post(`${base}/complete`, {
        uploadId: target.uploadId,
        fileName: target.fileName,
      });
      if (!done.response.ok) {
        setMessage({ ok: false, text: errorText(done.json.code) });
        return;
      }
      setMessage({ ok: true, text: t('submissionFile.uploaded') });
      await refresh();
    } catch {
      setMessage({ ok: false, text: errorText() });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const open = async () => {
    setMessage(null);
    try {
      const response = await authFetch(`${base}?link=1`);
      const json = (await response.json().catch(() => ({}))) as {
        file?: { url?: string } | null;
      };
      if (!response.ok || !json.file?.url) {
        setMessage({ ok: false, text: errorText() });
        return;
      }
      // the link forces a download, so the page stays where it is (no popup to be blocked)
      window.location.assign(json.file.url);
    } catch {
      setMessage({ ok: false, text: errorText() });
    }
  };

  const remove = async () => {
    setMessage(null);
    setBusy(true);
    try {
      const response = await authFetch(base, { method: 'DELETE' });
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as {
          code?: string;
        };
        setMessage({ ok: false, text: errorText(json.code) });
        return;
      }
      setMessage({ ok: true, text: t('submissionFile.removed') });
      await refresh();
    } catch {
      setMessage({ ok: false, text: errorText() });
    } finally {
      setBusy(false);
    }
  };

  const file = data.file;
  const sizeText =
    file?.size != null ? ` (${(file.size / 1024).toFixed(0)} KB)` : '';

  return (
    <div className="space-y-2" data-testid="submission-file-field">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Paperclip className="h-4 w-4" />
        {t('submissionFile.title')}
      </div>
      <p className="text-muted-foreground text-xs">
        {t('submissionFile.hint')
          .replace('{types}', SUBMISSION_EXTENSIONS.join(', '))
          .replace('{size}', String(MAX_SUBMISSION_FILE_BYTES / MEGABYTE))}
      </p>
      {file ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium break-all">
            {file.fileName}
            {sizeText}
          </span>
          <button
            type="button"
            onClick={open}
            className="border-accent/30 hover:bg-background/60 rounded-md border px-3 py-1.5 text-sm"
          >
            {t('submissionFile.open')}
          </button>
          {canEdit && (
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              className="border-accent/30 hover:bg-background/60 rounded-md border px-3 py-1.5 text-sm disabled:opacity-60"
            >
              {t('submissionFile.remove')}
            </button>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          {t('submissionFile.none')}
        </p>
      )}
      {canEdit && (
        <div>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            disabled={busy}
            aria-label={t('submissionFile.choose')}
            className="text-sm"
            onChange={event => {
              const picked = event.target.files?.[0];
              if (picked) void upload(picked);
            }}
          />
        </div>
      )}
      {busy && (
        <p className="text-muted-foreground text-sm">
          {t('submissionFile.uploading')}
        </p>
      )}
      {message && (
        <p
          role={message.ok ? 'status' : 'alert'}
          className={
            message.ok ? 'text-sm text-green-500' : 'text-sm text-red-500'
          }
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
