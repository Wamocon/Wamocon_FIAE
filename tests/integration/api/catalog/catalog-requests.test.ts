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

// POST /api/me/catalog-requests: a trainer-level user asks the platform
// administration for an occupation their organization does not have. The only
// effect is one notification per platform administrator (no mail, no table).
//
// The table mock ignores where(), so these tests configure only the rows a
// query should see and check the rendered conditions separately. The real
// queries (recipient search, duplicate check, enabled check) are covered by the
// smoke test against the local database.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = '11111111-1111-4111-8111-111111111111';
const PLATFORM_ORG = '00000000-0000-0000-0000-000000000001';
const URL = 'http://localhost/api/me/catalog-requests';

const kfbm = {
  id: KFBM,
  code: 'KFBM',
  title: 'Kaufmann/-frau für Büromanagement',
  isActive: true,
};
const fiaeOnly = [{ trainingCatalogId: FIAE, isEnabled: true }];
const platformAdmins = [
  { id: 'sa1', organizationId: PLATFORM_ORG },
  { id: 'sa2', organizationId: null },
];

const admin = (overrides = {}) =>
  fakeSession({
    id: 'ad1',
    role: 'ADMIN',
    fullName: 'Anna Admin',
    organizationId: ORG,
    isAdmin: true,
    ...overrides,
  });
const trainer = () => fakeSession({ id: 'tr1', fullName: 'Tim Trainer' });
const trainee = () =>
  fakeSession({
    id: 'tn1',
    role: 'TRAINEE',
    organizationId: ORG,
    isTrainerLevel: false,
  });
const superAdmin = () =>
  fakeSession({
    id: 'sa1',
    role: 'SUPER_ADMIN',
    isAdmin: true,
    isSuperAdmin: true,
  });

const defaultTables = {
  trainingCatalogs: [kfbm],
  organizationCatalogs: fiaeOnly,
  notifications: [],
  organizations: [{ name: 'Muster GmbH' }],
  profiles: platformAdmins,
};

async function load(
  session: ReturnType<typeof fakeSession> | null,
  tables: Record<string, any> = defaultTables
) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockSession(session);
  const mod = await import('@/app/api/me/catalog-requests/route');
  return { mock, POST: mod.POST as (r: any) => Promise<Response> };
}

const post = (body: unknown, token: string | null = 't') =>
  makeRequest('POST', URL, { token, body });

describe('POST /api/me/catalog-requests', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('who may ask', () => {
    it('answers 401 without a session', async () => {
      const { POST, mock } = await load(null);
      const res = await POST(post({ catalogCode: 'KFBM' }, null));
      expect(res.status).toBe(401);
      expect(mock.db.insert).not.toHaveBeenCalled();
    });

    it('answers 403 for a trainee and writes nothing', async () => {
      const { POST, mock } = await load(trainee());
      const res = await POST(post({ catalogCode: 'KFBM' }));
      expect(res.status).toBe(403);
      expect(mock.db.select).not.toHaveBeenCalled();
      expect(mock.db.insert).not.toHaveBeenCalled();
    });

    it.each([
      ['ADMIN', admin()],
      ['TEMP_ADMIN', admin({ id: 'ta1', role: 'TEMP_ADMIN' })],
      ['TRAINER', trainer()],
    ])('lets a %s ask', async (_name, session) => {
      const { POST } = await load(session);
      const res = await POST(post({ catalogCode: 'KFBM' }));
      expect(res.status).toBe(201);
    });
  });

  describe('input', () => {
    it.each([
      ['no body', undefined],
      ['an array', []],
      ['no catalog code', {}],
      ['an empty catalog code', { catalogCode: '  ' }],
      ['a catalog code that is no string', { catalogCode: 5 }],
      ['a message that is no string', { catalogCode: 'KFBM', message: 5 }],
    ])('answers 400 for %s', async (_name, body) => {
      const { POST, mock } = await load(admin());
      const res = await POST(post(body));
      expect(res.status).toBe(400);
      expect(mock.db.insert).not.toHaveBeenCalled();
    });

    it('answers 400 for a body that is not JSON', async () => {
      const { POST } = await load(admin());
      const req = post({});
      req.json = async () => {
        throw new SyntaxError('Unexpected token');
      };
      expect((await POST(req)).status).toBe(400);
    });

    it('treats a code of the wrong shape like an unknown occupation (404)', async () => {
      const { POST, mock } = await load(admin());
      const res = await POST(post({ catalogCode: '<script>' }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Training catalog not found' });
      expect(mock.db.select).not.toHaveBeenCalled();
    });

    it('accepts a code in lower case', async () => {
      const { POST } = await load(admin());
      expect((await POST(post({ catalogCode: ' kfbm ' }))).status).toBe(201);
    });
  });

  describe('occupation and organization rules', () => {
    it('answers 404 for an unknown occupation', async () => {
      const { POST, mock } = await load(admin(), {
        ...defaultTables,
        trainingCatalogs: [],
      });
      const res = await POST(post({ catalogCode: 'ZZZ' }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Training catalog not found' });
      expect(mock.db.insert).not.toHaveBeenCalled();
    });

    it('answers the same 404 for an inactive occupation', async () => {
      const { POST, mock } = await load(admin(), {
        ...defaultTables,
        trainingCatalogs: [{ ...kfbm, isActive: false }],
      });
      const res = await POST(post({ catalogCode: 'KFBM' }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Training catalog not found' });
      expect(mock.db.insert).not.toHaveBeenCalled();
    });

    it('answers 409 ALREADY_ENABLED when the organization has the occupation', async () => {
      const { POST, mock } = await load(admin(), {
        ...defaultTables,
        organizationCatalogs: [
          ...fiaeOnly,
          { trainingCatalogId: KFBM, isEnabled: true },
        ],
      });
      const res = await POST(post({ catalogCode: 'KFBM' }));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'ALREADY_ENABLED' });
      expect(mock.db.insert).not.toHaveBeenCalled();
    });

    it('counts FIAE as enabled for a legacy organization without rows', async () => {
      const { POST, mock } = await load(admin(), {
        ...defaultTables,
        trainingCatalogs: [
          { id: FIAE, code: 'FIAE', title: 'FIAE', isActive: true },
        ],
        organizationCatalogs: [],
      });
      const res = await POST(post({ catalogCode: 'FIAE' }));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'ALREADY_ENABLED' });
      expect(mock.db.insert).not.toHaveBeenCalled();
    });

    it('lets an organization ask for an occupation it switched off', async () => {
      const { POST } = await load(admin(), {
        ...defaultTables,
        organizationCatalogs: [
          ...fiaeOnly,
          { trainingCatalogId: KFBM, isEnabled: false },
        ],
      });
      expect((await POST(post({ catalogCode: 'KFBM' }))).status).toBe(201);
    });

    it('needs no request from a platform administrator (409 ALREADY_ENABLED)', async () => {
      const { POST, mock } = await load(superAdmin());
      const res = await POST(post({ catalogCode: 'KFBM' }));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'ALREADY_ENABLED' });
      expect(mock.db.insert).not.toHaveBeenCalled();
    });
  });

  describe('the notification', () => {
    it('writes one notification per platform administrator', async () => {
      const { POST, mock } = await load(admin());
      const res = await POST(post({ catalogCode: 'KFBM' }));
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ ok: true, alreadyRequested: false });

      const [rows] = mock.writes('insert', 'notifications') as any[][];
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({
        userId: 'sa1',
        actorId: 'ad1',
        organizationId: PLATFORM_ORG,
        type: 'catalog_request',
        title: 'Abo-Anfrage für den Beruf KFBM',
        message:
          'Anna Admin (Muster GmbH) fragt den Beruf Kaufmann/-frau für Büromanagement an.',
        linkUrl: '/trainer/admin/organizations',
        context: {
          catalogCode: 'KFBM',
          requesterId: 'ad1',
          organizationId: ORG,
        },
        isRead: false,
      });
      // a recipient without an organization gets the platform organization
      expect(rows[1]).toMatchObject({
        userId: 'sa2',
        organizationId: PLATFORM_ORG,
      });
    });

    it('uses the organization of each recipient', async () => {
      const other = '33333333-3333-4333-8333-333333333333';
      const { POST, mock } = await load(admin(), {
        ...defaultTables,
        profiles: [{ id: 'pa1', organizationId: other }],
      });
      await POST(post({ catalogCode: 'KFBM' }));
      const [rows] = mock.writes('insert', 'notifications') as any[][];
      expect(rows[0]).toMatchObject({ userId: 'pa1', organizationId: other });
    });

    it('uses the e-mail address when the person has no name', async () => {
      const { POST, mock } = await load(
        admin({ fullName: null, email: 'anna@example.com' })
      );
      await POST(post({ catalogCode: 'KFBM' }));
      const [rows] = mock.writes('insert', 'notifications') as any[][];
      expect(rows[0].message).toContain('anna@example.com (Muster GmbH)');
    });

    it('adds the message of the person and keeps the text free of dashes', async () => {
      const { POST, mock } = await load(admin());
      await POST(
        post({
          catalogCode: 'KFBM',
          message: 'Wir bilden ab Februar drei Azubis im Büro aus.',
        })
      );
      const [rows] = mock.writes('insert', 'notifications') as any[][];
      expect(rows[0].message).toBe(
        'Anna Admin (Muster GmbH) fragt den Beruf Kaufmann/-frau für Büromanagement an.\n' +
          'Nachricht: Wir bilden ab Februar drei Azubis im Büro aus.'
      );
      for (const row of rows) {
        expect(`${row.title} ${row.message}`).not.toMatch(/[‒-―]/);
      }
    });

    it('cleans the message: control and direction characters go, the length is limited', async () => {
      const { POST, mock } = await load(admin());
      const dirty =
        '  Hallo\u0000\u0007 ‮und​ Welt\r\n\r\n\r\n\r\nEnde  ' +
        'x'.repeat(600);
      await POST(post({ catalogCode: 'KFBM', message: dirty }));
      const [rows] = mock.writes('insert', 'notifications') as any[][];
      const text: string = rows[0].message;
      const note = text.split('\nNachricht: ')[1];
      expect(note.startsWith('Hallo und Welt\n\nEnde')).toBe(true);
      expect(note).not.toMatch(/[\u0000-\u0008\u000B-\u001F‪-‮​]/);
      expect(Array.from(note).length).toBeLessThanOrEqual(500);
    });

    it('does not cut a character in the middle when it shortens the message', async () => {
      const { POST, mock } = await load(admin());
      await POST(
        post({ catalogCode: 'KFBM', message: '\u{1F600}'.repeat(600) })
      );
      const [rows] = mock.writes('insert', 'notifications') as any[][];
      const note = rows[0].message.split('\nNachricht: ')[1];
      expect(Array.from(note)).toHaveLength(500);
      expect(note).not.toMatch(/�/);
    });

    it('leaves out an empty message', async () => {
      const { POST, mock } = await load(admin());
      await POST(post({ catalogCode: 'KFBM', message: '   \n\t ' }));
      const [rows] = mock.writes('insert', 'notifications') as any[][];
      expect(rows[0].message).not.toContain('Nachricht:');
    });

    it('answers 503 and writes nothing when there is nobody to tell', async () => {
      const { POST, mock } = await load(admin(), {
        ...defaultTables,
        profiles: [],
      });
      const res = await POST(post({ catalogCode: 'KFBM' }));
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: 'NO_RECIPIENT' });
      expect(mock.db.insert).not.toHaveBeenCalled();
    });

    it('names the organization as unknown when it cannot be read', async () => {
      const { POST, mock } = await load(admin(), {
        ...defaultTables,
        organizations: [],
      });
      await POST(post({ catalogCode: 'KFBM' }));
      const [rows] = mock.writes('insert', 'notifications') as any[][];
      expect(rows[0].message).toContain('(unbekannte Organisation)');
    });
  });

  describe('one open request per person and occupation', () => {
    it('answers 200 alreadyRequested and writes no second notification', async () => {
      const { POST, mock } = await load(admin(), {
        ...defaultTables,
        notifications: [{ id: 'n1' }],
      });
      const res = await POST(post({ catalogCode: 'KFBM' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, alreadyRequested: true });
      expect(mock.db.insert).not.toHaveBeenCalled();
    });

    it('looks for the request of this person, this occupation and the last 14 days', async () => {
      const { POST, mock } = await load(admin());
      await POST(post({ catalogCode: 'KFBM' }));
      const { sql, params } = mock.filters('select', 'notifications');
      expect(sql).toContain('"type"');
      expect(sql).toContain('"actor_id"');
      expect(sql).toContain('"created_at"');
      expect(sql).toContain("->>'catalogCode'");
      expect(sql).toContain("interval '14 days'");
      expect(params).toEqual(['catalog_request', 'ad1', 'KFBM']);
    });

    it('takes a lock per person and occupation before it looks', async () => {
      const { POST, mock } = await load(admin());
      await POST(post({ catalogCode: 'KFBM' }));
      expect(mock.db.transaction).toHaveBeenCalledTimes(1);
      expect(mock.db.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('recipients', () => {
    it('search the active SUPER_ADMIN and the ADMIN of the platform organization', async () => {
      const { POST, mock } = await load(admin());
      await POST(post({ catalogCode: 'KFBM' }));
      const { sql, params } = mock.filters('select', 'profiles');
      expect(sql).toContain('"is_active"');
      expect(sql).toContain('"role"');
      expect(sql).toContain('"is_platform_owner"');
      // active, SUPER_ADMIN, or ADMIN of an organization that owns the platform
      expect(params).toEqual([true, 'SUPER_ADMIN', 'ADMIN', true]);
    });
  });

  describe('abuse limit', () => {
    it('answers 429 after five requests of one person in ten minutes', async () => {
      const { POST } = await load(admin(), {
        ...defaultTables,
        notifications: [{ id: 'n1' }],
      });
      for (let i = 0; i < 5; i++) {
        expect((await POST(post({ catalogCode: 'KFBM' }))).status).toBe(200);
      }
      const res = await POST(post({ catalogCode: 'KFBM' }));
      expect(res.status).toBe(429);
      expect(await res.json()).toMatchObject({ code: 'RATE_LIMITED' });
      expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    });

    it('counts each person on their own', async () => {
      const session = admin();
      const { POST } = await load(session, {
        ...defaultTables,
        notifications: [{ id: 'n1' }],
      });
      for (let i = 0; i < 6; i++) await POST(post({ catalogCode: 'KFBM' }));
      expect((await POST(post({ catalogCode: 'KFBM' }))).status).toBe(429);
      // another person on the same server instance is not limited
      session.id = 'ad2';
      expect((await POST(post({ catalogCode: 'KFBM' }))).status).toBe(200);
    });
  });

  it('answers 500 without details when the database fails', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const { POST, mock } = await load(admin());
    mock.db.select.mockImplementation(() => {
      throw new Error('boom: secret detail');
    });
    const res = await POST(post({ catalogCode: 'KFBM' }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
    consoleError.mockRestore();
  });
});
