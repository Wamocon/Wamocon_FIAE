import {
  buildHaiTrainingScope,
  buildTrainingScopePrompt,
  isMetadataAllowedForTrainingScope,
} from '@/lib/hai/trainingScope';

// Training scope of HAI: which content phases a trainee may see. FIAE results
// must stay as they were, KfBM gets its own phase one length and the phase
// column of a component (KfBM S4).

const start = new Date(2026, 7, 1);
const trainee = (extra: Record<string, unknown> = {}) => ({
  role: 'TRAINEE' as const,
  startOfTrainingDate: start,
  ausbildungDurationYears: 3,
  ...extra,
});

describe('buildHaiTrainingScope', () => {
  describe('FIAE (no phase one length, unchanged)', () => {
    it('is in phase 1 up to the end of month 18', () => {
      const scope = buildHaiTrainingScope(trainee(), new Date(2028, 0, 31))!;
      expect(scope.currentPhase).toBe(1);
      expect(scope.allowedComponentPhases).toEqual([1, 3]);
      expect(scope.phaseMonthRange).toEqual({ startMonth: 1, endMonth: 18 });
      expect(scope.currentAusbildungsjahr).toBe(2);
    });

    it('is in phase 2 from month 19', () => {
      const scope = buildHaiTrainingScope(trainee(), new Date(2028, 1, 1))!;
      expect(scope.currentPhase).toBe(2);
      expect(scope.allowedComponentPhases).toEqual([1, 2, 3]);
      expect(scope.phaseMonthRange).toEqual({ startMonth: 19, endMonth: 36 });
    });

    it('uses 12 + 12 months for the shortened plan', () => {
      const profile = trainee({ ausbildungDurationYears: 2 });
      const before = buildHaiTrainingScope(profile, new Date(2027, 6, 31))!;
      const after = buildHaiTrainingScope(profile, new Date(2027, 7, 1))!;
      expect(before.currentPhase).toBe(1);
      expect(before.phaseMonthRange).toEqual({ startMonth: 1, endMonth: 12 });
      expect(after.currentPhase).toBe(2);
      expect(after.phaseMonthRange).toEqual({ startMonth: 13, endMonth: 24 });
    });

    it('treats a null phase one length like none', () => {
      const now = new Date(2027, 10, 1);
      expect(
        buildHaiTrainingScope(trainee({ phaseOneMonths: null }), now)
      ).toEqual(buildHaiTrainingScope(trainee(), now));
    });
  });

  describe('KfBM (phase one of 15 months)', () => {
    it('is still in phase 1 in month 15 and in phase 2 from month 16', () => {
      const profile = trainee({ phaseOneMonths: 15 });
      const before = buildHaiTrainingScope(profile, new Date(2027, 9, 31))!;
      const after = buildHaiTrainingScope(profile, new Date(2027, 10, 1))!;
      expect(before.currentPhase).toBe(1);
      expect(before.allowedComponentPhases).toEqual([1, 3]);
      expect(before.phaseMonthRange).toEqual({ startMonth: 1, endMonth: 15 });
      expect(after.currentPhase).toBe(2);
      expect(after.allowedComponentPhases).toEqual([1, 2, 3]);
      expect(after.phaseMonthRange).toEqual({ startMonth: 16, endMonth: 36 });
    });

    it('names the phase months in the prompt', () => {
      const scope = buildHaiTrainingScope(
        trainee({ phaseOneMonths: 15 }),
        new Date(2027, 10, 1)
      );
      expect(buildTrainingScopePrompt(scope)).toContain(
        'Phase 2 (16. bis 36. Ausbildungsmonat)'
      );
    });
  });

  it('has no scope for trainers and without a start date uses phase 1', () => {
    expect(
      buildHaiTrainingScope({ role: 'TRAINER', startOfTrainingDate: start })
    ).toBeUndefined();
    const scope = buildHaiTrainingScope({ role: 'TRAINEE' })!;
    expect(scope.currentPhase).toBe(1);
    expect(scope.allowedComponentPhases).toEqual([1, 3]);
  });
});

describe('isMetadataAllowedForTrainingScope with components', () => {
  const phaseOne = buildHaiTrainingScope(trainee(), new Date(2026, 9, 1))!;
  const phaseTwo = buildHaiTrainingScope(trainee(), new Date(2028, 5, 1))!;
  const allowed = (
    metadata: Record<string, unknown>,
    scope = phaseOne
  ): boolean => isMetadataAllowedForTrainingScope(metadata, 'document', scope);

  describe('rows without a filled phase column (FIAE, order index rule)', () => {
    it.each([
      [1, true],
      [12, true],
      [13, false],
      [22, false],
      [23, true],
      [26, true],
      [27, true],
    ])('order %i in phase 1 is allowed: %s', (order, expected) => {
      expect(allowed({ componentOrderIndex: order })).toBe(expected);
    });

    it('allows every order index in phase 2', () => {
      for (const order of [1, 13, 22, 23, 26]) {
        expect(allowed({ componentOrderIndex: order }, phaseTwo)).toBe(true);
      }
    });

    it.each([
      'componentOrderIndex',
      'trainingComponentOrder',
      'componentOrder',
    ])('reads the order from %s', key => {
      expect(allowed({ [key]: 14 })).toBe(false);
      expect(allowed({ [key]: 3 })).toBe(true);
    });

    it('reads the order from a numeric string', () => {
      expect(allowed({ componentOrderIndex: '14' })).toBe(false);
    });
  });

  describe('with the phase column', () => {
    it('lets the column win over the order index', () => {
      // order 14 would be phase 2 by the old rule
      expect(allowed({ componentOrderIndex: 14, componentPhase: 1 })).toBe(
        true
      );
      expect(allowed({ componentOrderIndex: 3, componentPhase: 2 })).toBe(
        false
      );
    });

    it('reads the phase from trainingComponentPhase as well', () => {
      expect(allowed({ trainingComponentPhase: 2 })).toBe(false);
      expect(allowed({ trainingComponentPhase: 1 })).toBe(true);
    });

    it('allows phase 2 components once phase 2 has begun', () => {
      expect(allowed({ componentPhase: 2 }, phaseTwo)).toBe(true);
    });

    it('treats an integrative component as always allowed', () => {
      expect(
        allowed({ componentKind: 'integrativ', componentOrderIndex: 40 })
      ).toBe(true);
    });

    it('ignores an invalid phase value and falls back to the order', () => {
      expect(allowed({ componentPhase: 9, componentOrderIndex: 14 })).toBe(
        false
      );
      expect(allowed({ componentPhase: 'x', componentOrderIndex: 3 })).toBe(
        true
      );
    });
  });

  it('allows metadata without a component hint', () => {
    expect(allowed({})).toBe(true);
    expect(allowed({ type: 'lernfeld' })).toBe(true);
  });

  it('does not restrict when there is no scope or no metadata', () => {
    expect(
      isMetadataAllowedForTrainingScope(
        { componentOrderIndex: 14 },
        'doc',
        undefined
      )
    ).toBe(true);
    expect(isMetadataAllowedForTrainingScope(undefined, 'doc', phaseOne)).toBe(
      true
    );
  });
});
