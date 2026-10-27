'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import type { StockDto } from '@/lib/content-upload/review/types';
import {
  STOCK_SYMBOL,
  stockLabel,
} from '@/components/admin/content-upload/labels';

const STYLE: Record<string, string> = {
  new: 'border-green-600 bg-green-600/10',
  extended: 'border-blue-500 bg-blue-500/10',
  unchanged: 'border-border',
  differs: 'border-amber-500 bg-amber-500/10',
  conflict: 'border-red-500 bg-red-500/10',
};

/**
 * The status of the supply of a file (new, added, unchanged, differs, conflict) as a
 * word with a symbol, never colour alone. A status that is stale (the assignment was
 * corrected after the comparison) or missing says so instead of showing a value that
 * may be wrong.
 */
export function StockBadge({ stock }: { stock: StockDto | null }) {
  const { t } = useLanguage();
  if (!stock) {
    return <span className="text-muted">{t('contentUpload.stock.none')}</span>;
  }
  if (stock.stale) {
    return (
      <span className="text-muted text-xs">
        {t('contentUpload.stock.stale')}
      </span>
    );
  }
  return (
    <span
      className={`text-foreground inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-sm font-medium ${STYLE[stock.status] ?? 'border-border'}`}
    >
      <span aria-hidden="true" className="w-4 text-center font-bold">
        {STOCK_SYMBOL[stock.status] ?? '?'}
      </span>
      <span>{stockLabel(t, stock.status)}</span>
      {stock.status === 'extended' && stock.added > 0 && (
        <span className="text-muted text-xs font-normal">
          {t('contentUpload.stock.added', { count: stock.added })}
        </span>
      )}
    </span>
  );
}
