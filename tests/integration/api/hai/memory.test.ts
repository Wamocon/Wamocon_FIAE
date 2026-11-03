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
  mockCatalogScope,
  mockSession,
  traineeSession,
  type FakeSession,
} from '../../../helpers/mockNext';
import {
  createGlobalRepo,
  createUserRepo,
  globalRow,
  userRow,
  type FakeGlobalRepo,
  type FakeUserRepo,
} from '../../../helpers/memoryHaiRepo';
import { MEMORY_ENV } from '@/lib/hai/memory/config';

// The routes of the HAI memory. The user routes work on the entries of the
// SESSION user only: no request names another person, a trainer or an admin gets
// the same (their own entries, never the entry of a trainee). The admin routes
// are for the platform admin and show the shared memory, never an entry of one
// person. Everything is behind the switch HAI_MEMORY.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const TRAINEE = '11111111-1111-4111-8111-111111111111';
const TRAINER = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';
const SUPER = '44444444-4444-4444-8444-444444444444';
const BASE = 'http://localhost/api';

const CATALOGS = [
  {
    id: FIAE,
    code: 'FIAE',
    title: 'Fachinformatiker/in Anwendungsentwicklung',
  },
  { id: KFBM, code: 'KFBM', title: 'Kaufleute für Büromanagement' },
];

type World = {
  users: FakeUserRepo;
  globals: FakeGlobalRepo;
  counters?: { preferences?: unknown[]; weaknesses?: unknown[] };
};

async function load(route: string, session: FakeSession | null, world: World) {
  jest.resetModules();
  mockSession(session);
  mockCatalogScope({
    allowedCatalogIds: [FIAE, KFBM],
    activeCatalogId: FIAE,
    selected: false,
  });
  const rec = createTableDb({ training_catalogs: CATALOGS });
  jest.doMock('@/db', () => ({ __esModule: true, default: rec.db }));
  jest.doMock('@/lib/hai/memory/repoDb', () => ({
    __esModule: true,
    dbUserMemoryRepo: world.users,
    dbGlobalMemoryRepo: world.globals,
  }));
  jest.doMock('@/lib/hai/memory/globalData', () => ({
    __esModule: true,
    loadPreferenceCounters: async () => world.counters?.preferences ?? [],
    loadWeaknessCounters: async () => world.counters?.weaknesses ?? [],
  }));
  return (await import(`@/app/api/${route}/route`)) as Record<
    string,
    (...args: any[]) => Promise<Response>
  >;
}

const call = (method: string, url: string, body?: unknown) =>
  makeRequest(method, `${BASE}/${url}`, { token: 't', body });

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

let saved: string | undefined;
let world: World;
beforeEach(() => {
  saved = process.env[MEMORY_ENV];
  process.env[MEMORY_ENV] = 'on';
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  world = { users: createUserRepo(), globals: createGlobalRepo() };
});
afterEach(() => {
  if (saved === undefined) delete process.env[MEMORY_ENV];
  else process.env[MEMORY_ENV] = saved;
  jest.restoreAllMocks();
});

describe('user routes: the switch HAI_MEMORY is off', () => {
  beforeEach(() => {
    delete process.env[MEMORY_ENV];
  });

  it('GET says the feature is not available and reads nothing', async () => {
    const mod = await load('hai/memory', traineeSession(TRAINEE), world);
    const res = await mod.GET(call('GET', 'hai/memory'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false });
    expect(world.users.calls).toEqual([]);
  });

  it('every write answers 404 and changes nothing', async () => {
    const seed = userRow({ userId: TRAINEE, trainingCatalogId: FIAE });
    world.users = createUserRepo([seed]);
    const mod = await load('hai/memory', traineeSession(TRAINEE), world);
    for (const res of [
      await mod.PATCH(call('PATCH', 'hai/memory', { enabled: false })),
      await mod.DELETE(call('DELETE', 'hai/memory')),
    ]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: 'MEMORY_OFF' });
    }
    const one = await load('hai/memory/[id]', traineeSession(TRAINEE), world);
    expect(
      (
        await one.PATCH(
          call('PATCH', 'x', { decision: 'confirm' }),
          idParams(seed.id)
        )
      ).status
    ).toBe(404);
    expect(
      (await one.DELETE(call('DELETE', 'x'), idParams(seed.id))).status
    ).toBe(404);
    expect(world.users.rows).toEqual([seed]);
    expect(world.users.calls).toEqual([]);
  });
});

describe('GET /api/hai/memory', () => {
  it('lists the own entries per occupation, open proposals included, rejected ones hidden', async () => {
    world.users = createUserRepo([
      userRow({
        userId: TRAINEE,
        trainingCatalogId: FIAE,
        proposalKey: 'a',
        content: 'Antworten kurz halten.',
      }),
      userRow({
        userId: TRAINEE,
        trainingCatalogId: FIAE,
        proposalKey: 'b',
        content: 'Noch offen.',
        status: 'proposed',
        confirmedAt: null,
      }),
      userRow({
        userId: TRAINEE,
        trainingCatalogId: FIAE,
        proposalKey: 'c',
        content: 'Abgelehnt.',
        status: 'rejected',
        confirmedAt: null,
      }),
      userRow({
        userId: TRAINEE,
        trainingCatalogId: KFBM,
        proposalKey: 'd',
        content: 'Anderer Beruf.',
      }),
    ]);
    const mod = await load('hai/memory', traineeSession(TRAINEE), world);
    const res = await mod.GET(call('GET', 'hai/memory'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.enabled).toBe(true);
    const byCode = Object.fromEntries(
      body.occupations.map((o: any) => [
        o.code,
        o.entries.map((e: any) => e.content).sort(),
      ])
    );
    expect(byCode).toEqual({
      FIAE: ['Antworten kurz halten.', 'Noch offen.'],
      KFBM: ['Anderer Beruf.'],
    });
    expect(JSON.stringify(body)).not.toContain('Abgelehnt.');
    expect(JSON.stringify(body)).not.toContain(TRAINEE);
  });

  it('shows an occupation without entries and the state of the switch', async () => {
    world.users.enabled.set(TRAINEE, false);
    const mod = await load('hai/memory', traineeSession(TRAINEE), world);
    const body = await (await mod.GET(call('GET', 'hai/memory'))).json();
    expect(body.enabled).toBe(false);
    expect(body.occupations.map((o: any) => o.code).sort()).toEqual([
      'FIAE',
      'KFBM',
    ]);
    expect(body.occupations.every((o: any) => o.entries.length === 0)).toBe(
      true
    );
  });

  it('answers 500 with a code when the memory cannot be read (the section stays hidden)', async () => {
    world.users.list = async () => {
      throw new Error('relation does not exist');
    };
    const mod = await load('hai/memory', traineeSession(TRAINEE), world);
    const res = await mod.GET(call('GET', 'hai/memory'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'Memory could not be loaded',
      code: 'LOAD_FAILED',
    });
  });
});

describe.each([
  ['a trainee', traineeSession(TRAINEE)],
  ['a trainer', fakeSession({ id: TRAINER })],
  ['an admin', fakeSession({ id: ADMIN, role: 'ADMIN', isAdmin: true })],
  [
    'a platform admin',
    fakeSession({
      id: SUPER,
      role: 'SUPER_ADMIN',
      isAdmin: true,
      isSuperAdmin: true,
    }),
  ],
])('%s reaches only the own memory', (_name, session) => {
  const mine = () =>
    userRow({
      userId: session.id,
      trainingCatalogId: FIAE,
      proposalKey: 'mine',
      content: 'Mein Eintrag.',
    });
  const theirs = () =>
    userRow({
      userId: TRAINEE === session.id ? TRAINER : TRAINEE,
      trainingCatalogId: FIAE,
      proposalKey: 'theirs',
      content: 'Fremder Eintrag.',
      status: 'proposed',
      confirmedAt: null,
    });

  it('GET lists the own entries, a userId in the query changes nothing', async () => {
    const other = theirs();
    world.users = createUserRepo([mine(), other]);
    const mod = await load('hai/memory', session, world);
    const res = await mod.GET(
      call('GET', `hai/memory?userId=${other.userId}&user=${other.userId}`)
    );
    const text = JSON.stringify(await res.json());
    expect(text).toContain('Mein Eintrag.');
    expect(text).not.toContain('Fremder Eintrag.');
  });

  it('PATCH and DELETE of the entry of another person answer 404 and change nothing', async () => {
    const other = theirs();
    world.users = createUserRepo([mine(), other]);
    const before = JSON.stringify(world.users.rows);
    const one = await load('hai/memory/[id]', session, world);
    for (const res of [
      await one.PATCH(
        call('PATCH', `hai/memory/${other.id}`, {
          decision: 'confirm',
          userId: other.userId,
        }),
        idParams(other.id)
      ),
      await one.PATCH(
        call('PATCH', `hai/memory/${other.id}`, { content: 'Überschrieben' }),
        idParams(other.id)
      ),
      await one.PATCH(
        call('PATCH', `hai/memory/${other.id}`, { decision: 'reject' }),
        idParams(other.id)
      ),
      await one.DELETE(
        call('DELETE', `hai/memory/${other.id}?userId=${other.userId}`),
        idParams(other.id)
      ),
    ]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        error: 'Not found',
        code: 'NOT_FOUND',
      });
    }
    expect(JSON.stringify(world.users.rows)).toBe(before);
  });

  it('DELETE of everything removes only the own entries', async () => {
    const other = theirs();
    world.users = createUserRepo([mine(), other]);
    const mod = await load('hai/memory', session, world);
    const res = await mod.DELETE(
      call('DELETE', `hai/memory?userId=${other.userId}`)
    );
    expect(await res.json()).toEqual({ deleted: 1 });
    expect(world.users.rows).toEqual([other]);
  });

  it('the switch is the own switch (a userId in the body is ignored)', async () => {
    const mod = await load('hai/memory', session, world);
    const res = await mod.PATCH(
      call('PATCH', 'hai/memory', { enabled: false, userId: 'someone-else' })
    );
    expect(await res.json()).toEqual({ enabled: false });
    expect([...world.users.enabled.entries()]).toEqual([[session.id, false]]);
  });
});

describe('PATCH /api/hai/memory (the switch) and DELETE /api/hai/memory', () => {
  it('turns the memory off and on', async () => {
    const mod = await load('hai/memory', traineeSession(TRAINEE), world);
    expect(
      await (
        await mod.PATCH(call('PATCH', 'hai/memory', { enabled: false }))
      ).json()
    ).toEqual({ enabled: false });
    expect(world.users.enabled.get(TRAINEE)).toBe(false);
    expect(
      await (
        await mod.PATCH(call('PATCH', 'hai/memory', { enabled: true }))
      ).json()
    ).toEqual({ enabled: true });
    expect(world.users.enabled.get(TRAINEE)).toBe(true);
  });

  it('turns away a body that is no switch', async () => {
    const mod = await load('hai/memory', traineeSession(TRAINEE), world);
    for (const body of [{}, { enabled: 'yes' }, null, { enabled: 1 }]) {
      const res = await mod.PATCH(call('PATCH', 'hai/memory', body));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID' });
    }
    const broken = makeRequest('PATCH', `${BASE}/hai/memory`, { token: 't' });
    broken.json = async () => {
      throw new Error('bad json');
    };
    expect((await mod.PATCH(broken)).status).toBe(400);
  });

  it('answers 500 when the switch cannot be saved', async () => {
    world.users.setEnabled = async () => {
      throw new Error('no table');
    };
    const mod = await load('hai/memory', traineeSession(TRAINEE), world);
    const res = await mod.PATCH(
      call('PATCH', 'hai/memory', { enabled: false })
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'SAVE_FAILED' });
  });

  it('deletes the entries of one occupation, and rejects a bad occupation id', async () => {
    world.users = createUserRepo([
      userRow({ userId: TRAINEE, trainingCatalogId: FIAE, proposalKey: 'a' }),
      userRow({ userId: TRAINEE, trainingCatalogId: KFBM, proposalKey: 'b' }),
    ]);
    const mod = await load('hai/memory', traineeSession(TRAINEE), world);
    expect(
      (await mod.DELETE(call('DELETE', 'hai/memory?catalogId=not-a-uuid')))
        .status
    ).toBe(400);
    expect(
      await (
        await mod.DELETE(call('DELETE', `hai/memory?catalogId=${KFBM}`))
      ).json()
    ).toEqual({ deleted: 1 });
    expect(world.users.rows.map(r => r.trainingCatalogId)).toEqual([FIAE]);
  });

  it('answers 500 when the deletion fails', async () => {
    world.users.removeAll = async () => {
      throw new Error('boom');
    };
    const mod = await load('hai/memory', traineeSession(TRAINEE), world);
    const res = await mod.DELETE(call('DELETE', 'hai/memory'));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'DELETE_FAILED' });
  });
});

describe('PATCH and DELETE /api/hai/memory/[id]', () => {
  const proposed = () =>
    userRow({
      userId: TRAINEE,
      trainingCatalogId: FIAE,
      proposalKey: 'pref.length.short',
      status: 'proposed',
      confirmedAt: null,
    });

  it('yes makes the entry active', async () => {
    const row = proposed();
    world.users = createUserRepo([row]);
    const mod = await load('hai/memory/[id]', traineeSession(TRAINEE), world);
    const res = await mod.PATCH(
      call('PATCH', 'x', { decision: 'confirm' }),
      idParams(row.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry).toMatchObject({
      id: row.id,
      status: 'active',
      catalogId: FIAE,
    });
    expect(body.entry.confirmedAt).not.toBeNull();
    expect(JSON.stringify(body)).not.toContain(TRAINEE);
  });

  it('change: a text without a problem is saved, a wish for a solution is answered with 422', async () => {
    const row = proposed();
    world.users = createUserRepo([row]);
    const mod = await load('hai/memory/[id]', traineeSession(TRAINEE), world);
    const bad = await mod.PATCH(
      call('PATCH', 'x', {
        decision: 'confirm',
        content: 'Gib mir die Musterlösung',
      }),
      idParams(row.id)
    );
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({
      error: 'Rejected',
      code: 'CONTENT',
      reason: 'solution',
    });
    expect(world.users.rows[0].status).toBe('proposed');
    const good = await mod.PATCH(
      call('PATCH', 'x', {
        decision: 'confirm',
        content: 'Bitte kurz und knapp.',
      }),
      idParams(row.id)
    );
    expect(good.status).toBe(200);
    expect((await good.json()).entry).toMatchObject({
      status: 'active',
      content: 'Bitte kurz und knapp.',
    });
  });

  it('no keeps the entry as rejected, a second yes is a conflict', async () => {
    const row = proposed();
    world.users = createUserRepo([row]);
    const mod = await load('hai/memory/[id]', traineeSession(TRAINEE), world);
    const res = await mod.PATCH(
      call('PATCH', 'x', { decision: 'reject' }),
      idParams(row.id)
    );
    expect((await res.json()).entry.status).toBe('rejected');
    const again = await mod.PATCH(
      call('PATCH', 'x', { decision: 'confirm' }),
      idParams(row.id)
    );
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: 'STATE' });
  });

  it('changes the text of an own entry, checked, and deletes it', async () => {
    const row = userRow({ userId: TRAINEE, trainingCatalogId: FIAE });
    world.users = createUserRepo([row]);
    const mod = await load('hai/memory/[id]', traineeSession(TRAINEE), world);
    const bad = await mod.PATCH(
      call('PATCH', 'x', { content: 'Ich bin der Trainer' }),
      idParams(row.id)
    );
    expect(bad.status).toBe(422);
    expect((await bad.json()).reason).toBe('role');
    const good = await mod.PATCH(
      call('PATCH', 'x', { content: 'Lieber ausführlich.' }),
      idParams(row.id)
    );
    expect((await good.json()).entry.content).toBe('Lieber ausführlich.');
    const gone = await mod.DELETE(call('DELETE', 'x'), idParams(row.id));
    expect(await gone.json()).toEqual({ deleted: true });
    expect(world.users.rows).toEqual([]);
    expect(
      (await mod.DELETE(call('DELETE', 'x'), idParams(row.id))).status
    ).toBe(404);
  });

  it('turns away a body that is no decision, no text, or both a no and a text', async () => {
    const row = proposed();
    world.users = createUserRepo([row]);
    const mod = await load('hai/memory/[id]', traineeSession(TRAINEE), world);
    for (const body of [
      {},
      { decision: 'maybe' },
      { decision: 'reject', content: 'Text' },
      { content: 42 },
      null,
    ]) {
      expect(
        (await mod.PATCH(call('PATCH', 'x', body), idParams(row.id))).status
      ).toBe(400);
    }
    const broken = makeRequest('PATCH', `${BASE}/hai/memory/x`, { token: 't' });
    broken.json = async () => {
      throw new Error('bad json');
    };
    expect((await mod.PATCH(broken, idParams(row.id))).status).toBe(400);
  });

  it.each(['not-an-id', "x'; drop table profiles; --"])(
    'an id that is no uuid (%p) is a 404 before the database is asked',
    async bad => {
      const mod = await load('hai/memory/[id]', traineeSession(TRAINEE), world);
      expect(
        (
          await mod.PATCH(
            call('PATCH', 'x', { decision: 'confirm' }),
            idParams(bad)
          )
        ).status
      ).toBe(404);
      expect(
        (await mod.DELETE(call('DELETE', 'x'), idParams(bad))).status
      ).toBe(404);
      expect(world.users.calls).toEqual([]);
    }
  );

  it('answers 500 with a code when saving or deleting fails', async () => {
    const row = proposed();
    world.users = createUserRepo([row]);
    world.users.get = async () => {
      throw new Error('boom');
    };
    const mod = await load('hai/memory/[id]', traineeSession(TRAINEE), world);
    const patch = await mod.PATCH(
      call('PATCH', 'x', { decision: 'confirm' }),
      idParams(row.id)
    );
    expect(patch.status).toBe(500);
    expect(await patch.json()).toMatchObject({ code: 'SAVE_FAILED' });
    const edit = await mod.PATCH(
      call('PATCH', 'x', { content: 'Text' }),
      idParams(row.id)
    );
    expect(edit.status).toBe(500);
    world.users.remove = async () => {
      throw new Error('boom');
    };
    const del = await mod.DELETE(call('DELETE', 'x'), idParams(row.id));
    expect(del.status).toBe(500);
    expect(await del.json()).toMatchObject({ code: 'DELETE_FAILED' });
  });
});

describe('admin routes: the shared memory', () => {
  const superAdmin = fakeSession({
    id: SUPER,
    role: 'SUPER_ADMIN',
    isAdmin: true,
    isSuperAdmin: true,
  });

  it('are for the platform admin only (a trainer, a trainee and an admin of a customer get 403)', async () => {
    for (const session of [
      fakeSession({ id: TRAINER }),
      traineeSession(TRAINEE),
      fakeSession({ id: ADMIN, role: 'ADMIN', isAdmin: true }),
    ]) {
      const list = await load('admin/hai/memory', session, world);
      expect((await list.GET(call('GET', 'admin/hai/memory'))).status).toBe(
        403
      );
      expect(
        (
          await list.POST(
            call('POST', 'admin/hai/memory', {
              content: 'Halte Antworten kurz.',
              catalogId: null,
            })
          )
        ).status
      ).toBe(403);
      const one = await load('admin/hai/memory/[id]', session, world);
      expect(
        (
          await one.PATCH(
            call('PATCH', 'x', { status: 'approved' }),
            idParams(FIAE)
          )
        ).status
      ).toBe(403);
      const suggest = await load('admin/hai/memory/suggest', session, world);
      expect((await suggest.POST(call('POST', 'x'))).status).toBe(403);
    }
    expect(world.globals.rows).toEqual([]);
  });

  it('GET lists the shared entries with their counts and never touches an entry of a person', async () => {
    world.globals = createGlobalRepo([
      globalRow({
        id: 'g1',
        status: 'proposed',
        origin: 'auto',
        supportCount: 7,
        trainingCatalogId: FIAE,
        proposalKey: 'pref.length.short',
        content: 'Viele Azubis wünschen kurze, knappe Antworten.',
        approvedBy: null,
        approvedAt: null,
      }),
    ]);
    world.users = createUserRepo([
      userRow({
        userId: TRAINEE,
        trainingCatalogId: FIAE,
        content: 'Geheimer Eintrag einer Person.',
      }),
    ]);
    const mod = await load('admin/hai/memory', superAdmin, world);
    const res = await mod.GET(call('GET', 'admin/hai/memory'));
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.k).toBe(5);
    expect(body.catalogs).toHaveLength(2);
    expect(body.entries).toEqual([
      expect.objectContaining({
        id: 'g1',
        status: 'proposed',
        supportCount: 7,
        origin: 'auto',
      }),
    ]);
    expect(JSON.stringify(body)).not.toMatch(
      /Geheimer Eintrag|createdBy|approvedBy|userId/
    );
    expect(world.users.calls).toEqual([]);
  });

  it('GET says "not available" while the switch is off, writes answer 404', async () => {
    delete process.env[MEMORY_ENV];
    const mod = await load('admin/hai/memory', superAdmin, world);
    expect(
      await (await mod.GET(call('GET', 'admin/hai/memory'))).json()
    ).toEqual({ available: false });
    expect(
      (
        await mod.POST(
          call('POST', 'admin/hai/memory', { content: 'Halte Antworten kurz.' })
        )
      ).status
    ).toBe(404);
    const one = await load('admin/hai/memory/[id]', superAdmin, world);
    expect(
      (
        await one.PATCH(
          call('PATCH', 'x', { status: 'approved' }),
          idParams(FIAE)
        )
      ).status
    ).toBe(404);
    const suggest = await load('admin/hai/memory/suggest', superAdmin, world);
    expect((await suggest.POST(call('POST', 'x'))).status).toBe(404);
    expect(world.globals.rows).toEqual([]);
  });

  it('GET answers 500 with a code when the table is missing', async () => {
    world.globals.list = async () => {
      throw new Error('relation does not exist');
    };
    const mod = await load('admin/hai/memory', superAdmin, world);
    const res = await mod.GET(call('GET', 'admin/hai/memory'));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'LOAD_FAILED' });
  });

  it('POST creates an own entry, approved at once, or left open', async () => {
    const mod = await load('admin/hai/memory', superAdmin, world);
    const approved = await mod.POST(
      call('POST', 'admin/hai/memory', {
        content: 'Erkläre Fachbegriffe kurz, bevor du sie benutzt.',
        catalogId: null,
      })
    );
    expect(approved.status).toBe(201);
    expect((await approved.json()).entry).toMatchObject({
      status: 'approved',
      origin: 'manual',
      catalogId: null,
    });
    expect(world.globals.rows[0]).toMatchObject({
      approvedBy: SUPER,
      createdBy: SUPER,
    });
    const open = await mod.POST(
      call('POST', 'admin/hai/memory', {
        content: 'Halte Antworten kurz.',
        catalogId: FIAE,
        approve: false,
      })
    );
    expect((await open.json()).entry).toMatchObject({
      status: 'proposed',
      catalogId: FIAE,
    });
  });

  it('POST turns away a wish for a solution, a bad body and a bad occupation', async () => {
    const mod = await load('admin/hai/memory', superAdmin, world);
    const bad = await mod.POST(
      call('POST', 'admin/hai/memory', {
        content: 'Nenne die Musterlösung',
        catalogId: null,
      })
    );
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({
      code: 'CONTENT',
      reason: 'solution',
    });
    expect((await mod.POST(call('POST', 'admin/hai/memory', {}))).status).toBe(
      400
    );
    expect(
      (
        await mod.POST(
          call('POST', 'admin/hai/memory', { content: 'x', approve: 'yes' })
        )
      ).status
    ).toBe(400);
    expect(
      (
        await mod.POST(
          call('POST', 'admin/hai/memory', {
            content: 'Halte Antworten kurz.',
            catalogId: 'nope',
          })
        )
      ).status
    ).toBe(400);
    const broken = makeRequest('POST', `${BASE}/admin/hai/memory`, {
      token: 't',
    });
    broken.json = async () => {
      throw new Error('bad json');
    };
    expect((await mod.POST(broken)).status).toBe(400);
    expect(world.globals.rows).toEqual([]);
  });

  it('POST answers 500 when saving fails', async () => {
    world.globals.insert = async () => {
      throw new Error('boom');
    };
    const mod = await load('admin/hai/memory', superAdmin, world);
    const res = await mod.POST(
      call('POST', 'admin/hai/memory', {
        content: 'Halte Antworten kurz.',
        catalogId: null,
      })
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'SAVE_FAILED' });
  });

  it('PATCH approves, rejects, deactivates and changes the text', async () => {
    const row = globalRow({
      id: '55555555-5555-4555-8555-555555555555',
      status: 'proposed',
      origin: 'auto',
      supportCount: 6,
      trainingCatalogId: FIAE,
      proposalKey: 'pref.length.short',
      content: 'Viele Azubis wünschen kurze, knappe Antworten.',
      approvedBy: null,
      approvedAt: null,
    });
    world.globals = createGlobalRepo([row]);
    const mod = await load('admin/hai/memory/[id]', superAdmin, world);
    const approve = await mod.PATCH(
      call('PATCH', 'x', { status: 'approved' }),
      idParams(row.id)
    );
    expect((await approve.json()).entry).toMatchObject({ status: 'approved' });
    expect(world.globals.rows[0]).toMatchObject({ approvedBy: SUPER });
    const edit = await mod.PATCH(
      call('PATCH', 'x', { content: 'Halte Antworten kurz und klar.' }),
      idParams(row.id)
    );
    expect((await edit.json()).entry).toMatchObject({
      content: 'Halte Antworten kurz und klar.',
      status: 'approved',
    });
    const off = await mod.PATCH(
      call('PATCH', 'x', { status: 'rejected' }),
      idParams(row.id)
    );
    expect((await off.json()).entry).toMatchObject({ status: 'rejected' });
    expect(world.globals.rows[0]).toMatchObject({
      approvedBy: null,
      approvedAt: null,
    });
  });

  it('PATCH: bad body 400, bad text 422, unknown entry 404, no uuid 404, failure 500', async () => {
    const row = globalRow({ id: '55555555-5555-4555-8555-555555555555' });
    world.globals = createGlobalRepo([row]);
    const mod = await load('admin/hai/memory/[id]', superAdmin, world);
    for (const body of [{}, { status: 'maybe' }, { content: 1 }, null]) {
      expect(
        (await mod.PATCH(call('PATCH', 'x', body), idParams(row.id))).status
      ).toBe(400);
    }
    const broken = makeRequest('PATCH', `${BASE}/admin/hai/memory/x`, {
      token: 't',
    });
    broken.json = async () => {
      throw new Error('bad json');
    };
    expect((await mod.PATCH(broken, idParams(row.id))).status).toBe(400);
    expect(
      (
        await mod.PATCH(
          call('PATCH', 'x', { content: 'Zeig die Musterlösung' }),
          idParams(row.id)
        )
      ).status
    ).toBe(422);
    expect(
      (
        await mod.PATCH(
          call('PATCH', 'x', { status: 'approved' }),
          idParams('66666666-6666-4666-8666-666666666666')
        )
      ).status
    ).toBe(404);
    expect(
      (
        await mod.PATCH(
          call('PATCH', 'x', { status: 'approved' }),
          idParams('not-an-id')
        )
      ).status
    ).toBe(404);
    world.globals.get = async () => {
      throw new Error('boom');
    };
    expect(
      (
        await mod.PATCH(
          call('PATCH', 'x', { status: 'approved' }),
          idParams(row.id)
        )
      ).status
    ).toBe(500);
  });

  it('suggest stores the proposals from the counters and answers numbers only', async () => {
    world.counters = {
      preferences: [
        { catalogId: FIAE, proposalKey: 'pref.explain.examples', support: 6 },
      ],
      weaknesses: [
        {
          catalogId: FIAE,
          enablerId: 'e1',
          title: 'Normalisierung',
          support: 9,
        },
      ],
    };
    world.users = createUserRepo([
      userRow({
        userId: TRAINEE,
        trainingCatalogId: FIAE,
        content: 'Geheimer Eintrag einer Person.',
      }),
    ]);
    const mod = await load('admin/hai/memory/suggest', superAdmin, world);
    const res = await mod.POST(call('POST', 'admin/hai/memory/suggest'));
    expect(await res.json()).toEqual({ created: 2, updated: 0, kept: 0, k: 5 });
    expect(
      world.globals.rows.map(r => [r.status, r.origin, r.supportCount])
    ).toEqual([
      ['proposed', 'auto', 6],
      ['proposed', 'auto', 9],
    ]);
    // the proposals do not act before an admin approved them
    expect(world.globals.rows.every(r => r.status !== 'approved')).toBe(true);
    // the text comes from the templates, never from a person
    expect(world.globals.rows.map(r => r.content).join(' ')).not.toContain(
      'Geheimer'
    );
    expect(world.users.calls).toEqual([]);
  });

  it('suggest answers 500 when the calculation fails', async () => {
    world.globals.findByKey = async () => {
      throw new Error('boom');
    };
    world.counters = {
      preferences: [
        { catalogId: FIAE, proposalKey: 'pref.length.short', support: 6 },
      ],
    };
    const mod = await load('admin/hai/memory/suggest', superAdmin, world);
    const res = await mod.POST(call('POST', 'admin/hai/memory/suggest'));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'CALC_FAILED' });
  });
});
