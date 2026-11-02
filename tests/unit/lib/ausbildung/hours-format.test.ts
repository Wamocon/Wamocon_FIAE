import {
  formatHours,
  remainingAfterEntry,
} from '@/lib/ausbildung/hours-format';

// WMCNL-2943: "80.0 Std übrig" never moved and wrote a point. The hours read
// "80" and "72,5" in German.
describe('formatHours', () => {
  it('writes whole hours without a decimal', () => {
    expect(formatHours(80)).toBe('80');
    expect(formatHours(72.0)).toBe('72');
  });

  it('uses the comma in German and the point in English', () => {
    expect(formatHours(72.5)).toBe('72,5');
    expect(formatHours(72.5, 'de')).toBe('72,5');
    expect(formatHours(72.5, 'en')).toBe('72.5');
  });

  it('rounds to one decimal and survives rubbish', () => {
    expect(formatHours(71.46)).toBe('71,5');
    expect(formatHours(0.04)).toBe('0');
    expect(formatHours(NaN)).toBe('0');
    expect(formatHours(-3.5)).toBe('-3,5');
  });
});

describe('remainingAfterEntry', () => {
  it('takes the typed hours off what the server counts', () => {
    expect(remainingAfterEntry(80, 8)).toBe(72);
    expect(remainingAfterEntry(80, 0)).toBe(80);
  });

  it('counts an empty or broken input as 0', () => {
    expect(remainingAfterEntry(80, undefined)).toBe(80);
    expect(remainingAfterEntry(80, null)).toBe(80);
    expect(remainingAfterEntry(80, NaN)).toBe(80);
  });

  it('can go below zero (the form warns then)', () => {
    expect(remainingAfterEntry(5, 8)).toBe(-3);
  });
});
