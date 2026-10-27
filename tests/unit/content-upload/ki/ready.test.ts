/**
 * @jest-environment node
 */
// When the model step may take files of a run: every condition on its own.
import { DEFAULT_LIMITS } from '@/lib/content-upload/ki/config';
import { kiReady, type KiStepEnv } from '@/lib/content-upload/ki/steps';
import type { SolutionCorpus } from '@/lib/content-upload/ki/corpus';
import type { KiUsage } from '@/lib/content-upload/ki/repo';
import type { QueueState } from '@/lib/content-upload/staging/repo';
import type { RunStatus } from '@/lib/content-upload/staging/status';
import type { RunRow } from '@/lib/content-upload/staging/types';
import { localConfig } from '../../../helpers/fakeSokrates';

const run = (overrides: Partial<RunRow> = {}): RunRow => ({
  id: 'r1',
  trainingCatalogId: 'c1',
  createdById: 'u1',
  label: 'x',
  status: 'processing' as RunStatus,
  kiEnabled: true,
  declarationAcceptedAt: new Date(0),
  storagePrefix: 'upload/r1/',
  decisionsVersion: 0,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  finishedAt: null,
  purgeAfter: null,
  ...overrides,
});

interface Setup {
  config?: boolean;
  available?: boolean;
  run?: RunRow | null;
  early?: Partial<QueueState>;
  usage?: Partial<KiUsage>;
  corpusComplete?: boolean;
}

function check(setup: Setup = {}) {
  const calls = { corpus: 0, usage: 0, queue: 0 };
  const env = {
    config: () =>
      setup.config === false
        ? { ok: false as const, code: 'DISABLED' as const }
        : {
            ok: true as const,
            config: localConfig({ url: 'http://127.0.0.1:1/api' }),
          },
    available: () => setup.available !== false,
    ki: {
      usage: async (): Promise<KiUsage> => {
        calls.usage += 1;
        return { run: 0, day: 0, file: 0, recent: [], ...setup.usage };
      },
    },
    corpus: async () => {
      calls.corpus += 1;
      return {
        advance: async () => setup.corpusComplete !== false,
      } as unknown as SolutionCorpus;
    },
  } as unknown as KiStepEnv;
  const deps = {
    repo: {
      getRun: async () => (setup.run === undefined ? run() : setup.run),
      queueState: async (): Promise<QueueState> => {
        calls.queue += 1;
        return { announced: 0, claimable: 0, locked: 0, ...setup.early };
      },
    },
  } as any;
  return { ready: () => kiReady(env, { runId: 'r1', deps }), calls };
}

describe('when the model step may take files', () => {
  it('is ready when everything is in place', async () => {
    expect(await check().ready()).toBe(true);
    expect(await check({ run: run({ status: 'review' }) }).ready()).toBe(true);
  });

  it.each([
    ['the stage is off in the environment', { config: false }],
    ['the upload is off here (Production)', { available: false }],
    ['the run does not exist', { run: null }],
    ['the run has no opt in', { run: run({ kiEnabled: false }) }],
    ['the upload is still open', { run: run({ status: 'uploading' }) }],
    ['the run is a draft', { run: run({ status: 'draft' }) }],
    ['the run is being applied', { run: run({ status: 'applying' }) }],
    ['the run was applied', { run: run({ status: 'applied' }) }],
    ['the run was discarded', { run: run({ status: 'discarded' }) }],
    ['a file is announced and not uploaded yet', { early: { announced: 1 } }],
    ['a file waits to be read', { early: { claimable: 1 } }],
    ['a file is being read', { early: { locked: 1 } }],
    [
      'the run used its calls',
      { usage: { run: DEFAULT_LIMITS.maxCallsPerRun } },
    ],
    [
      'the day used its calls',
      { usage: { day: DEFAULT_LIMITS.maxCallsPerDay } },
    ],
    [
      'the breaker is open',
      {
        usage: {
          recent: Array.from({ length: 5 }, () => ({
            status: 'http_error' as const,
            ageSec: 3,
          })),
        },
      },
    ],
    ['the list of solution texts is not complete', { corpusComplete: false }],
  ] as Array<[string, Setup]>)('is not ready when %s', async (_name, setup) => {
    expect(await check(setup).ready()).toBe(false);
  });

  it('asks the cheap things first and builds the list of solutions last', async () => {
    const off = check({ config: false });
    await off.ready();
    expect(off.calls).toEqual({ corpus: 0, usage: 0, queue: 0 });
    const reading = check({ early: { claimable: 2 } });
    await reading.ready();
    expect(reading.calls).toEqual({ corpus: 0, usage: 0, queue: 1 });
    const blocked = check({ usage: { run: 999_999 } });
    await blocked.ready();
    expect(blocked.calls.corpus).toBe(0);
  });
});
