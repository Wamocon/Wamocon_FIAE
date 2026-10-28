import {
  buildTrainingComponentMetadata,
  componentDurationText,
} from '@/lib/hai/componentMetadata';
import {
  buildHaiTrainingScope,
  isMetadataAllowedForTrainingScope,
} from '@/lib/hai/trainingScope';

// Metadata of a training component in the HAI index (scripts/reindex-gemini.ts,
// KfBM S4b): the keys that exist stay as they are, the phase column and the
// kind of the component are added, so the training scope can decide with the
// phase of the occupation instead of the order index of the 26 ARP components.

const row = {
  code: '§4.2.1',
  training_year: 1,
  total_hours: 120,
  phase: 1,
  kind: 'pflicht',
};

describe('buildTrainingComponentMetadata', () => {
  it('keeps the existing keys and values exactly', () => {
    const metadata = buildTrainingComponentMetadata(row, 3);
    expect(metadata).toMatchObject({
      componentCode: '§4.2.1',
      trainingYear: 1,
      totalHours: 120,
      useCaseCount: 3,
    });
    expect(Object.keys(metadata).slice(0, 4)).toEqual([
      'componentCode',
      'trainingYear',
      'totalHours',
      'useCaseCount',
    ]);
  });

  it('adds only componentPhase and componentKind as new keys', () => {
    const metadata = buildTrainingComponentMetadata(row, 3);
    expect(Object.keys(metadata).slice(4)).toEqual([
      'componentPhase',
      'componentKind',
    ]);
    expect(metadata.componentPhase).toBe(1);
    expect(metadata.componentKind).toBe('pflicht');
  });

  it('writes null for an integrative component (no phase)', () => {
    const metadata = buildTrainingComponentMetadata(
      { ...row, training_year: 3, phase: null, kind: 'integrativ' },
      0
    );
    expect(metadata.componentPhase).toBeNull();
    expect(metadata.componentKind).toBe('integrativ');
  });

  it('writes null for rows of a database without the columns', () => {
    const { phase: _phase, kind: _kind, ...old } = row;
    const metadata = buildTrainingComponentMetadata(old, 3);
    expect(metadata.componentPhase).toBeNull();
    expect(metadata.componentKind).toBeNull();
    expect(metadata.trainingYear).toBe(1);
  });

  it('is plain data that survives JSON (the index stores it as jsonb)', () => {
    const metadata = buildTrainingComponentMetadata(row, 3);
    expect(JSON.parse(JSON.stringify(metadata))).toEqual(metadata);
  });
});

describe('training scope with the new keys', () => {
  // A trainee in month 3 of the training: phase 1 is open, phase 2 is not
  const scope = buildHaiTrainingScope(
    {
      role: 'TRAINEE',
      startOfTrainingDate: new Date(2026, 5, 1),
      ausbildungDurationYears: 3,
      phaseOneMonths: 15,
    },
    new Date(2026, 8, 1)
  );
  const allowed = (metadata: Record<string, unknown>) =>
    isMetadataAllowedForTrainingScope(metadata, 'document', scope);

  it('holds back a component of phase 2', () => {
    expect(
      allowed(
        buildTrainingComponentMetadata(
          { ...row, training_year: null as any, phase: 2 },
          1
        )
      )
    ).toBe(false);
  });

  it('lets a component of phase 1 through', () => {
    expect(allowed(buildTrainingComponentMetadata(row, 1))).toBe(true);
  });

  it('lets an integrative component through whatever the old year says', () => {
    expect(
      allowed(
        buildTrainingComponentMetadata(
          { ...row, training_year: 3, phase: null, kind: 'integrativ' },
          1
        )
      )
    ).toBe(true);
  });

  it('does not tie an elective component to a phase', () => {
    expect(
      allowed(
        buildTrainingComponentMetadata(
          { ...row, training_year: null as any, phase: null, kind: 'wahl' },
          1
        )
      )
    ).toBe(true);
  });
});

describe('componentDurationText', () => {
  it('names weeks and hours', () => {
    expect(componentDurationText(11, 440)).toBe(
      'Dauer: 11 Wochen / 440 Stunden'
    );
    expect(componentDurationText('22', '880')).toBe(
      'Dauer: 22 Wochen / 880 Stunden'
    );
  });

  it('leaves out a missing or 0 value, never writes 0 Stunden or 0 Wochen', () => {
    expect(componentDurationText(11, 0)).toBe('Dauer: 11 Wochen');
    expect(componentDurationText(11, null)).toBe('Dauer: 11 Wochen');
    expect(componentDurationText(0, 120)).toBe('Dauer: 120 Stunden');
    expect(componentDurationText(undefined, 120)).toBe('Dauer: 120 Stunden');
  });

  it('has no line without both values', () => {
    expect(componentDurationText(0, 0)).toBeNull();
    expect(componentDurationText(null, undefined)).toBeNull();
    expect(componentDurationText('', 'x')).toBeNull();
    expect(componentDurationText(-1, Number.NaN)).toBeNull();
  });
});
