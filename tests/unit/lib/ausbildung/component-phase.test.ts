import { componentPhase } from '@/lib/ausbildung/component-phase';

describe('componentPhase', () => {
  it('uses the phase of a catalog component (KfBM has no training year)', () => {
    expect(componentPhase({ phase: 1, trainingYear: null })).toBe(1);
    expect(componentPhase({ phase: 2, trainingYear: null })).toBe(2);
  });

  it('falls back to the training year of the old FIAE rows', () => {
    expect(componentPhase({ phase: null, trainingYear: 1 })).toBe(1);
    expect(componentPhase({ phase: undefined, trainingYear: 2 })).toBe(2);
    expect(componentPhase({ trainingYear: 3 })).toBe(3);
  });

  it('puts everything else under the integrative group', () => {
    expect(componentPhase({ phase: null, trainingYear: null })).toBe(3);
    expect(componentPhase({})).toBe(3);
    expect(componentPhase({ phase: 7, trainingYear: 9 })).toBe(3);
  });

  it('lets the phase win over the training year', () => {
    expect(componentPhase({ phase: 2, trainingYear: 1 })).toBe(2);
  });
});
