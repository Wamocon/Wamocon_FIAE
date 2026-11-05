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
  mockCatalogScope,
  mockTraineeSession,
} from '../../../helpers/mockNext';

// KFB-1167: the card "Anstehende Termine" of the trainee dashboard only showed
// the phase deadlines, the appointments of the calendar (blocks, exams) never
// reached it. The dashboard now also answers the next appointments from the
// calendar, counted from the start of today (calendar day of Germany). The
// table mock ignores where(), so the tests read the rendered conditions.

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

async function dashboard(tables: Record<string, any> = {}) {
  jest.resetModules();
  const mock = createTableDb({
    courseMembers: [],
    profiles: [{ startOfTrainingDate: null, ausbildungDurationYears: 3 }],
    ausbildungBlocks: [],
    schoolExams: [],
    ...tables,
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockTraineeSession();
  mockCatalogScope();
  const mod = await import('@/app/api/trainee/dashboard/route');
  const res = await mod.GET({
    url: 'http://localhost/api/trainee/dashboard',
  } as any);
  return { res, body: await res.json(), mock };
}

const block = (over: Record<string, unknown>) => ({
  id: 'b',
  blockType: 'SCHOOL',
  title: null,
  notes: null,
  description: null,
  examSubType: null,
  startDate: new Date('2026-11-10T07:00:00.000Z'),
  endDate: new Date('2026-11-14T16:00:00.000Z'),
  ...over,
});

describe('dashboard: upcoming appointments of the calendar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.useFakeTimers({ now: NOW, doNotFake: ONLY_DATE });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('answers the blocks and exams of the trainee, the nearest first', async () => {
    const { res, body } = await dashboard({
      ausbildungBlocks: [
        block({ id: 'b1', startDate: new Date('2026-11-20T07:00:00.000Z') }),
        block({
          id: 'b2',
          blockType: 'PERSONAL',
          title: 'Zahnarzt',
          startDate: new Date('2026-11-08T07:00:00.000Z'),
          endDate: new Date('2026-11-08T08:00:00.000Z'),
        }),
      ],
      schoolExams: [
        {
          id: 'e1',
          subject: 'LF5',
          examDate: new Date('2026-11-12T00:00:00.000Z'),
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(body.appointments.map((a: any) => a.id)).toEqual(['b2', 'e1', 'b1']);
    expect(body.appointments[0]).toMatchObject({
      kind: 'PERSONAL',
      label: 'Zahnarzt',
      source: 'block',
    });
    expect(body.appointments[1]).toMatchObject({
      kind: 'EXAM',
      label: 'LF5',
      source: 'exam',
      startDate: '2026-11-12T00:00:00.000Z',
    });
  });

  it('keeps five appointments at most', async () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      block({
        id: `b${i}`,
        startDate: new Date(Date.UTC(2026, 10, 10 + i, 7)),
        endDate: new Date(Date.UTC(2026, 10, 10 + i, 15)),
      })
    );
    const { body } = await dashboard({ ausbildungBlocks: many });
    expect(body.appointments).toHaveLength(5);
  });

  it('only asks for appointments that have not ended before today', async () => {
    const { mock } = await dashboard();
    const blocks = mock.filters('select', 'ausbildung_blocks');
    expect(blocks.sql).toContain('"ausbildung_blocks"."trainee_id" =');
    expect(blocks.sql).toContain('"ausbildung_blocks"."end_date" >=');
    expect(blocks.params).toContain(DAY_START);
    const exams = mock.filters('select', 'school_exams');
    expect(exams.sql).toContain('"school_exams"."trainee_id" =');
    expect(exams.sql).toContain('"school_exams"."exam_date" >=');
    expect(exams.params).toContain(DAY_START);
  });

  it('leaves the long phase blocks of the company out', async () => {
    const { mock } = await dashboard();
    expect(mock.filters('select', 'ausbildung_blocks').sql).toContain(
      '"ausbildung_blocks"."block_type" <>'
    );
  });

  it('a failing calendar lookup does not break the dashboard', async () => {
    jest.resetModules();
    const mock = createTableDb({ courseMembers: [], profiles: [] });
    const original = mock.db.select;
    mock.db.select = jest.fn((...args: any[]) => {
      const chain = (original as any)(...args);
      const from = chain.from;
      chain.from = (table: any) => {
        const name = String((table as any)[Symbol.for('drizzle:Name')] ?? '');
        if (name === 'ausbildung_blocks') throw new Error('boom');
        return from(table);
      };
      return chain;
    });
    jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
    mockTraineeSession();
    mockCatalogScope();
    const mod = await import('@/app/api/trainee/dashboard/route');
    const res = await mod.GET({
      url: 'http://localhost/api/trainee/dashboard',
    } as any);
    expect(res.status).toBe(200);
    expect((await res.json()).appointments).toEqual([]);
  });
});
