/**
 * HAI memory of ONE user: read, propose, confirm, change, delete.
 *
 * The rules this module keeps (the repository only stores):
 *  - ONLY the owner reaches an entry. Every call carries the user id of the
 *    session, and the repository puts it into every WHERE clause. There is no
 *    function for trainers or admins.
 *  - An entry belongs to ONE occupation (training catalog). A new entry is only
 *    possible in an occupation the user has (`allowedCatalogIds`, from the catalog
 *    scope of the server). Reading for the prompt asks for exactly one catalog, so
 *    an entry of occupation A never appears for occupation B.
 *  - Nothing acts before the user said yes: a new entry starts as `proposed`, only
 *    `confirm` makes it `active`. A rejected proposal stays as `rejected` and is
 *    never offered again (the key is unique per user and occupation).
 *  - Every text is checked (text.ts) when it is created or changed: a wish for a
 *    solution, a role, another occupation, a link or an instruction to the model is
 *    discarded, a text over the limit is turned away.
 *
 * @module lib/hai/memory/memoryStore
 */

import { USER_MEMORY_MAX_CHARS, USER_MEMORY_MAX_ENTRIES } from './config';
import { dimensionOf } from './memoryDetect';
import { checkMemoryContent, type MemoryRejectReason } from './text';
import type {
  NewUserMemory,
  UserMemoryKind,
  UserMemoryRepo,
  UserMemoryRow,
  UserMemorySource,
} from './repo';

export type StoreError =
  | 'invalid'
  | 'occupation'
  | 'not_found'
  | 'exists'
  | 'limit'
  | 'state'
  | 'content';

export type StoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StoreError; reason?: MemoryRejectReason };

const KINDS: readonly UserMemoryKind[] = [
  'preference',
  'learning_style',
  'learning_state',
  'weakness',
];
const SOURCES: readonly UserMemorySource[] = ['stated', 'derived'];

/** Dimensions with ONE value: a new confirmed value replaces the old one. */
const EXCLUSIVE_DIMENSIONS = new Set([
  'pref.length',
  'pref.address',
  'style.input',
]);

/** Whether the entry came from a template and a topic (light check) and not from a person. */
export function isDerivedRow(
  row: Pick<UserMemoryRow, 'kind' | 'source'>
): boolean {
  return (
    row.source === 'derived' &&
    (row.kind === 'weakness' || row.kind === 'learning_state')
  );
}

export interface ProposeInput {
  userId: string;
  catalogId: string;
  /** The occupations of the user (catalog scope of the server). */
  allowedCatalogIds: readonly string[];
  kind: UserMemoryKind;
  key: string;
  content: string;
  source: UserMemorySource;
  /** Names of other occupations to keep out of the text (persona). */
  extraBlocked?: readonly string[];
}

/**
 * A new proposal (status proposed, no effect yet). Turned away when the
 * occupation is not one of the user, the text fails the check, the key exists in
 * any state (a rejected proposal never comes back) or the user holds too many
 * entries.
 */
export async function proposeUserMemory(
  repo: UserMemoryRepo,
  input: ProposeInput
): Promise<StoreResult<UserMemoryRow>> {
  if (
    !input.userId ||
    !KINDS.includes(input.kind) ||
    !SOURCES.includes(input.source) ||
    !input.key ||
    input.key.length > 120
  ) {
    return { ok: false, error: 'invalid' };
  }
  if (!input.allowedCatalogIds.includes(input.catalogId)) {
    return { ok: false, error: 'occupation' };
  }
  const derived = isDerivedRow({ kind: input.kind, source: input.source });
  const checked = checkMemoryContent(input.content, USER_MEMORY_MAX_CHARS, {
    derived,
    extraBlocked: input.extraBlocked,
  });
  if (!checked.ok) {
    return { ok: false, error: 'content', reason: checked.reason };
  }
  if (await repo.findByKey(input.userId, input.catalogId, input.key)) {
    return { ok: false, error: 'exists' };
  }
  if (
    (await repo.countOpen(input.userId, input.catalogId)) >=
    USER_MEMORY_MAX_ENTRIES
  ) {
    return { ok: false, error: 'limit' };
  }
  const row: NewUserMemory = {
    userId: input.userId,
    trainingCatalogId: input.catalogId,
    kind: input.kind,
    proposalKey: input.key,
    content: checked.content,
    source: input.source,
    status: 'proposed',
  };
  const saved = await repo.insert(row);
  if (!saved) return { ok: false, error: 'exists' };
  return { ok: true, value: saved };
}

/**
 * The answer of the user to a proposal. `confirm` (optionally with a changed
 * text, the "Ändern" of the card) makes it active, `reject` keeps it as rejected.
 * A text the user typed is checked like any new text.
 */
export async function decideUserMemory(
  repo: UserMemoryRepo,
  input: {
    userId: string;
    id: string;
    decision: 'confirm' | 'reject';
    content?: string;
    extraBlocked?: readonly string[];
    now?: Date;
  }
): Promise<StoreResult<UserMemoryRow>> {
  const row = await repo.get(input.userId, input.id);
  if (!row) return { ok: false, error: 'not_found' };

  if (input.decision === 'reject') {
    if (row.status === 'rejected') return { ok: true, value: row };
    if (row.status !== 'proposed') return { ok: false, error: 'state' };
    const updated = await repo.update(input.userId, row.id, {
      status: 'rejected',
      confirmedAt: null,
    });
    return updated
      ? { ok: true, value: updated }
      : { ok: false, error: 'not_found' };
  }

  if (row.status === 'active' && input.content === undefined) {
    return { ok: true, value: row };
  }
  if (row.status === 'rejected') return { ok: false, error: 'state' };

  // the user changed the text: it is a text of a person now, the strict check applies
  const changed = input.content !== undefined;
  const checked = checkMemoryContent(
    changed ? input.content : row.content,
    USER_MEMORY_MAX_CHARS,
    {
      derived: !changed && isDerivedRow(row),
      extraBlocked: input.extraBlocked,
    }
  );
  if (!checked.ok) {
    return { ok: false, error: 'content', reason: checked.reason };
  }
  const now = input.now ?? new Date();
  const updated = await repo.update(input.userId, row.id, {
    content: checked.content,
    status: 'active',
    confirmedAt: row.confirmedAt ?? now,
  });
  if (!updated) return { ok: false, error: 'not_found' };

  // a value with one choice (length, address, input) replaces the older ACTIVE
  // ones (an open proposal of the same kind stays, the person still has to answer it)
  const dimension = dimensionOf(row.proposalKey);
  if (EXCLUSIVE_DIMENSIONS.has(dimension)) {
    const others = await repo.list(input.userId, {
      catalogId: row.trainingCatalogId,
      statuses: ['active'],
    });
    for (const other of others) {
      if (other.id !== row.id && dimensionOf(other.proposalKey) === dimension) {
        await repo.remove(input.userId, other.id);
      }
    }
  }
  return { ok: true, value: updated };
}

/** The user changes the text of an own entry (a text of a person, strict check). */
export async function editUserMemory(
  repo: UserMemoryRepo,
  input: {
    userId: string;
    id: string;
    content: string;
    extraBlocked?: readonly string[];
  }
): Promise<StoreResult<UserMemoryRow>> {
  const row = await repo.get(input.userId, input.id);
  if (!row) return { ok: false, error: 'not_found' };
  if (row.status === 'rejected') return { ok: false, error: 'state' };
  const checked = checkMemoryContent(input.content, USER_MEMORY_MAX_CHARS, {
    extraBlocked: input.extraBlocked,
  });
  if (!checked.ok) {
    return { ok: false, error: 'content', reason: checked.reason };
  }
  const updated = await repo.update(input.userId, row.id, {
    content: checked.content,
  });
  return updated
    ? { ok: true, value: updated }
    : { ok: false, error: 'not_found' };
}

/** Deletes one own entry. */
export async function removeUserMemory(
  repo: UserMemoryRepo,
  userId: string,
  id: string
): Promise<StoreResult<true>> {
  return (await repo.remove(userId, id))
    ? { ok: true, value: true }
    : { ok: false, error: 'not_found' };
}

/** Deletes all own entries (of one occupation or of all), also the rejected ones. */
export async function removeAllUserMemories(
  repo: UserMemoryRepo,
  userId: string,
  catalogId?: string
): Promise<number> {
  return repo.removeAll(userId, catalogId);
}

/**
 * The entries the user sees: open proposals and active entries, newest first.
 * Rejected ones are only the memory of "never ask again", they are not shown.
 */
export async function listUserMemories(
  repo: UserMemoryRepo,
  userId: string,
  catalogId?: string
): Promise<UserMemoryRow[]> {
  return repo.list(userId, { catalogId, statuses: ['active', 'proposed'] });
}

/**
 * The confirmed entries of ONE occupation for the prompt, each checked again (a
 * row that reached the database by another way never gets into the prompt).
 */
export async function loadActiveUserMemories(
  repo: UserMemoryRepo,
  userId: string,
  catalogId: string
): Promise<UserMemoryRow[]> {
  const rows = await repo.list(userId, { catalogId, statuses: ['active'] });
  return rows.filter(
    row =>
      row.userId === userId &&
      row.trainingCatalogId === catalogId &&
      row.status === 'active' &&
      checkMemoryContent(row.content, USER_MEMORY_MAX_CHARS, {
        derived: isDerivedRow(row),
      }).ok
  );
}
