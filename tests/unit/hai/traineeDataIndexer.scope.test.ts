/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../helpers/mockDb';

// Write path 4: lib/hai/traineeDataIndexer.ts. The personal chunks carry the
// occupation of the enrollment of the trainee, are visible to the audience of
// the search (it also filters by metadata.userId) and belong to the
// organization of the trainee. E-mail addresses do not go into the text any
// more (the text goes to the embedding model).

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = '11111111-1111-4111-8111-111111111111';

async function run(tables: Record<string, any[]>, trainerRows: any[] = []) {
  jest.resetModules();
  const hai = createTableDb(tables);
  hai.db.execute = jest.fn(async () => trainerRows);
  const main = createTableDb({});
  const indexContent = jest.fn(async (_item: unknown) => ({
    success: true,
    chunksIndexed: 1,
  }));
  jest.doMock('@/db/haiDb', () => ({ __esModule: true, default: hai.db }));
  jest.doMock('@/db', () => ({ __esModule: true, default: main.db }));
  jest.doMock('@/lib/hai/embeddings', () => ({
    __esModule: true,
    indexContent,
  }));
  const { indexTraineeData, indexAllContent } =
    await import('@/lib/hai/traineeDataIndexer');
  return { indexTraineeData, indexAllContent, indexContent };
}

const profile = {
  fullName: 'Azubi Eins',
  firstName: 'Azubi',
  email: 'azubi@example.com',
  role: 'TRAINEE',
  startOfTrainingDate: null,
  ausbildungDurationYears: 3,
  organizationId: ORG,
};

describe('personal chunks of a trainee', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('carry the occupation of the latest enrollment and the organization of the trainee', async () => {
    const { indexTraineeData, indexContent } = await run({
      profiles: [profile],
      traineeEnrollments: [
        { traineeId: 't1', trainingCatalogId: FIAE, startDate: '2024-08-01' },
        { traineeId: 't1', trainingCatalogId: KFBM, startDate: '2026-08-01' },
      ],
      ausbildungBlocks: [
        {
          blockType: 'SCHULE',
          startDate: '2026-09-01',
          endDate: '2026-10-01',
          schuljahr: '1',
          ausbildungsjahr: 1,
        },
      ],
    });
    await indexTraineeData('t1');
    const calls = indexContent.mock.calls.map(([item]) => item as any);
    expect(calls.map(c => c.sourceType)).toEqual(
      expect.arrayContaining(['trainee_profile', 'trainee_schedule'])
    );
    for (const call of calls) {
      expect(call.trainingCatalogId).toBe(KFBM);
      expect(call.visibility).toBe('all');
      expect(call.organizationId).toBe(ORG);
      expect(call.metadata.userId).toBe('t1');
    }
  });

  it('fall back to the FIAE catalog without an enrollment, organization null if unknown', async () => {
    const { indexTraineeData, indexContent } = await run({
      profiles: [{ ...profile, organizationId: null }],
      traineeEnrollments: [],
    });
    await indexTraineeData('t1');
    const [item] = indexContent.mock.calls[0] as any[];
    expect(item.trainingCatalogId).toBe(FIAE);
    expect(item.organizationId).toBeNull();
  });

  it('keep e-mail addresses out of the text that goes to the model', async () => {
    const { indexTraineeData, indexContent } = await run(
      { profiles: [profile], traineeEnrollments: [] },
      [{ full_name: 'Trainerin Zwei', email: 'trainerin@example.com' }]
    );
    await indexTraineeData('t1');
    const item = indexContent.mock.calls
      .map(([i]) => i as any)
      .find(i => i.sourceType === 'trainee_profile');
    expect(item.content).toContain('Name: Azubi Eins');
    expect(item.content).toContain('Ausbilder: Trainerin Zwei');
    expect(item.content).not.toContain('@');
    expect(item.content).not.toMatch(/E-Mail/);
  });
});

describe('shared content written by indexAllContent', () => {
  it('states the catalog of every course and enabler, visible to all, no organization', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { indexAllContent, indexContent } = await run({
      courses: [
        {
          id: 'c1',
          title: 'Kurs',
          year: 1,
          chapter: 1,
          trainingCatalogId: KFBM,
        },
      ],
      enablers: [
        {
          id: 'e1',
          title: 'Enabler',
          courseId: 'c1',
          descriptionText: 'Eine Beschreibung, lang genug für den Index.',
          trainingCatalogId: KFBM,
        },
      ],
    });
    await indexAllContent();
    const calls = indexContent.mock.calls.map(([item]) => item as any);
    expect(calls.map(c => c.sourceType).sort()).toEqual(['course', 'enabler']);
    for (const call of calls) {
      expect(call.trainingCatalogId).toBe(KFBM);
      expect(call.visibility).toBe('all');
      expect(call.organizationId).toBeNull();
    }
  });
});
