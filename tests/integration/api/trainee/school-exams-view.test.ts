/**
 * @jest-environment node
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  fakeSession,
  makeRequest,
  mockSession,
} from '../../../helpers/mockNext';

// KFB-1153: "Vergangene Prüfungen" listed exams that lie ahead. The route only
// filtered for upcoming=true, upcoming=false meant "everything". The two views
// now split at the start of today (calendar day of Germany), so an exam on
// today's date is still upcoming and one of yesterday is past. The table mock
// ignores where(), so the tests read the rendered conditions.

const ME = 't1';
const me = fakeSession({
  id: ME,
  role: 'TRAINEE',
  isTrainerLevel: false,
  organizationId: 'org-1',
});

// 2026-11-05 10:00 UTC is 11:00 in Berlin, the day starts 2026-11-04 23:00 UTC
const NOW = new Date('2026-11-05T10:00:00.000Z');
const DAY_START = '2026-11-04T23:00:00.000Z';

const ONLY_DATE = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'nextTick',
  'queueMicrotask',
  'performance',
  'hrtime',
] as any;

async function listExams(query: string, tables: Record<string, any> = {}) {
  jest.resetModules();
  mockSession(me);
  const mock = createTableDb({
    schoolExams: [],
    ausbildungBlocks: [],
    ...tables,
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const mod = await import('@/app/api/trainee/school/exams/route');
  const res = await mod.GET(
    makeRequest('GET', `http://localhost/api/trainee/school/exams${query}`, {
      token: 'tok',
    })
  );
  return { res, mock, body: await res.json() };
}

const examRow = (id: string, examDate: Date) => ({
  exam: { id, traineeId: ME, subject: id, examDate },
  result: null,
});

describe('exams of a trainee: upcoming and past split at the start of today', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ONLY_DATE });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('the past view only asks for exams before today', async () => {
    const { mock } = await listExams('?upcoming=false');
    const exams = mock.filters('select', 'school_exams');
    expect(exams.sql).toContain('"school_exams"."exam_date" <');
    expect(exams.sql).not.toContain('"school_exams"."exam_date" >=');
    expect(exams.params).toContain(DAY_START);
    const blocks = mock.filters('select', 'ausbildung_blocks');
    expect(blocks.sql).toContain('"ausbildung_blocks"."start_date" <');
    expect(blocks.params).toContain(DAY_START);
  });

  it('the upcoming view asks for exams from the start of today on', async () => {
    const { mock } = await listExams('?upcoming=true');
    const exams = mock.filters('select', 'school_exams');
    expect(exams.sql).toContain('"school_exams"."exam_date" >=');
    expect(exams.sql).not.toContain('"school_exams"."exam_date" <');
    expect(exams.params).toContain(DAY_START);
    const blocks = mock.filters('select', 'ausbildung_blocks');
    expect(blocks.sql).toContain('"ausbildung_blocks"."start_date" >=');
  });

  it('without the parameter every exam is listed (calendar, results)', async () => {
    const { mock } = await listExams('');
    expect(mock.filters('select', 'school_exams').sql).not.toContain(
      'exam_date'
    );
    expect(mock.filters('select', 'ausbildung_blocks').sql).not.toContain(
      'start_date'
    );
  });

  it('an exam on the date of today is today, not past (a date without a time)', async () => {
    const { body } = await listExams('?upcoming=true', {
      schoolExams: [
        examRow('today', new Date('2026-11-05T00:00:00.000Z')),
        examRow('tomorrow', new Date('2026-11-06T00:00:00.000Z')),
        examRow('yesterday', new Date('2026-11-04T00:00:00.000Z')),
      ],
    });
    const byId = Object.fromEntries(body.exams.map((e: any) => [e.id, e]));
    expect(byId.today.meta).toMatchObject({
      isPast: false,
      isToday: true,
      daysUntil: 0,
    });
    expect(byId.tomorrow.meta).toMatchObject({
      isPast: false,
      isToday: false,
      daysUntil: 1,
    });
    expect(byId.yesterday.meta.isPast).toBe(true);
  });

  it('shortly after midnight in Germany it is already the next day', async () => {
    // 2026-11-04 23:30 UTC is 00:30 on 5 November in Berlin
    jest.setSystemTime(new Date('2026-11-04T23:30:00.000Z'));
    const { mock } = await listExams('?upcoming=true');
    expect(mock.filters('select', 'school_exams').params).toContain(DAY_START);
  });

  it('in summer the day starts at 22:00 UTC (daylight saving time)', async () => {
    jest.setSystemTime(new Date('2026-07-05T10:00:00.000Z'));
    const { mock } = await listExams('?upcoming=true');
    expect(mock.filters('select', 'school_exams').params).toContain(
      '2026-07-04T22:00:00.000Z'
    );
  });
});
