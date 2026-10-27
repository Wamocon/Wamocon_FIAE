import { MemoryReviewRepo } from '../../../helpers/memoryReviewRepo';
import { MemoryUploadRepo } from '../../../helpers/memoryUploadRepo';
import { runReviewContract, type ReviewHarness } from './review-contract';

// The in-memory review repository is what the unit tests of the review build on,
// so it has to keep the same contract as the SQL one.

runReviewContract('memory', async (): Promise<ReviewHarness> => {
  const upload = new MemoryUploadRepo();
  const review = new MemoryReviewRepo(upload);
  review.names.set('11111111-1111-4111-8111-111111111111', 'Erika Muster');
  return {
    upload,
    review,
    userA: '11111111-1111-4111-8111-111111111111',
    userB: '22222222-2222-4222-8222-222222222222',
    catalogId: 'catalog-kfbm',
    async forceRunStatus(id, status) {
      upload.forceRunStatus(id, status);
    },
    async forceFileStatus(id, status) {
      upload.forceFileStatus(id, status);
    },
    async setDryRunHash(runId, hash) {
      review.dryRunHash.set(runId, hash);
    },
    async dryRunHash(runId) {
      return review.dryRunHash.get(runId) ?? null;
    },
    async seedCatalog() {
      review.components = [
        {
          code: 'K1',
          title: 'Eins',
          kind: 'pflicht',
          phase: 1,
          enablers: [
            { code: 'K1-a', title: 'A' },
            { code: 'K1-b', title: null },
          ],
        },
        { code: 'K12', title: null, kind: 'wahl', phase: null, enablers: [] },
      ];
    },
    async rawDecisions(runId) {
      return review.decisionRows
        .filter(d => d.runId === runId)
        .map(d => ({
          fileId: d.fileId,
          action: d.action,
          isCurrent: d.isCurrent,
          version: d.decisionsVersion,
        }));
    },
    async rawProposals(fileId) {
      return review.proposals
        .filter(p => p.fileId === fileId)
        .map(p => ({ id: p.id, isCurrent: p.isCurrent, band: p.band }));
    },
    async close() {},
  };
});
