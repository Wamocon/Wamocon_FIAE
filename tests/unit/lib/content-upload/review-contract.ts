// The contract every ReviewRepo has to keep. It runs against the in-memory
// repository on every test run (review-repo-memory.test.ts) and against the SQL
// repository when a throwaway database is given (review-repo-pg.test.ts, variable
// CONTENT_UPLOAD_TEST_DB), so the two cannot drift apart.

import { randomUUID } from 'crypto';
import type {
  ReviewRepo,
  DecisionWriteItem,
} from '@/lib/content-upload/review/repo';
import type { ProposalWrite } from '@/lib/content-upload/review/types';
import type { UploadRepo } from '@/lib/content-upload/staging/repo';
import type {
  FileStatus,
  RunStatus,
} from '@/lib/content-upload/staging/status';
import { candidate } from './repo-contract';

export interface ReviewHarness {
  upload: UploadRepo;
  review: ReviewRepo;
  userA: string;
  userB: string;
  catalogId: string;
  forceRunStatus(id: string, status: RunStatus): Promise<void>;
  forceFileStatus(id: string, status: FileStatus): Promise<void>;
  setDryRunHash(runId: string, hash: string | null): Promise<void>;
  dryRunHash(runId: string): Promise<string | null>;
  /** K1 (mandatory, phase 1) with K1-a and K1-b, K12 (elective) without enablers. */
  seedCatalog(): Promise<void>;
  /** Every decision row of the run, also the retired ones. */
  rawDecisions(
    runId: string
  ): Promise<
    { fileId: string; action: string; isCurrent: boolean; version: number }[]
  >;
  rawProposals(
    fileId: string
  ): Promise<{ id: string; isCurrent: boolean; band: string }[]>;
  close(): Promise<void>;
}

const proposal = (overrides: Partial<ProposalWrite> = {}): ProposalWrite => ({
  source: 'path_content',
  docType: 'quiz',
  componentCode: 'K1',
  enablerCode: 'K1-a',
  quizLevel: 'low',
  confidence: 0.99,
  band: 'high',
  reasons: [{ code: 'AGREE', text: 'Pfad und Inhalt nennen dasselbe.' }],
  model: null,
  ...overrides,
});

export function runReviewContract(
  label: string,
  make: () => Promise<ReviewHarness>
) {
  describe(`ReviewRepo contract: ${label}`, () => {
    let h: ReviewHarness;
    let counter = 0;
    beforeEach(async () => {
      h = await make();
    });
    afterEach(async () => {
      await h.close();
    });

    /** A run with `count` files that are claimed and have a proposal. */
    async function runWithFiles(
      count: number,
      options: {
        user?: string;
        status?: RunStatus;
        fileStatus?: FileStatus;
      } = {}
    ) {
      const id = randomUUID();
      const created = await h.upload.createRun(
        {
          id,
          catalogId: h.catalogId,
          createdById: options.user ?? h.userA,
          label: `review ${++counter}`,
          kiEnabled: true,
          storagePrefix: `upload/${id}/`,
        },
        100
      );
      if (!created.ok) throw new Error('could not create the run');
      const cs = Array.from({ length: count }, (_, i) =>
        candidate(id, counter * 100 + i, {
          relPath: `d/f${String(i).padStart(2, '0')}.docx`,
          fileName: `f${i}.docx`,
        })
      );
      const announced = await h.upload.announce(id, cs);
      if (!announced.ok) throw new Error('announce failed');
      for (const c of cs) {
        await h.upload.transitionFile(id, c.id, 'announced', 'uploaded', {
          completed: true,
        });
      }
      const claimed = await h.upload.claimFiles(id, {
        statuses: ['uploaded'],
        limit: count,
        lockSeconds: 60,
        maxAttempts: 3,
      });
      expect(claimed).toHaveLength(count);
      const proposals: {
        fileId: string;
        claimId: string;
        proposalId: string;
      }[] = [];
      for (const file of claimed) {
        expect(
          await h.review.writeProposal(file.id, file.claimId!, proposal())
        ).toBe(true);
        await h.forceFileStatus(
          file.id,
          options.fileStatus ?? 'proposed_rules'
        );
      }
      const records = await h.review.listRecords(id);
      for (const r of records) {
        proposals.push({
          fileId: r.file.id,
          claimId: r.file.claimId!,
          proposalId: r.proposal!.id,
        });
      }
      await h.forceRunStatus(id, options.status ?? 'review');
      return { runId: id, files: records.map(r => r.file), proposals };
    }

    const item = (
      fileId: string,
      proposalId: string | null,
      overrides: Partial<DecisionWriteItem> = {}
    ): DecisionWriteItem => ({
      fileId,
      proposalId,
      action: 'accept',
      docType: 'quiz',
      componentCode: 'K1',
      enablerCode: 'K1-a',
      quizLevel: 'low',
      dupChoice: null,
      note: null,
      ...overrides,
    });

    describe('listRecords', () => {
      it('lists the files of the run by path with their current proposal and no decision', async () => {
        const { runId, proposals } = await runWithFiles(3);
        const records = await h.review.listRecords(runId);
        expect(records.map(r => r.file.relPath)).toEqual([
          'd/f00.docx',
          'd/f01.docx',
          'd/f02.docx',
        ]);
        for (const r of records) {
          expect(r.decision).toBeNull();
          expect(r.proposal).toMatchObject({
            source: 'path_content',
            docType: 'quiz',
            componentCode: 'K1',
            enablerCode: 'K1-a',
            quizLevel: 'low',
            confidence: 0.99,
            band: 'high',
            model: null,
          });
          expect(r.proposal!.reasons).toEqual([
            { code: 'AGREE', text: 'Pfad und Inhalt nennen dasselbe.' },
          ]);
          expect(proposals.map(p => p.proposalId)).toContain(r.proposal!.id);
        }
      });

      it('lists the files of that run only and nothing for an unknown or bad id', async () => {
        const a = await runWithFiles(2);
        const b = await runWithFiles(1);
        expect(await h.review.listRecords(a.runId)).toHaveLength(2);
        expect(await h.review.listRecords(b.runId)).toHaveLength(1);
        expect(await h.review.listRecords(randomUUID())).toEqual([]);
        expect(
          await h.review.listRecords("x'; drop table content_upload_runs; --")
        ).toEqual([]);
      });

      it('gives a file without a proposal a null proposal', async () => {
        const id = randomUUID();
        await h.upload.createRun(
          {
            id,
            catalogId: h.catalogId,
            createdById: h.userA,
            label: 'x',
            kiEnabled: true,
            storagePrefix: `upload/${id}/`,
          },
          10
        );
        await h.upload.announce(id, [candidate(id, 9001)]);
        const [record] = await h.review.listRecords(id);
        expect(record.proposal).toBeNull();
        expect(record.decision).toBeNull();
      });
    });

    describe('writeProposal', () => {
      it("writes only while the claim is the caller's", async () => {
        const { files } = await runWithFiles(1);
        expect(
          await h.review.writeProposal(
            files[0].id,
            randomUUID(),
            proposal({ band: 'low' })
          )
        ).toBe(false);
        expect(
          await h.review.writeProposal(randomUUID(), randomUUID(), proposal())
        ).toBe(false);
        expect(
          await h.review.writeProposal('not-a-uuid', 'also-not', proposal())
        ).toBe(false);
        const proposals = await h.rawProposals(files[0].id);
        expect(proposals).toHaveLength(1);
        expect(proposals[0].band).toBe('high');
      });

      it('hands back the current proposal of a file, or nothing', async () => {
        const { files } = await runWithFiles(1);
        const claim = (await h.review.listRecords(files[0].runId))[0].file
          .claimId!;
        expect(await h.review.currentProposal(files[0].id)).toMatchObject({
          fileId: files[0].id,
          band: 'high',
          docType: 'quiz',
          componentCode: 'K1',
          source: 'path_content',
        });
        await h.review.writeProposal(
          files[0].id,
          claim,
          proposal({ source: 'ki', band: 'medium', confidence: 0.7, model: 'm' })
        );
        // the new one, not the retired one
        expect(await h.review.currentProposal(files[0].id)).toMatchObject({
          source: 'ki',
          band: 'medium',
          confidence: 0.7,
          model: 'm',
        });
        expect(await h.review.currentProposal(randomUUID())).toBeNull();
        expect(await h.review.currentProposal('not-a-uuid')).toBeNull();
      });

      it('retires the old proposal and keeps it as history', async () => {
        const { files } = await runWithFiles(1);
        const claim = (await h.review.listRecords(files[0].runId))[0].file
          .claimId!;
        expect(
          await h.review.writeProposal(
            files[0].id,
            claim,
            proposal({ band: 'medium', confidence: 0.7 })
          )
        ).toBe(true);
        const proposals = await h.rawProposals(files[0].id);
        expect(proposals).toHaveLength(2);
        expect(proposals.filter(p => p.isCurrent)).toHaveLength(1);
        const [record] = await h.review.listRecords(files[0].runId);
        expect(record.proposal).toMatchObject({
          band: 'medium',
          confidence: 0.7,
        });
      });

      it('stores the reasons and the codes without change, also special characters', async () => {
        const { files } = await runWithFiles(1);
        const claim = (await h.review.listRecords(files[0].runId))[0].file
          .claimId!;
        const reasons = [{ code: 'X', text: 'Ä ö ü ß \' " ; -- \\ {} []' }];
        await h.review.writeProposal(
          files[0].id,
          claim,
          proposal({
            reasons,
            docType: null,
            componentCode: null,
            enablerCode: null,
            quizLevel: null,
            band: 'low',
            confidence: 0,
          })
        );
        const [record] = await h.review.listRecords(files[0].runId);
        expect(record.proposal!.reasons).toEqual(reasons);
        expect(record.proposal!.docType).toBeNull();
        expect(record.proposal!.confidence).toBe(0);
      });
    });

    describe('applyDecisions', () => {
      it('writes decisions in the state review, moves the files to decided and raises the version', async () => {
        const { runId, proposals } = await runWithFiles(3);
        await h.setDryRunHash(runId, 'hash-of-a-dry-run');
        const result = await h.review.applyDecisions({
          runId,
          expectedVersion: 0,
          decidedById: h.userA,
          items: proposals.map(p => item(p.fileId, p.proposalId)),
        });
        expect(result).toEqual({
          ok: true,
          version: 1,
          written: 3,
          skipped: [],
        });
        expect((await h.upload.getRun(runId))!.decisionsVersion).toBe(1);
        expect(await h.dryRunHash(runId)).toBeNull();
        const records = await h.review.listRecords(runId);
        for (const r of records) {
          expect(r.file.status).toBe('decided');
          expect(r.decision).toMatchObject({
            action: 'accept',
            docType: 'quiz',
            componentCode: 'K1',
            enablerCode: 'K1-a',
            quizLevel: 'low',
            decidedById: h.userA,
            decisionsVersion: 0,
            dupChoice: null,
            note: null,
          });
          expect(r.decision!.proposalId).toBe(r.proposal!.id);
        }
      });

      it.each([
        'draft',
        'uploading',
        'processing',
        'applying',
        'applied',
        'failed',
        'discarded',
      ] as const)(
        'refuses a run in the state %s and writes nothing',
        async status => {
          const { runId, proposals } = await runWithFiles(1, { status });
          await h.setDryRunHash(runId, 'keep');
          const result = await h.review.applyDecisions({
            runId,
            expectedVersion: 0,
            decidedById: h.userA,
            items: [item(proposals[0].fileId, proposals[0].proposalId)],
          });
          expect(result).toEqual({ ok: false, reason: 'RUN_STATE', status });
          expect(await h.rawDecisions(runId)).toEqual([]);
          expect(await h.dryRunHash(runId)).toBe('keep');
        }
      );

      it('refuses a version that is not the current one', async () => {
        const { runId, proposals } = await runWithFiles(2);
        await h.review.applyDecisions({
          runId,
          expectedVersion: 0,
          decidedById: h.userA,
          items: [item(proposals[0].fileId, proposals[0].proposalId)],
        });
        const stale = await h.review.applyDecisions({
          runId,
          expectedVersion: 0,
          decidedById: h.userB,
          items: [item(proposals[1].fileId, proposals[1].proposalId)],
        });
        expect(stale).toEqual({
          ok: false,
          reason: 'VERSION_CONFLICT',
          current: 1,
        });
        const ahead = await h.review.applyDecisions({
          runId,
          expectedVersion: 7,
          decidedById: h.userB,
          items: [item(proposals[1].fileId, proposals[1].proposalId)],
        });
        expect(ahead).toEqual({
          ok: false,
          reason: 'VERSION_CONFLICT',
          current: 1,
        });
        expect(
          (await h.rawDecisions(runId)).filter(
            d => d.fileId === proposals[1].fileId
          )
        ).toEqual([]);
      });

      it('lets exactly one of several writes at the same time pass for one version', async () => {
        const { runId, proposals } = await runWithFiles(4);
        const results = await Promise.all(
          proposals.map(p =>
            h.review.applyDecisions({
              runId,
              expectedVersion: 0,
              decidedById: h.userA,
              items: [item(p.fileId, p.proposalId)],
            })
          )
        );
        expect(results.filter(r => r.ok)).toHaveLength(1);
        expect(
          results.filter(r => !r.ok && r.reason === 'VERSION_CONFLICT')
        ).toHaveLength(3);
        expect((await h.upload.getRun(runId))!.decisionsVersion).toBe(1);
      });

      it('an unknown run is not found', async () => {
        expect(
          await h.review.applyDecisions({
            runId: randomUUID(),
            expectedVersion: 0,
            decidedById: h.userA,
            items: [],
          })
        ).toEqual({ ok: false, reason: 'RUN_NOT_FOUND' });
        expect(
          await h.review.applyDecisions({
            runId: 'nope',
            expectedVersion: 0,
            decidedById: h.userA,
            items: [],
          })
        ).toEqual({ ok: false, reason: 'RUN_NOT_FOUND' });
      });

      it('skips what cannot be decided and writes the rest', async () => {
        const { runId, files, proposals } = await runWithFiles(4);
        await h.forceFileStatus(files[1].id, 'failed');
        const other = await runWithFiles(1);
        const result = await h.review.applyDecisions({
          runId,
          expectedVersion: 0,
          decidedById: h.userA,
          items: [
            item(proposals[0].fileId, proposals[0].proposalId),
            item(proposals[1].fileId, proposals[1].proposalId),
            item(randomUUID(), null),
            item(other.files[0].id, other.proposals[0].proposalId),
            item(proposals[2].fileId, randomUUID()),
          ],
        });
        expect(result).toEqual({
          ok: true,
          version: 1,
          written: 1,
          skipped: [
            { fileId: proposals[1].fileId, code: 'FILE_STATE' },
            expect.objectContaining({ code: 'FILE_NOT_FOUND' }),
            { fileId: other.files[0].id, code: 'FILE_NOT_FOUND' },
            { fileId: proposals[2].fileId, code: 'PROPOSAL_CHANGED' },
          ],
        });
        // nothing was written for the other run
        expect(await h.rawDecisions(other.runId)).toEqual([]);
        expect((await h.upload.getRun(other.runId))!.decisionsVersion).toBe(0);
      });

      it('does not raise the version or clear the hash when nothing is written', async () => {
        const { runId } = await runWithFiles(1);
        await h.setDryRunHash(runId, 'keep');
        const result = await h.review.applyDecisions({
          runId,
          expectedVersion: 0,
          decidedById: h.userA,
          items: [item(randomUUID(), null)],
        });
        expect(result).toMatchObject({ ok: true, version: 0, written: 0 });
        expect(await h.dryRunHash(runId)).toBe('keep');
      });

      it('keeps the history of the decisions of a file', async () => {
        const { runId, proposals } = await runWithFiles(1);
        const [p] = proposals;
        for (const [version, action] of [
          [0, 'accept'],
          [1, 'reject'],
          [2, 'defer'],
        ] as const) {
          const result = await h.review.applyDecisions({
            runId,
            expectedVersion: version,
            decidedById: h.userA,
            items: [item(p.fileId, p.proposalId, { action })],
          });
          expect(result).toMatchObject({ ok: true, version: version + 1 });
        }
        const rows = await h.rawDecisions(runId);
        expect(rows.map(r => [r.action, r.isCurrent, r.version])).toEqual([
          ['accept', false, 0],
          ['reject', false, 1],
          ['defer', true, 2],
        ]);
        const [record] = await h.review.listRecords(runId);
        expect(record.decision!.action).toBe('defer');
      });

      it('moves an unclear file to decided and leaves a decided one decided', async () => {
        const { runId, proposals } = await runWithFiles(2, {
          fileStatus: 'unclear',
        });
        await h.review.applyDecisions({
          runId,
          expectedVersion: 0,
          decidedById: h.userA,
          items: proposals.map(p => item(p.fileId, p.proposalId)),
        });
        const again = await h.review.applyDecisions({
          runId,
          expectedVersion: 1,
          decidedById: h.userA,
          items: [
            item(proposals[0].fileId, proposals[0].proposalId, {
              action: 'defer',
            }),
          ],
        });
        expect(again).toMatchObject({ ok: true, written: 1 });
        for (const r of await h.review.listRecords(runId))
          expect(r.file.status).toBe('decided');
      });

      it('writes a note and a choice of version', async () => {
        const { runId, proposals } = await runWithFiles(1);
        await h.review.applyDecisions({
          runId,
          expectedVersion: 0,
          decidedById: h.userA,
          items: [
            item(proposals[0].fileId, proposals[0].proposalId, {
              action: 'reject',
              dupChoice: 'skip',
              note: 'Fassung A gilt',
            }),
          ],
        });
        const [record] = await h.review.listRecords(runId);
        expect(record.decision).toMatchObject({
          action: 'reject',
          dupChoice: 'skip',
          note: 'Fassung A gilt',
        });
      });

      it('takes the last of two items for one file: one current decision, no error', async () => {
        const { runId, proposals } = await runWithFiles(1);
        const [p] = proposals;
        const result = await h.review.applyDecisions({
          runId,
          expectedVersion: 0,
          decidedById: h.userA,
          items: [
            item(p.fileId, p.proposalId, { action: 'accept' }),
            item(p.fileId, p.proposalId, { action: 'reject' }),
          ],
        });
        expect(result).toMatchObject({ ok: true, written: 1, version: 1 });
        const rows = await h.rawDecisions(runId);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ action: 'reject', isCurrent: true });
      });

      it('writes up to the size of a run in one call', async () => {
        const { runId, proposals } = await runWithFiles(60);
        const result = await h.review.applyDecisions({
          runId,
          expectedVersion: 0,
          decidedById: h.userA,
          items: proposals.map(p => item(p.fileId, p.proposalId)),
        });
        expect(result).toMatchObject({ ok: true, written: 60, version: 1 });
      });
    });

    describe('reopenRun', () => {
      it.each(['applied', 'failed'] as const)(
        'takes a run in the state %s back to review, raises the version and clears the hash',
        async status => {
          const { runId } = await runWithFiles(1, { status });
          await h.setDryRunHash(runId, 'hash-of-a-dry-run');
          const result = await h.review.reopenRun(runId);
          expect(result).toEqual({ ok: true, version: 1 });
          const run = (await h.upload.getRun(runId))!;
          expect(run.status).toBe('review');
          expect(run.decisionsVersion).toBe(1);
          expect(await h.dryRunHash(runId)).toBeNull();
        }
      );

      it.each(['draft', 'uploading', 'processing', 'review', 'applying', 'discarded'] as const)(
        'refuses a run in the state %s and changes nothing',
        async status => {
          const { runId } = await runWithFiles(1, { status });
          await h.setDryRunHash(runId, 'keep');
          expect(await h.review.reopenRun(runId)).toEqual({
            ok: false,
            reason: 'RUN_STATE',
            status,
          });
          expect((await h.upload.getRun(runId))!.decisionsVersion).toBe(0);
          expect(await h.dryRunHash(runId)).toBe('keep');
        }
      );

      it('does not know an unknown run, and a decision made on the old version is refused afterwards', async () => {
        expect(await h.review.reopenRun(randomUUID())).toEqual({ ok: false, reason: 'RUN_NOT_FOUND' });
        expect(await h.review.reopenRun('nope')).toEqual({ ok: false, reason: 'RUN_NOT_FOUND' });
        const { runId, proposals } = await runWithFiles(1, { status: 'applied' });
        await h.review.reopenRun(runId);
        const stale = await h.review.applyDecisions({
          runId,
          expectedVersion: 0,
          decidedById: h.userA,
          items: [item(proposals[0].fileId, proposals[0].proposalId)],
        });
        expect(stale).toEqual({ ok: false, reason: 'VERSION_CONFLICT', current: 1 });
      });

      it('lets only one of two calls at the same time pass', async () => {
        const { runId } = await runWithFiles(1, { status: 'applied' });
        const results = await Promise.all([h.review.reopenRun(runId), h.review.reopenRun(runId)]);
        expect(results.filter(r => r.ok)).toHaveLength(1);
        expect((await h.upload.getRun(runId))!.decisionsVersion).toBe(1);
      });
    });

    describe('runStats', () => {
      it('counts files and current decisions per run and names the creator', async () => {
        const a = await runWithFiles(3);
        const b = await runWithFiles(1, { user: h.userB });
        await h.review.applyDecisions({
          runId: a.runId,
          expectedVersion: 0,
          decidedById: h.userA,
          items: [item(a.proposals[0].fileId, a.proposals[0].proposalId)],
        });
        await h.review.applyDecisions({
          runId: a.runId,
          expectedVersion: 1,
          decidedById: h.userA,
          items: [
            item(a.proposals[0].fileId, a.proposals[0].proposalId, {
              action: 'defer',
            }),
          ],
        });
        const stats = await h.review.runStats([
          a.runId,
          b.runId,
          randomUUID(),
          'bad',
        ]);
        const byRun = new Map(stats.map(s => [s.runId, s]));
        expect(byRun.size).toBe(2);
        expect(byRun.get(a.runId)).toMatchObject({ files: 3, decided: 1 });
        expect(byRun.get(b.runId)).toMatchObject({ files: 1, decided: 0 });
        expect(await h.review.runStats([])).toEqual([]);
      });
    });

    describe('catalogComponents', () => {
      it('lists the components of the catalog with their enablers', async () => {
        await h.seedCatalog();
        const components = await h.review.catalogComponents(h.catalogId);
        const k1 = components.find(c => c.code === 'K1')!;
        expect(k1).toMatchObject({ kind: 'pflicht', phase: 1 });
        expect(k1.enablers.map(e => e.code)).toEqual(['K1-a', 'K1-b']);
        const k12 = components.find(c => c.code === 'K12')!;
        expect(k12).toMatchObject({ kind: 'wahl', phase: null, enablers: [] });
      });

      it('knows nothing of a catalog that does not exist', async () => {
        await h.seedCatalog();
        expect(await h.review.catalogComponents(randomUUID())).toEqual([]);
        expect(await h.review.catalogComponents('nope')).toEqual([]);
      });
    });
  });
}
