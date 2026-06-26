import {
  getPhaseDateRange,
  getPhaseDeadline,
  getPhaseMonthRange,
  getTrainingEndDate,
  getTrainingPhase,
  normalizeDurationYears,
} from './duration';

describe('ausbildung duration helpers', () => {
  const start = new Date(2026, 7, 1);

  const dateKey = (date: Date) =>
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');

  it('normalizes only supported 2-year and 3-year durations', () => {
    expect(normalizeDurationYears(2)).toBe(2);
    expect(normalizeDurationYears(3)).toBe(3);
    expect(normalizeDurationYears(1)).toBe(3);
    expect(normalizeDurationYears(null)).toBe(3);
  });

  it('uses 18+18 month phases for the 3-year standard plan', () => {
    expect(getTrainingPhase(start, 3, new Date(2028, 0, 31))).toBe(1);
    expect(getTrainingPhase(start, 3, new Date(2028, 1, 1))).toBe(2);
    expect(getPhaseMonthRange(3, 1)).toEqual({ startMonth: 1, endMonth: 18 });
    expect(getPhaseMonthRange(3, 2)).toEqual({ startMonth: 19, endMonth: 36 });
    expect(dateKey(getPhaseDeadline(start, 3, 1))).toBe('2028-02-01');
    expect(dateKey(getPhaseDeadline(start, 3, 2))).toBe('2029-08-01');
  });

  it('uses 12+12 month phases for the 2-year intensive plan', () => {
    expect(getTrainingPhase(start, 2, new Date(2027, 6, 31))).toBe(1);
    expect(getTrainingPhase(start, 2, new Date(2027, 7, 1))).toBe(2);
    expect(getPhaseMonthRange(2, 1)).toEqual({ startMonth: 1, endMonth: 12 });
    expect(getPhaseMonthRange(2, 2)).toEqual({ startMonth: 13, endMonth: 24 });
    expect(dateKey(getPhaseDeadline(start, 2, 1))).toBe('2027-08-01');
    expect(dateKey(getPhaseDeadline(start, 2, 2))).toBe('2028-08-01');
  });

  it('uses the whole selected duration for final and integrative ranges', () => {
    expect(dateKey(getTrainingEndDate(start, 2))).toBe('2028-08-01');

    const finalRange = getPhaseDateRange(start, 0, 2);
    expect(dateKey(finalRange.startDate)).toBe('2026-08-01');
    expect(dateKey(finalRange.endDate)).toBe('2028-07-31');
    expect(finalRange.endDate.getHours()).toBe(23);
    expect(finalRange.endDate.getMinutes()).toBe(59);

    const integrativeRange = getPhaseDateRange(start, 3, 3);
    expect(dateKey(integrativeRange.startDate)).toBe('2026-08-01');
    expect(dateKey(integrativeRange.endDate)).toBe('2029-07-31');
  });
});
