import { getTrainingPhase } from '@/lib/ausbildung/duration';
import {
  getDaysInMonth,
  getFirstDayOfMonth,
  isDateInBlock,
} from '@/lib/school/calendar';
import {
  calculateAusbildungsjahr,
  getCurrentSchuljahr,
  getISOWeek,
} from '@/lib/school/schuljahr';
import { isPermissionError } from '@/lib/hai/voice/client/permission-error';
import { escapeRegExp } from '@/lib/regex-escape';
import { isRecord } from '@/lib/type-guards';

describe('school helpers', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('getCurrentSchuljahr starts the school year in August', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 31));
    expect(getCurrentSchuljahr()).toBe('2025/2026');
    jest.setSystemTime(new Date(2026, 7, 1));
    expect(getCurrentSchuljahr()).toBe('2026/2027');
  });

  it('calculateAusbildungsjahr delegates to getTrainingPhase', () => {
    const start = new Date(2024, 7, 1);
    const at = new Date(2026, 1, 15);
    expect(calculateAusbildungsjahr(start, 3, at)).toBe(
      getTrainingPhase(start, 3, at)
    );
  });

  it('getISOWeek handles the turn of the year', () => {
    expect(getISOWeek(new Date(2025, 11, 29))).toBe(1);
    expect(getISOWeek(new Date(2026, 0, 1))).toBe(1);
  });
});

describe('calendar helpers', () => {
  it('getDaysInMonth uses 0-based months', () => {
    expect(getDaysInMonth(2024, 1)).toBe(29);
    expect(getDaysInMonth(2026, 10)).toBe(30);
  });

  it('getFirstDayOfMonth counts Monday as 0', () => {
    expect(getFirstDayOfMonth(2026, 0)).toBe(3);
    expect(getFirstDayOfMonth(2026, 10)).toBe(6);
  });

  it('isDateInBlock includes both end days', () => {
    const block = { startDate: '2026-03-02', endDate: '2026-03-06' };
    expect(isDateInBlock(new Date(2026, 2, 2, 8, 0), block)).toBe(true);
    expect(isDateInBlock(new Date(2026, 2, 6, 23, 0), block)).toBe(true);
    expect(isDateInBlock(new Date(2026, 2, 1, 23, 59), block)).toBe(false);
    expect(isDateInBlock(new Date(2026, 2, 7, 0, 0), block)).toBe(false);
  });
});

describe('isRecord', () => {
  it('accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe('escapeRegExp', () => {
  it('escapes special characters so the text matches literally', () => {
    expect(escapeRegExp('a.b')).toBe('a\\.b');
    const source = 'a.b*c?(d)[e]{f}|g^h$i\\j';
    expect(new RegExp(escapeRegExp(source)).test(source)).toBe(true);
    expect(new RegExp(escapeRegExp('a.b*c')).test('axbbc')).toBe(false);
  });
});

describe('isPermissionError', () => {
  it('recognises the browser permission error names', () => {
    expect(isPermissionError({ name: 'NotAllowedError' })).toBe(true);
    expect(isPermissionError({ name: 'SecurityError' })).toBe(true);
    expect(isPermissionError({ name: 'AbortError' })).toBe(false);
    expect(isPermissionError(new Error('x'))).toBe(false);
    expect(isPermissionError(null)).toBe(false);
  });
});
