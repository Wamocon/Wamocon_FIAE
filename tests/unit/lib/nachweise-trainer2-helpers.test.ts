import { activityReportHasContent } from '@/lib/submission-input';
import {
  approveMissing,
  formatHours,
  reviewTitleKey,
} from '@/lib/trainer/report-review';
import {
  checkExamPoints,
  deriveMaxPoints,
  isAboveMax,
} from '@/lib/school/exam-points';
import {
  formatPeriodDate,
  generateBlockers,
} from '@/lib/arbeitszeugnis/review-state';
import { resolveTrainingYearPeriod } from '@/lib/arbeitszeugnis/period';

describe('activityReportHasContent (WMCNL-3011)', () => {
  it.each([
    [undefined, false],
    [null, false],
    [[], false],
    [[{ actualHours: 0 }], false],
    [[{ actualHours: '0' }], false],
    [[{ actualHours: -2 }], false],
    [['x', null], false],
    [[{ actualHours: 0 }, { actualHours: 4 }], true],
    [[{ actualHours: '2.5' }], true],
  ])('%j -> %s', (entries, expected) => {
    expect(activityReportHasContent(entries)).toBe(expected);
  });
});

describe('review dialog helpers (WMCNL-3011, 3012)', () => {
  it('the title says "prüfen" only for a report to check', () => {
    expect(reviewTitleKey('SUBMITTED')).toBe('trainer.reports.modal.title');
    expect(reviewTitleKey('APPROVED')).toBe(
      'trainer.reports.modal.titleApproved'
    );
    expect(reviewTitleKey('REJECTED')).toBe(
      'trainer.reports.modal.titleRejected'
    );
    expect(reviewTitleKey('DRAFT')).toBe('trainer.reports.modal.titleDraft');
  });

  it('writes hours with a comma in German and a point in English', () => {
    expect(formatHours(0, 'de', true)).toBe('0,0');
    expect(formatHours(7.5, 'de')).toBe('7,5');
    expect(formatHours(8, 'de')).toBe('8');
    expect(formatHours(8, 'de', true)).toBe('8,0');
    expect(formatHours(-1.5, 'de', true)).toBe('-1,5');
    expect(formatHours(0, 'en', true)).toBe('0.0');
    expect(formatHours(Number.NaN, 'de')).toBe('0');
  });

  it('says what is missing before the approval', () => {
    const all = { entryCount: 2, allEntriesGraded: true, allSkillsRated: true };
    expect(approveMissing(all)).toEqual([]);
    expect(approveMissing({ ...all, allEntriesGraded: false })).toEqual([
      'grades',
    ]);
    expect(
      approveMissing({ ...all, allEntriesGraded: false, allSkillsRated: false })
    ).toEqual(['grades', 'skills']);
    expect(approveMissing({ ...all, entryCount: 0 })).toEqual(['entries']);
  });
});

describe('exam points (WMCNL-3016)', () => {
  it('takes whole points from 0 up to the maximum', () => {
    expect(checkExamPoints(0, 100)).toEqual({
      ok: true,
      points: 0,
      maxPoints: 100,
    });
    expect(checkExamPoints('100', '100')).toMatchObject({ ok: true });
  });

  it.each([
    [150, 100, 'POINTS_ABOVE_MAX'],
    [-1, 100, 'POINTS_INVALID'],
    [2.5, 100, 'POINTS_INVALID'],
    ['', 100, 'POINTS_INVALID'],
    [Number.NaN, 100, 'POINTS_INVALID'],
    [5, 0, 'MAX_POINTS_INVALID'],
    [5, 100001, 'MAX_POINTS_INVALID'],
    [5, undefined, 'MAX_POINTS_INVALID'],
  ])('%j of %j is %s', (points, max, code) => {
    expect(checkExamPoints(points, max)).toEqual({ ok: false, code });
  });

  it('derives the maximum of a saved result and tells one above it', () => {
    expect(deriveMaxPoints(70, 70)).toBe(100);
    expect(deriveMaxPoints(150, 150)).toBe(100);
    expect(deriveMaxPoints(12, 80)).toBe(15);
    expect(deriveMaxPoints(0, 0)).toBeNull();
    expect(deriveMaxPoints(null, 50)).toBeNull();
    expect(deriveMaxPoints(5, null)).toBeNull();
    expect(isAboveMax(150, 100)).toBe(true);
    expect(isAboveMax(100, 100)).toBe(false);
    expect(isAboveMax(5, null)).toBe(false);
  });
});

describe('certificate page helpers (WMCNL-3013, 3014)', () => {
  it('names what keeps the buttons of the Gesamturteil grey', () => {
    expect(generateBlockers({ overallGrade: 2, overallAverage: 2.4 })).toEqual(
      []
    );
    expect(
      generateBlockers({ overallGrade: null, overallAverage: 2.4 })
    ).toEqual(['grade']);
    expect(generateBlockers({ overallGrade: 2, overallAverage: null })).toEqual(
      ['components']
    );
    expect(generateBlockers({ overallGrade: null, overallAverage: 0 })).toEqual(
      ['grade', 'components']
    );
  });

  it('shows the last day of the period as that day, not the next one', () => {
    // the end of the period is the end of 31 July (UTC), not 1 August
    expect(formatPeriodDate('2026-07-31T23:59:59.999Z')).toBe('31.7.2026');
    expect(formatPeriodDate('2025-08-01T00:00:00.000Z')).toBe('1.8.2025');
    expect(formatPeriodDate(null)).toBe('–');
    expect(formatPeriodDate('nonsense')).toBe('–');
  });

  it('has no period without a start of the training', () => {
    expect(
      resolveTrainingYearPeriod({
        startDate: null,
        ausbildungsjahr: 1,
        durationYears: 3,
      })
    ).toBeNull();
    expect(
      resolveTrainingYearPeriod({
        startDate: 'not a date',
        ausbildungsjahr: 1,
        durationYears: 3,
      })
    ).toBeNull();
    const range = resolveTrainingYearPeriod({
      startDate: new Date(2026, 7, 1),
      ausbildungsjahr: 1,
      durationYears: 3,
    });
    expect(range?.startDate.getFullYear()).toBe(2026);
  });
});
