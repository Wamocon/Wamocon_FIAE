/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import {
  compareEnrollments,
  effectiveEnrollmentTerms,
  firstEnrollment,
  isDateOnly,
  sortEnrollments,
  toDateOnly,
} from '@/lib/catalog/enrollments';

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';

describe('order of the enrollments of one trainee', () => {
  it('the training the trainee started with comes first', () => {
    const rows = [
      { trainingCatalogId: KFBM, createdAt: '2026-10-02T08:00:00.000Z' },
      { trainingCatalogId: FIAE, createdAt: '2026-09-01T08:00:00.000Z' },
    ];
    expect(sortEnrollments(rows).map(r => r.trainingCatalogId)).toEqual([
      FIAE,
      KFBM,
    ]);
    expect(firstEnrollment(rows)?.trainingCatalogId).toBe(FIAE);
  });

  it('reads Date objects as well as text', () => {
    const rows = [
      { trainingCatalogId: KFBM, createdAt: new Date('2026-10-02') },
      { trainingCatalogId: FIAE, createdAt: '2026-10-01T00:00:00Z' },
    ];
    expect(firstEnrollment(rows)?.trainingCatalogId).toBe(FIAE);
  });

  it('the start date decides when both were created at the same time', () => {
    const at = '2026-09-01T08:00:00.000Z';
    const rows = [
      { trainingCatalogId: KFBM, createdAt: at, startDate: '2026-09-01' },
      { trainingCatalogId: FIAE, createdAt: at, startDate: '2024-09-01' },
    ];
    expect(firstEnrollment(rows)?.trainingCatalogId).toBe(FIAE);
  });

  it('a missing start date sorts last, then the catalog id breaks the tie', () => {
    const rows = [
      { trainingCatalogId: KFBM, startDate: null },
      { trainingCatalogId: FIAE, startDate: '2024-09-01' },
    ];
    expect(firstEnrollment(rows)?.trainingCatalogId).toBe(FIAE);
    expect(
      compareEnrollments(
        { trainingCatalogId: FIAE },
        { trainingCatalogId: KFBM }
      )
    ).toBeLessThan(0);
    expect(
      compareEnrollments(
        { trainingCatalogId: KFBM },
        { trainingCatalogId: FIAE }
      )
    ).toBeGreaterThan(0);
  });

  it('an unusable created at counts as no value', () => {
    const rows = [
      { trainingCatalogId: KFBM, createdAt: 'not a date' },
      { trainingCatalogId: FIAE, createdAt: null },
    ];
    expect(firstEnrollment(rows)?.trainingCatalogId).toBe(FIAE);
  });

  it('does not change the list it is given and has no first of nothing', () => {
    const rows = [{ trainingCatalogId: KFBM }, { trainingCatalogId: FIAE }];
    sortEnrollments(rows);
    expect(rows[0].trainingCatalogId).toBe(KFBM);
    expect(firstEnrollment([])).toBeUndefined();
  });
});

describe('start date and duration of an enrollment', () => {
  const profile = { startDate: '2026-09-01', durationYears: 2 };

  it('the primary enrollment follows the profile', () => {
    expect(
      effectiveEnrollmentTerms({
        enrollment: { startDate: '2025-01-01', durationYears: 3 },
        isPrimary: true,
        profile,
      })
    ).toEqual({ startDate: '2026-09-01', durationYears: 2 });
  });

  it('the primary enrollment falls back to its row when the profile has nothing', () => {
    expect(
      effectiveEnrollmentTerms({
        enrollment: { startDate: '2025-01-01', durationYears: 3 },
        isPrimary: true,
        profile: { startDate: null, durationYears: null },
      })
    ).toEqual({ startDate: '2025-01-01', durationYears: 3 });
  });

  it('a further enrollment has its own start date and duration', () => {
    expect(
      effectiveEnrollmentTerms({
        enrollment: { startDate: '2027-03-01', durationYears: 3 },
        isPrimary: false,
        profile,
      })
    ).toEqual({ startDate: '2027-03-01', durationYears: 3 });
  });

  it('a further enrollment without a start date uses the one of the profile', () => {
    expect(
      effectiveEnrollmentTerms({
        enrollment: { startDate: null, durationYears: 3 },
        isPrimary: false,
        profile,
      })
    ).toEqual({ startDate: '2026-09-01', durationYears: 3 });
    expect(
      effectiveEnrollmentTerms({
        enrollment: {},
        isPrimary: false,
        profile: {},
      })
    ).toEqual({ startDate: null, durationYears: null });
  });
});

describe('dates', () => {
  it('takes the date part of a Date or of a text', () => {
    expect(toDateOnly(new Date('2026-09-01T12:00:00.000Z'))).toBe('2026-09-01');
    expect(toDateOnly('2026-02-15 00:00:00')).toBe('2026-02-15');
    expect(toDateOnly(null)).toBeNull();
    expect(toDateOnly(undefined)).toBeNull();
    expect(toDateOnly(new Date('nope'))).toBeNull();
  });

  it('accepts only real calendar dates in the form yyyy-mm-dd', () => {
    expect(isDateOnly('2026-09-01')).toBe(true);
    expect(isDateOnly('2024-02-29')).toBe(true);
    expect(isDateOnly('2026-02-29')).toBe(false);
    expect(isDateOnly('2026-13-01')).toBe(false);
    expect(isDateOnly('2026-9-1')).toBe(false);
    expect(isDateOnly('01.09.2026')).toBe(false);
    expect(isDateOnly(20260901)).toBe(false);
    expect(isDateOnly(null)).toBe(false);
  });
});
