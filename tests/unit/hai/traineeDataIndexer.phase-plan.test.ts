/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../helpers/mockDb';

// The profile text HAI indexes for a trainee names the current phase and its
// months (KfBM S4b). They follow the phase plan of the occupation of the
// trainee, read from the same database as the profile (the HAI database), so
// a FIAE trainee keeps "1. bis 18." and a KfBM trainee gets "16. bis 36.".

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';

const settings = {
  FIAE: { phase_months: [18, 18] },
  KFBM: { phase_months: [15, 21] },
} as const;

type Occupation = keyof typeof settings;

// 16 whole months ago: phase 1 under the FIAE rule (18), phase 2 for KfBM (15)
function sixteenMonthsAgo() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 16, 1);
}

async function profileTextOf(
  occupation: Occupation,
  durationYears: number,
  start: Date | null = sixteenMonthsAgo()
) {
  jest.resetModules();
  const id = occupation === 'FIAE' ? FIAE : KFBM;
  const hai = createTableDb({
    profiles: [
      {
        fullName: 'Azubi Eins',
        firstName: 'Azubi',
        email: 'azubi@example.com',
        role: 'TRAINEE',
        startOfTrainingDate: start,
        ausbildungDurationYears: durationYears,
      },
    ],
    traineeEnrollments:
      occupation === 'KFBM'
        ? [
            {
              traineeId: 't1',
              trainingCatalogId: KFBM,
              startDate: '2026-08-01',
            },
          ]
        : [],
    trainingCatalogs: [{ id, settings: settings[occupation] }],
  });
  // The main database must stay out of it: HAI reads everything from its own
  const main = createTableDb({});
  const indexContent = jest.fn(async () => ({
    success: true,
    chunksIndexed: 1,
  }));
  jest.doMock('@/db/haiDb', () => ({ __esModule: true, default: hai.db }));
  jest.doMock('@/db', () => ({ __esModule: true, default: main.db }));
  jest.doMock('@/lib/hai/embeddings', () => ({
    __esModule: true,
    indexContent,
  }));
  const { indexTraineeData } = await import('@/lib/hai/traineeDataIndexer');
  await indexTraineeData('t1');
  const call = (indexContent.mock.calls as any[][]).find(
    ([item]) => item.sourceType === 'trainee_profile'
  );
  return { text: call?.[0].content as string, main };
}

describe('HAI trainee profile text: current phase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('FIAE: month 16 is phase 1 (1. bis 18. Ausbildungsmonat), as before', async () => {
    const { text } = await profileTextOf('FIAE', 3);
    expect(text).toContain(
      'Aktuelle Modulphase: Phase 1 (1. bis 18. Ausbildungsmonat)'
    );
  });

  it('FIAE shortened (2 years): month 16 is phase 2 (13. bis 24.), as before', async () => {
    const { text } = await profileTextOf('FIAE', 2);
    expect(text).toContain(
      'Aktuelle Modulphase: Phase 2 (13. bis 24. Ausbildungsmonat)'
    );
  });

  it('KfBM: month 16 is phase 2 (16. bis 36. Ausbildungsmonat)', async () => {
    const { text } = await profileTextOf('KFBM', 3);
    expect(text).toContain(
      'Aktuelle Modulphase: Phase 2 (16. bis 36. Ausbildungsmonat)'
    );
  });

  it('KfBM shortened (2 years): month 16 is phase 2 (11. bis 24.)', async () => {
    const { text } = await profileTextOf('KFBM', 2);
    expect(text).toContain(
      'Aktuelle Modulphase: Phase 2 (11. bis 24. Ausbildungsmonat)'
    );
  });

  it('reads the phase plan from the HAI database, not from the main database', async () => {
    const { main } = await profileTextOf('KFBM', 3);
    expect(main.calls).toHaveLength(0);
  });

  it('names no phase and asks for no plan without a start date', async () => {
    const { text } = await profileTextOf('KFBM', 3, null);
    expect(text).not.toContain('Aktuelle Modulphase');
  });
});
