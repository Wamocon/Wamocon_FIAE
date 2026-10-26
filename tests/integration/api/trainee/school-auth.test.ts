/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  fakeSession,
  makeRequest,
  mockSession,
} from '../../../helpers/mockNext';

// The school routes of a trainee (blocks, exams, exam results, reports) work
// on the data of the signed-in user only. The identity is the bearer session,
// a traineeId in the query or in the body is ignored, and a record of someone
// else is answered like a missing one (404). 401 and 403 of the session layer
// run for every handler in route-guards.test.ts. The table mock ignores
// where(), so the tests read the rendered conditions and the rows' owners.

const ME = 't1';
const OTHER = 't2';
const ORG = 'org-1';
const DATE = '2027-03-10';

const me = fakeSession({
  id: ME,
  role: 'TRAINEE',
  isTrainerLevel: false,
  organizationId: ORG,
});

type Tables = Record<string, any>;

async function loadRoute(route: string, tables: Tables = {}, returns = {}) {
  jest.resetModules();
  mockSession(me);
  const mock = createTableDb(tables, returns);
  const getUserOrgId = jest.fn(async (_id: string) => ORG);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    getUserOrgId,
  }));
  const mod = await import(`@/app/api/trainee/school/${route}/route`);
  return { mod, mock, getUserOrgId };
}

const call = (method: string, url: string, body?: unknown) =>
  makeRequest(method, `http://localhost${url}`, { token: 'tok', body });
const withId = (id: string) => ({ params: Promise.resolve({ id }) });

const noWrites = (mock: { db: any }) => {
  expect(mock.db.insert).not.toHaveBeenCalled();
  expect(mock.db.update).not.toHaveBeenCalled();
  expect(mock.db.delete).not.toHaveBeenCalled();
};

const ownBlock = {
  id: 'b1',
  traineeId: ME,
  startDate: new Date(2027, 2, 1),
  endDate: new Date(2027, 2, 5),
  blockType: 'SCHOOL',
};
const foreignBlock = { ...ownBlock, id: 'b2', traineeId: OTHER };

const ownExam = {
  id: 'e1',
  traineeId: ME,
  examDate: new Date(2027, 2, 1),
  subject: 'LF1',
};
const foreignExam = { ...ownExam, id: 'e2', traineeId: OTHER };

const ownReport = {
  id: 'r1',
  traineeId: ME,
  status: 'DRAFT',
  weekNumber: 10,
  year: 2027,
  reviewerId: null,
};
const foreignReport = { ...ownReport, id: 'r2', traineeId: OTHER };

describe('school routes: the session is the only identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  // -------------------------------------------------------------------------
  describe('blocks', () => {
    const query = `?traineeId=${OTHER}&year=2027`;

    it('GET lists the own blocks even if another traineeId is named', async () => {
      const { mod, mock } = await loadRoute('blocks', {
        ausbildungBlocks: [ownBlock],
      });
      const res = await mod.GET(
        call('GET', `/api/trainee/school/blocks${query}`)
      );
      expect(res.status).toBe(200);
      expect((await res.json()).blocks).toHaveLength(1);
      const { params } = mock.filters('select', 'ausbildung_blocks');
      expect(params).toContain(ME);
      expect(params).not.toContain(OTHER);
    });

    it('GET works without a traineeId', async () => {
      const { mod, mock } = await loadRoute('blocks', {
        ausbildungBlocks: [ownBlock],
      });
      const res = await mod.GET(call('GET', '/api/trainee/school/blocks'));
      expect(res.status).toBe(200);
      expect(mock.filters('select', 'ausbildung_blocks').params).toContain(ME);
    });

    it('POST creates the block for the session user, not for the traineeId of the body', async () => {
      const { mod, mock, getUserOrgId } = await loadRoute('blocks', {
        profiles: [{ id: ME, startOfTrainingDate: null }],
      });
      const res = await mod.POST(
        call('POST', '/api/trainee/school/blocks', {
          traineeId: OTHER,
          calendarWeek: 10,
          year: 2027,
          startDate: DATE,
          endDate: DATE,
          blockType: 'SCHOOL',
        })
      );
      expect(res.status).toBe(201);
      expect(mock.writes('insert', 'ausbildung_blocks')).toEqual([
        expect.objectContaining({ traineeId: ME, organizationId: ORG }),
      ]);
      expect(getUserOrgId).toHaveBeenCalledWith(ME);
      expect(mock.filters('select', 'profiles').params).not.toContain(OTHER);
    });

    it('POST keeps its validation (calendarWeek)', async () => {
      const { mod, mock } = await loadRoute('blocks');
      const res = await mod.POST(
        call('POST', '/api/trainee/school/blocks', { calendarWeek: 99 })
      );
      expect(res.status).toBe(400);
      noWrites(mock);
    });
  });

  describe('blocks/import', () => {
    const body = (extra = {}) => ({
      traineeId: OTHER,
      csvData: [{ KW: '33', Datum: '10.08. - 14.08.', '10IT': '5' }],
      baseYear: 2026,
      ...extra,
    });

    it('imports into the calendar of the session user', async () => {
      const { mod, mock, getUserOrgId } = await loadRoute('blocks/import', {
        profiles: [{ id: ME, startOfTrainingDate: null }],
      });
      const res = await mod.POST(
        call('POST', '/api/trainee/school/blocks/import', body())
      );
      expect(res.status).toBe(201);
      expect(getUserOrgId).toHaveBeenCalledWith(ME);
      const inserts = mock.writes('insert', 'ausbildung_blocks') as any[];
      expect(inserts.length).toBeGreaterThan(0);
      for (const values of inserts) expect(values.traineeId).toBe(ME);
    });

    it('clearExisting deletes the blocks of the session user only', async () => {
      const { mod, mock } = await loadRoute('blocks/import', {
        profiles: [{ id: ME, startOfTrainingDate: null }],
      });
      await mod.POST(
        call(
          'POST',
          '/api/trainee/school/blocks/import',
          body({ clearExisting: true })
        )
      );
      const { params } = mock.filters('delete', 'ausbildung_blocks');
      expect(params).toContain(ME);
      expect(params).not.toContain(OTHER);
    });

    it('keeps its validation (csvData)', async () => {
      const { mod, mock } = await loadRoute('blocks/import');
      const res = await mod.POST(
        call('POST', '/api/trainee/school/blocks/import', {})
      );
      expect(res.status).toBe(400);
      noWrites(mock);
    });
  });

  describe('blocks/[id]', () => {
    const url = '/api/trainee/school/blocks/b';

    it('GET returns an own block', async () => {
      const { mod } = await loadRoute('blocks/[id]', {
        ausbildungBlocks: [ownBlock],
      });
      const res = await mod.GET(call('GET', url), withId('b1'));
      expect(res.status).toBe(200);
      expect((await res.json()).block.id).toBe('b1');
    });

    it('GET answers a foreign block with 404', async () => {
      const { mod } = await loadRoute('blocks/[id]', {
        ausbildungBlocks: [foreignBlock],
      });
      const res = await mod.GET(call('GET', url), withId('b2'));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Block not found' });
    });

    it('PUT changes an own block, limited to the owner in the update', async () => {
      const { mod, mock } = await loadRoute('blocks/[id]', {
        ausbildungBlocks: [ownBlock],
      });
      const res = await mod.PUT(
        call('PUT', url, { title: 'Neu' }),
        withId('b1')
      );
      expect(res.status).toBe(200);
      expect(mock.writes('update', 'ausbildung_blocks')).toEqual([
        { title: 'Neu' },
      ]);
      expect(mock.filters('update', 'ausbildung_blocks').params).toEqual(
        expect.arrayContaining(['b1', ME])
      );
    });

    it('PUT answers a foreign block with 404 and changes nothing', async () => {
      const { mod, mock } = await loadRoute('blocks/[id]', {
        ausbildungBlocks: [foreignBlock],
      });
      const res = await mod.PUT(
        call('PUT', url, { title: 'Hijack', traineeId: ME }),
        withId('b2')
      );
      expect(res.status).toBe(404);
      noWrites(mock);
    });

    it('DELETE removes an own block, limited to the owner', async () => {
      const { mod, mock } = await loadRoute('blocks/[id]', {
        ausbildungBlocks: [ownBlock],
      });
      const res = await mod.DELETE(call('DELETE', url), withId('b1'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, deleted: 'b1' });
      expect(mock.filters('delete', 'ausbildung_blocks').params).toEqual(
        expect.arrayContaining(['b1', ME])
      );
    });

    it('DELETE answers a foreign block with 404 and deletes nothing', async () => {
      const { mod, mock } = await loadRoute('blocks/[id]', {
        ausbildungBlocks: [foreignBlock],
      });
      const res = await mod.DELETE(call('DELETE', url), withId('b2'));
      expect(res.status).toBe(404);
      noWrites(mock);
    });
  });

  // -------------------------------------------------------------------------
  describe('exams', () => {
    it('GET lists the own exams and exam blocks even if another traineeId is named', async () => {
      const { mod, mock } = await loadRoute('exams', {
        schoolExams: [{ exam: ownExam, result: null }],
        ausbildungBlocks: [],
      });
      const res = await mod.GET(
        call('GET', `/api/trainee/school/exams?traineeId=${OTHER}`)
      );
      expect(res.status).toBe(200);
      expect((await res.json()).exams).toHaveLength(1);
      for (const table of ['school_exams', 'ausbildung_blocks']) {
        const { params } = mock.filters('select', table);
        expect(params).toContain(ME);
        expect(params).not.toContain(OTHER);
      }
    });

    it('GET works without a traineeId', async () => {
      const { mod } = await loadRoute('exams', {
        schoolExams: [],
        ausbildungBlocks: [],
      });
      const res = await mod.GET(call('GET', '/api/trainee/school/exams'));
      expect(res.status).toBe(200);
    });

    it('POST creates the exam for the session user, not for the traineeId of the body', async () => {
      const { mod, mock, getUserOrgId } = await loadRoute('exams', {
        profiles: [{ id: ME, startOfTrainingDate: null }],
      });
      const res = await mod.POST(
        call('POST', '/api/trainee/school/exams', {
          traineeId: OTHER,
          examDate: DATE,
          subject: 'LF1',
        })
      );
      expect(res.status).toBe(201);
      expect(mock.writes('insert', 'school_exams')).toEqual([
        expect.objectContaining({ traineeId: ME, organizationId: ORG }),
      ]);
      expect(getUserOrgId).toHaveBeenCalledWith(ME);
    });

    it('POST keeps its validation (subject)', async () => {
      const { mod, mock } = await loadRoute('exams');
      const res = await mod.POST(
        call('POST', '/api/trainee/school/exams', { examDate: DATE })
      );
      expect(res.status).toBe(400);
      noWrites(mock);
    });
  });

  describe('exams/[id]', () => {
    const url = '/api/trainee/school/exams/e';

    it('GET returns an own exam', async () => {
      const { mod } = await loadRoute('exams/[id]', {
        schoolExams: [{ exam: ownExam, result: null }],
      });
      const res = await mod.GET(call('GET', url), withId('e1'));
      expect(res.status).toBe(200);
      expect((await res.json()).exam.id).toBe('e1');
    });

    it('GET answers a foreign exam with 404', async () => {
      const { mod } = await loadRoute('exams/[id]', {
        schoolExams: [{ exam: foreignExam, result: null }],
      });
      const res = await mod.GET(call('GET', url), withId('e2'));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Exam not found' });
    });

    it('PUT changes an own exam, limited to the owner in the update', async () => {
      const { mod, mock } = await loadRoute('exams/[id]', {
        schoolExams: [ownExam],
      });
      const res = await mod.PUT(
        call('PUT', url, { subject: 'LF2' }),
        withId('e1')
      );
      expect(res.status).toBe(200);
      expect(mock.filters('update', 'school_exams').params).toEqual(
        expect.arrayContaining(['e1', ME])
      );
    });

    it('PUT answers a foreign exam with 404 and changes nothing', async () => {
      const { mod, mock } = await loadRoute('exams/[id]', {
        schoolExams: [foreignExam],
      });
      const res = await mod.PUT(
        call('PUT', url, { subject: 'Hijack' }),
        withId('e2')
      );
      expect(res.status).toBe(404);
      noWrites(mock);
    });

    it('DELETE removes an own exam, limited to the owner', async () => {
      const { mod, mock } = await loadRoute('exams/[id]', {
        schoolExams: [ownExam],
      });
      const res = await mod.DELETE(call('DELETE', url), withId('e1'));
      expect(res.status).toBe(200);
      expect(mock.filters('delete', 'school_exams').params).toEqual(
        expect.arrayContaining(['e1', ME])
      );
    });

    it('DELETE answers a foreign exam with 404 and deletes nothing', async () => {
      const { mod, mock } = await loadRoute('exams/[id]', {
        schoolExams: [foreignExam],
        ausbildungBlocks: [],
      });
      const res = await mod.DELETE(call('DELETE', url), withId('e2'));
      expect(res.status).toBe(404);
      noWrites(mock);
    });

    it('DELETE removes an own calendar exam block', async () => {
      const { mod, mock } = await loadRoute('exams/[id]', {
        schoolExams: [],
        ausbildungBlocks: [{ ...ownBlock, blockType: 'EXAM' }],
      });
      const res = await mod.DELETE(call('DELETE', url), withId('b1'));
      expect(res.status).toBe(200);
      expect(mock.filters('delete', 'ausbildung_blocks').params).toEqual(
        expect.arrayContaining(['b1', ME])
      );
    });

    it('DELETE answers a foreign calendar exam block with 404', async () => {
      const { mod, mock } = await loadRoute('exams/[id]', {
        schoolExams: [],
        ausbildungBlocks: [{ ...foreignBlock, blockType: 'EXAM' }],
      });
      const res = await mod.DELETE(call('DELETE', url), withId('b2'));
      expect(res.status).toBe(404);
      noWrites(mock);
    });
  });

  describe('exams/[id]/result', () => {
    const url = '/api/trainee/school/exams/e/result';
    const ownResult = { id: 'x1', examId: 'e1', traineeId: ME, grade: '2' };
    const foreignResult = { id: 'x2', examId: 'e2', traineeId: OTHER };

    it('POST records a result for an own exam, as the session user', async () => {
      const { mod, mock, getUserOrgId } = await loadRoute('exams/[id]/result', {
        schoolExams: [ownExam],
        schoolExamResults: [],
        profiles: [{ fullName: 'Azubi', assignedTrainerId: 'trainer-1' }],
      });
      const res = await mod.POST(
        call('POST', url, { traineeId: OTHER, grade: '2' }),
        withId('e1')
      );
      expect(res.status).toBe(201);
      expect(mock.writes('insert', 'school_exam_results')).toEqual([
        expect.objectContaining({ traineeId: ME, examId: 'e1' }),
      ]);
      expect(getUserOrgId).toHaveBeenCalledWith(ME);
      expect(mock.writes('insert', 'notifications')).toEqual([
        expect.objectContaining({ actorId: ME, userId: 'trainer-1' }),
      ]);
    });

    it('POST answers a foreign exam with 404 and records nothing', async () => {
      const { mod, mock } = await loadRoute('exams/[id]/result', {
        schoolExams: [foreignExam],
        schoolExamResults: [],
      });
      const res = await mod.POST(
        call('POST', url, { traineeId: ME, grade: '1' }),
        withId('e2')
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Exam not found' });
      noWrites(mock);
    });

    it('POST keeps the 409 for an existing result', async () => {
      const { mod } = await loadRoute('exams/[id]/result', {
        schoolExams: [ownExam],
        schoolExamResults: [ownResult],
      });
      const res = await mod.POST(call('POST', url, {}), withId('e1'));
      expect(res.status).toBe(409);
    });

    it('PUT updates the result of an own exam', async () => {
      const { mod, mock } = await loadRoute('exams/[id]/result', {
        schoolExamResults: [ownResult],
      });
      const res = await mod.PUT(call('PUT', url, { grade: '1' }), withId('e1'));
      expect(res.status).toBe(200);
      expect(mock.writes('update', 'school_exam_results')).toEqual([
        expect.objectContaining({ grade: '1', passed: true }),
      ]);
    });

    it('PUT answers the result of a foreign exam like a missing one (404)', async () => {
      const { mod, mock } = await loadRoute('exams/[id]/result', {
        schoolExamResults: [foreignResult],
      });
      const res = await mod.PUT(call('PUT', url, { grade: '1' }), withId('e2'));
      expect(res.status).toBe(404);
      expect((await res.json()).error).toMatch(/No result found/);
      noWrites(mock);
    });

    it('GET returns the own result', async () => {
      const { mod } = await loadRoute('exams/[id]/result', {
        schoolExamResults: [ownResult],
      });
      const res = await mod.GET(call('GET', url), withId('e1'));
      expect(await res.json()).toEqual({ result: ownResult });
    });

    it('GET shows a foreign result as no result (null), like a missing one', async () => {
      const { mod } = await loadRoute('exams/[id]/result', {
        schoolExamResults: [foreignResult],
      });
      const res = await mod.GET(call('GET', url), withId('e2'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ result: null });
    });
  });

  // -------------------------------------------------------------------------
  describe('reports', () => {
    it('GET lists the own reports even if another traineeId is named', async () => {
      const { mod, mock } = await loadRoute('reports', {
        activityReports: [ownReport],
      });
      const res = await mod.GET(
        call('GET', `/api/trainee/school/reports?traineeId=${OTHER}`)
      );
      expect(res.status).toBe(200);
      expect((await res.json()).reports).toHaveLength(1);
      const { params } = mock.filters('select', 'activity_reports');
      expect(params).toContain(ME);
      expect(params).not.toContain(OTHER);
    });

    it('GET works without a traineeId', async () => {
      const { mod } = await loadRoute('reports', { activityReports: [] });
      const res = await mod.GET(call('GET', '/api/trainee/school/reports'));
      expect(res.status).toBe(200);
    });

    it('POST creates the report for the session user, not for the traineeId of the body', async () => {
      const { mod, mock, getUserOrgId } = await loadRoute('reports', {
        activityReports: [],
        profiles: [{ id: ME, startOfTrainingDate: null }],
      });
      const res = await mod.POST(
        call('POST', '/api/trainee/school/reports', {
          traineeId: OTHER,
          weekNumber: 10,
          year: 2027,
        })
      );
      expect(res.status).toBe(201);
      expect(mock.writes('insert', 'activity_reports')).toEqual([
        expect.objectContaining({ traineeId: ME, organizationId: ORG }),
      ]);
      expect(getUserOrgId).toHaveBeenCalledWith(ME);
      // The duplicate check looks at the own reports
      const { params } = mock.filters('select', 'activity_reports');
      expect(params).toContain(ME);
      expect(params).not.toContain(OTHER);
    });

    it('POST keeps the 409 when the week already exists', async () => {
      const { mod } = await loadRoute('reports', {
        activityReports: [ownReport],
      });
      const res = await mod.POST(
        call('POST', '/api/trainee/school/reports', {
          weekNumber: 10,
          year: 2027,
        })
      );
      expect(res.status).toBe(409);
      expect((await res.json()).existingId).toBe('r1');
    });
  });

  describe('reports/[id]', () => {
    const url = '/api/trainee/school/reports/r';
    const tables = (report: object) => ({
      activityReports: [report],
      activityReportEntries: [],
      profiles: [{ fullName: 'Azubi' }],
    });

    it('GET returns an own report with entries', async () => {
      const { mod } = await loadRoute('reports/[id]', tables(ownReport));
      const res = await mod.GET(call('GET', url), withId('r1'));
      expect(res.status).toBe(200);
      expect((await res.json()).report.id).toBe('r1');
    });

    it('GET answers a foreign report with 404', async () => {
      const { mod } = await loadRoute('reports/[id]', tables(foreignReport));
      const res = await mod.GET(call('GET', url), withId('r2'));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Report not found' });
    });

    it('PUT changes an own draft, limited to the owner in the update', async () => {
      const { mod, mock } = await loadRoute('reports/[id]', tables(ownReport));
      const res = await mod.PUT(
        call('PUT', url, { abteilung: 'IT' }),
        withId('r1')
      );
      expect(res.status).toBe(200);
      expect(mock.filters('update', 'activity_reports').params).toEqual(
        expect.arrayContaining(['r1', ME])
      );
    });

    it('PUT answers a foreign report with 404 and changes nothing', async () => {
      const { mod, mock } = await loadRoute(
        'reports/[id]',
        tables(foreignReport)
      );
      const res = await mod.PUT(
        call('PUT', url, { abteilung: 'IT' }),
        withId('r2')
      );
      expect(res.status).toBe(404);
      noWrites(mock);
    });

    it('PUT keeps the 403 for a submitted own report', async () => {
      const { mod } = await loadRoute(
        'reports/[id]',
        tables({ ...ownReport, status: 'SUBMITTED' })
      );
      const res = await mod.PUT(call('PUT', url, {}), withId('r1'));
      expect(res.status).toBe(403);
    });

    it('DELETE removes an own draft, limited to the owner', async () => {
      const { mod, mock } = await loadRoute('reports/[id]', tables(ownReport));
      const res = await mod.DELETE(call('DELETE', url), withId('r1'));
      expect(res.status).toBe(200);
      expect(mock.filters('delete', 'activity_reports').params).toEqual(
        expect.arrayContaining(['r1', ME])
      );
    });

    it('DELETE answers a foreign report with 404 and deletes nothing', async () => {
      const { mod, mock } = await loadRoute(
        'reports/[id]',
        tables(foreignReport)
      );
      const res = await mod.DELETE(call('DELETE', url), withId('r2'));
      expect(res.status).toBe(404);
      noWrites(mock);
    });
  });

  describe('reports/[id]/entries', () => {
    const url = '/api/trainee/school/reports/r/entries';
    const entry = {
      id: 'en1',
      reportId: 'r1',
      betrieblicheStunden: 8,
      unterweisungenStunden: 0,
      berufsschulStunden: 0,
    };

    it('GET lists the entries of an own report', async () => {
      const { mod } = await loadRoute('reports/[id]/entries', {
        activityReports: [ownReport],
        activityReportEntries: [entry],
      });
      const res = await mod.GET(call('GET', url), withId('r1'));
      expect(res.status).toBe(200);
      expect((await res.json()).totalHours).toBe(8);
    });

    it('GET answers the entries of a foreign report with 404', async () => {
      const { mod, mock } = await loadRoute('reports/[id]/entries', {
        activityReports: [foreignReport],
        activityReportEntries: [entry],
      });
      const res = await mod.GET(call('GET', url), withId('r2'));
      expect(res.status).toBe(404);
      expect(mock.filters('select', 'activity_report_entries').sql).toBe('');
    });

    it('POST adds an entry to an own draft', async () => {
      const { mod, mock } = await loadRoute('reports/[id]/entries', {
        activityReports: [ownReport],
      });
      const res = await mod.POST(
        call('POST', url, { betrieblicheTaetigkeit: 'Code' }),
        withId('r1')
      );
      expect(res.status).toBe(201);
      expect(mock.writes('insert', 'activity_report_entries')).toEqual([
        expect.objectContaining({ reportId: 'r1' }),
      ]);
    });

    it('POST answers a foreign report with 404 and adds nothing', async () => {
      const { mod, mock } = await loadRoute('reports/[id]/entries', {
        activityReports: [foreignReport],
      });
      const res = await mod.POST(
        call('POST', url, { betrieblicheTaetigkeit: 'Spam' }),
        withId('r2')
      );
      expect(res.status).toBe(404);
      noWrites(mock);
    });

    it('PUT updates entries of an own report, each limited to that report', async () => {
      const { mod, mock } = await loadRoute('reports/[id]/entries', {
        activityReports: [ownReport],
      });
      const res = await mod.PUT(
        call('PUT', url, {
          entries: [{ id: 'en1', betrieblicheStunden: 5 }],
        }),
        withId('r1')
      );
      expect(res.status).toBe(200);
      // An entry id of another person's report must not be reachable through
      // an own report: the update names the report as well
      expect(mock.filters('update', 'activity_report_entries').params).toEqual(
        expect.arrayContaining(['en1', 'r1'])
      );
    });

    it('PUT answers a foreign report with 404 and updates nothing', async () => {
      const { mod, mock } = await loadRoute('reports/[id]/entries', {
        activityReports: [foreignReport],
      });
      const res = await mod.PUT(
        call('PUT', url, { entries: [{ id: 'en1', betrieblicheStunden: 99 }] }),
        withId('r2')
      );
      expect(res.status).toBe(404);
      noWrites(mock);
    });
  });

  describe('reports/[id]/submit', () => {
    const url = '/api/trainee/school/reports/r/submit';
    const entries = [{ id: 'en1', betrieblicheTaetigkeit: 'Code' }];

    it('submits an own report and notifies the assigned trainer', async () => {
      const { mod, mock, getUserOrgId } = await loadRoute(
        'reports/[id]/submit',
        {
          activityReports: [ownReport],
          activityReportEntries: entries,
          profiles: [{ fullName: 'Azubi', assignedTrainerId: 'trainer-1' }],
        }
      );
      const res = await mod.POST(
        call('POST', url, { traineeConfirmation: true }),
        withId('r1')
      );
      expect(res.status).toBe(200);
      expect(getUserOrgId).toHaveBeenCalledWith(ME);
      expect(mock.filters('update', 'activity_reports').params).toEqual(
        expect.arrayContaining(['r1', ME])
      );
      expect(mock.writes('insert', 'notifications')).toEqual([
        expect.objectContaining({ actorId: ME, userId: 'trainer-1' }),
      ]);
    });

    it('answers a foreign report with 404, no status change, no notification', async () => {
      const { mod, mock } = await loadRoute('reports/[id]/submit', {
        activityReports: [foreignReport],
        activityReportEntries: entries,
        profiles: [{ fullName: 'Azubi', assignedTrainerId: 'trainer-1' }],
      });
      const res = await mod.POST(
        call('POST', url, { traineeConfirmation: true }),
        withId('r2')
      );
      expect(res.status).toBe(404);
      noWrites(mock);
    });

    it('keeps the 400 without the confirmation', async () => {
      const { mod, mock } = await loadRoute('reports/[id]/submit');
      const res = await mod.POST(call('POST', url, {}), withId('r1'));
      expect(res.status).toBe(400);
      noWrites(mock);
    });
  });
});
