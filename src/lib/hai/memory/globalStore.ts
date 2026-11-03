/**
 * HAI memory, SHARED part (for all users): proposals, approval by a platform
 * admin, and what reaches the prompt.
 *
 * The rules this module keeps:
 *  - The HAI only PROPOSES (origin auto, from the counters of globalPropose.ts).
 *    Only an entry with the status `approved` acts. The admin routes (behind
 *    requireSuperAdmin) are the only callers that approve, reject, change or
 *    create an entry.
 *  - A proposal that was rejected stays rejected (one row per occupation and key),
 *    a new calculation only raises the count of an OPEN proposal and never
 *    reopens a decided one.
 *  - The text an admin types is checked like any text (text.ts); a text over 400
 *    characters is turned away.
 *  - An approved entry of occupation A is never loaded for occupation B: the
 *    prompt asks for exactly one occupation and gets that one plus the entries
 *    for all occupations (catalog null).
 *
 * @module lib/hai/memory/globalStore
 */

import { GLOBAL_MEMORY_MAX_CHARS } from './config';
import type { GlobalProposal } from './globalPropose';
import type { StoreResult } from './memoryStore';
import type { GlobalMemoryRepo, GlobalMemoryRow } from './repo';
import { checkMemoryContent } from './text';

export interface SuggestSummary {
  created: number;
  updated: number;
  kept: number;
}

/**
 * Stores the proposals of one calculation: a new key becomes a proposed row, an
 * open proposal gets its count updated, a decided one (approved or rejected) is
 * left as it is.
 */
export async function storeGlobalProposals(
  repo: GlobalMemoryRepo,
  proposals: readonly GlobalProposal[]
): Promise<SuggestSummary> {
  const summary: SuggestSummary = { created: 0, updated: 0, kept: 0 };
  for (const proposal of proposals) {
    const existing = await repo.findByKey(proposal.catalogId, proposal.key);
    if (!existing) {
      const saved = await repo.insert({
        trainingCatalogId: proposal.catalogId,
        proposalKey: proposal.key,
        content: proposal.content,
        status: 'proposed',
        origin: 'auto',
        supportCount: proposal.supportCount,
        createdBy: null,
      });
      if (saved) summary.created += 1;
      else summary.kept += 1;
      continue;
    }
    if (
      existing.status === 'proposed' &&
      existing.supportCount !== proposal.supportCount
    ) {
      await repo.update(existing.id, { supportCount: proposal.supportCount });
      summary.updated += 1;
    } else {
      summary.kept += 1;
    }
  }
  return summary;
}

/** An entry written by a platform admin (origin manual), approved at once or left open. */
export async function createManualGlobalMemory(
  repo: GlobalMemoryRepo,
  input: {
    content: string;
    catalogId: string | null;
    adminId: string;
    approve: boolean;
    now?: Date;
  }
): Promise<StoreResult<GlobalMemoryRow>> {
  if (!input.adminId) return { ok: false, error: 'invalid' };
  const checked = checkMemoryContent(input.content, GLOBAL_MEMORY_MAX_CHARS);
  if (!checked.ok) {
    return { ok: false, error: 'content', reason: checked.reason };
  }
  const now = input.now ?? new Date();
  const saved = await repo.insert({
    trainingCatalogId: input.catalogId,
    proposalKey: null,
    content: checked.content,
    status: input.approve ? 'approved' : 'proposed',
    origin: 'manual',
    supportCount: 0,
    createdBy: input.adminId,
    approvedBy: input.approve ? input.adminId : null,
    approvedAt: input.approve ? now : null,
  });
  return saved ? { ok: true, value: saved } : { ok: false, error: 'exists' };
}

/**
 * The decision of an admin on an entry: approve, reject or deactivate (the same as
 * reject for an approved entry), with an optional changed text (checked strictly,
 * it is a text of a person).
 */
export async function decideGlobalMemory(
  repo: GlobalMemoryRepo,
  input: {
    id: string;
    adminId: string;
    status?: 'approved' | 'rejected';
    content?: string;
    now?: Date;
  }
): Promise<StoreResult<GlobalMemoryRow>> {
  if (!input.adminId) return { ok: false, error: 'invalid' };
  if (input.status === undefined && input.content === undefined) {
    return { ok: false, error: 'invalid' };
  }
  const row = await repo.get(input.id);
  if (!row) return { ok: false, error: 'not_found' };

  let content: string | undefined;
  if (input.content !== undefined) {
    const checked = checkMemoryContent(input.content, GLOBAL_MEMORY_MAX_CHARS);
    if (!checked.ok) {
      return { ok: false, error: 'content', reason: checked.reason };
    }
    content = checked.content;
  }

  const now = input.now ?? new Date();
  const patch: Parameters<GlobalMemoryRepo['update']>[1] = {};
  if (content !== undefined) patch.content = content;
  if (input.status === 'approved') {
    // the text that is approved is the text that is checked: a stored text is checked again
    const text = checkMemoryContent(
      content ?? row.content,
      GLOBAL_MEMORY_MAX_CHARS,
      {
        derived: row.origin === 'auto' && content === undefined,
      }
    );
    if (!text.ok) {
      return { ok: false, error: 'content', reason: text.reason };
    }
    patch.status = 'approved';
    patch.approvedBy = input.adminId;
    patch.approvedAt = now;
  } else if (input.status === 'rejected') {
    patch.status = 'rejected';
    patch.approvedBy = null;
    patch.approvedAt = null;
  }
  const updated = await repo.update(row.id, patch);
  return updated
    ? { ok: true, value: updated }
    : { ok: false, error: 'not_found' };
}

/** The approved texts for ONE occupation (its own and those for all occupations). */
export async function loadApprovedGlobalTexts(
  repo: GlobalMemoryRepo,
  catalogId: string | null
): Promise<string[]> {
  const rows = await repo.listApproved(catalogId);
  return rows
    .filter(
      row =>
        row.status === 'approved' &&
        (row.trainingCatalogId === null || row.trainingCatalogId === catalogId)
    )
    .map(row => row.content);
}
