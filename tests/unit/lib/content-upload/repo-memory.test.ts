import { MemoryUploadRepo } from '../../../helpers/memoryUploadRepo';
import { runRepoContract, type RepoHarness } from './repo-contract';

// The in-memory repository is what every other unit test of the content upload
// builds on, so it has to keep the same contract as the SQL one.

runRepoContract('memory', async (): Promise<RepoHarness> => {
  const repo = new MemoryUploadRepo();
  return {
    repo,
    userA: '11111111-1111-4111-8111-111111111111',
    userB: '22222222-2222-4222-8222-222222222222',
    catalogId: 'catalog-kfbm',
    async advance(ms) {
      repo.advance(ms);
    },
    async forceRunStatus(id, status, purgeAfterDays) {
      repo.forceRunStatus(id, status, purgeAfterDays);
    },
    async forceFileStatus(id, status) {
      repo.forceFileStatus(id, status);
    },
    async addApply(runId, mode) {
      repo.addApply(runId, mode);
    },
    async rawFiles(runId) {
      return [...repo.files.values()].filter(f => f.runId === runId);
    },
    async rawRunExists(runId) {
      return repo.runs.has(runId);
    },
    async close() {},
  };
});
