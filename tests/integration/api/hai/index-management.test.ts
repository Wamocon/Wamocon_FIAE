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

// Embed, sync and verify-pin manage the shared HAI index, which has no
// organization column: one reindex or delete touches every organization. Only
// platform staff may use them (src/lib/hai/indexAccess.ts). The role comes from
// the session, a userId in the query changes nothing.

const URL_BASE = 'http://localhost/api/hai';

// The routes log progress and configuration errors, keep the test output clean
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
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

async function load(route: 'embed' | 'sync' | 'verify-pin', who: FakeSession) {
  jest.resetModules();
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
  const mod = await import(`@/app/api/hai/${route}/route`);
  return { mod: mod as any, haiDb, hai, jobs, indexer };
}

function call(method: string, path: string, body?: unknown) {
  return makeRequest(method, `${URL_BASE}/${path}`, { token: 't', body });
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
      call('DELETE', 'embed?sourceType=enabler&sourceId=e1')
    );
    expect(res.status).toBe(403);
    expect(hai.removeEmbeddings).not.toHaveBeenCalled();
  });

  it.each(ALLOWED)('%s may delete embeddings', async (_name, who) => {
    const { mod, hai } = await load('embed', who);
    const res = await mod.DELETE(
      call('DELETE', 'embed?sourceType=enabler&sourceId=e1')
    );
    expect(res.status).toBe(200);
    expect(hai.removeEmbeddings.mock.calls).toEqual([['enabler', 'e1']]);
  });

  it('asks for the source when deleting', async () => {
    const { mod, hai } = await load('embed', PLATFORM_TRAINER);
    const res = await mod.DELETE(call('DELETE', 'embed'));
    expect(res.status).toBe(400);
    expect(hai.removeEmbeddings).not.toHaveBeenCalled();
  });

  it.each(DENIED)('%s may not see the index status', async (_name, who) => {
    const { mod, hai, jobs } = await load('embed', who);
    const res = await mod.GET(call('GET', 'embed?jobId=job-1'));
    expect(res.status).toBe(403);
    expect(jobs.getJobStatus).not.toHaveBeenCalled();
    expect(hai.getIndexedSources).not.toHaveBeenCalled();
  });

  it('shows the job and the index status to platform staff', async () => {
    const { mod, jobs } = await load('embed', SUPER_ADMIN);
    const job = await mod.GET(call('GET', 'embed?jobId=job-1'));
    expect(job.status).toBe(200);
    expect(jobs.getJobStatus.mock.calls).toEqual([['job-1']]);
    const stats = await mod.GET(call('GET', 'embed'));
    expect(stats.status).toBe(200);
    expect((await stats.json()).stats.architecture).toBe('hybrid');
  });

  it('answers 404 for an unknown job', async () => {
    const { mod, jobs } = await load('embed', SUPER_ADMIN);
    jobs.getJobStatus.mockResolvedValueOnce(null as any);
    const res = await mod.GET(call('GET', 'embed?jobId=nope'));
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
          sourceId: 'c1',
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
        sourceId: 'c1',
      })
    );
    expect(res.status).toBe(200);
    expect(hai.removeEmbeddings.mock.calls).toEqual([['course', 'c1']]);
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
      call('POST', 'sync', { action: 'sync_trainee', traineeId: 't1' })
    );
    expect(one.status).toBe(200);
    expect(indexer.indexTraineeData.mock.calls).toEqual([['t1']]);
  });

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
    expect(await res.json()).toEqual({ success: true });
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
});
