'use client';

import { useId, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ReviewOptions } from '@/lib/content-upload/review/types';
import type { AssignmentInput } from '@/lib/content-upload/review/validate';
import { Modal } from '@/components/admin/content-upload/Modal';
import {
  levelLabel,
  typeLabel,
} from '@/components/admin/content-upload/labels';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  FIELD,
  LABEL,
} from '@/components/admin/content-upload/styles';

type Props = {
  count: number;
  options: ReviewOptions;
  busy: boolean;
  onApply: (assignment: AssignmentInput) => void;
  onCancel: () => void;
};

const KEEP = '';

/**
 * "Zuordnung ändern" for a selection: only what is chosen here is changed, the rest
 * of each file stays as it is. Every value comes from the positive list. The files
 * are accepted with the new assignment; those for which it does not fit (an enabler
 * of another component, a level on a text) are skipped and named afterwards.
 */
export function AssignDialog({
  count,
  options,
  busy,
  onApply,
  onCancel,
}: Props) {
  const { t } = useLanguage();
  const titleId = useId();
  const descriptionId = useId();
  const id = useId();
  const [docType, setDocType] = useState(KEEP);
  const [componentCode, setComponentCode] = useState(KEEP);
  const [enablerCode, setEnablerCode] = useState(KEEP);
  const [quizLevel, setQuizLevel] = useState(KEEP);

  const component = options.components.find(c => c.code === componentCode);
  const changed = [docType, componentCode, enablerCode, quizLevel].some(
    v => v !== KEEP
  );

  const apply = () => {
    const change: AssignmentInput = {};
    if (docType) change.docType = docType;
    if (componentCode) change.componentCode = componentCode;
    // a new component without an enabler clears the old one (it belongs to the old component)
    if (enablerCode) change.enablerCode = enablerCode;
    else if (componentCode) change.enablerCode = null;
    if (quizLevel) change.quizLevel = quizLevel;
    else if (docType && docType !== 'quiz') change.quizLevel = null;
    onApply(change);
  };

  return (
    <Modal titleId={titleId} descriptionId={descriptionId} onClose={onCancel}>
      <h2 id={titleId} className="text-foreground text-xl font-bold">
        {t('contentUpload.assign.title')}
      </h2>
      <p id={descriptionId} className="text-foreground mt-2 text-sm">
        {t('contentUpload.assign.description', { count })}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-type`} className={LABEL}>
            {t('contentUpload.field.type')}
          </label>
          <select
            id={`${id}-type`}
            data-initial-focus
            value={docType}
            onChange={e => setDocType(e.target.value)}
            className={FIELD}
          >
            <option value={KEEP}>{t('contentUpload.assign.keep')}</option>
            {options.docTypes
              .filter(type => type !== 'pdf_original')
              .map(type => (
                <option key={type} value={type}>
                  {typeLabel(t, type)}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-component`} className={LABEL}>
            {t('contentUpload.field.component')}
          </label>
          <select
            id={`${id}-component`}
            value={componentCode}
            onChange={e => {
              setComponentCode(e.target.value);
              setEnablerCode(KEEP);
            }}
            className={FIELD}
          >
            <option value={KEEP}>{t('contentUpload.assign.keep')}</option>
            {options.components.map(c => (
              <option key={c.code} value={c.code}>
                {c.code}
                {c.title ? ` ${c.title}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-enabler`} className={LABEL}>
            {t('contentUpload.field.enabler')}
          </label>
          <select
            id={`${id}-enabler`}
            value={enablerCode}
            onChange={e => setEnablerCode(e.target.value)}
            className={FIELD}
          >
            <option value={KEEP}>
              {componentCode
                ? t('contentUpload.assign.clear')
                : t('contentUpload.assign.keep')}
            </option>
            {options.components
              .filter(c => !component || c.code === component.code)
              .map(c => (
                <optgroup key={c.code} label={c.code}>
                  {c.enablers.map(e => (
                    <option key={e.code} value={e.code}>
                      {e.code}
                      {e.title ? ` ${e.title}` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-level`} className={LABEL}>
            {t('contentUpload.field.level')}
          </label>
          <select
            id={`${id}-level`}
            value={quizLevel}
            onChange={e => setQuizLevel(e.target.value)}
            className={FIELD}
          >
            <option value={KEEP}>{t('contentUpload.assign.keep')}</option>
            {options.quizLevels.map(level => (
              <option key={level} value={level}>
                {levelLabel(t, level)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-muted mt-3 text-sm">
        {t('contentUpload.assign.hint')}
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className={BTN_SECONDARY}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={apply}
          disabled={busy || !changed}
          className={BTN_PRIMARY}
        >
          {t('contentUpload.assign.apply', { count })}
        </button>
      </div>
    </Modal>
  );
}
