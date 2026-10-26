'use client';

import { Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { IS_PREVIEW_SCHEMA } from '@/lib/db-schema';

/**
 * Notice on the user administration of the Preview: accounts created there are
 * for tests and Production does not accept them (src/lib/preview-account.ts).
 * Shows nothing in Production. The flag can be passed for tests.
 */
export function PreviewAccountNotice({
  isPreview = IS_PREVIEW_SCHEMA,
}: {
  isPreview?: boolean;
}) {
  const { t } = useLanguage();
  if (!isPreview) return null;
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-500"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{t('admin.users.previewNotice')}</p>
    </div>
  );
}
