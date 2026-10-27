// Keys of the texts of the content upload pages (the texts themselves are at the
// end of src/locales/de.json and en.json). A code that has no text of its own falls
// back to a general one, so a new code of the server never shows an empty cell.

import type { ProposalBand } from '@/lib/content-upload/classify/types';

type Translate = (
  key: string,
  data?: Record<string, string | number>
) => string;

const has = (t: Translate, key: string) => t(key) !== key;

/** The text for a code under a prefix, or the fallback text with the code in it. */
export function codeText(
  t: Translate,
  prefix: string,
  code: string | null | undefined,
  fallbackKey: string
): string {
  if (!code) return '';
  const key = `${prefix}.${code}`;
  return has(t, key) ? t(key) : t(fallbackKey, { code });
}

export const typeLabel = (t: Translate, type: string | null | undefined) =>
  type
    ? codeText(t, 'contentUpload.type', type, 'contentUpload.type.other')
    : '';

export const levelLabel = (t: Translate, level: string | null | undefined) =>
  level
    ? codeText(t, 'contentUpload.level', level, 'contentUpload.level.other')
    : '';

export const statusLabel = (t: Translate, status: string) =>
  codeText(
    t,
    'contentUpload.fileStatus',
    status,
    'contentUpload.fileStatus.other'
  );

export const runStatusLabel = (t: Translate, status: string) =>
  codeText(
    t,
    'contentUpload.runStatus',
    status,
    'contentUpload.runStatus.other'
  );

/** The text for the code of a file (MACRO_ENABLED, NO_TEXT, ...). */
export const fileCodeLabel = (t: Translate, code: string | null | undefined) =>
  codeText(t, 'contentUpload.code', code, 'contentUpload.code.other');

export const skipLabel = (t: Translate, code: string) =>
  codeText(t, 'contentUpload.skip', code, 'contentUpload.skip.other');

export const sourceLabel = (t: Translate, source: string) =>
  codeText(t, 'contentUpload.source', source, 'contentUpload.source.other');

export const bandLabel = (t: Translate, band: ProposalBand) =>
  t(`contentUpload.band.${band}`);

/** Symbol of a band, so that the meaning never rests on colour alone. */
export const BAND_SYMBOL: Record<ProposalBand, string> = {
  high: '✓',
  medium: '~',
  low: '?',
  conflict: '!',
};

/** The status of the supply (docs 8.9) as a word. */
export const stockLabel = (t: Translate, status: string) =>
  codeText(t, 'contentUpload.stock', status, 'contentUpload.stock.other');

/** Symbol of a status of the supply, so that the meaning never rests on colour alone. */
export const STOCK_SYMBOL: Record<string, string> = {
  new: '+',
  extended: '↑',
  differs: '≠',
  unchanged: '=',
  conflict: '!',
};

export const KIND_KEYS: Record<string, string> = {
  pflicht: 'contentUpload.kind.pflicht',
  wahl: 'contentUpload.kind.wahl',
  integrativ: 'contentUpload.kind.integrativ',
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(value: string | number | null, language: string) {
  if (value === null) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(language === 'en' ? 'en-GB' : 'de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
