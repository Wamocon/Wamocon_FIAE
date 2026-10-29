/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../helpers/mockDb';
import {
  fakeSession,
  mockSession,
  mockTraineeAccess,
  traineeSession,
} from '../../helpers/mockNext';

// KFB-1167: creating an appointment in the calendar did not work. The page
// computed the calendar week with its own formula, which is 0 (or off) for the
// first days of January, and the route refused a week outside 1 to 53 with a
// 400. The route now derives the ISO week from the start date when the client
// sends none, and the calendar week of a trainee appears on the dashboard
// right away (the cached dashboard is dropped). A trainer-level admin could not
// create a blocker either: the route required the role TRAINER exactly.

const revalidateTag = jest.fn();

const call = (method: string, url: string, body?: unknown) =>
  ({
    url,
    method,
    nextUrl: new URL(url),
    headers: { get: () => null },
    json: async () => body,
  }) as any;

async function loadTraineeBlocks() {
  jest.resetModules();
  mockSession(
    traineeSession('t1') as unknown as ReturnType<typeof fakeSession>
  );
  const mock = createTableDb({
    profiles: [{ id: 't1', startOfTrainingDate: null }],
    ausbildungBlocks: [],
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    getUserOrgId: async () => 'org-1',
  }));
  jest.doMock('next/cache', () => ({
    __esModule: true,
    revalidateTag,
    unstable_cache: (fn: any) => fn,
  }));
  const mod = await import('@/app/api/trainee/school/blocks/route');
  return { mod, mock };
}

const post = (extra: Record<string, unknown>) =>
  call('POST', 'http://localhost/api/trainee/school/blocks', {
    year: 2026,
    endDate: '2026-12-31T16:00:00.000Z',
    blockType: 'PERSONAL',
    ...extra,
  });

describe('POST /api/trainee/school/blocks: the calendar week', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it.each([
    ['2026-01-01T08:00:00.000Z', 1],
    ['2026-11-05T08:00:00.000Z', 45],
    ['2027-01-01T08:00:00.000Z', 53],
  ])(
    'derives the ISO week of %s when the client sends none',
    async (start, week) => {
      const { mod, mock } = await loadTraineeBlocks();
      const res = await mod.POST(post({ startDate: start }));
      expect(res.status).toBe(201);
      expect(mock.writes('insert', 'ausbildung_blocks')[0]).toMatchObject({
        calendarWeek: week,
      });
    }
  );

  it('a week of 0 (what the page computed for 1 to 3 January) is derived too', async () => {
    const { mod, mock } = await loadTraineeBlocks();
    const res = await mod.POST(
      post({ startDate: '2026-01-02T08:00:00.000Z', calendarWeek: 0 })
    );
    expect(res.status).toBe(201);
    expect(mock.writes('insert', 'ausbildung_blocks')[0]).toMatchObject({
      calendarWeek: 1,
    });
  });

  it('keeps a valid week of the client', async () => {
    const { mod, mock } = await loadTraineeBlocks();
    await mod.POST(
      post({ startDate: '2026-11-05T08:00:00.000Z', calendarWeek: 44 })
    );
    expect(mock.writes('insert', 'ausbildung_blocks')[0]).toMatchObject({
      calendarWeek: 44,
    });
  });

  it.each([[1.5], ['abc']])('refuses the week %p', async week => {
    const { mod, mock } = await loadTraineeBlocks();
    const res = await mod.POST(
      post({ startDate: '2026-11-05T08:00:00.000Z', calendarWeek: week })
    );
    expect(res.status).toBe(400);
    expect(mock.db.insert).not.toHaveBeenCalled();
  });

  it('still refuses a week that cannot exist', async () => {
    const { mod, mock } = await loadTraineeBlocks();
    const res = await mod.POST(
      post({ startDate: '2026-11-05T08:00:00.000Z', calendarWeek: 99 })
    );
    expect(res.status).toBe(400);
    expect(mock.db.insert).not.toHaveBeenCalled();
  });

  it('drops the cached dashboard so the new appointment shows at once', async () => {
    const { mod } = await loadTraineeBlocks();
    await mod.POST(post({ startDate: '2026-11-05T08:00:00.000Z' }));
    expect(revalidateTag).toHaveBeenCalledWith('trainee_dashboard');
  });

  it('a failing cache does not fail the appointment', async () => {
    revalidateTag.mockImplementationOnce(() => {
      throw new Error('no cache');
    });
    const { mod } = await loadTraineeBlocks();
    const res = await mod.POST(post({ startDate: '2026-11-05T08:00:00.000Z' }));
    expect(res.status).toBe(201);
  });
});

describe('POST /api/trainer/blocks: who may create a blocker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  async function loadTrainerBlocks(role: string) {
    jest.resetModules();
    const mock = createTableDb({
      profiles: {
        sequence: [
          [
            {
              firstName: 'Tina',
              lastName: 'Leitung',
              email: 'leitung@example.com',
              role,
            },
          ],
          [
            {
              firstName: 'Azubi',
              lastName: 'Eins',
              email: 'azubi@example.com',
              startOfTrainingDate: null,
              ausbildungDurationYears: 3,
            },
          ],
        ],
      },
      ausbildungBlocks: [],
    });
    jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
    jest.doMock('@/lib/auth-helpers', () => ({
      __esModule: true,
      getUserOrgId: async () => 'org-1',
    }));
    jest.doMock('@/lib/email', () => ({
      __esModule: true,
      sendBlockerInvite: jest.fn(async () => undefined),
    }));
    mockSession(
      fakeSession({ id: 'tr1', role, organizationId: 'org-1', isAdmin: true })
    );
    mockTraineeAccess('ok');
    const mod = await import('@/app/api/trainer/blocks/route');
    return { mod, mock };
  }

  const blocker = {
    traineeIds: ['t1'],
    blockType: 'TRAINER_BLOCKER',
    startDate: '2026-11-10T08:00:00.000Z',
    endDate: '2026-11-10T10:00:00.000Z',
    sendInvitation: false,
  };

  it.each(['TRAINER', 'ADMIN', 'SUPER_ADMIN'])(
    'the role %s can create a blocker for a trainee in scope',
    async role => {
      const { mod, mock } = await loadTrainerBlocks(role);
      const res = await mod.POST(
        call('POST', 'http://localhost/api/trainer/blocks', blocker)
      );
      expect(res.status).toBe(201);
      expect(mock.writes('insert', 'ausbildung_blocks')).toHaveLength(1);
    }
  );

  it('a trainee profile is still turned away', async () => {
    const { mod, mock } = await loadTrainerBlocks('TRAINEE');
    const res = await mod.POST(
      call('POST', 'http://localhost/api/trainer/blocks', blocker)
    );
    expect(res.status).toBe(403);
    expect(mock.db.insert).not.toHaveBeenCalled();
  });
});
