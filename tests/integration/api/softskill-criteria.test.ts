/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../helpers/mockDb';
import {
  makeRequest,
  mockSupabaseAuth,
  sessionProfileRow,
} from '../../helpers/mockNext';

// GET /api/softskill-criteria used to answer without a session. It reads for
// any signed-in, active account (trainee and trainer alike, no role check) and
// turns an anonymous call away with 401 before it reads anything.

const TOKEN = 'valid-token';
const CRITERIA = [
  { id: 'c1', name: 'Teamfähigkeit', orderIndex: 1 },
  { id: 'c2', name: 'Zuverlässigkeit', orderIndex: 2 },
];

async function load(role: string, isActive = true) {
  jest.resetModules();
  mockSupabaseAuth({ [TOKEN]: { id: 'session-user' } });
  const mock = createTableDb({
    profiles: [sessionProfileRow({ role, isActive })],
    mesSoftskillCriteria: CRITERIA,
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const mod = await import('@/app/api/softskill-criteria/route');
  return { mod, mock };
}

const call = (token: string | null) =>
  makeRequest('GET', 'http://localhost/api/softskill-criteria', { token });

describe('GET /api/softskill-criteria', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  });

  it('answers 401 without a session and reads no criteria', async () => {
    const { mod, mock } = await load('TRAINEE');
    const res = await mod.GET(call(null));
    expect(res.status).toBe(401);
    expect(
      mock.calls.filter(c => c.table === 'mes_softskill_criteria')
    ).toHaveLength(0);
  });

  it.each(['TRAINEE', 'TRAINER', 'ADMIN'])(
    'gives the criteria to a signed-in %s',
    async role => {
      const { mod } = await load(role);
      const res = await mod.GET(call(TOKEN));
      expect(res.status).toBe(200);
      expect((await res.json()).criteria).toHaveLength(2);
    }
  );

  it('turns an inactive account away', async () => {
    const { mod } = await load('TRAINEE', false);
    const res = await mod.GET(call(TOKEN));
    expect(res.status).toBe(403);
  });
});
