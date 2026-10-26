/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb, renderCondition } from '../../../helpers/mockDb';
import {
  fakeSession,
  makeRequest,
  mockSession,
} from '../../../helpers/mockNext';

// The HAI routes that work on the data of one person (chat, session, insights,
// action) take that person from the session. A userId in the query or in the
// body must never decide whose sessions are read, whose plan is checked or who
// executes an action. Anonymous callers and the role checks are covered by
// route-guards.test.ts, the FREE plan by the 403 cases below.

const ME = 'me-1';
const VICTIM = 'victim-9';
const URL_BASE = 'http://localhost/api/hai';

type Rows = Record<string, any[]>;

async function load(
  route: 'chat' | 'session' | 'action' | 'insights',
  options: { tables?: Rows; pro?: boolean; role?: 'TRAINEE' | 'TRAINER' } = {}
) {
  const { tables = {}, pro = true, role = 'TRAINEE' } = options;
  jest.resetModules();
  const session = fakeSession({
    id: ME,
    role,
    isTrainerLevel: role === 'TRAINER',
    organizationId: 'org-me',
  });
  mockSession(session);
  const rec = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: rec.db }));
  const requireProPlan = jest.fn(async (_id: string) => pro);
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    ...(jest.requireActual('@/lib/auth-helpers') as object),
    requireProPlan,
    // A lookup by the victim's id would not find the session's organization
    getUserOrgId: jest.fn(async (id: string) => `org-of-${id}`),
  }));
  const executeAction = jest.fn(async (..._args: unknown[]) => ({
    success: true,
    message: 'ok',
    data: {},
  }));
  jest.doMock('@/lib/hai/actions', () => ({
    __esModule: true,
    executeAction,
  }));
  const runProactiveChecks = jest.fn(async (_id: string) => []);
  jest.doMock('@/lib/hai/proactive', () => ({
    __esModule: true,
    runProactiveChecks,
  }));
  // The pipeline would call the models, chat only needs it to import
  jest.doMock('@/lib/hai', () => ({
    __esModule: true,
    processMessage: jest.fn(),
    processMessageStream: jest.fn(),
  }));
  jest.doMock('@/lib/hai/providers', () => ({
    __esModule: true,
    getProviderStatus: () => ({ primary: 'test' }),
  }));
  const mod = await import(`@/app/api/hai/${route}/route`);
  return {
    mod: mod as any,
    rec,
    requireProPlan,
    executeAction,
    runProactiveChecks,
  };
}

function call(method: string, path: string, body?: unknown) {
  return makeRequest(method, `${URL_BASE}/${path}`, { token: 't', body });
}

function expectSessionOnly(params: unknown[]) {
  expect(params).toContain(ME);
  expect(params).not.toContain(VICTIM);
}

describe('HAI session route: the person is the session', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists only the sessions of the session user', async () => {
    const { mod, rec, requireProPlan } = await load('session', {
      tables: { haiChatSessions: [] },
    });
    const res = await mod.GET(call('GET', `session?userId=${VICTIM}`));
    expect(res.status).toBe(200);
    expectSessionOnly(rec.filters('select', 'haiChatSessions').params);
    expect(requireProPlan.mock.calls).toEqual([[ME]]);
  });

  it('opens a session of someone else as not found', async () => {
    const { mod, rec } = await load('session', {
      tables: { haiChatSessions: [] },
    });
    const res = await mod.GET(
      call('GET', `session?userId=${VICTIM}&sessionId=s-victim`)
    );
    expect(res.status).toBe(404);
    expectSessionOnly(rec.filters('select', 'haiChatSessions').params);
    // The messages of a session that is not mine are never read
    expect(rec.filters('select', 'haiChatMessages').params).toEqual([]);
  });

  it('searches only inside the sessions of the session user', async () => {
    const { mod, rec } = await load('session');
    const res = await mod.GET(
      call('GET', `session?userId=${VICTIM}&search=secret`)
    );
    expect(res.status).toBe(200);
    const query = renderCondition(rec.db.execute.mock.calls[0][0]);
    expectSessionOnly(query.params);
  });

  it('renames only a session of the session user', async () => {
    const { mod, rec } = await load('session', {
      tables: { haiChatSessions: [] },
    });
    const res = await mod.PATCH(
      call('PATCH', `session?userId=${VICTIM}`, { sessionId: 's1', title: 'x' })
    );
    expect(res.status).toBe(404);
    expectSessionOnly(rec.filters('select', 'haiChatSessions').params);
    expect(rec.db.update).not.toHaveBeenCalled();
  });

  it('renames an own session', async () => {
    const { mod, rec } = await load('session', {
      tables: { haiChatSessions: [{ id: 's1' }] },
    });
    const res = await mod.PATCH(
      call('PATCH', `session?userId=${VICTIM}`, { sessionId: 's1', title: 'x' })
    );
    expect(res.status).toBe(200);
    expect(rec.writes('update', 'haiChatSessions')).toEqual([{ title: 'x' }]);
  });

  it('deletes only a session of the session user', async () => {
    const { mod, rec } = await load('session', {
      tables: { haiChatSessions: [] },
    });
    const res = await mod.DELETE(
      call('DELETE', `session?userId=${VICTIM}&sessionId=s-victim`)
    );
    expect(res.status).toBe(404);
    expectSessionOnly(rec.filters('select', 'haiChatSessions').params);
    expect(rec.db.delete).not.toHaveBeenCalled();
  });

  it('deletes an own session', async () => {
    const { mod, rec } = await load('session', {
      tables: { haiChatSessions: [{ id: 's1' }] },
    });
    const res = await mod.DELETE(
      call('DELETE', `session?userId=${VICTIM}&sessionId=s1`)
    );
    expect(res.status).toBe(200);
    expect(rec.db.delete).toHaveBeenCalledTimes(1);
  });

  it('creates a session for the session user in their organization', async () => {
    const { mod, rec } = await load('session');
    const res = await mod.POST(
      call('POST', `session?userId=${VICTIM}`, { contextType: 'general' })
    );
    expect(res.status).toBe(200);
    const [values] = rec.writes('insert', 'haiChatSessions') as any[];
    expect(values.userId).toBe(ME);
    expect(values.organizationId).toBe('org-me');
  });

  it('answers 403 without the PRO plan before it reads anything', async () => {
    const { mod, rec } = await load('session', { pro: false });
    const res = await mod.GET(call('GET', 'session'));
    expect(res.status).toBe(403);
    expect(rec.db.select).not.toHaveBeenCalled();
  });
});

describe('HAI chat route: the person is the session', () => {
  beforeEach(() => jest.clearAllMocks());

  it('GET lists only the sessions of the session user', async () => {
    const { mod, rec, requireProPlan } = await load('chat', {
      tables: { haiChatSessions: [] },
    });
    const res = await mod.GET(call('GET', `chat?userId=${VICTIM}`));
    expect(res.status).toBe(200);
    expectSessionOnly(rec.filters('select', 'haiChatSessions').params);
    expect(requireProPlan.mock.calls).toEqual([[ME]]);
  });

  it('PATCH edits only a message of a session of the session user', async () => {
    const { mod, rec } = await load('chat', {
      tables: { haiChatMessages: [] },
    });
    const res = await mod.PATCH(
      call('PATCH', `chat?userId=${VICTIM}`, {
        messageId: 'm-victim',
        content: 'changed',
      })
    );
    expect(res.status).toBe(404);
    expectSessionOnly(rec.filters('select', 'haiChatMessages').params);
    expect(rec.db.update).not.toHaveBeenCalled();
  });

  it('POST loads the profile and plan of the session user only', async () => {
    const { mod, rec, requireProPlan } = await load('chat', {
      tables: { profiles: [] },
    });
    const res = await mod.POST(
      call('POST', `chat?userId=${VICTIM}`, { message: 'hello' })
    );
    // The mocked profile table is empty, the point is whose profile was asked
    expect(res.status).toBe(404);
    expectSessionOnly(rec.filters('select', 'profiles').params);
    expect(requireProPlan.mock.calls).toEqual([[ME]]);
  });

  it('POST answers 403 without the PRO plan', async () => {
    const { mod, rec } = await load('chat', { pro: false });
    const res = await mod.POST(call('POST', 'chat', { message: 'hello' }));
    expect(res.status).toBe(403);
    expect(rec.db.select).not.toHaveBeenCalled();
  });
});

describe('HAI insights route: the person is the session', () => {
  beforeEach(() => jest.clearAllMocks());

  it('computes the insights of the session user', async () => {
    const { mod, runProactiveChecks, requireProPlan } = await load('insights');
    const res = await mod.GET(call('GET', `insights?userId=${VICTIM}`));
    expect(res.status).toBe(200);
    expect(runProactiveChecks.mock.calls).toEqual([[ME]]);
    expect(requireProPlan.mock.calls).toEqual([[ME]]);
  });

  it('answers 403 without the PRO plan', async () => {
    const { mod, runProactiveChecks } = await load('insights', {
      pro: false,
    });
    const res = await mod.GET(call('GET', 'insights'));
    expect(res.status).toBe(403);
    expect(runProactiveChecks).not.toHaveBeenCalled();
  });
});

describe('HAI action route: the person is the session', () => {
  beforeEach(() => jest.clearAllMocks());

  it('executes the action as the session user', async () => {
    const { mod, executeAction } = await load('action');
    const res = await mod.POST(
      call('POST', `action?userId=${VICTIM}`, {
        actionType: 'submit_quiz',
        parameters: { quizId: 'q1' },
      })
    );
    expect(res.status).toBe(200);
    expect(executeAction.mock.calls).toEqual([
      ['submit_quiz', { quizId: 'q1' }, ME],
    ]);
  });

  it('does not execute anything without the PRO plan', async () => {
    const { mod, executeAction } = await load('action', { pro: false });
    const res = await mod.POST(
      call('POST', 'action', { actionType: 'submit_quiz', parameters: {} })
    );
    expect(res.status).toBe(403);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('rejects a missing action type', async () => {
    const { mod, executeAction } = await load('action');
    const res = await mod.POST(call('POST', 'action', { parameters: {} }));
    expect(res.status).toBe(400);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('reports a failed action as 400', async () => {
    const { mod, executeAction } = await load('action');
    executeAction.mockResolvedValueOnce({
      success: false,
      message: 'no',
      error: 'Permission denied',
    } as any);
    const res = await mod.POST(
      call('POST', 'action', {
        actionType: 'approve_submission',
        parameters: {},
      })
    );
    expect(res.status).toBe(400);
  });

  it('lists the trainee actions for a trainee session, even with a trainer id', async () => {
    // The victim in the query is a trainer, the caller is a trainee
    const { mod, requireProPlan } = await load('action', { role: 'TRAINEE' });
    const res = await mod.GET(call('GET', `action?userId=${VICTIM}`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.userRole).toBe('TRAINEE');
    expect(body.availableActions).toContain('submit_quiz');
    expect(body.availableActions).not.toContain('approve_submission');
    expect(requireProPlan.mock.calls).toEqual([[ME]]);
  });

  it('lists the trainer actions for a trainer session', async () => {
    const { mod } = await load('action', { role: 'TRAINER' });
    const res = await mod.GET(call('GET', 'action'));
    const body = await res.json();
    expect(body.availableActions).toContain('approve_submission');
  });

  it('GET answers 403 without the PRO plan', async () => {
    const { mod } = await load('action', { pro: false });
    const res = await mod.GET(call('GET', 'action'));
    expect(res.status).toBe(403);
  });
});
