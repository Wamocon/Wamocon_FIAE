'use client';

import { useLanguage } from '@/contexts/LanguageContext';

type Props = {
  /** Kind of seat, for example "Auszubildende". */
  label: string;
  occupied: number;
  limit: number;
};

/**
 * Occupied seats of one kind next to the limit. When no seat is left the
 * counter says so ("Voll"), and an organization that is over its limit (the
 * limit was lowered later) says that instead. The count is the one the API
 * enforces with 409 SEATS_FULL (src/lib/admin/seatRules.ts).
 */
export function SeatCounter({ label, occupied, limit }: Props) {
  const { t } = useLanguage();
  const full = occupied >= limit;
  const over = occupied > limit;
  return (
    <div
      role="group"
      aria-label={`${label}: ${t('admin.seats.occupied', { occupied, limit })}`}
      className={`rounded-xl p-3 ${full ? 'bg-amber-500/10' : 'bg-background/50'}`}
    >
      <div className="text-muted text-xs">{label}</div>
      <div className="text-foreground text-lg font-bold">
        {occupied}
        <span className="text-muted text-sm font-normal">/{limit}</span>
      </div>
      {full && (
        <span className="mt-1 inline-block rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-500">
          {over ? t('admin.seats.over') : t('admin.seats.full')}
        </span>
      )}
    </div>
  );
}
