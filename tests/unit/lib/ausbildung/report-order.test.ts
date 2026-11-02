import { compareReportsNewestWeekFirst } from '@/lib/ausbildung/report-order';

// WMCNL-2942: the list "Meine Nachweise" was sorted by the day of creation:
// a new draft for KW 44 stood on top of KW 41, 42, 43 (ascending), and in the
// other tab KW 43 stood before KW 42.

const report = (weekNumber: number, createdAt: string, year = 2026) => ({
  weekNumber,
  year,
  createdAt,
});

describe('compareReportsNewestWeekFirst', () => {
  it('puts the newest calendar week on top whatever the creation order was', () => {
    const list = [
      report(41, '2026-10-10T08:00:00Z'),
      report(43, '2026-10-24T08:00:00Z'),
      report(42, '2026-10-30T08:00:00Z'),
      report(44, '2026-11-02T08:00:00Z'),
    ];
    expect(
      [...list].sort(compareReportsNewestWeekFirst).map(r => r.weekNumber)
    ).toEqual([44, 43, 42, 41]);
  });

  it('puts the year before the week', () => {
    const list = [
      report(52, '2025-12-20T08:00:00Z', 2025),
      report(2, '2026-01-10T08:00:00Z'),
    ];
    expect(
      [...list].sort(compareReportsNewestWeekFirst).map(r => r.year)
    ).toEqual([2026, 2025]);
  });

  it('uses the creation date only to break a tie', () => {
    const list = [
      report(41, '2026-10-10T08:00:00Z'),
      report(41, '2026-10-12T08:00:00Z'),
    ];
    expect(
      [...list].sort(compareReportsNewestWeekFirst).map(r => r.createdAt)
    ).toEqual(['2026-10-12T08:00:00Z', '2026-10-10T08:00:00Z']);
  });
});
