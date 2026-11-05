/**
 * @jest-environment node
 */
import { createTableDb } from '../../../helpers/mockDb';

// The loader of the trainer pages counts the courses of the trainee like the
// course list of the trainee does: a course with is_active = false counts
// nowhere. Before, the trainer pages counted it (two Preview trainees: 164 of
// 188 enablers instead of 163 of 186). The mock ignores where(), so the rendered
// condition is the proof.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const T1 = '10000000-0000-4000-8000-000000000001';

async function load() {
  jest.resetModules();
  const rec = createTableDb({
    courseMembers: [
      { userId: T1, courseId: 'c1', title: 'Kurs', chapter: 1, code: null },
    ],
    enablers: [{ id: 'e1', courseId: 'c1', isActive: true }],
    enablerQuizLinks: [],
    quizzes: [],
    quizSubmissions: [],
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: rec.db }));
  jest.doMock('@/lib/catalog/progression-db', () => ({
    __esModule: true,
    loadGradableQuizIds: async () => new Set(),
  }));
  const mod = await import('@/lib/trainer/trainee-progress');
  return { mod, rec };
}

describe('loadTraineeProgress', () => {
  it('counts only active courses, with and without a scope', async () => {
    const { mod, rec } = await load();
    await mod.loadTraineeProgress([T1], null);
    await mod.loadTraineeProgress([T1], {
      allowedCatalogIds: [KFBM],
      activeCatalogId: KFBM,
      selected: true,
    });
    const filter = rec.filters('select', 'course_members');
    // both calls carry the condition
    expect(filter.sql.split('"courses"."is_active" = $').length - 1).toBe(2);
    expect(filter.sql).toContain('"course_members"."role" = $');
  });

  it('still limits to the occupation of the scope', async () => {
    const { mod, rec } = await load();
    await mod.loadTraineeProgress([T1], {
      allowedCatalogIds: [KFBM],
      activeCatalogId: KFBM,
      selected: true,
    });
    const filter = rec.filters('select', 'course_members');
    expect(filter.params).toContain(KFBM);
    expect(filter.params).not.toContain(FIAE);
    expect(filter.sql).toContain('"courses"."training_catalog_id" = $');
  });

  it('a trainee with a course and an enabler without a required quiz gets 1 of 1 (counted as completed, as in the trainee area)', async () => {
    const { mod } = await load();
    const loaded = await mod.loadTraineeProgress([T1], null);
    expect(loaded.byTrainee.get(T1)).toMatchObject({
      completed: 1,
      total: 1,
      pct: 100,
    });
  });
});
