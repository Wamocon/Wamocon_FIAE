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
import { createTableDb } from '../../helpers/mockDb';

// Module under test: POST /api/register (src/app/api/register/route.ts).
// Self-registration always yields a TRAINEE, never takes a role from the
// request, from ADMIN_EMAIL or from an existing profile, and is rate limited.

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

type RegisterOptions = {
  tables?: Parameters<typeof createTableDb>[0];
  createUser?: jest.Mock;
};

async function setup(options: RegisterOptions = {}) {
  jest.resetModules();
  const table = createTableDb(
    options.tables ?? {
      // 1) e-mail lookup, 2) trainer assignment, 3) org + trainer list
      profiles: {
        sequence: [
          [],
          [{ id: 'tr1' }],
          [{ id: 'tr1', organizationId: 'org1' }],
        ],
      },
    }
  );
  jest.doMock('@/db', () => ({ __esModule: true, default: table.db }));
  const createUser =
    options.createUser ??
    (jest.fn() as jest.Mock).mockImplementation(async (args: any) => ({
      data: { user: { id: 'new-user', email: args.email } },
      error: null,
    }));
  const supa = await import('@supabase/supabase-js');
  (supa.createClient as jest.Mock).mockReturnValue({
    auth: { admin: { createUser } },
  });
  const mod = await import('@/app/api/register/route');
  return {
    POST: mod.POST as (req: any) => Promise<Response>,
    createUser,
    ...table,
  };
}

function makeRequest(body: unknown, ip = '203.0.113.7') {
  return {
    headers: {
      get: (k: string) => (k.toLowerCase() === 'x-forwarded-for' ? ip : null),
    },
    json: async () => body,
  } as any;
}

const valid = { email: 'azubi@example.com', password: 'secret1' };

describe('API: POST /api/register', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPABASE_URL = 'http://test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
    delete process.env.ADMIN_EMAIL;
    delete process.env.DEFAULT_TRAINER_ID;
    delete process.env.DEFAULT_TRAINER_EMAIL;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('creates a TRAINEE that waits for trainer activation and notifies trainers', async () => {
    const { POST, createUser, writes } = await setup();
    const res = await POST(makeRequest(valid));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, role: 'TRAINEE' });
    expect(createUser).toHaveBeenCalledTimes(1);
    expect((createUser.mock.calls[0][0] as any).user_metadata).toEqual({
      full_name: 'Azubi',
    });
    expect(writes('insert', 'profiles')[0]).toMatchObject({
      id: 'new-user',
      role: 'TRAINEE',
      trainerActivated: false,
      assignedTrainerId: 'tr1',
    });
    expect((writes('insert', 'notifications')[0] as any).type).toBe(
      'TRAINEE_REGISTERED'
    );
  });

  it('ignores a role sent in the request body', async () => {
    const { POST, writes } = await setup();
    const res = await POST(
      makeRequest({ ...valid, role: 'ADMIN', user_metadata: { role: 'ADMIN' } })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe('TRAINEE');
    expect((writes('insert', 'profiles')[0] as any).role).toBe('TRAINEE');
  });

  it('does not grant ADMIN to the ADMIN_EMAIL address', async () => {
    process.env.ADMIN_EMAIL = 'boss@example.com';
    const { POST, writes } = await setup();
    const res = await POST(
      makeRequest({ email: 'Boss@Example.com', password: 'secret1' })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe('TRAINEE');
    expect((writes('insert', 'profiles')[0] as any).role).toBe('TRAINEE');
  });

  it('409 and no auth user if a profile with this e-mail already exists', async () => {
    const { POST, createUser } = await setup({
      tables: { profiles: [{ id: 'existing', role: 'ADMIN' }] },
    });
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/bereits registriert/);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('409 if Supabase reports the address as already registered', async () => {
    const createUser = (jest.fn() as jest.Mock).mockImplementation(
      async () => ({
        data: { user: null },
        error: {
          status: 422,
          message: 'A user with this email address has already been registered',
        },
      })
    );
    const { POST } = await setup({
      tables: { profiles: [] },
      createUser,
    });
    const res = await POST(makeRequest(valid));
    expect(res.status).toBe(409);
  });

  it.each([
    [{ email: '', password: 'secret1' }, /erforderlich/],
    [{ email: 'not-an-email', password: 'secret1' }, /gültige E-Mail/],
    [{ email: 'azubi@example.com', password: '123' }, /mindestens 6 Zeichen/],
  ])(
    '400 with a clear message for invalid input %#',
    async (payload, message) => {
      const { POST, createUser } = await setup();
      const res = await POST(makeRequest(payload));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(message);
      expect(createUser).not.toHaveBeenCalled();
    }
  );

  it('400 for an unreadable body', async () => {
    const { POST } = await setup();
    const res = await POST({
      headers: { get: () => null },
      json: async () => {
        throw new Error('bad json');
      },
    } as any);
    expect(res.status).toBe(400);
  });

  it('429 with Retry-After after five registrations from the same address', async () => {
    const { POST } = await setup({ tables: { profiles: [] } });
    for (let i = 0; i < 5; i++) {
      const ok = await POST(
        makeRequest({ email: `azubi${i}@example.com`, password: 'secret1' })
      );
      expect(ok.status).toBe(200);
    }
    const blocked = await POST(makeRequest(valid));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await blocked.json()).error).toMatch(
      /Zu viele Registrierungsversuche/
    );

    // A different client address is not affected
    const other = await POST(makeRequest(valid, '198.51.100.9'));
    expect(other.status).toBe(200);
  });
});
