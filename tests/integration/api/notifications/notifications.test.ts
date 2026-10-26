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

// The notification routes work on the notifications of the signed-in user
// only. The identity comes from the bearer session, a userId in the query or
// in the body is ignored. Since the catalog requests (name and organization of
// a person) arrive as notifications, an anonymous or foreign read is a leak.
// The table mock ignores where(), so the tests read the rendered conditions.

const ME = 'user-me';
const VICTIM = 'user-victim';

const me = fakeSession({
  id: ME,
  role: 'TRAINEE',
  isTrainerLevel: false,
});

const rowOf = (id: string, userId: string, isRead = false) => ({
  id,
  userId,
  type: 'catalog_request',
  title: 'Request',
  message: 'Max Muster, Org',
  isRead,
  createdAt: new Date('2026-10-01'),
});

async function loadRoute(
  route: string,
  tables: Record<string, any> = {},
  returns: Record<string, any[]> = {},
  session: ReturnType<typeof fakeSession> | null = me
) {
  jest.resetModules();
  mockSession(session);
  const mock = createTableDb(tables, returns);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const mod = await import(`@/app/api/notifications/${route}`);
  return { mod, mock };
}

const withId = (id: string) => ({ params: Promise.resolve({ id }) });

describe('GET /api/notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('answers an anonymous call with 401 and reads nothing', async () => {
    const { mod, mock } = await loadRoute('route', {}, {}, null);
    const res = await mod.GET(
      makeRequest('GET', `http://localhost/api/notifications?userId=${VICTIM}`)
    );
    expect(res.status).toBe(401);
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('returns the own notifications and the unread count', async () => {
    const { mod } = await loadRoute('route', {
      notifications: [rowOf('n1', ME), rowOf('n2', ME, true)],
    });
    const res = await mod.GET(
      makeRequest('GET', `http://localhost/api/notifications?userId=${ME}`, {
        token: 't',
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(
      'no-store, no-cache, must-revalidate'
    );
    const body = await res.json();
    expect(body.notifications).toHaveLength(2);
    expect(body.unreadCount).toBe(1);
  });

  it('ignores a foreign userId in the query and reads the session user', async () => {
    const { mod, mock } = await loadRoute('route', {
      notifications: [rowOf('n1', ME)],
    });
    const res = await mod.GET(
      makeRequest(
        'GET',
        `http://localhost/api/notifications?userId=${VICTIM}&limit=5`,
        { token: 't' }
      )
    );
    expect(res.status).toBe(200);
    const { params } = mock.filters('select', 'notifications');
    expect(params).toContain(ME);
    expect(params).not.toContain(VICTIM);
  });

  it('works without a userId in the query (identity is the session)', async () => {
    const { mod, mock } = await loadRoute('route', {
      notifications: [rowOf('n1', ME)],
    });
    const res = await mod.GET(
      makeRequest('GET', 'http://localhost/api/notifications', { token: 't' })
    );
    expect(res.status).toBe(200);
    expect(mock.filters('select', 'notifications').params).toContain(ME);
  });

  it('keeps the limit between 1 and 100', async () => {
    const { mod, mock } = await loadRoute('route', { notifications: [] });
    await mod.GET(
      makeRequest('GET', 'http://localhost/api/notifications?limit=9999', {
        token: 't',
      })
    );
    await mod.GET(
      makeRequest('GET', 'http://localhost/api/notifications?limit=0', {
        token: 't',
      })
    );
    expect(mock.db.select).toHaveBeenCalledTimes(2);
  });

  it('answers 500 when the query fails', async () => {
    const { mod, mock } = await loadRoute('route', {});
    mock.db.select.mockImplementation(() => {
      throw new Error('db down');
    });
    const res = await mod.GET(
      makeRequest('GET', 'http://localhost/api/notifications', { token: 't' })
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
  });
});

describe('POST /api/notifications/mark-all-read', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('answers an anonymous call with 401 and changes nothing', async () => {
    const { mod, mock } = await loadRoute('mark-all-read/route', {}, {}, null);
    const res = await mod.POST(
      makeRequest('POST', 'http://localhost/api/notifications/mark-all-read', {
        body: { userId: VICTIM },
      })
    );
    expect(res.status).toBe(401);
    expect(mock.db.update).not.toHaveBeenCalled();
  });

  it('marks the own notifications as read', async () => {
    const { mod, mock } = await loadRoute('mark-all-read/route');
    const res = await mod.POST(
      makeRequest('POST', 'http://localhost/api/notifications/mark-all-read', {
        token: 't',
        body: { userId: ME },
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mock.writes('update', 'notifications')).toEqual([
      expect.objectContaining({ isRead: true }),
    ]);
    expect(mock.filters('update', 'notifications').params).toContain(ME);
  });

  it('ignores a foreign userId in the body', async () => {
    const { mod, mock } = await loadRoute('mark-all-read/route');
    const res = await mod.POST(
      makeRequest('POST', 'http://localhost/api/notifications/mark-all-read', {
        token: 't',
        body: { userId: VICTIM },
      })
    );
    expect(res.status).toBe(200);
    const { params } = mock.filters('update', 'notifications');
    expect(params).toContain(ME);
    expect(params).not.toContain(VICTIM);
  });

  it('needs no body at all', async () => {
    const { mod, mock } = await loadRoute('mark-all-read/route');
    const request = makeRequest(
      'POST',
      'http://localhost/api/notifications/mark-all-read',
      { token: 't' }
    );
    request.json = async () => {
      throw new Error('no body');
    };
    const res = await mod.POST(request);
    expect(res.status).toBe(200);
    expect(mock.filters('update', 'notifications').params).toContain(ME);
  });

  it('answers 500 when the update fails', async () => {
    const { mod, mock } = await loadRoute('mark-all-read/route');
    mock.db.update.mockImplementation(() => {
      throw new Error('db down');
    });
    const res = await mod.POST(
      makeRequest('POST', 'http://localhost/api/notifications/mark-all-read', {
        token: 't',
      })
    );
    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/notifications/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  const patch = (body?: unknown, token: string | null = 't') =>
    makeRequest('PATCH', 'http://localhost/api/notifications/n1', {
      token,
      body,
    });

  it('answers an anonymous call with 401 and changes nothing', async () => {
    const { mod, mock } = await loadRoute('[id]/route', {}, {}, null);
    const res = await mod.PATCH(patch({ isRead: true }, null), withId('n1'));
    expect(res.status).toBe(401);
    expect(mock.db.update).not.toHaveBeenCalled();
  });

  it('marks an own notification as read', async () => {
    const { mod, mock } = await loadRoute(
      '[id]/route',
      {},
      { notifications: [rowOf('n1', ME, true)] }
    );
    const res = await mod.PATCH(patch({ isRead: true }), withId('n1'));
    expect(res.status).toBe(200);
    expect((await res.json()).notification.id).toBe('n1');
    // The row is looked up by id AND owner, in the update itself
    const { sql, params } = mock.filters('update', 'notifications');
    expect(params).toEqual(expect.arrayContaining(['n1', ME]));
    expect(sql).toContain('user_id');
  });

  it('marks an own notification as unread', async () => {
    const { mod, mock } = await loadRoute(
      '[id]/route',
      {},
      { notifications: [rowOf('n1', ME)] }
    );
    const res = await mod.PATCH(patch({ isRead: false }), withId('n1'));
    expect(res.status).toBe(200);
    expect(mock.writes('update', 'notifications')).toEqual([
      expect.objectContaining({ isRead: false, readAt: null }),
    ]);
  });

  it('defaults to read when the body has no isRead', async () => {
    const { mod, mock } = await loadRoute(
      '[id]/route',
      {},
      { notifications: [rowOf('n1', ME, true)] }
    );
    await mod.PATCH(patch({}), withId('n1'));
    expect(mock.writes('update', 'notifications')).toEqual([
      expect.objectContaining({ isRead: true }),
    ]);
  });

  it('answers 404 for a foreign or missing notification (no row updated)', async () => {
    // The update is limited to the owner, so a foreign id returns no row
    const { mod, mock } = await loadRoute(
      '[id]/route',
      {},
      { notifications: [] }
    );
    const res = await mod.PATCH(patch({ isRead: true }), withId('n-victim'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Notification not found' });
    expect(mock.filters('update', 'notifications').params).toContain(ME);
  });

  it('does not let a userId in the body change the owner', async () => {
    const { mod, mock } = await loadRoute(
      '[id]/route',
      {},
      { notifications: [rowOf('n1', ME, true)] }
    );
    await mod.PATCH(patch({ isRead: true, userId: VICTIM }), withId('n1'));
    const [values] = mock.writes('update', 'notifications') as any[];
    expect(values).not.toHaveProperty('userId');
    expect(mock.filters('update', 'notifications').params).not.toContain(
      VICTIM
    );
  });

  it('answers 400 for a missing id', async () => {
    const { mod } = await loadRoute('[id]/route');
    const res = await mod.PATCH(patch({}), withId(''));
    expect(res.status).toBe(400);
  });

  it('answers 500 when the update fails', async () => {
    const { mod, mock } = await loadRoute('[id]/route');
    mock.db.update.mockImplementation(() => {
      throw new Error('db down');
    });
    const res = await mod.PATCH(patch({}), withId('n1'));
    expect(res.status).toBe(500);
  });
});
