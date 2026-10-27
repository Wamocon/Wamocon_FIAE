'use client';

import { useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  UploadApiError,
  createUploadClient,
} from '@/lib/content-upload/staging/client';
import { LIMITS } from '@/lib/content-upload/staging/config';
import { RunUploader } from '@/components/admin/content-upload/RunUploader';
import {
  BTN_PRIMARY,
  FIELD,
  LABEL,
  NOTICE_ERROR,
  NOTICE_INFO,
} from '@/components/admin/content-upload/styles';

const BASE = '/trainer/admin/content-upload';

type Props = {
  /** Replaced in the tests. */
  client?: ReturnType<typeof createUploadClient>;
};

/** The message for a refused request, from the code the route answers with. */
function errorKey(error: unknown): string {
  if (error instanceof UploadApiError) {
    if (error.status === 404) return 'contentUpload.unavailable';
    if (error.code === 'TOO_MANY_ACTIVE_RUNS')
      return 'contentUpload.new.tooManyRuns';
    if (error.code === 'LABEL_INVALID') return 'contentUpload.new.labelInvalid';
    if (error.code === 'DECLARATION_REQUIRED')
      return 'contentUpload.new.declarationRequired';
    if (error.status === 429) return 'contentUpload.new.rateLimited';
  }
  return 'contentUpload.new.createError';
}

/**
 * Screen 2 of the concept: the data of a new run (name, occupation, the
 * declaration that the files are the own teaching material and the opt in for the
 * model), then the choice of the files and their upload. The opt in for the model is
 * stored with the run, it has no effect until the model step exists.
 */
export function NewRunForm({ client: injected }: Props) {
  const { t } = useLanguage();
  const router = useRouter();
  const client = useMemo(() => injected ?? createUploadClient(), [injected]);
  const ids = {
    label: useId(),
    catalog: useId(),
    error: useId(),
    declaration: useId(),
  };
  const [label, setLabel] = useState('');
  const [declared, setDeclared] = useState(false);
  const [ki, setKi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const labelField = useRef<HTMLInputElement>(null);
  const declarationField = useRef<HTMLInputElement>(null);

  const trimmed = label.trim();
  const labelProblem =
    trimmed.length === 0
      ? t('contentUpload.new.labelInvalid', { max: LIMITS.maxLabelChars })
      : trimmed.length > LIMITS.maxLabelChars
        ? t('contentUpload.new.labelInvalid', { max: LIMITS.maxLabelChars })
        : null;
  const declarationProblem = declared
    ? null
    : t('contentUpload.new.declarationRequired');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    setErrorText(null);
    if (labelProblem || declarationProblem) {
      // the first field that is wrong takes the focus, so it is read out
      (labelProblem ? labelField : declarationField).current?.focus();
      return;
    }
    setBusy(true);
    try {
      const created = await client.createRun({
        label: trimmed,
        kiEnabled: ki,
      });
      setRunId(created.run.id);
    } catch (error) {
      setErrorText(t(errorKey(error), { max: LIMITS.maxLabelChars }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <nav aria-label={t('contentUpload.breadcrumb')}>
        <Link href={BASE} className="text-muted text-sm underline">
          {t('contentUpload.backToRuns')}
        </Link>
      </nav>
      <h1 className="text-foreground text-3xl font-bold">
        {t('contentUpload.new.title')}
      </h1>

      <form
        onSubmit={submit}
        noValidate
        className="glass-effect glass-static space-y-5 rounded-3xl border p-6"
        aria-describedby={errorText ? ids.error : undefined}
      >
        {errorText && (
          <p id={ids.error} role="alert" className={NOTICE_ERROR}>
            {errorText}
          </p>
        )}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div>
            <label htmlFor={ids.label} className={LABEL}>
              {t('contentUpload.new.label')} *
            </label>
            <input
              id={ids.label}
              ref={labelField}
              value={label}
              onChange={e => setLabel(e.target.value)}
              disabled={runId !== null}
              maxLength={LIMITS.maxLabelChars}
              required
              aria-invalid={touched && labelProblem ? true : undefined}
              aria-describedby={
                touched && labelProblem ? `${ids.label}-err` : undefined
              }
              className={FIELD}
              placeholder={t('contentUpload.new.labelPlaceholder')}
            />
            {touched && labelProblem && (
              <p
                id={`${ids.label}-err`}
                role="alert"
                className="mt-1 text-sm text-red-500"
              >
                {labelProblem}
              </p>
            )}
          </div>
          <div>
            <label htmlFor={ids.catalog} className={LABEL}>
              {t('contentUpload.new.catalog')} *
            </label>
            <select
              id={ids.catalog}
              disabled
              value="KFBM"
              onChange={() => undefined}
              aria-describedby={`${ids.catalog}-hint`}
              className={FIELD}
            >
              <option value="KFBM">{t('contentUpload.catalogName')}</option>
            </select>
            <p id={`${ids.catalog}-hint`} className="text-muted mt-1 text-sm">
              {t('contentUpload.new.catalogHint')}
            </p>
          </div>
        </div>

        <fieldset className="space-y-3" disabled={runId !== null}>
          <legend className="sr-only">{t('contentUpload.new.consent')}</legend>
          <div>
            <label className="text-foreground flex cursor-pointer items-start gap-3 text-sm">
              <input
                ref={declarationField}
                type="checkbox"
                checked={declared}
                onChange={e => setDeclared(e.target.checked)}
                required
                aria-invalid={touched && declarationProblem ? true : undefined}
                aria-describedby={
                  touched && declarationProblem ? ids.declaration : undefined
                }
                className="mt-1 h-5 w-5 shrink-0 accent-red-700"
              />
              <span>{t('contentUpload.declaration')} *</span>
            </label>
            {touched && declarationProblem && (
              <p
                id={ids.declaration}
                role="alert"
                className="mt-1 text-sm text-red-500"
              >
                {declarationProblem}
              </p>
            )}
          </div>
          <div>
            <label className="text-foreground flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={ki}
                onChange={e => setKi(e.target.checked)}
                aria-describedby="ki-hint"
                className="mt-1 h-5 w-5 shrink-0 accent-red-700"
              />
              <span>{t('contentUpload.kiOptIn')}</span>
            </label>
            <p id="ki-hint" className="text-muted mt-1 pl-8 text-sm">
              {t('contentUpload.kiHint')}
            </p>
          </div>
        </fieldset>

        {runId === null ? (
          <div className="flex justify-end">
            <button type="submit" disabled={busy} className={BTN_PRIMARY}>
              {busy
                ? t('contentUpload.new.creating')
                : t('contentUpload.new.create')}
            </button>
          </div>
        ) : (
          <p className={NOTICE_INFO}>{t('contentUpload.new.created')}</p>
        )}
      </form>

      {runId !== null && (
        <div className="glass-effect glass-static rounded-3xl border p-6">
          <RunUploader
            runId={runId}
            client={client}
            focusOnMount
            onFinished={() => router.push(`${BASE}/${runId}`)}
          />
        </div>
      )}
    </div>
  );
}
