import {
  daysFromToday,
  isoWeekOf,
  isoWeekOfDate,
  startOfToday,
} from '@/lib/school/day';

// The calendar day of the platform (Germany) as an instant, and the ISO week.

describe('startOfToday', () => {
  it.each([
    ['2026-11-05T10:00:00.000Z', '2026-11-04T23:00:00.000Z'],
    // 00:30 on 5 November in Berlin is still 4 November in UTC
    ['2026-11-04T23:30:00.000Z', '2026-11-04T23:00:00.000Z'],
    // just before midnight in Berlin
    ['2026-11-04T22:59:59.000Z', '2026-11-03T23:00:00.000Z'],
    // summer time (UTC+2)
    ['2026-07-05T10:00:00.000Z', '2026-07-04T22:00:00.000Z'],
    // the day summer time starts (29 March 2026, 02:00 becomes 03:00)
    ['2026-03-29T12:00:00.000Z', '2026-03-28T23:00:00.000Z'],
    // the day summer time ends (25 October 2026, 03:00 becomes 02:00)
    ['2026-10-25T12:00:00.000Z', '2026-10-24T22:00:00.000Z'],
  ])('%s starts the day at %s', (now, start) => {
    expect(startOfToday(new Date(now)).toISOString()).toBe(start);
  });

  it('takes another time zone when asked', () => {
    expect(
      startOfToday(new Date('2026-11-05T10:00:00.000Z'), 'UTC').toISOString()
    ).toBe('2026-11-05T00:00:00.000Z');
  });
});

describe('daysFromToday', () => {
  const now = new Date('2026-11-05T10:00:00.000Z');

  it('a date without a time on today is today, not past', () => {
    expect(daysFromToday(new Date('2026-11-05T00:00:00.000Z'), now)).toEqual({
      daysUntil: 0,
      isPast: false,
      isToday: true,
      isSoon: true,
    });
  });

  it('counts the days to a later date', () => {
    const later = daysFromToday(new Date('2026-11-20T00:00:00.000Z'), now);
    expect(later).toMatchObject({
      daysUntil: 15,
      isPast: false,
      isSoon: false,
    });
    expect(
      daysFromToday(new Date('2026-11-12T00:00:00.000Z'), now).isSoon
    ).toBe(true);
  });

  it('yesterday is past', () => {
    expect(daysFromToday(new Date('2026-11-04T00:00:00.000Z'), now)).toEqual({
      daysUntil: -1,
      isPast: true,
      isToday: false,
      isSoon: false,
    });
  });
});

describe('ISO week', () => {
  it.each([
    [2026, 1, 1, 1],
    [2026, 1, 4, 1],
    [2026, 1, 5, 2],
    [2026, 11, 5, 45],
    [2026, 12, 31, 53],
    [2027, 1, 1, 53],
    [2027, 1, 4, 1],
    [2024, 12, 30, 1],
  ])('%i-%i-%i is week %i', (y, m, d, week) => {
    expect(isoWeekOfDate(y, m, d)).toBe(week);
  });

  it('takes the date of Germany for an instant', () => {
    // Sunday 3 January 2027 23:30 UTC is Monday 4 January in Berlin (week 1)
    expect(isoWeekOf(new Date('2027-01-03T23:30:00.000Z'))).toBe(1);
    expect(isoWeekOf(new Date('2027-01-03T22:30:00.000Z'))).toBe(53);
  });
});
