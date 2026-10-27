'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ReviewClient } from '@/lib/content-upload/review/client';
import type { DuplicateGroupDto } from '@/lib/content-upload/review/types';
import { Modal } from '@/components/admin/content-upload/Modal';
import { describeAssignment } from '@/components/admin/content-upload/ReviewTable';
import {
  formatBytes,
  formatDate,
} from '@/components/admin/content-upload/labels';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  NOTICE_ERROR,
  NOTICE_INFO,
} from '@/components/admin/content-upload/styles';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

const NONE = 'none';

type Props = {
  runId: string;
  groupKey: string;
  client: ReviewClient;
  /** The run is in review: the choice may be saved. */
  decidable: boolean;
  busy: boolean;
  /** keepFileId is null for "take none of them". */
  onDecide: (key: string, keepFileId: string | null) => void;
  onClose: () => void;
};

/**
 * Screen 4 of the concept: the versions of one document. The suggestion (the
 * newest version) comes with its reasons, or the note that there is none. The time
 * of change is the browser's and says so. One version is kept, the others are
 * skipped, or none is taken. Nothing is chosen for the person when there is no
 * suggestion.
 */
export function DuplicateDialog({
  runId,
  groupKey,
  client,
  decidable,
  busy,
  onDecide,
  onClose,
}: Props) {
  const { t, language } = useLanguage();
  const titleId = useId();
  const descriptionId = useId();
  const [group, setGroup] = useState<DuplicateGroupDto | null | 'missing'>(
    null
  );
  const [failed, setFailed] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    client
      .duplicates(runId, controller.signal)
      .then(({ groups }) => {
        const found = groups.find(g => g.key === groupKey) ?? null;
        setGroup(found ?? 'missing');
        if (found?.suggestedId) setChoice(found.suggestedId);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [client, runId, groupKey]);

  const loaded = useMemo(
    () => (group && group !== 'missing' ? group : null),
    [group]
  );

  // the group arrives after the dialog opened: the focus goes to the choice then
  useEffect(() => {
    if (!loaded) return;
    const radios = form.current?.querySelectorAll<HTMLInputElement>(
      'input[type="radio"]'
    );
    const target = Array.from(radios ?? []).find(r => r.checked) ?? radios?.[0];
    target?.focus();
  }, [loaded]);

  return (
    <Modal titleId={titleId} descriptionId={descriptionId} onClose={onClose}>
      <h2 id={titleId} className="text-foreground text-xl font-bold">
        {loaded
          ? t('contentUpload.duplicate.title', {
              label: describeAssignment(t, loaded.label),
              count: loaded.members.length,
            })
          : t('contentUpload.duplicate.titleShort')}
      </h2>

      {!group && !failed && (
        <div aria-live="polite" className="mt-4 flex items-center gap-3">
          <LoadingSpinner size="sm" />
          <span className="text-foreground">{t('contentUpload.loading')}</span>
        </div>
      )}
      {failed && (
        <p role="alert" className={`${NOTICE_ERROR} mt-4`}>
          {t('contentUpload.loadError')}
        </p>
      )}
      {group === 'missing' && (
        <p role="alert" className={`${NOTICE_INFO} mt-4`}>
          {t('contentUpload.duplicate.gone')}
        </p>
      )}

      {loaded && (
        <form
          ref={form}
          className="mt-4 space-y-4"
          onSubmit={event => {
            event.preventDefault();
            if (choice !== null)
              onDecide(loaded.key, choice === NONE ? null : choice);
          }}
        >
          <p id={descriptionId} className="text-foreground text-sm">
            {t('contentUpload.duplicate.description')}
          </p>
          <fieldset disabled={!decidable || busy} className="space-y-3">
            <legend className="text-foreground mb-2 text-sm font-semibold">
              {t('contentUpload.duplicate.legend')}
            </legend>
            {loaded.members.map((member, index) => (
              <label
                key={member.fileId}
                className="border-border flex cursor-pointer items-start gap-3 rounded-xl border p-3"
              >
                <input
                  type="radio"
                  name="dup-choice"
                  value={member.fileId}
                  checked={choice === member.fileId}
                  onChange={() => setChoice(member.fileId)}
                  data-initial-focus={index === 0 ? '' : undefined}
                  className="mt-1 h-5 w-5 shrink-0 accent-red-700"
                />
                <span className="text-foreground min-w-0 text-sm">
                  <span className="font-medium">
                    {t('contentUpload.duplicate.version', { n: index + 1 })}:{' '}
                    {member.fileName}
                  </span>
                  {member.suggested && (
                    <span className="ml-2 rounded-md border border-green-600 px-1.5 py-0.5 text-xs">
                      {t('contentUpload.duplicate.suggested')}
                    </span>
                  )}
                  <span className="text-muted block text-xs break-all">
                    {member.relPath}
                  </span>
                  <span className="text-muted block text-xs">
                    {[
                      member.version > 0
                        ? t('contentUpload.duplicate.versionNumber', {
                            n: member.version,
                          })
                        : '',
                      member.clientMtimeMs !== null
                        ? t('contentUpload.duplicate.changed', {
                            date: formatDate(member.clientMtimeMs, language),
                          })
                        : '',
                      formatBytes(member.sizeBytes),
                      member.pageCount
                        ? t('contentUpload.table.pages', {
                            count: member.pageCount,
                          })
                        : '',
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                  {member.decision && (
                    <span className="block text-xs">
                      {t(`contentUpload.decision.${member.decision.action}`)}
                    </span>
                  )}
                </span>
              </label>
            ))}
            <label className="border-border flex cursor-pointer items-start gap-3 rounded-xl border p-3">
              <input
                type="radio"
                name="dup-choice"
                value={NONE}
                checked={choice === NONE}
                onChange={() => setChoice(NONE)}
                className="mt-1 h-5 w-5 shrink-0 accent-red-700"
              />
              <span className="text-foreground text-sm font-medium">
                {t('contentUpload.duplicate.none')}
              </span>
            </label>
          </fieldset>

          <div className="space-y-1 text-sm">
            {loaded.reasons.map((reason, i) => (
              <p key={`${reason.code}-${i}`} className="text-foreground">
                {reason.text}
              </p>
            ))}
            <p className="text-muted text-xs">
              {t('contentUpload.duplicate.browserTime')}
            </p>
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className={BTN_SECONDARY}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={!decidable || busy || choice === null}
              className={BTN_PRIMARY}
            >
              {t('contentUpload.duplicate.decide')}
            </button>
          </div>
        </form>
      )}
      {!loaded && (
        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>
            {t('common.close')}
          </button>
        </div>
      )}
    </Modal>
  );
}
