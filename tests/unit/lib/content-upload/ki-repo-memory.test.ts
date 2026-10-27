/**
 * @jest-environment node
 */
import { randomUUID } from 'crypto';
import { MemoryKiRepo } from '../../../helpers/memoryKiRepo';
import { runKiRepoContract, type KiHarness } from './ki-repo-contract';

runKiRepoContract('memory', async (): Promise<KiHarness> => {
  let now = Date.UTC(2026, 9, 28, 12, 0, 0);
  const repo = new MemoryKiRepo(() => now);
  return {
    repo,
    async newFile() {
      return { runId: randomUUID(), fileId: randomUUID() };
    },
    async moreFile() {
      return randomUUID();
    },
    async advance(ms) {
      now += ms;
    },
    async rawCalls(runId) {
      return repo.calls
        .filter(c => c.runId === runId)
        .map(c => ({
          status: c.status,
          // the memory log has no excerpt column at all
          excerpt: null,
          excerptChars: c.excerptChars,
          endpointHost: c.endpointHost,
          model: c.model,
          answer: c.answer,
        }));
    },
    async close() {
      return undefined;
    },
  };
});
