// The contract every KiRepo has to keep (the log of the Sokrates stage and the
// numbers of the cost brake). It runs against the in-memory repository on every
// test run (ki-repo-memory.test.ts) and against the SQL repository when a
// throwaway database is given (ki-repo-pg.test.ts, variable
// CONTENT_UPLOAD_TEST_DB), so the two cannot drift apart.

import { sha256 } from '../../../helpers/kiFixtures';
import type {
  KiCallStatus,
  KiCallWrite,
  KiRepo,
} from '@/lib/content-upload/ki/repo';

const HOUR = 3_600_000;

export interface KiHarness {
  repo: KiRepo;
  /** A run with a file, as the log needs them (the table has foreign keys). */
  newFile(): Promise<{ runId: string; fileId: string }>;
  /** Another file of an existing run. */
  moreFile(runId: string): Promise<string>;
  advance(ms: number): Promise<void>;
  /** The stored rows of a run, read directly. */
  rawCalls(runId: string): Promise<
    {
      status: string;
      excerpt: string | null;
      excerptChars: number;
      endpointHost: string | null;
      model: string | null;
      answer: string | null;
    }[]
  >;
  close(): Promise<void>;
}

const call = (
  runId: string,
  fileId: string,
  status: KiCallStatus = 'ok',
  overrides: Partial<KiCallWrite> = {}
): KiCallWrite => ({
  runId,
  fileId,
  stage: 'type_component',
  model: 'test-model',
  endpointHost: 'sokrates.example.org',
  excerptChars: 120,
  excerptSha256: sha256('excerpt'),
  redactions: 1,
  status,
  httpStatus: status === 'ok' ? 200 : null,
  latencyMs: 250,
  promptTokens: 100,
  completionTokens: 30,
  attempt: 1,
  answer: '{"docType":"quiz"}',
  ...overrides,
});

export function runKiRepoContract(
  label: string,
  make: () => Promise<KiHarness>
) {
  describe(`KiRepo contract: ${label}`, () => {
    let h: KiHarness;
    let repo: KiRepo;
    beforeEach(async () => {
      h = await make();
      repo = h.repo;
    });
    afterEach(async () => {
      await h.close();
    });

    it('stores a call with its metadata and never an excerpt', async () => {
      const { runId, fileId } = await h.newFile();
      await repo.recordCall(call(runId, fileId));
      expect(await h.rawCalls(runId)).toEqual([
        {
          status: 'ok',
          excerpt: null,
          excerptChars: 120,
          endpointHost: 'sokrates.example.org',
          model: 'test-model',
          answer: '{"docType":"quiz"}',
        },
      ]);
    });

    it('stores a call that sent nothing (refused, skipped) without model and host', async () => {
      const { runId, fileId } = await h.newFile();
      await repo.recordCall(
        call(runId, fileId, 'refused_by_guard', {
          model: null,
          endpointHost: null,
          excerptChars: 0,
          excerptSha256: sha256(''),
          answer: null,
        })
      );
      await repo.recordCall(
        call(runId, fileId, 'skipped', {
          model: null,
          endpointHost: null,
          excerptChars: 0,
          excerptSha256: sha256(''),
          answer: null,
        })
      );
      const rows = await h.rawCalls(runId);
      expect(rows.map(r => r.status)).toEqual(['refused_by_guard', 'skipped']);
      expect(rows.every(r => r.model === null && r.endpointHost === null)).toBe(
        true
      );
    });

    it('counts only the calls that reached the server', async () => {
      const { runId, fileId } = await h.newFile();
      for (const status of [
        'ok',
        'invalid_json',
        'not_in_whitelist',
        'timeout',
        'http_error',
      ] as const) {
        await repo.recordCall(call(runId, fileId, status));
      }
      await repo.recordCall(call(runId, fileId, 'refused_by_guard'));
      await repo.recordCall(call(runId, fileId, 'skipped'));
      const usage = await repo.usage(runId, fileId, 10);
      expect(usage).toMatchObject({ run: 5, day: 5, file: 5 });
      expect(usage.recent).toHaveLength(5);
    });

    it('counts per run, per file and, for the day, over all runs', async () => {
      const a = await h.newFile();
      const b = await h.newFile();
      const a2 = await h.moreFile(a.runId);
      await repo.recordCall(call(a.runId, a.fileId));
      await repo.recordCall(call(a.runId, a.fileId));
      await repo.recordCall(call(a.runId, a2));
      await repo.recordCall(call(b.runId, b.fileId));
      expect(await repo.usage(a.runId, a.fileId, 5)).toMatchObject({
        run: 3,
        day: 4,
        file: 2,
      });
      expect(await repo.usage(a.runId, a2, 5)).toMatchObject({ file: 1 });
      expect(await repo.usage(b.runId, null, 5)).toMatchObject({
        run: 1,
        day: 4,
        file: 0,
      });
    });

    it('lets a call fall out of the day after 24 hours', async () => {
      const { runId, fileId } = await h.newFile();
      await repo.recordCall(call(runId, fileId));
      await h.advance(23 * HOUR);
      expect(await repo.usage(runId, fileId, 5)).toMatchObject({
        run: 1,
        day: 1,
      });
      await h.advance(2 * HOUR);
      expect(await repo.usage(runId, fileId, 5)).toMatchObject({
        run: 1,
        day: 0,
      });
    });

    it('lists the newest calls of the run first, with their age, up to the limit', async () => {
      const { runId, fileId } = await h.newFile();
      await repo.recordCall(call(runId, fileId, 'http_error'));
      await h.advance(10_000);
      await repo.recordCall(call(runId, fileId, 'timeout'));
      await h.advance(10_000);
      await repo.recordCall(call(runId, fileId, 'ok'));
      await h.advance(5_000);
      const { recent } = await repo.usage(runId, fileId, 2);
      expect(recent.map(r => r.status)).toEqual(['ok', 'timeout']);
      expect(recent[0].ageSec).toBeGreaterThanOrEqual(4.5);
      expect(recent[0].ageSec).toBeLessThan(8);
      expect(recent[1].ageSec).toBeGreaterThanOrEqual(14.5);
      expect((await repo.usage(runId, fileId, 0)).recent).toEqual([]);
    });

    it('knows nothing of a run without calls', async () => {
      const { runId } = await h.newFile();
      expect(await repo.usage(runId, null, 5)).toEqual({
        run: 0,
        day: 0,
        file: 0,
        recent: [],
      });
    });
  });
}
