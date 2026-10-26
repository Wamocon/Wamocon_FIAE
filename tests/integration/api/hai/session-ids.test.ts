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

// /api/hai/session hands the session id (query or body) and the context id
// (body) to uuid columns. A value that is no uuid made the database reject the
// query and the route answer 500. A query id that is no uuid is a session that
// cannot exist (404, the wording of the route), a body id that is no uuid is a
// malformed request (400).

const ME = '8b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11';
const GOOD = '2f6a1c0a-9e11-4b5a-9d63-8b1d1c526f3e';
const BAD = ['not-an-id', "x'; drop table hai_chat_sessions; --"];
const URL_BASE = 'http://localhost/api/hai/session';

function trap() {
  return jest.fn(() => {
    throw new Error('the database must not be reached');
  });
}

async function load(db: unknown) {
  jest.resetModules();
  mockSession(fakeSession({ id: ME, organizationId: 'org-me' }));
  jest.doMock('@/db', () => ({ __esModule: true, default: db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    ...(jest.requireActual('@/lib/auth-helpers') as object),
    requireProPlan: jest.fn(async () => true),
  }));
  return (await import('@/app/api/hai/session/route')) as any;
}

const call = (method: string, query = '', body?: unknown) =>
  makeRequest(method, `${URL_BASE}${query}`, { token: 't', body });

const trapDb = () => ({
  select: trap(),
  insert: trap(),
  update: trap(),
  delete: trap(),
  execute: trap(),
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('HAI session route: ids that are no uuid', () => {
  it.each(BAD)(
    'GET with the sessionId %p answers 404 without a query',
    async bad => {
      const db = trapDb();
      const mod = await load(db);
      const res = await mod.GET(
        call('GET', `?sessionId=${encodeURIComponent(bad)}`)
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Session nicht gefunden.' });
      expect(db.select).not.toHaveBeenCalled();
    }
  );

  it.each(BAD)(
    'DELETE with the sessionId %p answers 404 without a query',
    async bad => {
      const db = trapDb();
      const mod = await load(db);
      const res = await mod.DELETE(
        call('DELETE', `?sessionId=${encodeURIComponent(bad)}`)
      );
      expect(res.status).toBe(404);
      expect(db.select).not.toHaveBeenCalled();
      expect(db.delete).not.toHaveBeenCalled();
    }
  );

  it.each(BAD)(
    'PATCH with the sessionId %p in the body answers 400',
    async bad => {
      const db = trapDb();
      const mod = await load(db);
      const res = await mod.PATCH(
        call('PATCH', '', { sessionId: bad, title: 'x' })
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid sessionId' });
      expect(db.select).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    }
  );

  it.each(BAD)(
    'POST with the contextId %p answers 400 and creates nothing',
    async bad => {
      const db = trapDb();
      const mod = await load(db);
      const res = await mod.POST(
        call('POST', '', { contextType: 'course', contextId: bad })
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid contextId' });
      expect(db.insert).not.toHaveBeenCalled();
    }
  );

  it('POST without a contextId still creates a session', async () => {
    const { db, calls } = createTableDb(
      {},
      { hai_chat_sessions: [{ id: GOOD, title: null, contextType: 'general' }] }
    );
    const mod = await load(db);
    const res = await mod.POST(call('POST', '', { title: 'x' }));
    expect(res.status).toBe(200);
    expect(calls.some(c => c.op === 'insert')).toBe(true);
  });

  it('POST with a uuid as contextId still creates a session', async () => {
    const { db, calls } = createTableDb(
      {},
      { hai_chat_sessions: [{ id: GOOD, title: null, contextType: 'course' }] }
    );
    const mod = await load(db);
    const res = await mod.POST(
      call('POST', '', { contextType: 'course', contextId: GOOD })
    );
    expect(res.status).toBe(200);
    expect(calls.some(c => c.op === 'insert')).toBe(true);
  });

  it('a uuid reaches the database as before (GET, PATCH, DELETE)', async () => {
    const { db, calls } = createTableDb({ hai_chat_sessions: [] });
    const mod = await load(db);
    expect((await mod.GET(call('GET', `?sessionId=${GOOD}`))).status).toBe(404);
    expect(
      (await mod.PATCH(call('PATCH', '', { sessionId: GOOD, title: 'x' })))
        .status
    ).toBe(404);
    expect(
      (await mod.DELETE(call('DELETE', `?sessionId=${GOOD}`))).status
    ).toBe(404);
    // the three lookups of the person's own sessions took place
    expect(calls.filter(c => c.op === 'select').length).toBeGreaterThanOrEqual(
      3
    );
  });
});
