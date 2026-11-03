/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createTableDb } from '../../../helpers/mockDb';
import {
  fakeSession,
  makeRequest,
  mockCatalogScope,
  mockSession,
  mockTraineeAccess,
  traineeSession,
} from '../../../helpers/mockNext';
import {
  BOTH_ENABLED,
  CATALOG_ROWS,
  FIAE,
  KFBM,
  TWO_ENROLLMENTS,
} from '../../../helpers/schoolCatalogTables';

// School exams (Prüfungen) and school blocks (Berufsschul-Kalender) belong to one
// occupation (school_exams.training_catalog_id, ausbildung_blocks.training_catalog_id,
// WMCNL-2955 and WMCNL-3018). A trainee in two trainings sees only the exams and
// blocks of the occupation of the tab, new ones get that occupation, a row of the
// other occupation is answered like a missing one. Trainer level sees only the
// chosen occupation. A trainee with one occupation works as before. The real
// catalog scope runs against a table mock, which ignores where(), so the
// assertions read the rendered conditions and the written values.

const ORG = 'org-1';
const ME = '11111111-1111-4111-8111-111111111111';
const AZUBI = '22222222-2222-4222-8222-222222222222';
const EXAM = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const BLOCK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const trainer = {
  firstName: 'Tina',
  lastName: 'Trainer',
  email: 'trainer@example.com',
  fullName: 'Tina Trainer',
  role: 'TRAINER',
};

const traineeRow = {
  id: AZUBI,
  fullName: 'Azubi',
  firstName: 'Azubi',
  lastName: 'Zwei',
  email: 'azubi@example.com',
  organizationId: ORG,
  startOfTrainingDate: new Date(2026, 7, 1),
  ausbildungDurationYears: 3,
};

function req(
  method: string,
  url: string,
  options: { header?: string; body?: unknown } = {}
) {
  return makeRequest(method, url, {
    token: 't',
    body: options.body,
    headers: options.header ? { 'x-catalog': options.header } : undefined,
  });
}

const withId = (id: string) => ({ params: Promise.resolve({ id }) });

type Loaded = { mod: any; mock: ReturnType<typeof createTableDb> };

/** A route run as the trainee ME, the real catalog scope. */
async function loadTrainee(
  route: string,
  tables: Record<string, any>,
  enrollments: any[] = TWO_ENROLLMENTS
): Promise<Loaded> {
  jest.resetModules();
  jest.dontMock('@/lib/catalog/scope');
  mockSession(traineeSession(ME, { organizationId: ORG }));
  const mock = createTableDb({
    trainingCatalogs: CATALOG_ROWS,
    organizationCatalogs: BOTH_ENABLED,
    traineeEnrollments: enrollments,
    profiles: [traineeRow],
    ausbildungBlocks: [],
    schoolExams: [],
    ...tables,
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    getUserOrgId: async () => ORG,
  }));
  jest.doMock('@/lib/catalog/phase-plan-db', () => ({
    __esModule: true,
    loadPhasePlanForUser: async () => ({ phaseMonths: [18, 18] }),
  }));
  const mod = await import(`@/app/api/${route}`);
  return { mod, mock };
}

/** A route run as a trainer, the real catalog scope, the trainee check passes. */
async function loadTrainer(
  route: string,
  tables: Record<string, any>
): Promise<Loaded> {
  jest.resetModules();
  jest.dontMock('@/lib/catalog/scope');
  mockSession(fakeSession({ id: 'tr1', organizationId: ORG }));
  mockTraineeAccess('ok');
  const mock = createTableDb({
    trainingCatalogs: CATALOG_ROWS,
    organizationCatalogs: BOTH_ENABLED,
    profiles: { sequence: [[trainer], [traineeRow]] },
    ausbildungBlocks: [],
    schoolExams: [],
    ...tables,
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    getUserOrgId: async () => ORG,
    verifyPlatformOwner: async () => false,
  }));
  jest.doMock('@/lib/email', () => ({
    __esModule: true,
    sendBlockerInvite: jest.fn(async () => undefined),
  }));
  jest.doMock('@/lib/catalog/phase-plan-db', () => ({
    __esModule: true,
    loadPhasePlanForUser: async () => ({ phaseMonths: [18, 18] }),
  }));
  const mod = await import(`@/app/api/${route}`);
  return { mod, mock };
}

const examRow = (catalogId: string, extra: Record<string, unknown> = {}) => ({
  id: EXAM,
  traineeId: ME,
  trainingCatalogId: catalogId,
  subject: 'LF5',
  examDate: new Date('2027-03-10T00:00:00.000Z'),
  ...extra,
});

const blockRow = (catalogId: string, extra: Record<string, unknown> = {}) => ({
  id: BLOCK,
  traineeId: ME,
  trainingCatalogId: catalogId,
  blockType: 'PERSONAL',
  startDate: new Date('2027-03-01T08:00:00.000Z'),
  endDate: new Date('2027-03-05T16:00:00.000Z'),
  description: null,
  createdByTrainerId: null,
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

// ---------------------------------------------------------------------------
// Trainee in two occupations: lists and counters
// ---------------------------------------------------------------------------

describe('GET /api/trainee/school/exams of a trainee in two occupations', () => {
  const LIST = 'http://localhost/api/trainee/school/exams';

  it('KfBM tab: the exams and the exam blocks of KfBM only', async () => {
    const { mod, mock } = await loadTrainee('trainee/school/exams/route', {});
    const res = await mod.GET(req('GET', LIST, { header: 'KFBM' }));
    expect(res.status).toBe(200);
    for (const table of ['school_exams', 'ausbildung_blocks']) {
      const filter = mock.filters('select', table);
      expect(filter.sql).toContain(`"${table}"."training_catalog_id" = $`);
      expect(filter.params).toContain(ME);
      expect(filter.params).toContain(KFBM);
      expect(filter.params).not.toContain(FIAE);
    }
  });

  it('FIAE tab: the exams and the exam blocks of FIAE only', async () => {
    const { mod, mock } = await loadTrainee('trainee/school/exams/route', {});
    const res = await mod.GET(req('GET', LIST, { header: 'FIAE' }));
    expect(res.status).toBe(200);
    for (const table of ['school_exams', 'ausbildung_blocks']) {
      const filter = mock.filters('select', table);
      expect(filter.params).toContain(FIAE);
      expect(filter.params).not.toContain(KFBM);
    }
  });

  it('without a choice the first enrollment counts (never both lists mixed)', async () => {
    const { mod, mock } = await loadTrainee('trainee/school/exams/route', {});
    const res = await mod.GET(req('GET', LIST));
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'school_exams');
    expect(filter.params).toContain(FIAE);
    expect(filter.params).not.toContain(KFBM);
  });

  it('the counter of the upcoming exams (SchoolView) follows the tab as well', async () => {
    const { mod, mock } = await loadTrainee('trainee/school/exams/route', {});
    const res = await mod.GET(
      req('GET', `${LIST}?upcoming=true&limit=200`, { header: 'KFBM' })
    );
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'school_exams');
    expect(filter.sql).toContain('"school_exams"."exam_date" >=');
    expect(filter.params).toContain(KFBM);
    expect(filter.params).not.toContain(FIAE);
  });

  it('refuses an occupation the trainee is not enrolled in (403)', async () => {
    const { mod, mock } = await loadTrainee('trainee/school/exams/route', {}, [
      TWO_ENROLLMENTS[0],
    ]);
    const res = await mod.GET(req('GET', LIST, { header: 'KFBM' }));
    expect(res.status).toBe(403);
    expect(mock.filters('select', 'school_exams').params).toEqual([]);
  });
});

describe('GET /api/trainee/school/blocks of a trainee in two occupations', () => {
  const LIST = 'http://localhost/api/trainee/school/blocks?year=2027';

  it('KfBM tab: the blocks of KfBM only', async () => {
    const { mod, mock } = await loadTrainee('trainee/school/blocks/route', {});
    const res = await mod.GET(req('GET', LIST, { header: 'KFBM' }));
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'ausbildung_blocks');
    expect(filter.sql).toContain(
      '"ausbildung_blocks"."training_catalog_id" = $'
    );
    expect(filter.params).toContain(ME);
    expect(filter.params).toContain(KFBM);
    expect(filter.params).not.toContain(FIAE);
  });

  it('FIAE tab: the blocks of FIAE only', async () => {
    const { mod, mock } = await loadTrainee('trainee/school/blocks/route', {});
    await mod.GET(req('GET', LIST, { header: 'FIAE' }));
    const filter = mock.filters('select', 'ausbildung_blocks');
    expect(filter.params).toContain(FIAE);
    expect(filter.params).not.toContain(KFBM);
  });
});

describe('the dashboard appointments of a trainee in two occupations', () => {
  async function dashboard(scope: {
    allowedCatalogIds: string[];
    activeCatalogId: string;
    selected: boolean;
  }) {
    jest.resetModules();
    const mock = createTableDb({
      courseMembers: [],
      profiles: [{ startOfTrainingDate: null, ausbildungDurationYears: 3 }],
      ausbildungBlocks: [],
      schoolExams: [],
    });
    jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
    mockSession(traineeSession(ME, { organizationId: ORG }));
    mockCatalogScope(scope);
    const mod = await import('@/app/api/trainee/dashboard/route');
    const res = await mod.GET(
      req('GET', 'http://localhost/api/trainee/dashboard', { header: 'KFBM' })
    );
    expect(res.status).toBe(200);
    return mock;
  }

  it('KfBM tab: the blocks and exams of KfBM only', async () => {
    const mock = await dashboard({
      allowedCatalogIds: [FIAE, KFBM],
      activeCatalogId: KFBM,
      selected: true,
    });
    for (const table of ['ausbildung_blocks', 'school_exams']) {
      const filter = mock.filters('select', table);
      expect(filter.sql).toContain(`"${table}"."training_catalog_id" = $`);
      expect(filter.params).toContain(KFBM);
      expect(filter.params).not.toContain(FIAE);
    }
  });

  it('a trainee with one occupation is not filtered, as before', async () => {
    const mock = await dashboard({
      allowedCatalogIds: [FIAE],
      activeCatalogId: FIAE,
      selected: false,
    });
    expect(mock.filters('select', 'ausbildung_blocks').sql).not.toContain(
      'training_catalog_id'
    );
    expect(mock.filters('select', 'school_exams').sql).not.toContain(
      'training_catalog_id'
    );
  });
});

// ---------------------------------------------------------------------------
// Trainee in two occupations: creating
// ---------------------------------------------------------------------------

describe('POST of a trainee in two occupations: the new row gets the occupation of the tab', () => {
  const examBody = { examDate: '2027-03-10', subject: 'Betriebliche Prüfung' };
  const blockBody = {
    year: 2027,
    startDate: '2027-03-01T08:00:00.000Z',
    endDate: '2027-03-05T16:00:00.000Z',
    blockType: 'PERSONAL',
  };

  it.each([
    ['KFBM', KFBM],
    ['FIAE', FIAE],
  ])('an exam in the %s tab', async (header, catalogId) => {
    const { mod, mock } = await loadTrainee('trainee/school/exams/route', {});
    const res = await mod.POST(
      req('POST', 'http://localhost/api/trainee/school/exams', {
        header,
        body: examBody,
      })
    );
    expect(res.status).toBe(201);
    expect(mock.writes('insert', 'school_exams')[0]).toMatchObject({
      traineeId: ME,
      trainingCatalogId: catalogId,
    });
  });

  it.each([
    ['KFBM', KFBM],
    ['FIAE', FIAE],
  ])('a block in the %s tab', async (header, catalogId) => {
    const { mod, mock } = await loadTrainee('trainee/school/blocks/route', {});
    const res = await mod.POST(
      req('POST', 'http://localhost/api/trainee/school/blocks', {
        header,
        body: blockBody,
      })
    );
    expect(res.status).toBe(201);
    expect(mock.writes('insert', 'ausbildung_blocks')[0]).toMatchObject({
      traineeId: ME,
      trainingCatalogId: catalogId,
    });
  });

  it('without a choice the new exam belongs to the first enrollment', async () => {
    const { mod, mock } = await loadTrainee('trainee/school/exams/route', {});
    await mod.POST(
      req('POST', 'http://localhost/api/trainee/school/exams', {
        body: examBody,
      })
    );
    expect(mock.writes('insert', 'school_exams')[0]).toMatchObject({
      trainingCatalogId: FIAE,
    });
  });

  it('refuses a new exam in an occupation the trainee does not have (403, nothing written)', async () => {
    const { mod, mock } = await loadTrainee('trainee/school/exams/route', {}, [
      TWO_ENROLLMENTS[0],
    ]);
    const res = await mod.POST(
      req('POST', 'http://localhost/api/trainee/school/exams', {
        header: 'KFBM',
        body: examBody,
      })
    );
    expect(res.status).toBe(403);
    expect(mock.db.insert).not.toHaveBeenCalled();
  });

  it('the CSV import writes into the occupation of the tab and clears only that one', async () => {
    const { mod, mock } = await loadTrainee(
      'trainee/school/blocks/import/route',
      {}
    );
    const res = await mod.POST(
      req('POST', 'http://localhost/api/trainee/school/blocks/import', {
        header: 'KFBM',
        body: {
          baseYear: 2027,
          clearExisting: true,
          csvData: [
            {
              KW: '46',
              Datum: '15.11. - 19.11.',
              '10IT': '',
              '11IT': '',
              '12IT': '',
              Anmerkungen: 'Ferien',
            },
          ],
        },
      })
    );
    expect(res.status).toBe(201);
    expect(mock.writes('insert', 'ausbildung_blocks')[0]).toMatchObject({
      trainingCatalogId: KFBM,
    });
    const cleared = mock.filters('delete', 'ausbildung_blocks');
    expect(cleared.sql).toContain(
      '"ausbildung_blocks"."training_catalog_id" = $'
    );
    expect(cleared.params).toContain(ME);
    expect(cleared.params).toContain(KFBM);
    expect(cleared.params).not.toContain(FIAE);
  });
});

// ---------------------------------------------------------------------------
// Trainee in two occupations: change and delete
// ---------------------------------------------------------------------------

describe('a trainee in two occupations changes and deletes only the rows of the tab', () => {
  it('PUT an exam of the other occupation is answered like a missing one (404, no update)', async () => {
    const { mod, mock } = await loadTrainee('trainee/school/exams/[id]/route', {
      schoolExams: [examRow(KFBM)],
    });
    const res = await mod.PUT(
      req('PUT', `http://localhost/api/trainee/school/exams/${EXAM}`, {
        header: 'FIAE',
        body: { notes: 'Neu' },
      }),
      withId(EXAM)
    );
    expect(res.status).toBe(404);
    expect(mock.db.update).not.toHaveBeenCalled();
  });

  it('PUT an exam of the own occupation works and never moves it to another occupation', async () => {
    const { mod, mock } = await loadTrainee('trainee/school/exams/[id]/route', {
      schoolExams: [examRow(KFBM)],
    });
    const res = await mod.PUT(
      req('PUT', `http://localhost/api/trainee/school/exams/${EXAM}`, {
        header: 'KFBM',
        body: { notes: 'Neu', trainingCatalogId: FIAE },
      }),
      withId(EXAM)
    );
    expect(res.status).toBe(200);
    const set = mock.writes('update', 'school_exams')[0] as Record<
      string,
      unknown
    >;
    expect(set).toMatchObject({ notes: 'Neu' });
    expect(set).not.toHaveProperty('trainingCatalogId');
  });

  it('GET one exam of the other occupation is answered like a missing one', async () => {
    const { mod } = await loadTrainee('trainee/school/exams/[id]/route', {
      schoolExams: [{ exam: examRow(KFBM), result: null }],
    });
    // the table mock hands the joined row back as the row of the exam
    const res = await mod.GET(
      req('GET', `http://localhost/api/trainee/school/exams/${EXAM}`, {
        header: 'FIAE',
      }),
      withId(EXAM)
    );
    expect(res.status).toBe(404);
  });

  it('DELETE an exam of the other occupation is answered like a missing one (404, nothing deleted)', async () => {
    const { mod, mock } = await loadTrainee('trainee/school/exams/[id]/route', {
      schoolExams: [examRow(KFBM)],
    });
    const res = await mod.DELETE(
      req('DELETE', `http://localhost/api/trainee/school/exams/${EXAM}`, {
        header: 'FIAE',
      }),
      withId(EXAM)
    );
    expect(res.status).toBe(404);
    expect(mock.db.delete).not.toHaveBeenCalled();
  });

  it('DELETE an exam of the own occupation works', async () => {
    const { mod, mock } = await loadTrainee('trainee/school/exams/[id]/route', {
      schoolExams: [examRow(KFBM)],
    });
    const res = await mod.DELETE(
      req('DELETE', `http://localhost/api/trainee/school/exams/${EXAM}`, {
        header: 'KFBM',
      }),
      withId(EXAM)
    );
    expect(res.status).toBe(200);
    expect(mock.db.delete).toHaveBeenCalledTimes(1);
  });

  it('DELETE an exam block of the other occupation (the calendar copy of an exam) is a 404', async () => {
    const { mod, mock } = await loadTrainee('trainee/school/exams/[id]/route', {
      schoolExams: [],
      ausbildungBlocks: [blockRow(KFBM, { blockType: 'EXAM' })],
    });
    const res = await mod.DELETE(
      req('DELETE', `http://localhost/api/trainee/school/exams/${BLOCK}`, {
        header: 'FIAE',
      }),
      withId(BLOCK)
    );
    expect(res.status).toBe(404);
    expect(mock.db.delete).not.toHaveBeenCalled();
  });

  it('the result of an exam of the other occupation counts as missing (POST 404, PUT 404, GET null)', async () => {
    const result = { id: 'r1', examId: EXAM, traineeId: ME };
    const tables = {
      schoolExams: [examRow(KFBM)],
      schoolExamResults: [result],
    };
    const post = await loadTrainee(
      'trainee/school/exams/[id]/result/route',
      tables
    );
    const posted = await post.mod.POST(
      req('POST', `http://localhost/api/trainee/school/exams/${EXAM}/result`, {
        header: 'FIAE',
        body: { points: 40 },
      }),
      withId(EXAM)
    );
    expect(posted.status).toBe(404);
    expect(post.mock.db.insert).not.toHaveBeenCalled();

    const put = await loadTrainee(
      'trainee/school/exams/[id]/result/route',
      tables
    );
    const updated = await put.mod.PUT(
      req('PUT', `http://localhost/api/trainee/school/exams/${EXAM}/result`, {
        header: 'FIAE',
        body: { points: 41 },
      }),
      withId(EXAM)
    );
    expect(updated.status).toBe(404);
    expect(put.mock.db.update).not.toHaveBeenCalled();

    const get = await loadTrainee(
      'trainee/school/exams/[id]/result/route',
      tables
    );
    const read = await get.mod.GET(
      req('GET', `http://localhost/api/trainee/school/exams/${EXAM}/result`, {
        header: 'FIAE',
      }),
      withId(EXAM)
    );
    expect((await read.json()).result).toBeNull();
  });

  it('the result of an exam of the own occupation is read', async () => {
    const result = { id: 'r1', examId: EXAM, traineeId: ME };
    const { mod } = await loadTrainee(
      'trainee/school/exams/[id]/result/route',
      { schoolExams: [examRow(KFBM)], schoolExamResults: [result] }
    );
    const res = await mod.GET(
      req('GET', `http://localhost/api/trainee/school/exams/${EXAM}/result`, {
        header: 'KFBM',
      }),
      withId(EXAM)
    );
    expect((await res.json()).result).toMatchObject({ id: 'r1' });
  });

  it('PUT a block of the other occupation is a 404 (no update), of the own occupation it works', async () => {
    const other = await loadTrainee('trainee/school/blocks/[id]/route', {
      ausbildungBlocks: [blockRow(KFBM)],
    });
    const refused = await other.mod.PUT(
      req('PUT', `http://localhost/api/trainee/school/blocks/${BLOCK}`, {
        header: 'FIAE',
        body: { notes: 'Neu' },
      }),
      withId(BLOCK)
    );
    expect(refused.status).toBe(404);
    expect(other.mock.db.update).not.toHaveBeenCalled();

    const own = await loadTrainee('trainee/school/blocks/[id]/route', {
      ausbildungBlocks: [blockRow(KFBM)],
    });
    const ok = await own.mod.PUT(
      req('PUT', `http://localhost/api/trainee/school/blocks/${BLOCK}`, {
        header: 'KFBM',
        body: { notes: 'Neu', trainingCatalogId: FIAE },
      }),
      withId(BLOCK)
    );
    expect(ok.status).toBe(200);
    expect(
      own.mock.writes('update', 'ausbildung_blocks')[0]
    ).not.toHaveProperty('trainingCatalogId');
  });

  it('GET and DELETE a block of the other occupation are a 404, of the own occupation they work', async () => {
    const other = await loadTrainee('trainee/school/blocks/[id]/route', {
      ausbildungBlocks: [blockRow(KFBM)],
    });
    expect(
      (
        await other.mod.GET(
          req('GET', `http://localhost/api/trainee/school/blocks/${BLOCK}`, {
            header: 'FIAE',
          }),
          withId(BLOCK)
        )
      ).status
    ).toBe(404);
    expect(
      (
        await other.mod.DELETE(
          req('DELETE', `http://localhost/api/trainee/school/blocks/${BLOCK}`, {
            header: 'FIAE',
          }),
          withId(BLOCK)
        )
      ).status
    ).toBe(404);
    expect(other.mock.db.delete).not.toHaveBeenCalled();

    const own = await loadTrainee('trainee/school/blocks/[id]/route', {
      ausbildungBlocks: [blockRow(KFBM)],
    });
    expect(
      (
        await own.mod.GET(
          req('GET', `http://localhost/api/trainee/school/blocks/${BLOCK}`, {
            header: 'KFBM',
          }),
          withId(BLOCK)
        )
      ).status
    ).toBe(200);
    expect(
      (
        await own.mod.DELETE(
          req('DELETE', `http://localhost/api/trainee/school/blocks/${BLOCK}`, {
            header: 'KFBM',
          }),
          withId(BLOCK)
        )
      ).status
    ).toBe(200);
    expect(own.mock.db.delete).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Trainee with one occupation: exactly as before
// ---------------------------------------------------------------------------

describe('a trainee with one occupation works exactly as before', () => {
  it('the lists are not filtered by occupation (no enrollment counts as FIAE, no choice needed)', async () => {
    const exams = await loadTrainee(
      'trainee/school/exams/route',
      { schoolExams: [{ exam: examRow(FIAE), result: null }] },
      []
    );
    const res = await exams.mod.GET(
      req('GET', 'http://localhost/api/trainee/school/exams')
    );
    expect(res.status).toBe(200);
    expect(exams.mock.filters('select', 'school_exams').sql).not.toContain(
      'training_catalog_id'
    );
    expect(exams.mock.filters('select', 'ausbildung_blocks').sql).not.toContain(
      'training_catalog_id'
    );

    const blocks = await loadTrainee('trainee/school/blocks/route', {}, []);
    await blocks.mod.GET(
      req('GET', 'http://localhost/api/trainee/school/blocks?year=2027')
    );
    expect(
      blocks.mock.filters('select', 'ausbildung_blocks').sql
    ).not.toContain('training_catalog_id');
  });

  it('new rows get FIAE without a choice', async () => {
    const { mod, mock } = await loadTrainee(
      'trainee/school/exams/route',
      {},
      []
    );
    const res = await mod.POST(
      req('POST', 'http://localhost/api/trainee/school/exams', {
        body: { examDate: '2027-03-10', subject: 'LF5' },
      })
    );
    expect(res.status).toBe(201);
    expect(mock.writes('insert', 'school_exams')[0]).toMatchObject({
      trainingCatalogId: FIAE,
    });
  });

  it('a trainee with a single KfBM enrollment gets KfBM for new rows and sees every row, also one that kept the default FIAE', async () => {
    const kfbmOnly = [TWO_ENROLLMENTS[1]];
    const create = await loadTrainee(
      'trainee/school/blocks/route',
      {},
      kfbmOnly
    );
    await create.mod.POST(
      req('POST', 'http://localhost/api/trainee/school/blocks', {
        body: {
          year: 2027,
          startDate: '2027-03-01T08:00:00.000Z',
          endDate: '2027-03-05T16:00:00.000Z',
          blockType: 'PERSONAL',
        },
      })
    );
    expect(create.mock.writes('insert', 'ausbildung_blocks')[0]).toMatchObject({
      trainingCatalogId: KFBM,
    });

    // a row an older app version wrote (default FIAE) is still reachable
    const change = await loadTrainee(
      'trainee/school/blocks/[id]/route',
      { ausbildungBlocks: [blockRow(FIAE)] },
      kfbmOnly
    );
    const res = await change.mod.PUT(
      req('PUT', `http://localhost/api/trainee/school/blocks/${BLOCK}`, {
        body: { notes: 'Neu' },
      }),
      withId(BLOCK)
    );
    expect(res.status).toBe(200);
  });

  it('changing and deleting an exam works without a choice', async () => {
    const { mod, mock } = await loadTrainee(
      'trainee/school/exams/[id]/route',
      { schoolExams: [examRow(FIAE)] },
      []
    );
    const put = await mod.PUT(
      req('PUT', `http://localhost/api/trainee/school/exams/${EXAM}`, {
        body: { notes: 'Neu' },
      }),
      withId(EXAM)
    );
    expect(put.status).toBe(200);
    const del = await mod.DELETE(
      req('DELETE', `http://localhost/api/trainee/school/exams/${EXAM}`),
      withId(EXAM)
    );
    expect(del.status).toBe(200);
    expect(mock.db.delete).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Trainer level
// ---------------------------------------------------------------------------

describe('trainer level sees the chosen occupation only', () => {
  it('the exams of one trainee: KfBM tab filters, without a choice nothing is filtered', async () => {
    const url = `http://localhost/api/trainer/school/exams?traineeId=${AZUBI}`;
    const chosen = await loadTrainer('trainer/school/exams/route', {});
    const res = await chosen.mod.GET(req('GET', url, { header: 'KFBM' }));
    expect(res.status).toBe(200);
    const filter = chosen.mock.filters('select', 'school_exams');
    expect(filter.sql).toContain('"school_exams"."training_catalog_id" = $');
    expect(filter.params).toContain(AZUBI);
    expect(filter.params).toContain(KFBM);
    expect(filter.params).not.toContain(FIAE);

    const open = await loadTrainer('trainer/school/exams/route', {});
    await open.mod.GET(req('GET', url));
    expect(open.mock.filters('select', 'school_exams').sql).not.toContain(
      'training_catalog_id'
    );
  });

  it('the exams of all trainees follow the tab (WMCNL-3018: a FIAE exam is not listed under KfBM)', async () => {
    const { mod, mock } = await loadTrainer('trainer/school/exams/route', {});
    const res = await mod.GET(
      req('GET', 'http://localhost/api/trainer/school/exams', {
        header: 'FIAE',
      })
    );
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'school_exams');
    expect(filter.sql).toContain('"school_exams"."training_catalog_id" = $');
    expect(filter.params).toContain(FIAE);
    expect(filter.params).not.toContain(KFBM);
  });

  it('the calendar of a trainee (blocks): KfBM tab filters, without a choice nothing is filtered', async () => {
    const url = `http://localhost/api/trainer/blocks?traineeId=${AZUBI}&year=2027`;
    const chosen = await loadTrainer('trainer/blocks/route', {});
    const res = await chosen.mod.GET(req('GET', url, { header: 'KFBM' }));
    expect(res.status).toBe(200);
    const filter = chosen.mock.filters('select', 'ausbildung_blocks');
    expect(filter.sql).toContain(
      '"ausbildung_blocks"."training_catalog_id" = $'
    );
    expect(filter.params).toContain(KFBM);
    expect(filter.params).not.toContain(FIAE);

    const open = await loadTrainer('trainer/blocks/route', {});
    await open.mod.GET(req('GET', url));
    expect(open.mock.filters('select', 'ausbildung_blocks').sql).not.toContain(
      'training_catalog_id'
    );
  });

  it('refuses an occupation the trainer does not have (403)', async () => {
    const { mod, mock } = await loadTrainer('trainer/blocks/route', {
      organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
    });
    const res = await mod.GET(
      req('GET', `http://localhost/api/trainer/blocks?traineeId=${AZUBI}`, {
        header: 'KFBM',
      })
    );
    expect(res.status).toBe(403);
    expect(mock.filters('select', 'ausbildung_blocks').params).toEqual([]);
  });

  it('the number of upcoming exams in the header follows the tab', async () => {
    const { mod, mock } = await loadTrainer('trainer/school/stats/route', {
      schoolExams: [{ count: 2 }],
    });
    const res = await mod.GET(
      req('GET', 'http://localhost/api/trainer/school/stats', {
        header: 'KFBM',
      })
    );
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'school_exams');
    expect(filter.sql).toContain('"school_exams"."training_catalog_id" = $');
    expect(filter.params).toContain(KFBM);
    expect(filter.params).not.toContain(FIAE);
  });
});

describe('a trainer creates exams and blocks in the occupation of the tab', () => {
  const examBody = {
    traineeId: AZUBI,
    subject: 'Betriebliche Prüfung',
    examDate: '2027-03-10',
  };
  const blockBody = {
    traineeIds: [AZUBI],
    blockType: 'TRAINER_BLOCKER',
    startDate: '2027-11-15T08:00:00.000Z',
    endDate: '2027-11-15T17:00:00.000Z',
    sendInvitation: false,
  };

  it.each([
    ['KFBM', KFBM],
    ['FIAE', FIAE],
  ])('an exam in the %s tab', async (header, catalogId) => {
    const { mod, mock } = await loadTrainer('trainer/school/exams/route', {
      profiles: [traineeRow],
    });
    const res = await mod.POST(
      req('POST', 'http://localhost/api/trainer/school/exams', {
        header,
        body: examBody,
      })
    );
    expect(res.status).toBe(200);
    expect(mock.writes('insert', 'school_exams')[0]).toMatchObject({
      traineeId: AZUBI,
      trainingCatalogId: catalogId,
    });
  });

  it('a block in the KfBM tab, and the duplicate check of an exam block counts per occupation', async () => {
    const { mod, mock } = await loadTrainer('trainer/blocks/route', {});
    const res = await mod.POST(
      req('POST', 'http://localhost/api/trainer/blocks', {
        header: 'KFBM',
        body: { ...blockBody, blockType: 'EXAM', examSubType: 'KLAUSUR_WMC' },
      })
    );
    expect(res.status).toBe(201);
    expect(mock.writes('insert', 'ausbildung_blocks')[0]).toMatchObject({
      traineeId: AZUBI,
      trainingCatalogId: KFBM,
    });
    const duplicate = mock.filters('select', 'ausbildung_blocks');
    expect(duplicate.sql).toContain(
      '"ausbildung_blocks"."training_catalog_id" = $'
    );
    expect(duplicate.params).toContain(KFBM);
  });

  it('without a choice the occupation is the default one of the trainee, never the one of the trainer', async () => {
    // a trainee who is enrolled in KfBM only
    const kfbmOnly = await loadTrainer('trainer/school/exams/route', {
      profiles: [traineeRow],
      traineeEnrollments: [TWO_ENROLLMENTS[1]],
    });
    await kfbmOnly.mod.POST(
      req('POST', 'http://localhost/api/trainer/school/exams', {
        body: examBody,
      })
    );
    expect(kfbmOnly.mock.writes('insert', 'school_exams')[0]).toMatchObject({
      trainingCatalogId: KFBM,
    });

    // two enrollments: the first one
    const both = await loadTrainer('trainer/blocks/route', {
      traineeEnrollments: TWO_ENROLLMENTS,
    });
    await both.mod.POST(
      req('POST', 'http://localhost/api/trainer/blocks', { body: blockBody })
    );
    expect(both.mock.writes('insert', 'ausbildung_blocks')[0]).toMatchObject({
      trainingCatalogId: FIAE,
    });

    // no enrollment: FIAE
    const none = await loadTrainer('trainer/blocks/route', {
      traineeEnrollments: [],
    });
    await none.mod.POST(
      req('POST', 'http://localhost/api/trainer/blocks', { body: blockBody })
    );
    expect(none.mock.writes('insert', 'ausbildung_blocks')[0]).toMatchObject({
      trainingCatalogId: FIAE,
    });
  });
});

describe('a trainer changes, deletes and grades only what lies in the chosen occupation', () => {
  const trainerBlock = (catalogId: string) =>
    blockRow(catalogId, {
      traineeId: AZUBI,
      blockType: 'TRAINER_BLOCKER',
      createdByTrainerId: 'tr1',
    });

  it('PATCH and DELETE of a trainer block of the other occupation are a 404', async () => {
    const patch = await loadTrainer('trainer/blocks/[blockId]/route', {
      ausbildungBlocks: [trainerBlock(KFBM)],
    });
    const patched = await patch.mod.PATCH(
      req('PATCH', `http://localhost/api/trainer/blocks/${BLOCK}`, {
        header: 'FIAE',
        body: { title: 'Neu' },
      }),
      { params: Promise.resolve({ blockId: BLOCK }) }
    );
    expect(patched.status).toBe(404);
    expect(patch.mock.db.update).not.toHaveBeenCalled();

    const del = await loadTrainer('trainer/blocks/[blockId]/route', {
      ausbildungBlocks: [trainerBlock(KFBM)],
    });
    const deleted = await del.mod.DELETE(
      req('DELETE', `http://localhost/api/trainer/blocks/${BLOCK}`, {
        header: 'FIAE',
      }),
      { params: Promise.resolve({ blockId: BLOCK }) }
    );
    expect(deleted.status).toBe(404);
    expect(del.mock.db.delete).not.toHaveBeenCalled();
  });

  it('PATCH and DELETE of a trainer block of the chosen occupation work', async () => {
    const patch = await loadTrainer('trainer/blocks/[blockId]/route', {
      ausbildungBlocks: [trainerBlock(KFBM)],
    });
    const patched = await patch.mod.PATCH(
      req('PATCH', `http://localhost/api/trainer/blocks/${BLOCK}`, {
        header: 'KFBM',
        body: { title: 'Neu' },
      }),
      { params: Promise.resolve({ blockId: BLOCK }) }
    );
    expect(patched.status).toBe(200);

    const del = await loadTrainer('trainer/blocks/[blockId]/route', {
      ausbildungBlocks: [trainerBlock(KFBM)],
    });
    const deleted = await del.mod.DELETE(
      req('DELETE', `http://localhost/api/trainer/blocks/${BLOCK}`, {
        header: 'KFBM',
      }),
      { params: Promise.resolve({ blockId: BLOCK }) }
    );
    expect(deleted.status).toBe(200);
  });

  it('PATCH without a choice still reaches the block (as before)', async () => {
    const { mod } = await loadTrainer('trainer/blocks/[blockId]/route', {
      ausbildungBlocks: [trainerBlock(KFBM)],
    });
    const res = await mod.PATCH(
      req('PATCH', `http://localhost/api/trainer/blocks/${BLOCK}`, {
        body: { title: 'Neu' },
      }),
      { params: Promise.resolve({ blockId: BLOCK }) }
    );
    expect(res.status).toBe(200);
  });

  it('the points of an exam of the other occupation are refused like a missing exam (404, nothing graded)', async () => {
    const { mod, mock } = await loadTrainer(
      'trainer/school/exams/[examId]/grade/route',
      { schoolExams: [examRow(KFBM, { traineeId: AZUBI })] }
    );
    const res = await mod.PUT(
      req('PUT', `http://localhost/api/trainer/school/exams/${EXAM}/grade`, {
        header: 'FIAE',
        body: { points: 40, maxPoints: 50 },
      }),
      { params: Promise.resolve({ examId: EXAM }) }
    );
    expect(res.status).toBe(404);
    expect(mock.db.insert).not.toHaveBeenCalled();
    expect(mock.db.update).not.toHaveBeenCalled();
  });

  it('the points of an exam of the chosen occupation are saved', async () => {
    const { mod, mock } = await loadTrainer(
      'trainer/school/exams/[examId]/grade/route',
      {
        schoolExams: [examRow(KFBM, { traineeId: AZUBI })],
        schoolExamResults: [],
      }
    );
    const res = await mod.PUT(
      req('PUT', `http://localhost/api/trainer/school/exams/${EXAM}/grade`, {
        header: 'KFBM',
        body: { points: 40, maxPoints: 50 },
      }),
      { params: Promise.resolve({ examId: EXAM }) }
    );
    expect(res.status).toBe(200);
    expect(mock.writes('insert', 'school_exam_results')[0]).toMatchObject({
      examId: EXAM,
      points: 40,
    });
  });
});

// ---------------------------------------------------------------------------
// Every route that reads or writes exams and blocks uses the shared rule
// ---------------------------------------------------------------------------

describe('the routes use the one rule of src/lib/school/catalog-access.ts', () => {
  const API = join(process.cwd(), 'src/app/api');
  const READ = /requireSchoolCatalogFilter|ensureSchoolRowInChosenCatalog/;
  const WRITE = /resolveSchoolWriteCatalog/;

  /** Routes that read, change or delete exams and blocks of a person. */
  const READ_ROUTES = [
    'trainee/school/exams',
    'trainee/school/exams/[id]',
    'trainee/school/exams/[id]/result',
    'trainee/school/blocks',
    'trainee/school/blocks/[id]',
    'trainer/blocks',
    'trainer/blocks/[blockId]',
    'trainer/school/exams',
    'trainer/school/exams/[examId]/grade',
    'trainer/school/stats',
  ];
  /** Routes that create exams or blocks. */
  const WRITE_ROUTES = [
    'trainee/school/exams',
    'trainee/school/blocks',
    'trainee/school/blocks/import',
    'trainer/blocks',
    'trainer/school/exams',
  ];

  it.each(READ_ROUTES)('%s filters by the occupation of the row', route => {
    const file = join(API, route, 'route.ts');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toMatch(READ);
  });

  it.each(WRITE_ROUTES)('%s writes the occupation of the tab', route => {
    const text = readFileSync(join(API, route, 'route.ts'), 'utf8');
    expect(text).toMatch(WRITE);
    expect(text).toContain('trainingCatalogId');
  });

  it('the dashboard counts the appointments of the occupation of the tab', () => {
    const text = readFileSync(join(API, 'trainee/dashboard/route.ts'), 'utf8');
    expect(text).toContain('ausbildungBlocks.trainingCatalogId');
    expect(text).toContain('schoolExams.trainingCatalogId');
  });
});
