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
import {
  fakeSession,
  makeRequest,
  mockSession,
  type FakeSession,
} from '../../../helpers/mockNext';
import { proofHeader, useTestProofKey } from '../../../helpers/adminProof';

// Embed, sync and verify-pin manage the shared HAI index, which has no
// organization column: one reindex or delete touches every organization. Only
// platform staff may use them (src/lib/hai/indexAccess.ts). The role comes from
// the session, a userId in the query changes nothing.

const URL_BASE = 'http://localhost/api/hai';

// The routes log progress and configuration errors, keep the test output clean
let restoreProofKey: () => void = () => undefined;
beforeEach(() => {
  restoreProofKey = useTestProofKey();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  restoreProofKey();
  jest.restoreAllMocks();
});

const PLATFORM_TRAINER = fakeSession({
  id: 'p-trainer',
  isPlatformOwner: true,
});
const SUPER_ADMIN = fakeSession({
  id: 'super',
  role: 'SUPER_ADMIN',
  isSuperAdmin: true,
  isAdmin: true,
});
const CUSTOMER_TRAINER = fakeSession({ id: 'c-trainer' });
const CUSTOMER_ADMIN = fakeSession({
  id: 'c-admin',
  role: 'ADMIN',
  isAdmin: true,
});
const TRAINEE = fakeSession({
  id: 'trainee',
  role: 'TRAINEE',
  isTrainerLevel: false,
  isPlatformOwner: true,
});

const ALLOWED: [string, FakeSession][] = [
  ['a trainer of the platform organization', PLATFORM_TRAINER],
  ['a super admin', SUPER_ADMIN],
];
const DENIED: [string, FakeSession][] = [
  ['a trainer of a customer organization', CUSTOMER_TRAINER],
  ['an admin of a customer organization', CUSTOMER_ADMIN],
  ['a trainee, even of the platform organization', TRAINEE],
];

// The session of the last load(): call() sends its valid admin PIN proof
// (embed and sync ask for it, the other routes ignore the header)
let proofOwner: FakeSession | null = null;

async function load(route: 'embed' | 'sync' | 'verify-pin', who: FakeSession) {
  jest.resetModules();
  proofOwner = who;
  mockSession(who);
  const haiDb = { execute: jest.fn(async () => []), select: jest.fn() };
  jest.doMock('@/db/haiDb', () => ({ __esModule: true, default: haiDb }));
  jest.doMock('@/db', () => ({ __esModule: true, default: {} }));
  const hai = {
    indexContent: jest.fn(async () => ({
      success: true,
      chunksIndexed: 1,
      chunksSkipped: 0,
      chunksFailed: 0,
    })),
    removeEmbeddings: jest.fn(async (..._args: unknown[]) => true),
    getEmbeddingCount: jest.fn(async (..._args: unknown[]) => 0),
    getIndexedSources: jest.fn(async () => []),
  };
  jest.doMock('@/lib/hai', () => ({ __esModule: true, ...hai }));
  const jobs = {
    createReindexJob: jest.fn(async (..._args: unknown[]) => ({
      jobId: 'job-1',
      error: undefined,
    })),
    getJobStatus: jest.fn(async (..._args: unknown[]) => ({ id: 'job-1' })),
    getLatestJob: jest.fn(async () => null),
    markJobRunning: jest.fn(async () => undefined),
    markJobCompleted: jest.fn(async () => undefined),
    markJobFailed: jest.fn(async () => undefined),
    markJobCancelled: jest.fn(async () => undefined),
    updateJobProgress: jest.fn(async () => undefined),
    isCancellationRequested: jest.fn(async () => false),
    requestCancellation: jest.fn(async () => true),
  };
  jest.doMock('@/lib/hai/reindexJob', () => ({ __esModule: true, ...jobs }));
  const indexer = {
    indexAllContent: jest.fn(async () => ({
      enablersIndexed: 1,
      coursesIndexed: 2,
      errors: [],
    })),
    indexAllTrainees: jest.fn(async () => ({
      totalTrainees: 0,
      successfullyIndexed: 0,
      failed: 0,
      results: [],
    })),
    indexTraineeData: jest.fn(async (..._args: unknown[]) => ({
      traineeId: 't1',
      traineeName: 'Trainee',
      profileResult: { chunks: 1 },
      scheduleResult: { chunks: 1 },
      progressResult: { chunks: 1 },
      errors: [],
    })),
  };
  jest.doMock('@/lib/hai/traineeDataIndexer', () => ({
    __esModule: true,
    ...indexer,
  }));
  // The PIN counter lives in the database, the route logic is tested with a
  // counter double (the counter itself: tests/unit/lib/auth/attempt-limiter)
  const limiter = {
    reserveAttempt: jest.fn(async (..._args: unknown[]) => ({
      allowed: true,
      retryAfterSec: 0,
      failures: 1,
    })),
    clearAttempts: jest.fn(async (..._args: unknown[]) => undefined),
  };
  jest.doMock('@/lib/auth/attempt-limiter', () => ({
    __esModule: true,
    ...(jest.requireActual('@/lib/auth/attempt-limiter') as object),
    ...limiter,
  }));
  const mod = await import(`@/app/api/hai/${route}/route`);
  return { mod: mod as any, haiDb, hai, jobs, indexer, limiter };
}

function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> | null = proofOwner
    ? proofHeader(proofOwner.id)
    : {}
) {
  return makeRequest(method, `${URL_BASE}/${path}`, {
    token: 't',
    body,
    headers: headers ?? {},
  });
}

describe('HAI embed route: platform staff only', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(ALLOWED)('%s may start a reindex', async (_name, who) => {
    const { mod, jobs } = await load('embed', who);
    const res = await mod.POST(
      call('POST', 'embed', { action: 'index_all', forceReindex: true })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, jobId: 'job-1' });
    expect(jobs.createReindexJob.mock.calls).toEqual([[true]]);
  });

  it.each(DENIED)('%s may not start a reindex', async (_name, who) => {
    const { mod, jobs } = await load('embed', who);
    // The trainer's own id in the query does not help
    const res = await mod.POST(
      call('POST', 'embed?userId=p-trainer', { action: 'index_all' })
    );
    expect(res.status).toBe(403);
    expect(jobs.createReindexJob).not.toHaveBeenCalled();
  });

  it.each(DENIED)('%s may not cancel the running job', async (_name, who) => {
    const { mod, jobs } = await load('embed', who);
    const res = await mod.POST(call('POST', 'embed', { action: 'cancel_job' }));
    expect(res.status).toBe(403);
    expect(jobs.requestCancellation).not.toHaveBeenCalled();
  });

  it('cancels the job for platform staff', async () => {
    const { mod, jobs } = await load('embed', PLATFORM_TRAINER);
    const res = await mod.POST(call('POST', 'embed', { action: 'cancel_job' }));
    expect(res.status).toBe(200);
    expect(jobs.requestCancellation).toHaveBeenCalledTimes(1);
  });

  it.each(DENIED)('%s may not delete embeddings', async (_name, who) => {
    const { mod, hai } = await load('embed', who);
    const res = await mod.DELETE(
      call(
        'DELETE',
        'embed?sourceType=enabler&sourceId=3b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11'
      )
    );
    expect(res.status).toBe(403);
    expect(hai.removeEmbeddings).not.toHaveBeenCalled();
  });

  it.each(ALLOWED)('%s may delete embeddings', async (_name, who) => {
    const { mod, hai } = await load('embed', who);
    const res = await mod.DELETE(
      call(
        'DELETE',
        'embed?sourceType=enabler&sourceId=3b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11'
      )
    );
    expect(res.status).toBe(200);
    expect(hai.removeEmbeddings.mock.calls).toEqual([
      ['enabler', '3b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11'],
    ]);
  });

  it('asks for the source when deleting', async () => {
    const { mod, hai } = await load('embed', PLATFORM_TRAINER);
    const res = await mod.DELETE(call('DELETE', 'embed'));
    expect(res.status).toBe(400);
    expect(hai.removeEmbeddings).not.toHaveBeenCalled();
  });

  it.each(DENIED)('%s may not see the index status', async (_name, who) => {
    const { mod, hai, jobs } = await load('embed', who);
    const res = await mod.GET(
      call('GET', 'embed?jobId=5a1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11')
    );
    expect(res.status).toBe(403);
    expect(jobs.getJobStatus).not.toHaveBeenCalled();
    expect(hai.getIndexedSources).not.toHaveBeenCalled();
  });

  it('shows the job and the index status to platform staff', async () => {
    const { mod, jobs } = await load('embed', SUPER_ADMIN);
    const job = await mod.GET(
      call('GET', 'embed?jobId=5a1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11')
    );
    expect(job.status).toBe(200);
    expect(jobs.getJobStatus.mock.calls).toEqual([
      ['5a1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11'],
    ]);
    const stats = await mod.GET(call('GET', 'embed'));
    expect(stats.status).toBe(200);
    expect((await stats.json()).stats.architecture).toBe('hybrid');
  });

  it('answers 404 for an unknown job', async () => {
    const { mod, jobs } = await load('embed', SUPER_ADMIN);
    jobs.getJobStatus.mockResolvedValueOnce(null as any);
    const res = await mod.GET(
      call('GET', 'embed?jobId=6a1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11')
    );
    expect(res.status).toBe(404);
  });

  it.each(DENIED)(
    '%s may not reindex or remove one source',
    async (_name, who) => {
      const { mod, hai } = await load('embed', who);
      const res = await mod.POST(
        call('POST', 'embed', {
          action: 'reindex',
          sourceType: 'course',
          sourceId: '4b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11',
        })
      );
      expect(res.status).toBe(403);
      expect(hai.removeEmbeddings).not.toHaveBeenCalled();
    }
  );

  it('removes the embeddings of one source for platform staff', async () => {
    const { mod, hai } = await load('embed', PLATFORM_TRAINER);
    const res = await mod.POST(
      call('POST', 'embed', {
        action: 'reindex',
        sourceType: 'course',
        sourceId: '4b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11',
      })
    );
    expect(res.status).toBe(200);
    expect(hai.removeEmbeddings.mock.calls).toEqual([
      ['course', '4b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11'],
    ]);
  });

  it('asks for the source when reindexing', async () => {
    const { mod, hai } = await load('embed', PLATFORM_TRAINER);
    const res = await mod.POST(
      call('POST', 'embed', { action: 'reindex', sourceType: 'course' })
    );
    expect(res.status).toBe(400);
    expect(hai.removeEmbeddings).not.toHaveBeenCalled();
  });
});

describe('HAI sync route: platform staff only', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(DENIED)('%s may not reindex the content', async (_name, who) => {
    const { mod, indexer } = await load('sync', who);
    const res = await mod.POST(
      call('POST', 'sync?userId=p-trainer', { action: 'sync_content' })
    );
    expect(res.status).toBe(403);
    expect(indexer.indexAllContent).not.toHaveBeenCalled();
  });

  it.each(DENIED)(
    '%s may not list or index trainee data',
    async (_name, who) => {
      const { mod, indexer } = await load('sync', who);
      for (const body of [
        { action: 'sync_all' },
        { action: 'sync_trainees' },
        { action: 'sync_trainee', traineeId: 't1' },
      ]) {
        const res = await mod.POST(call('POST', 'sync', body));
        expect(res.status).toBe(403);
      }
      expect(indexer.indexAllContent).not.toHaveBeenCalled();
      expect(indexer.indexAllTrainees).not.toHaveBeenCalled();
      expect(indexer.indexTraineeData).not.toHaveBeenCalled();
    }
  );

  it.each(ALLOWED)('%s may sync', async (_name, who) => {
    const { mod, indexer } = await load('sync', who);
    const content = await mod.POST(
      call('POST', 'sync', { action: 'sync_content' })
    );
    expect(content.status).toBe(200);
    const all = await mod.POST(call('POST', 'sync', { action: 'sync_all' }));
    expect(all.status).toBe(200);
    const trainees = await mod.POST(
      call('POST', 'sync', { action: 'sync_trainees' })
    );
    expect(trainees.status).toBe(200);
    const one = await mod.POST(
      call('POST', 'sync', {
        action: 'sync_trainee',
        traineeId: '8b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11',
      })
    );
    expect(one.status).toBe(200);
    expect(indexer.indexTraineeData.mock.calls).toEqual([
      ['8b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11'],
    ]);
  });

  it.each(['t1', "x'; drop table profiles; --"])(
    'answers 400 for the traineeId %p and indexes nothing',
    async bad => {
      const { mod, indexer } = await load('sync', SUPER_ADMIN);
      const res = await mod.POST(
        call('POST', 'sync', { action: 'sync_trainee', traineeId: bad })
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid traineeId' });
      expect(indexer.indexTraineeData).not.toHaveBeenCalled();
    }
  );

  it('validates the action', async () => {
    const { mod } = await load('sync', SUPER_ADMIN);
    const unknown = await mod.POST(call('POST', 'sync', { action: 'nope' }));
    expect(unknown.status).toBe(400);
    const noTrainee = await mod.POST(
      call('POST', 'sync', { action: 'sync_trainee' })
    );
    expect(noTrainee.status).toBe(400);
  });

  it.each(DENIED)('%s may not read the sync status', async (_name, who) => {
    const { mod, haiDb } = await load('sync', who);
    const res = await mod.GET(call('GET', 'sync?userId=p-trainer'));
    expect(res.status).toBe(403);
    expect(haiDb.execute).not.toHaveBeenCalled();
  });

  it.each(ALLOWED)('%s may read the sync status', async (_name, who) => {
    const { mod, haiDb } = await load('sync', who);
    const res = await mod.GET(call('GET', 'sync'));
    expect(res.status).toBe(200);
    expect(haiDb.execute).toHaveBeenCalled();
  });
});

describe('HAI verify-pin route: session first, then the PIN', () => {
  const PIN_BEFORE = process.env.HAI_ADMIN_PIN;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.HAI_ADMIN_PIN = '4711';
  });
  afterEach(() => {
    if (PIN_BEFORE === undefined) delete process.env.HAI_ADMIN_PIN;
    else process.env.HAI_ADMIN_PIN = PIN_BEFORE;
  });

  it.each(ALLOWED)('%s with the right PIN gets in', async (_name, who) => {
    const { mod } = await load('verify-pin', who);
    const res = await mod.POST(call('POST', 'verify-pin', { pin: '4711' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
  });

  it('rejects a wrong PIN', async () => {
    const { mod } = await load('verify-pin', PLATFORM_TRAINER);
    const res = await mod.POST(call('POST', 'verify-pin', { pin: '0000' }));
    expect(res.status).toBe(401);
  });

  it.each(DENIED)(
    '%s is rejected even with the right PIN',
    async (_name, who) => {
      const { mod } = await load('verify-pin', who);
      const res = await mod.POST(call('POST', 'verify-pin', { pin: '4711' }));
      expect(res.status).toBe(403);
    }
  );

  it('answers 500 when no PIN is configured', async () => {
    delete process.env.HAI_ADMIN_PIN;
    const { mod } = await load('verify-pin', PLATFORM_TRAINER);
    const res = await mod.POST(call('POST', 'verify-pin', { pin: '4711' }));
    expect(res.status).toBe(500);
  });

  it('answers 400 for a body that is not JSON', async () => {
    const { mod } = await load('verify-pin', PLATFORM_TRAINER);
    const request = call('POST', 'verify-pin');
    request.json = async () => {
      throw new Error('bad json');
    };
    const res = await mod.POST(request);
    expect(res.status).toBe(400);
  });

  it('does not count a body that is not JSON', async () => {
    const { mod, limiter } = await load('verify-pin', PLATFORM_TRAINER);
    const request = call('POST', 'verify-pin');
    request.json = async () => {
      throw new Error('bad json');
    };
    await mod.POST(request);
    expect(limiter.reserveAttempt).not.toHaveBeenCalled();
  });
});

// The admin PIN is one shared secret, so a caller must not be able to try it
// as often as they like: every attempt is counted in the database per person
// and per address, a wrong PIN answers the same for everybody, the PIN is
// compared in constant time and never ends up in a log.
describe('HAI verify-pin route: lock after wrong PINs', () => {
  const PIN_BEFORE = process.env.HAI_ADMIN_PIN;
  const IP = '203.0.113.7';
  const pinRequest = (pin: unknown, headers: Record<string, string> = {}) =>
    makeRequest('POST', `${URL_BASE}/verify-pin`, {
      token: 't',
      body: { pin },
      headers: { 'x-forwarded-for': IP, ...headers },
    });
  const allow = { allowed: true, retryAfterSec: 0, failures: 1 };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.HAI_ADMIN_PIN = '4711';
  });
  afterEach(() => {
    if (PIN_BEFORE === undefined) delete process.env.HAI_ADMIN_PIN;
    else process.env.HAI_ADMIN_PIN = PIN_BEFORE;
  });

  it('counts the attempt for the person and for the address before it compares', async () => {
    const { mod, limiter } = await load('verify-pin', PLATFORM_TRAINER);
    const order: string[] = [];
    limiter.reserveAttempt.mockImplementation(async (...args: unknown[]) => {
      order.push(String(args[1]).split(':')[0]);
      return allow;
    });
    const res = await mod.POST(pinRequest('4711'));
    expect(res.status).toBe(200);
    expect(order).toEqual(['user', 'ip']);
    const [scope, subject, policy] = limiter.reserveAttempt.mock.calls[0];
    expect(scope).toBe('hai-admin-pin');
    // the person comes from the session, never from the request
    expect(subject).toBe('user:p-trainer');
    expect(policy).toMatchObject({ threshold: 5, lockSeconds: [60, 300, 900] });
    const [, ipKey, ipPolicy] = limiter.reserveAttempt.mock.calls[1];
    expect(ipKey).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(String(ipKey)).not.toContain(IP);
    expect(ipPolicy).toMatchObject({ threshold: 15 });
  });

  it('forgets the counters after the right PIN', async () => {
    const { mod, limiter } = await load('verify-pin', PLATFORM_TRAINER);
    const res = await mod.POST(pinRequest('4711'));
    expect(res.status).toBe(200);
    expect(limiter.clearAttempts).toHaveBeenCalledTimes(1);
    const [scope, subjects] = limiter.clearAttempts.mock.calls[0] as [
      string,
      string[],
    ];
    expect(scope).toBe('hai-admin-pin');
    expect(subjects[0]).toBe('user:p-trainer');
    expect(subjects).toHaveLength(2);
  });

  it('keeps the counters after a wrong PIN and answers 401 without detail', async () => {
    const { mod, limiter } = await load('verify-pin', PLATFORM_TRAINER);
    const res = await mod.POST(pinRequest('0000'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false });
    expect(limiter.clearAttempts).not.toHaveBeenCalled();
  });

  it('answers a PIN of another length, a non-string and an empty PIN exactly like a wrong one', async () => {
    const { mod, limiter } = await load('verify-pin', PLATFORM_TRAINER);
    const bodies = [];
    for (const pin of ['47', '471100000000', 4711, null, undefined, '', {}]) {
      const res = await mod.POST(pinRequest(pin));
      expect(res.status).toBe(401);
      bodies.push(await res.json());
    }
    expect(bodies.every(b => JSON.stringify(b) === '{"success":false}')).toBe(
      true
    );
    // every one of them was counted as an attempt
    expect(limiter.reserveAttempt).toHaveBeenCalledTimes(14);
  });

  it('does not accept an over long PIN and does not hash it', async () => {
    const { mod } = await load('verify-pin', PLATFORM_TRAINER);
    const res = await mod.POST(pinRequest('4'.repeat(100_000)));
    expect(res.status).toBe(401);
  });

  it('answers 429 with Retry-After while the person is locked, even for the right PIN', async () => {
    const { mod, limiter } = await load('verify-pin', PLATFORM_TRAINER);
    limiter.reserveAttempt.mockResolvedValueOnce({
      allowed: false,
      retryAfterSec: 42,
      failures: 5,
    });
    const res = await mod.POST(pinRequest('4711'));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(await res.json()).toEqual({
      success: false,
      error: 'Too many attempts',
      retryAfterSec: 42,
    });
    // a locked person is not given the chance to test the PIN, and the
    // address counter does not move for a person who is already locked
    expect(limiter.reserveAttempt).toHaveBeenCalledTimes(1);
    expect(limiter.clearAttempts).not.toHaveBeenCalled();
  });

  it('answers 429 while the address is locked, even for the right PIN', async () => {
    const { mod, limiter } = await load('verify-pin', PLATFORM_TRAINER);
    limiter.reserveAttempt.mockResolvedValueOnce(allow).mockResolvedValueOnce({
      allowed: false,
      retryAfterSec: 300,
      failures: 15,
    });
    const res = await mod.POST(pinRequest('4711'));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('300');
    expect(limiter.clearAttempts).not.toHaveBeenCalled();
  });

  it('tells a person at once when the wrong PIN has just started a lock', async () => {
    const { mod, limiter } = await load('verify-pin', PLATFORM_TRAINER);
    limiter.reserveAttempt
      .mockResolvedValueOnce({ allowed: true, retryAfterSec: 60, failures: 5 })
      .mockResolvedValueOnce(allow);
    const res = await mod.POST(pinRequest('0000'));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('lets the right PIN in even if it was the attempt that reached the threshold', async () => {
    const { mod, limiter } = await load('verify-pin', PLATFORM_TRAINER);
    limiter.reserveAttempt
      .mockResolvedValueOnce({ allowed: true, retryAfterSec: 60, failures: 5 })
      .mockResolvedValueOnce(allow);
    const res = await mod.POST(pinRequest('4711'));
    expect(res.status).toBe(200);
    expect(limiter.clearAttempts).toHaveBeenCalledTimes(1);
  });

  it('cannot be talked past the person counter with another address header', async () => {
    const { mod, limiter } = await load('verify-pin', PLATFORM_TRAINER);
    for (const forwarded of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      await mod.POST(pinRequest('0000', { 'x-forwarded-for': forwarded }));
    }
    const userKeys = limiter.reserveAttempt.mock.calls
      .map(args => String(args[1]))
      .filter(key => key.startsWith('user:'));
    // the same key every time, whatever the header says
    expect(new Set(userKeys)).toEqual(new Set(['user:p-trainer']));
    expect(userKeys).toHaveLength(3);
  });

  it('counts only the person when the address is unknown', async () => {
    const { mod, limiter } = await load('verify-pin', PLATFORM_TRAINER);
    const request = makeRequest('POST', `${URL_BASE}/verify-pin`, {
      token: 't',
      body: { pin: '4711' },
    });
    const res = await mod.POST(request);
    expect(res.status).toBe(200);
    expect(limiter.reserveAttempt).toHaveBeenCalledTimes(1);
    expect(limiter.reserveAttempt.mock.calls[0][1]).toBe('user:p-trainer');
    const [, subjects] = limiter.clearAttempts.mock.calls[0] as [
      string,
      string[],
    ];
    expect(subjects).toEqual(['user:p-trainer']);
  });

  it('answers 503 and never opens when the counter cannot be reached', async () => {
    const { mod, limiter } = await load('verify-pin', PLATFORM_TRAINER);
    limiter.reserveAttempt.mockRejectedValue(new Error('db down'));
    const res = await mod.POST(pinRequest('4711'));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Temporarily unavailable',
    });
  });

  it('does not open when forgetting the counters fails after the right PIN', async () => {
    const { mod, limiter } = await load('verify-pin', PLATFORM_TRAINER);
    limiter.clearAttempts.mockRejectedValue(new Error('db down'));
    const res = await mod.POST(pinRequest('4711'));
    // the PIN was right: the failed cleanup only leaves old counters behind
    expect(res.status).toBe(200);
  });

  it.each(DENIED)(
    '%s is refused before anything is counted',
    async (_name, who) => {
      const { mod, limiter } = await load('verify-pin', who);
      const res = await mod.POST(pinRequest('4711'));
      expect(res.status).toBe(403);
      expect(limiter.reserveAttempt).not.toHaveBeenCalled();
    }
  );

  it('does not count when no PIN is configured', async () => {
    delete process.env.HAI_ADMIN_PIN;
    const { mod, limiter } = await load('verify-pin', PLATFORM_TRAINER);
    const res = await mod.POST(pinRequest('4711'));
    expect(res.status).toBe(500);
    expect(limiter.reserveAttempt).not.toHaveBeenCalled();
  });

  it('compares the PIN in constant time', async () => {
    const cryptoModule = jest.requireActual(
      'crypto'
    ) as typeof import('crypto');
    const spy = jest.spyOn(cryptoModule, 'timingSafeEqual');
    const { mod } = await load('verify-pin', PLATFORM_TRAINER);
    await mod.POST(pinRequest('0000'));
    await mod.POST(pinRequest('4711'));
    expect(spy).toHaveBeenCalledTimes(2);
    // both digests have the length of the hash, not the length of the PIN
    for (const [a, b] of spy.mock.calls) {
      expect((a as Buffer).length).toBe(32);
      expect((b as Buffer).length).toBe(32);
    }
  });

  it('logs failed attempts and locks, but never the PIN', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { mod, limiter } = await load('verify-pin', PLATFORM_TRAINER);
    await mod.POST(pinRequest('0000'));
    limiter.reserveAttempt
      .mockResolvedValueOnce({ allowed: true, retryAfterSec: 60, failures: 5 })
      .mockResolvedValueOnce(allow);
    await mod.POST(pinRequest('1234'));
    limiter.reserveAttempt.mockResolvedValueOnce({
      allowed: false,
      retryAfterSec: 30,
      failures: 5,
    });
    await mod.POST(pinRequest('4711'));
    const lines = warn.mock.calls.map(args => args.map(String).join(' '));
    expect(lines.some(line => /wrong PIN/i.test(line))).toBe(true);
    expect(lines.some(line => /lock started/i.test(line))).toBe(true);
    expect(lines.some(line => /refused.*locked/i.test(line))).toBe(true);
    // who, not what: the profile id is there, the PIN and the address are not
    expect(lines.every(line => line.includes('p-trainer'))).toBe(true);
    for (const secret of ['0000', '1234', '4711', IP]) {
      for (const output of [
        ...lines,
        ...(console.error as jest.Mock).mock.calls.map(a =>
          a.map(String).join(' ')
        ),
        ...(console.log as jest.Mock).mock.calls.map(a =>
          a.map(String).join(' ')
        ),
      ]) {
        expect(output).not.toContain(secret);
      }
    }
  });

  it('does not log a right PIN as a failure', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { mod } = await load('verify-pin', PLATFORM_TRAINER);
    await mod.POST(pinRequest('4711'));
    expect(warn).not.toHaveBeenCalled();
  });
});

// The source id and the job id go into uuid columns. A value that is no uuid
// made the database reject the query and the route answer 500: a source id in
// the body or query is a malformed request (400), a job id that is no uuid is
// a job that cannot exist (404).
describe('HAI embed route: ids that are no uuid', () => {
  beforeEach(() => jest.clearAllMocks());
  const BAD = ['e1', "x'; drop table hai_embeddings; --"];

  it.each(BAD)('index_enabler with the sourceId %p answers 400', async bad => {
    const { mod, hai, haiDb } = await load('embed', PLATFORM_TRAINER);
    const res = await mod.POST(
      call('POST', 'embed', { action: 'index_enabler', sourceId: bad })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid sourceId' });
    expect(haiDb.execute).not.toHaveBeenCalled();
    expect(hai.removeEmbeddings).not.toHaveBeenCalled();
  });

  it.each(BAD)('reindex with the sourceId %p answers 400', async bad => {
    const { mod, hai } = await load('embed', PLATFORM_TRAINER);
    const res = await mod.POST(
      call('POST', 'embed', {
        action: 'reindex',
        sourceType: 'course',
        sourceId: bad,
      })
    );
    expect(res.status).toBe(400);
    expect(hai.removeEmbeddings).not.toHaveBeenCalled();
  });

  it.each(BAD)('DELETE with the sourceId %p answers 400', async bad => {
    const { mod, hai } = await load('embed', PLATFORM_TRAINER);
    const res = await mod.DELETE(
      call(
        'DELETE',
        `embed?sourceType=enabler&sourceId=${encodeURIComponent(bad)}`
      )
    );
    expect(res.status).toBe(400);
    expect(hai.removeEmbeddings).not.toHaveBeenCalled();
  });

  it.each(['job-1', 'nope', "1'; --"])(
    'GET with the jobId %p answers 404 without a lookup',
    async bad => {
      const { mod, jobs } = await load('embed', PLATFORM_TRAINER);
      const res = await mod.GET(
        call('GET', `embed?jobId=${encodeURIComponent(bad)}`)
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Job not found' });
      expect(jobs.getJobStatus).not.toHaveBeenCalled();
    }
  );
});

// The PIN used to be a gate of the dialog only. embed (POST, DELETE) and sync
// (POST) start expensive or dangerous work for the whole platform, so they ask
// for the proof that verify-pin hands out (src/lib/auth/admin-proof.ts): in the
// header x-admin-pin-proof, in addition to the role. Role first, then proof.
// The status reads (GET) stay behind the role, the widget polls them.
describe('HAI admin PIN proof on embed and sync', () => {
  beforeEach(() => jest.clearAllMocks());

  const NO_PROOF = {};
  const MINUTE = 60_000;

  type Gated = {
    name: string;
    route: 'embed' | 'sync';
    run: (mod: any, headers: Record<string, string>) => Promise<Response>;
    ran: (loaded: any) => unknown;
  };
  const VALID_ID = '3b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11';
  const gated: Gated[] = [
    {
      name: 'embed POST (index_all)',
      route: 'embed',
      run: (mod, headers) =>
        mod.POST(call('POST', 'embed', { action: 'index_all' }, headers)),
      ran: l => l.jobs.createReindexJob,
    },
    {
      name: 'embed POST (cancel_job)',
      route: 'embed',
      run: (mod, headers) =>
        mod.POST(call('POST', 'embed', { action: 'cancel_job' }, headers)),
      ran: l => l.jobs.requestCancellation,
    },
    {
      name: 'embed DELETE',
      route: 'embed',
      run: (mod, headers) =>
        mod.DELETE(
          call(
            'DELETE',
            `embed?sourceType=enabler&sourceId=${VALID_ID}`,
            undefined,
            headers
          )
        ),
      ran: l => l.hai.removeEmbeddings,
    },
    {
      name: 'sync POST',
      route: 'sync',
      run: (mod, headers) =>
        mod.POST(call('POST', 'sync', { action: 'sync_content' }, headers)),
      ran: l => l.indexer.indexAllContent,
    },
  ];

  describe.each(gated)('$name', g => {
    const asksForProof = async (headers: Record<string, string>) => {
      const loaded = await load(g.route, PLATFORM_TRAINER);
      const res = await g.run(loaded.mod, headers);
      return { res, loaded };
    };

    it('runs with a valid proof of the person', async () => {
      const { res, loaded } = await asksForProof(
        proofHeader(PLATFORM_TRAINER.id)
      );
      expect(res.status).toBe(200);
      expect(g.ran(loaded)).toHaveBeenCalled();
    });

    it('answers 403 without a proof and runs nothing', async () => {
      const { res, loaded } = await asksForProof(NO_PROOF);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Admin PIN required' });
      expect(g.ran(loaded)).not.toHaveBeenCalled();
    });

    it.each([
      ['an empty proof', { 'x-admin-pin-proof': '' }],
      [
        'a made up proof',
        { 'x-admin-pin-proof': `v1.${Date.now() + MINUTE}.${'a'.repeat(64)}` },
      ],
      ['the PIN itself', { 'x-admin-pin-proof': '4711' }],
    ])('answers 403 for %s', async (_name, headers) => {
      const { res, loaded } = await asksForProof(headers);
      expect(res.status).toBe(403);
      expect(g.ran(loaded)).not.toHaveBeenCalled();
    });

    it('answers 403 for the proof of another person (a replay)', async () => {
      const { res, loaded } = await asksForProof(proofHeader(SUPER_ADMIN.id));
      expect(res.status).toBe(403);
      expect(g.ran(loaded)).not.toHaveBeenCalled();
    });

    it('answers 403 for an expired proof', async () => {
      const { res, loaded } = await asksForProof(
        proofHeader(PLATFORM_TRAINER.id, Date.now() - 11 * MINUTE)
      );
      expect(res.status).toBe(403);
      expect(g.ran(loaded)).not.toHaveBeenCalled();
    });

    it('answers 403 for a proof with a changed expiry', async () => {
      const [v, , mac] = proofHeader(PLATFORM_TRAINER.id)[
        'x-admin-pin-proof'
      ].split('.');
      const { res, loaded } = await asksForProof({
        'x-admin-pin-proof': `${v}.${Date.now() + 5 * MINUTE}.${mac}`,
      });
      expect(res.status).toBe(403);
      expect(g.ran(loaded)).not.toHaveBeenCalled();
    });

    it('fails closed with 503 when the server has no key to check a proof', async () => {
      const headers = proofHeader(PLATFORM_TRAINER.id);
      delete process.env.SUPABASE_SECRET_KEY;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      const { res, loaded } = await asksForProof(headers);
      expect(res.status).toBe(503);
      expect(g.ran(loaded)).not.toHaveBeenCalled();
    });

    it.each(DENIED)(
      '%s gets 403 for the role, also with a valid proof or without a key',
      async (_name, who) => {
        for (const withKey of [true, false]) {
          if (!withKey) {
            delete process.env.SUPABASE_SECRET_KEY;
            delete process.env.SUPABASE_SERVICE_ROLE_KEY;
          }
          const loaded = await load(g.route, who);
          const res = await g.run(
            loaded.mod,
            withKey ? proofHeader(who.id) : NO_PROOF
          );
          // the role is checked first: never 503 and never "PIN required"
          expect(res.status).toBe(403);
          expect(await res.json()).toEqual({ error: 'Forbidden' });
          expect(g.ran(loaded)).not.toHaveBeenCalled();
        }
      }
    );

    it('does not write the proof to a log', async () => {
      const headers = proofHeader(
        PLATFORM_TRAINER.id,
        Date.now() - 11 * MINUTE
      );
      const proof = headers['x-admin-pin-proof'];
      await asksForProof(headers);
      await asksForProof(proofHeader(PLATFORM_TRAINER.id));
      for (const spy of [console.log, console.warn, console.error]) {
        for (const args of (spy as jest.Mock).mock.calls) {
          expect(args.map(String).join(' ')).not.toContain(proof);
        }
      }
    });
  });

  it('keeps the status reads behind the role only', async () => {
    const embed = await load('embed', PLATFORM_TRAINER);
    expect(
      (await embed.mod.GET(call('GET', 'embed', undefined, NO_PROOF))).status
    ).toBe(200);
    const sync = await load('sync', PLATFORM_TRAINER);
    expect(
      (await sync.mod.GET(call('GET', 'sync', undefined, NO_PROOF))).status
    ).toBe(200);
  });
});

describe('HAI verify-pin route: the proof', () => {
  const PIN_BEFORE = process.env.HAI_ADMIN_PIN;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.HAI_ADMIN_PIN = '4711';
  });
  afterEach(() => {
    if (PIN_BEFORE === undefined) delete process.env.HAI_ADMIN_PIN;
    else process.env.HAI_ADMIN_PIN = PIN_BEFORE;
  });

  it('hands out a proof of the session for ten minutes after the right PIN', async () => {
    const { mod } = await load('verify-pin', PLATFORM_TRAINER);
    const before = Date.now();
    const res = await mod.POST(call('POST', 'verify-pin', { pin: '4711' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.expiresAt).toBeGreaterThanOrEqual(before + 600_000);
    expect(body.expiresAt).toBeLessThanOrEqual(Date.now() + 600_000);
    const { verifyAdminProof } = await import('@/lib/auth/admin-proof');
    expect(
      verifyAdminProof(body.proof, PLATFORM_TRAINER.id, 'hai-index-admin')
    ).toBe('valid');
    // bound to the session, not usable by somebody else
    expect(
      verifyAdminProof(body.proof, SUPER_ADMIN.id, 'hai-index-admin')
    ).toBe('invalid');
  });

  it('is the person of the session, a userId in the request changes nothing', async () => {
    const { mod } = await load('verify-pin', PLATFORM_TRAINER);
    const res = await mod.POST(
      call('POST', `verify-pin?userId=${SUPER_ADMIN.id}`, {
        pin: '4711',
        userId: SUPER_ADMIN.id,
      })
    );
    const { proof } = await res.json();
    const { verifyAdminProof } = await import('@/lib/auth/admin-proof');
    expect(
      verifyAdminProof(proof, PLATFORM_TRAINER.id, 'hai-index-admin')
    ).toBe('valid');
    expect(verifyAdminProof(proof, SUPER_ADMIN.id, 'hai-index-admin')).toBe(
      'invalid'
    );
  });

  it('gives no proof for a wrong PIN or a lock', async () => {
    const { mod, limiter } = await load('verify-pin', PLATFORM_TRAINER);
    const wrong = await mod.POST(call('POST', 'verify-pin', { pin: '0000' }));
    expect(await wrong.json()).toEqual({ success: false });
    limiter.reserveAttempt.mockResolvedValueOnce({
      allowed: false,
      retryAfterSec: 60,
      failures: 5,
    });
    const locked = await mod.POST(call('POST', 'verify-pin', { pin: '4711' }));
    expect(JSON.stringify(await locked.json())).not.toContain('proof');
  });

  it('fails closed with 503 without a key, before it counts or compares the PIN', async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { mod, limiter } = await load('verify-pin', PLATFORM_TRAINER);
    const res = await mod.POST(call('POST', 'verify-pin', { pin: '4711' }, {}));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain('proof');
    expect(limiter.reserveAttempt).not.toHaveBeenCalled();
  });

  it('still checks the role first without a key', async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { mod } = await load('verify-pin', CUSTOMER_TRAINER);
    const res = await mod.POST(call('POST', 'verify-pin', { pin: '4711' }, {}));
    expect(res.status).toBe(403);
  });

  it('does not write the proof or the PIN to a log', async () => {
    const { mod } = await load('verify-pin', PLATFORM_TRAINER);
    const res = await mod.POST(call('POST', 'verify-pin', { pin: '4711' }));
    const { proof } = await res.json();
    for (const spy of [console.log, console.warn, console.error]) {
      for (const args of (spy as jest.Mock).mock.calls) {
        const line = args.map(String).join(' ');
        expect(line).not.toContain(proof);
        expect(line).not.toContain('4711');
      }
    }
  });
});

describe('HAI sync route: a failure is answered neutrally', () => {
  const SECRET_ERROR =
    'connection to postgres://admin:hunter2@db.internal:5432/app failed';

  beforeEach(() => jest.clearAllMocks());

  it('answers the status request with a neutral message and logs the error', async () => {
    const { mod, haiDb } = await load('sync', SUPER_ADMIN);
    haiDb.execute.mockRejectedValue(new Error(SECRET_ERROR) as never);
    const res = await mod.GET(call('GET', 'sync'));
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(JSON.parse(text)).toEqual({
      error: 'Ein interner Fehler ist aufgetreten.',
    });
    expect(text).not.toMatch(/postgres|hunter2|internal/);
    // the cause stays in the server log
    const logged = (console.error as jest.Mock).mock.calls.flat();
    expect(logged.some(arg => String(arg).includes('Sync'))).toBe(true);
    expect(logged.some(arg => arg instanceof Error)).toBe(true);
  });

  it('answers a failed sync with a neutral message and logs the error', async () => {
    const { mod, indexer } = await load('sync', SUPER_ADMIN);
    indexer.indexAllContent.mockRejectedValue(new Error(SECRET_ERROR) as never);
    const res = await mod.POST(
      call('POST', 'sync', { action: 'sync_content' })
    );
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(JSON.parse(text)).toEqual({
      error: 'Ein interner Fehler ist aufgetreten.',
    });
    expect(text).not.toMatch(/postgres|hunter2|internal/);
    const logged = (console.error as jest.Mock).mock.calls.flat();
    expect(logged.some(arg => arg instanceof Error)).toBe(true);
  });
});
