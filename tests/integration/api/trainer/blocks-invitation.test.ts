/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  fakeSession,
  mockSession,
  mockTraineeAccess,
} from '../../../helpers/mockNext';

// WMCNL-3017: the calendar invitation of a blocker goes out only when the
// trainer asks for it. A request that does not say anything sends no mail
// (before, the default was to send), so trying out the dialog or a caller
// that leaves the field out never mails a trainee by accident.

const ORG = 'org-1';

const trainer = {
  firstName: 'Tina',
  lastName: 'Trainer',
  email: 'trainer@example.com',
  fullName: 'Tina Trainer',
  role: 'TRAINER',
};

const trainee = {
  id: 'f1',
  fullName: 'Azubi f1',
  firstName: 'Azubi',
  lastName: 'f1',
  email: 'f1@example.com',
  startOfTrainingDate: new Date(2026, 7, 1),
  ausbildungDurationYears: 3,
};

const call = (body: unknown) =>
  ({
    url: 'http://localhost/api/trainer/blocks',
    method: 'POST',
    nextUrl: new URL('http://localhost/api/trainer/blocks'),
    headers: { get: () => null },
    json: async () => body,
  }) as any;

async function post(extra: Record<string, unknown>) {
  jest.resetModules();
  const mock = createTableDb({
    profiles: { sequence: [[trainer], [trainee]] },
    ausbildungBlocks: [],
  });
  const sendBlockerInvite = jest.fn(async () => undefined);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    getUserOrgId: async () => ORG,
  }));
  jest.doMock('@/lib/email', () => ({ __esModule: true, sendBlockerInvite }));
  jest.doMock('@/lib/catalog/phase-plan-db', () => ({
    __esModule: true,
    loadPhasePlanForUser: async () => ({ phaseMonths: [18, 18] }),
    loadPhasePlansForUsers: async () => new Map(),
  }));
  mockSession(fakeSession({ id: 'tr1', organizationId: ORG }));
  mockTraineeAccess('ok');
  const mod = await import('@/app/api/trainer/blocks/route');
  const res = await mod.POST(
    call({
      traineeIds: ['f1'],
      blockType: 'TRAINER_BLOCKER',
      startDate: '2027-11-15T08:00:00.000Z',
      endDate: '2027-11-15T17:00:00.000Z',
      ...extra,
    })
  );
  return { res, mock, sendBlockerInvite };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('POST /api/trainer/blocks: the invitation', () => {
  it('sends no invitation when the request does not ask for one', async () => {
    const { res, mock, sendBlockerInvite } = await post({});
    expect(res.status).toBe(201);
    expect(mock.writes('insert', 'ausbildung_blocks')).toHaveLength(1);
    expect(sendBlockerInvite).not.toHaveBeenCalled();
  });

  it('sends no invitation for sendInvitation false', async () => {
    const { sendBlockerInvite } = await post({ sendInvitation: false });
    expect(sendBlockerInvite).not.toHaveBeenCalled();
  });

  it('sends the invitation when the trainer asks for it', async () => {
    const { res, sendBlockerInvite } = await post({ sendInvitation: true });
    expect(res.status).toBe(201);
    expect(sendBlockerInvite).toHaveBeenCalledTimes(1);
    expect((sendBlockerInvite.mock.calls[0] as unknown[])[0]).toEqual([
      'f1@example.com',
    ]);
  });
});
