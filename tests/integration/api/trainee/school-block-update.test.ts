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

// WMCNL-2957: an entry of the block calendar can be changed (date, time, type,
// description, exam type, invitations), not only deleted. An entry a trainer
// put in the calendar stays with the trainer.

const ME = 't1';
const ORG = 'org-1';

const me = fakeSession({
  id: ME,
  role: 'TRAINEE',
  isTrainerLevel: false,
  organizationId: ORG,
});

const ownBlock = {
  id: 'b1',
  traineeId: ME,
  startDate: new Date(2027, 2, 1, 8),
  endDate: new Date(2027, 2, 5, 16),
  blockType: 'SCHOOL',
  description: null,
  createdByTrainerId: null,
};

const refreshDashboard = jest.fn();

async function loadPut(block: Record<string, unknown> = ownBlock) {
  jest.resetModules();
  mockSession(me);
  const mock = createTableDb({
    ausbildungBlocks: [block],
    profiles: [],
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/school/dashboard-cache', () => ({
    __esModule: true,
    refreshTraineeDashboard: refreshDashboard,
  }));
  const mod = await import('@/app/api/trainee/school/blocks/[id]/route');
  return { mod, mock };
}

const put = (body: unknown) =>
  makeRequest('PUT', 'http://localhost/api/trainee/school/blocks/b1', {
    token: 'tok',
    body,
  });
const ctx = { params: Promise.resolve({ id: 'b1' }) };

describe('PUT /api/trainee/school/blocks/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('changes date, time, type and the texts of an entry', async () => {
    const { mod, mock } = await loadPut();
    const res = await mod.PUT(
      put({
        startDate: '2027-03-02T07:30:00.000Z',
        endDate: '2027-03-04T15:00:00.000Z',
        calendarWeek: 9,
        year: 2027,
        blockType: 'EXAM',
        examSubType: 'KLAUSUR_WMC',
        notes: 'Raum 12',
        inviteeEmails: 'a@b.de',
      }),
      ctx
    );
    expect(res.status).toBe(200);
    const [values] = mock.writes('update', 'ausbildung_blocks') as any[];
    expect(values).toMatchObject({
      blockType: 'EXAM',
      examSubType: 'KLAUSUR_WMC',
      notes: 'Raum 12',
      inviteeEmails: 'a@b.de',
      calendarWeek: 9,
      year: 2027,
    });
    expect(values.startDate).toEqual(new Date('2027-03-02T07:30:00.000Z'));
    expect(values.endDate).toEqual(new Date('2027-03-04T15:00:00.000Z'));
    // the owner is part of the update, as before
    expect(mock.filters('update', 'ausbildung_blocks').params).toContain(ME);
  });

  it('derives the calendar week from a new start date', async () => {
    const { mod, mock } = await loadPut();
    await mod.PUT(
      put({
        startDate: '2027-03-02T09:00:00.000Z',
        endDate: '2027-03-03T09:00:00.000Z',
      }),
      ctx
    );
    const [values] = mock.writes('update', 'ausbildung_blocks') as any[];
    expect(values.calendarWeek).toBe(9);
    expect(values.year).toBe(2027);
  });

  it('refuses an end that is not after the start (400)', async () => {
    const { mod, mock } = await loadPut();
    const res = await mod.PUT(
      put({
        startDate: '2027-03-05T09:00:00.000Z',
        endDate: '2027-03-05T09:00:00.000Z',
      }),
      ctx
    );
    expect(res.status).toBe(400);
    expect(mock.db.update).not.toHaveBeenCalled();
  });

  it('refuses a date that is none (400)', async () => {
    const { mod, mock } = await loadPut();
    const res = await mod.PUT(put({ startDate: 'morgen' }), ctx);
    expect(res.status).toBe(400);
    expect(mock.db.update).not.toHaveBeenCalled();
  });

  it('needs a description for the type SONSTIGES, like on creation (400)', async () => {
    const { mod, mock } = await loadPut();
    const res = await mod.PUT(put({ blockType: 'SONSTIGES' }), ctx);
    expect(res.status).toBe(400);
    expect(mock.db.update).not.toHaveBeenCalled();

    const ok = await loadPut();
    const res2 = await ok.mod.PUT(
      put({ blockType: 'SONSTIGES', description: 'Betriebsausflug' }),
      ctx
    );
    expect(res2.status).toBe(200);
  });

  it('leaves an entry of a trainer alone (403)', async () => {
    const { mod, mock } = await loadPut({
      ...ownBlock,
      createdByTrainerId: 'trainer-1',
    });
    const res = await mod.PUT(put({ notes: 'Mein Text' }), ctx);
    expect(res.status).toBe(403);
    expect(mock.db.update).not.toHaveBeenCalled();
  });

  it('tells the dashboard about the change', async () => {
    const { mod } = await loadPut();
    await mod.PUT(put({ notes: 'Neu' }), ctx);
    expect(refreshDashboard).toHaveBeenCalledTimes(1);
  });
});
