// In memory implementation of the two repositories of the HAI memory
// (src/lib/hai/memory/repo.ts). The real one is Drizzle (repoDb.ts), the tests of
// the logic work on this one, so a rule such as "only the owner reaches an entry"
// or "the key is unique per user and occupation" is proven by what the repository
// answers, not by a mock that ignores every WHERE clause.

import type {
  GlobalMemoryPatch,
  GlobalMemoryRepo,
  GlobalMemoryRow,
  NewGlobalMemory,
  NewUserMemory,
  UserMemoryPatch,
  UserMemoryRepo,
  UserMemoryRow,
} from '@/lib/hai/memory/repo';

let counter = 0;
const nextId = (prefix: string) => {
  counter += 1;
  const hex = counter.toString(16).padStart(12, '0');
  return `${prefix}-0000-4000-8000-${hex}`;
};

export interface FakeUserRepo extends UserMemoryRepo {
  rows: UserMemoryRow[];
  enabled: Map<string, boolean>;
  /** Sessions whose answers already carried a memory question. */
  askedSessions: Set<string>;
  calls: string[];
}

export function createUserRepo(seed: UserMemoryRow[] = []): FakeUserRepo {
  const rows: UserMemoryRow[] = [...seed];
  const enabled = new Map<string, boolean>();
  const askedSessions = new Set<string>();
  const calls: string[] = [];
  const track = (name: string) => calls.push(name);

  const repo: FakeUserRepo = {
    rows,
    enabled,
    askedSessions,
    calls,
    async list(userId, filter = {}) {
      track('list');
      return rows
        .filter(r => r.userId === userId)
        .filter(
          r => !filter.catalogId || r.trainingCatalogId === filter.catalogId
        )
        .filter(r => !filter.statuses || filter.statuses.includes(r.status))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async get(userId, id) {
      track('get');
      return rows.find(r => r.userId === userId && r.id === id) ?? null;
    },
    async findByKey(userId, catalogId, proposalKey) {
      track('findByKey');
      return (
        rows.find(
          r =>
            r.userId === userId &&
            r.trainingCatalogId === catalogId &&
            r.proposalKey === proposalKey
        ) ?? null
      );
    },
    async insert(row: NewUserMemory) {
      track('insert');
      const clash = rows.some(
        r =>
          r.userId === row.userId &&
          r.trainingCatalogId === row.trainingCatalogId &&
          r.proposalKey === row.proposalKey
      );
      if (clash) return null;
      const now = new Date();
      const saved: UserMemoryRow = {
        id: nextId('aaaaaaaa'),
        userId: row.userId,
        trainingCatalogId: row.trainingCatalogId,
        kind: row.kind,
        proposalKey: row.proposalKey,
        content: row.content,
        source: row.source,
        status: row.status,
        createdAt: now,
        updatedAt: now,
        confirmedAt: row.confirmedAt ?? null,
      };
      rows.push(saved);
      return saved;
    },
    async update(userId, id, patch: UserMemoryPatch) {
      track('update');
      const row = rows.find(r => r.userId === userId && r.id === id);
      if (!row) return null;
      if (patch.content !== undefined) row.content = patch.content;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.confirmedAt !== undefined) row.confirmedAt = patch.confirmedAt;
      row.updatedAt = new Date();
      return row;
    },
    async remove(userId, id) {
      track('remove');
      const index = rows.findIndex(r => r.userId === userId && r.id === id);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },
    async removeAll(userId, catalogId) {
      track('removeAll');
      let removed = 0;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const r = rows[i];
        if (
          r.userId === userId &&
          (!catalogId || r.trainingCatalogId === catalogId)
        ) {
          rows.splice(i, 1);
          removed += 1;
        }
      }
      return removed;
    },
    async countOpen(userId, catalogId) {
      track('countOpen');
      return rows.filter(
        r =>
          r.userId === userId &&
          r.trainingCatalogId === catalogId &&
          (r.status === 'active' || r.status === 'proposed')
      ).length;
    },
    async latestDerivedAt(userId, catalogId) {
      track('latestDerivedAt');
      const times = rows
        .filter(
          r =>
            r.userId === userId &&
            r.trainingCatalogId === catalogId &&
            r.source === 'derived'
        )
        .map(r => r.createdAt.getTime());
      return times.length ? new Date(Math.max(...times)) : null;
    },
    async getEnabled(userId) {
      track('getEnabled');
      return enabled.get(userId) ?? true;
    },
    async setEnabled(userId, value) {
      track('setEnabled');
      enabled.set(userId, value);
    },
    async sessionAskedMemory(sessionId) {
      track('sessionAskedMemory');
      return askedSessions.has(sessionId);
    },
  };
  return repo;
}

export interface FakeGlobalRepo extends GlobalMemoryRepo {
  rows: GlobalMemoryRow[];
}

export function createGlobalRepo(seed: GlobalMemoryRow[] = []): FakeGlobalRepo {
  const rows: GlobalMemoryRow[] = [...seed];
  return {
    rows,
    async list(filter = {}) {
      return rows.filter(
        r => !filter.statuses || filter.statuses.includes(r.status)
      );
    },
    async get(id) {
      return rows.find(r => r.id === id) ?? null;
    },
    async findByKey(catalogId, proposalKey) {
      return (
        rows.find(
          r =>
            r.trainingCatalogId === catalogId && r.proposalKey === proposalKey
        ) ?? null
      );
    },
    async insert(row: NewGlobalMemory) {
      if (
        row.proposalKey !== null &&
        rows.some(
          r =>
            r.trainingCatalogId === row.trainingCatalogId &&
            r.proposalKey === row.proposalKey
        )
      ) {
        return null;
      }
      const now = new Date();
      const saved: GlobalMemoryRow = {
        id: nextId('bbbbbbbb'),
        trainingCatalogId: row.trainingCatalogId,
        proposalKey: row.proposalKey,
        content: row.content,
        status: row.status,
        origin: row.origin,
        supportCount: row.supportCount,
        createdBy: row.createdBy,
        approvedBy: row.approvedBy ?? null,
        approvedAt: row.approvedAt ?? null,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(saved);
      return saved;
    },
    async update(id, patch: GlobalMemoryPatch) {
      const row = rows.find(r => r.id === id);
      if (!row) return null;
      if (patch.content !== undefined) row.content = patch.content;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.supportCount !== undefined)
        row.supportCount = patch.supportCount;
      if (patch.approvedBy !== undefined) row.approvedBy = patch.approvedBy;
      if (patch.approvedAt !== undefined) row.approvedAt = patch.approvedAt;
      row.updatedAt = new Date();
      return row;
    },
    async listApproved(catalogId) {
      return rows.filter(
        r =>
          r.status === 'approved' &&
          (r.trainingCatalogId === null || r.trainingCatalogId === catalogId)
      );
    },
  };
}

export function userRow(
  partial: Partial<UserMemoryRow> &
    Pick<UserMemoryRow, 'userId' | 'trainingCatalogId'>
): UserMemoryRow {
  const now = new Date('2026-11-03T10:00:00Z');
  return {
    id: nextId('cccccccc'),
    kind: 'preference',
    proposalKey: `pref.length.${counter}`,
    content: 'Bevorzugt kurze, knappe Antworten.',
    source: 'stated',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    confirmedAt: now,
    ...partial,
  };
}

export function globalRow(
  partial: Partial<GlobalMemoryRow> = {}
): GlobalMemoryRow {
  const now = new Date('2026-11-03T10:00:00Z');
  return {
    id: nextId('dddddddd'),
    trainingCatalogId: null,
    proposalKey: null,
    content: 'Erkläre Fachbegriffe kurz, bevor du sie benutzt.',
    status: 'approved',
    origin: 'manual',
    supportCount: 0,
    createdBy: 'admin-1',
    approvedBy: 'admin-1',
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}
