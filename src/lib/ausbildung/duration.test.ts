import {
  getComponentPhase,
  getContentStageDeadline,
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

describe('ausbildung duration helpers with a phase one length (KfBM S4)', () => {
  const start = new Date(2026, 7, 1);

  const dateKey = (date: Date) =>
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');

  it('keeps the legacy results when no phase one length is given', () => {
    // FIAE: 18 months (3 years) and 12 months (2 years)
    expect(getPhaseMonthRange(3, 1)).toEqual(getPhaseMonthRange(3, 1, 18));
    expect(getPhaseMonthRange(2, 1)).toEqual(getPhaseMonthRange(2, 1, 12));
    expect(getPhaseMonthRange(3, 2)).toEqual(getPhaseMonthRange(3, 2, 18));
    expect(getPhaseMonthRange(2, 2)).toEqual(getPhaseMonthRange(2, 2, 12));
    expect(dateKey(getPhaseDeadline(start, 3, 1))).toBe(
      dateKey(getPhaseDeadline(start, 3, 1, 18))
    );
    expect(dateKey(getPhaseDeadline(start, 2, 1))).toBe(
      dateKey(getPhaseDeadline(start, 2, 1, 12))
    );
  });

  it('uses 15 + 21 months for a 3-year plan with phase one of 15 months', () => {
    expect(getPhaseMonthRange(3, 1, 15)).toEqual({
      startMonth: 1,
      endMonth: 15,
    });
    expect(getPhaseMonthRange(3, 2, 15)).toEqual({
      startMonth: 16,
      endMonth: 36,
    });
    expect(getTrainingPhase(start, 3, new Date(2027, 9, 31), 15)).toBe(1);
    expect(getTrainingPhase(start, 3, new Date(2027, 10, 1), 15)).toBe(2);
    // the same date is still phase one under the FIAE rule
    expect(getTrainingPhase(start, 3, new Date(2027, 10, 1))).toBe(1);
    expect(dateKey(getPhaseDeadline(start, 3, 1, 15))).toBe('2027-11-01');
    expect(dateKey(getPhaseDeadline(start, 3, 2, 15))).toBe('2029-08-01');
    expect(dateKey(getContentStageDeadline(start, 1, 3, 15))).toBe(
      '2027-11-01'
    );
  });

  it('applies the phase one length to the phase date ranges', () => {
    const phaseOne = getPhaseDateRange(start, 1, 3, 15);
    expect(dateKey(phaseOne.startDate)).toBe('2026-08-01');
    expect(dateKey(phaseOne.endDate)).toBe('2027-10-31');

    const phaseTwo = getPhaseDateRange(start, 2, 3, 15);
    expect(dateKey(phaseTwo.startDate)).toBe('2027-11-01');
    expect(dateKey(phaseTwo.endDate)).toBe('2029-07-31');

    const integrative = getPhaseDateRange(start, 3, 3, 15);
    expect(dateKey(integrative.startDate)).toBe('2026-08-01');
    expect(dateKey(integrative.endDate)).toBe('2029-07-31');
  });

  it('does not change the end of the training', () => {
    expect(dateKey(getPhaseDeadline(start, 3, 3, 15))).toBe(
      dateKey(getTrainingEndDate(start, 3))
    );
    expect(dateKey(getPhaseDeadline(start, 2, 2, 10))).toBe(
      dateKey(getTrainingEndDate(start, 2))
    );
  });

  it('uses 10 + 14 months for a prorated 2-year plan', () => {
    expect(getPhaseMonthRange(2, 1, 10)).toEqual({
      startMonth: 1,
      endMonth: 10,
    });
    expect(getPhaseMonthRange(2, 2, 10)).toEqual({
      startMonth: 11,
      endMonth: 24,
    });
    expect(dateKey(getPhaseDeadline(start, 2, 1, 10))).toBe('2027-06-01');
  });

  it.each([
    ['zero', 0],
    ['a negative number', -3],
    ['a fraction', 12.5],
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['the whole training', 36],
    ['more than the training', 40],
    ['null', null],
    ['undefined', undefined],
  ])('ignores %s as phase one length', (_label, value) => {
    const phaseOneMonths = value as number | null | undefined;
    expect(getPhaseMonthRange(3, 1, phaseOneMonths)).toEqual(
      getPhaseMonthRange(3, 1)
    );
    expect(
      getTrainingPhase(start, 3, new Date(2028, 1, 1), phaseOneMonths)
    ).toBe(2);
    expect(
      getTrainingPhase(start, 3, new Date(2028, 0, 31), phaseOneMonths)
    ).toBe(1);
    expect(dateKey(getPhaseDeadline(start, 3, 1, phaseOneMonths))).toBe(
      '2028-02-01'
    );
    expect(
      dateKey(getPhaseDateRange(start, 1, 3, phaseOneMonths).endDate)
    ).toBe('2028-01-31');
  });
});

describe('getComponentPhase', () => {
  it('uses the phase column when it is set', () => {
    expect(getComponentPhase({ phase: 1, orderIndex: 20 })).toBe(1);
    expect(getComponentPhase({ phase: 2, orderIndex: 1 })).toBe(2);
    expect(
      getComponentPhase({ phase: 2, kind: 'pflicht', orderIndex: 99 })
    ).toBe(2);
  });

  it('treats an integrative component without a phase as phase 3', () => {
    expect(getComponentPhase({ phase: null, kind: 'integrativ' })).toBe(3);
    expect(
      getComponentPhase({ phase: null, kind: 'integrativ', orderIndex: 5 })
    ).toBe(3);
  });

  it('falls back to the order index of the 26 ARP components', () => {
    // FIAE rows without a filled phase column keep their old phase
    expect(getComponentPhase({ phase: null, orderIndex: 1 })).toBe(1);
    expect(getComponentPhase({ orderIndex: 12 })).toBe(1);
    expect(getComponentPhase({ phase: null, orderIndex: 13 })).toBe(2);
    expect(getComponentPhase({ phase: null, orderIndex: 22 })).toBe(2);
    expect(getComponentPhase({ phase: null, orderIndex: 23 })).toBe(3);
    expect(getComponentPhase({ phase: null, orderIndex: 26 })).toBe(3);
    expect(
      getComponentPhase({ phase: null, kind: 'pflicht', orderIndex: 7 })
    ).toBe(1);
  });

  it('has no phase when neither column nor order index decide', () => {
    expect(getComponentPhase({})).toBeNull();
    expect(getComponentPhase({ phase: null, orderIndex: 0 })).toBeNull();
    expect(getComponentPhase({ phase: null, orderIndex: 27 })).toBeNull();
    expect(
      getComponentPhase({ phase: null, kind: 'wahl', orderIndex: 40 })
    ).toBeNull();
  });

  it('does not give an elective component without a phase the phase of its order index', () => {
    // An elective component (kind wahl) is only used by other occupations. Its
    // order index is not part of the 26 ARP components, so it must not land in
    // phase 1 or 2 by accident.
    expect(
      getComponentPhase({ phase: null, kind: 'wahl', orderIndex: 5 })
    ).toBeNull();
    expect(
      getComponentPhase({ phase: null, kind: 'wahl', orderIndex: 15 })
    ).toBeNull();
    // With a phase column an elective component still has its phase
    expect(getComponentPhase({ phase: 2, kind: 'wahl', orderIndex: 5 })).toBe(2);
  });

  it('ignores an invalid phase value and falls back', () => {
    expect(getComponentPhase({ phase: 0, orderIndex: 14 })).toBe(2);
    expect(getComponentPhase({ phase: 7, orderIndex: 3 })).toBe(1);
    expect(getComponentPhase({ phase: 1.5, orderIndex: 3 })).toBe(1);
  });
});
