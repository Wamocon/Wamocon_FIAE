import { getISOWeekDates, getISOWeekInfo } from './iso-week';

describe('iso week helpers', () => {
  const dateKey = (date: Date) => date.toISOString().slice(0, 10);

  it('returns the ISO week-year, not the plain calendar year', () => {
    expect(getISOWeekInfo(new Date('2021-01-01T12:00:00Z'))).toEqual({
      week: 53,
      year: 2020,
    });
  });

  it('calculates Monday through Sunday for ISO week dates', () => {
    const kw1 = getISOWeekDates(1, 2026);
    expect(dateKey(kw1.start)).toBe('2025-12-29');
    expect(dateKey(kw1.end)).toBe('2026-01-04');
  });
});
