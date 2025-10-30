import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  cn,
  calculateProgress,
  getProgressBarColor,
  truncateText,
  slugify,
  isValidEmail,
  handleError,
  debounce,
  throttle,
  formatDate,
  formatDateTime,
} from '@/lib/utils';

describe('lib/utils', () => {
  it('cn merges class names deterministically', () => {
    expect(cn('a', 'b', { c: true }, ['d', null as any])).toBe('a b c d');
  });

  it('calculateProgress handles zero total', () => {
    expect(calculateProgress(0, 0)).toBe(0);
    expect(calculateProgress(3, 5)).toBe(60);
  });

  it('getProgressBarColor maps thresholds', () => {
    expect(getProgressBarColor(85)).toBe('bg-green-500');
    expect(getProgressBarColor(65)).toBe('bg-yellow-500');
    expect(getProgressBarColor(45)).toBe('bg-orange-500');
    expect(getProgressBarColor(10)).toBe('bg-red-500');
  });

  it('progress color functions include boundary values', () => {
    expect(getProgressBarColor(80)).toBe('bg-green-500');
    expect(getProgressBarColor(60)).toBe('bg-yellow-500');
    expect(getProgressBarColor(40)).toBe('bg-orange-500');
    const { getProgressColor } = require('@/lib/utils');
    expect(getProgressColor(80)).toBe('text-green-500');
    expect(getProgressColor(60)).toBe('text-yellow-500');
    expect(getProgressColor(40)).toBe('text-orange-500');
    expect(getProgressColor(10)).toBe('text-red-500');
  });

  it('truncateText appends ellipsis if longer', () => {
    expect(truncateText('hello', 10)).toBe('hello');
    expect(truncateText('hello world', 5)).toBe('hello...');
  });

  it('slugify normalizes strings', () => {
    expect(slugify('Hello World!')).toBe('hello-world');
    expect(slugify('  Multiple   Spaces ')).toBe('multiple-spaces');
  });

  it('isValidEmail basic validation', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('bad@@example')).toBe(false);
  });

  it('handleError formats various inputs', () => {
    expect(handleError(new Error('boom'))).toBe('boom');
    expect(handleError('bad')).toBe('bad');
    expect(handleError(42)).toBe('Ein unbekannter Fehler ist aufgetreten');
  });

  describe('debounce', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    it('delays invocation until silence', () => {
      const fn = jest.fn();
      const d = debounce(fn, 200);
      d('a');
      d('b');
      expect(fn).not.toHaveBeenCalled();
      jest.advanceTimersByTime(199);
      expect(fn).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('b');
    });
  });

  describe('throttle', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    it('limits calls within window', () => {
      const fn = jest.fn();
      const t = throttle(fn, 200);
      t(1);
      t(2);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(1);
      jest.advanceTimersByTime(200);
      t(3);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenCalledWith(3);
    });
  });

  it('date formatters output de-DE locale strings', () => {
    const fixed = new Date('2024-01-15T10:30:00Z');
    // Note: Exact string depends on environment timezone; just assert substrings
    const d = formatDate(fixed);
    const dt = formatDateTime(fixed);
    expect(d).toMatch(/2024/);
    expect(dt).toMatch(/2024/);
  });

  it('timeAgo covers key thresholds', () => {
    const now = new Date();
    const sec30 = new Date(now.getTime() - 30 * 1000);
    const min5 = new Date(now.getTime() - 5 * 60 * 1000);
    const hr2 = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const day3 = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const day40 = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);

    // Use direct import to avoid locale mismatches in assertions except where safe
    const { timeAgo } = require('@/lib/utils');
    expect(timeAgo(sec30)).toBe('Gerade eben');
    expect(timeAgo(min5)).toMatch(/vor 5 Minuten/);
    expect(timeAgo(hr2)).toMatch(/vor 2 Stunden/);
    expect(timeAgo(day3)).toMatch(/vor 3 Tagen/);
    // Fallback to formatDate for older than ~30 days
    expect(timeAgo(day40)).toMatch(/\d{4}/);
  });

  it('capitalizeFirst uppercases only first letter', () => {
    const { capitalizeFirst } = require('@/lib/utils');
    expect(capitalizeFirst('hello WORLD')).toBe('Hello world');
  });

  it('groupBy groups by key', () => {
    const { groupBy } = require('@/lib/utils');
    const rows = [
      { id: '1', kind: 'a' },
      { id: '2', kind: 'b' },
      { id: '3', kind: 'a' },
    ];
    const grouped = groupBy(rows, 'kind');
    expect(Object.keys(grouped)).toEqual(['a', 'b']);
    expect(grouped['a'].map((r: any) => r.id)).toEqual(['1', '3']);
  });

  it('sortBy respects direction and equality', () => {
    const { sortBy } = require('@/lib/utils');
    const rows = [
      { id: '2', n: 2 },
      { id: '1', n: 1 },
      { id: '1b', n: 1 },
    ];
    expect(sortBy(rows, 'n', 'asc').map((r: any) => r.id)).toEqual(['1', '1b', '2']);
    expect(sortBy(rows, 'n', 'desc').map((r: any) => r.id)).toEqual(['2', '1', '1b']);
  });

  it('localStorage helpers handle set/get and errors', () => {
    const { setLocalStorage, getLocalStorage } = require('@/lib/utils');
    setLocalStorage('k', { a: 1 });
    expect(getLocalStorage('k', null)).toEqual({ a: 1 });

    // simulate invalid JSON in storage to hit catch branch
    const spy = jest.spyOn(window.localStorage.__proto__, 'getItem');
    spy.mockImplementationOnce(() => 'not-json');
    expect(getLocalStorage('k', { b: 2 })).toEqual({ b: 2 });
    spy.mockRestore();

    // simulate setItem failure to cover setLocalStorage catch
    const setSpy = jest.spyOn(window.localStorage.__proto__, 'setItem');
    setSpy.mockImplementationOnce(() => { throw new Error('quota exceeded'); });
    setLocalStorage('k2', { a: 2 });
    setSpy.mockRestore();
  });

  it('isValidPassword enforces minimum length', () => {
    const { isValidPassword } = require('@/lib/utils');
    expect(isValidPassword('1234567')).toBe(false);
    expect(isValidPassword('12345678')).toBe(true);
  });
});
