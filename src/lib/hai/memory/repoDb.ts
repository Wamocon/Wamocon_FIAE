/**
 * HAI memory: the Drizzle implementation of the two repositories (repo.ts).
 *
 * This is the ONLY file that reads or writes hai_user_memories (guarded by
 * tests/unit/hai/memory/access.static.test.ts): no route, page or script of a
 * trainer or admin queries the table. Every query on it carries the user id of the
 * owner in its WHERE clause. The two aggregate queries over several users live in
 * globalData.ts and return counts only.
 *
 * @module lib/hai/memory/repoDb
 */

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import db from '@/db';
import {
  haiChatMessages,
  haiGlobalMemories,
  haiUserMemories,
  haiUserMemorySettings,
} from '@/db/migrations/schemas/schema';
import type {
  GlobalMemoryRepo,
  GlobalMemoryRow,
  UserMemoryRepo,
  UserMemoryRow,
} from './repo';

function toUserRow(row: typeof haiUserMemories.$inferSelect): UserMemoryRow {
  return {
    id: String(row.id),
    userId: String(row.userId),
    trainingCatalogId: String(row.trainingCatalogId),
    kind: row.kind as UserMemoryRow['kind'],
    proposalKey: row.proposalKey,
    content: row.content,
    source: row.source as UserMemoryRow['source'],
    status: row.status as UserMemoryRow['status'],
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    confirmedAt: row.confirmedAt ? new Date(row.confirmedAt) : null,
  };
}

function toGlobalRow(
  row: typeof haiGlobalMemories.$inferSelect
): GlobalMemoryRow {
  return {
    id: String(row.id),
    trainingCatalogId: row.trainingCatalogId
      ? String(row.trainingCatalogId)
      : null,
    proposalKey: row.proposalKey,
    content: row.content,
    status: row.status as GlobalMemoryRow['status'],
    origin: row.origin as GlobalMemoryRow['origin'],
    supportCount: Number(row.supportCount),
    createdBy: row.createdBy ? String(row.createdBy) : null,
    approvedBy: row.approvedBy ? String(row.approvedBy) : null,
    approvedAt: row.approvedAt ? new Date(row.approvedAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export const dbUserMemoryRepo: UserMemoryRepo = {
  async list(userId, filter = {}) {
    const conditions = [eq(haiUserMemories.userId, userId)];
    if (filter.catalogId) {
      conditions.push(eq(haiUserMemories.trainingCatalogId, filter.catalogId));
    }
    if (filter.statuses && filter.statuses.length > 0) {
      conditions.push(inArray(haiUserMemories.status, [...filter.statuses]));
    }
    const rows = await db
      .select()
      .from(haiUserMemories)
      .where(and(...conditions))
      .orderBy(desc(haiUserMemories.createdAt));
    return rows.map(toUserRow);
  },

  async get(userId, id) {
    const [row] = await db
      .select()
      .from(haiUserMemories)
      .where(
        and(eq(haiUserMemories.userId, userId), eq(haiUserMemories.id, id))
      )
      .limit(1);
    return row ? toUserRow(row) : null;
  },

  async findByKey(userId, catalogId, proposalKey) {
    const [row] = await db
      .select()
      .from(haiUserMemories)
      .where(
        and(
          eq(haiUserMemories.userId, userId),
          eq(haiUserMemories.trainingCatalogId, catalogId),
          eq(haiUserMemories.proposalKey, proposalKey)
        )
      )
      .limit(1);
    return row ? toUserRow(row) : null;
  },

  async insert(row) {
    const [saved] = await db
      .insert(haiUserMemories)
      .values({
        userId: row.userId,
        trainingCatalogId: row.trainingCatalogId,
        kind: row.kind,
        proposalKey: row.proposalKey,
        content: row.content,
        source: row.source,
        status: row.status,
        confirmedAt: row.confirmedAt ?? null,
      })
      .onConflictDoNothing()
      .returning();
    return saved ? toUserRow(saved) : null;
  },

  async update(userId, id, patch) {
    const [saved] = await db
      .update(haiUserMemories)
      .set({
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.confirmedAt !== undefined
          ? { confirmedAt: patch.confirmedAt }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(eq(haiUserMemories.userId, userId), eq(haiUserMemories.id, id))
      )
      .returning();
    return saved ? toUserRow(saved) : null;
  },

  async remove(userId, id) {
    const removed = await db
      .delete(haiUserMemories)
      .where(
        and(eq(haiUserMemories.userId, userId), eq(haiUserMemories.id, id))
      )
      .returning({ id: haiUserMemories.id });
    return removed.length > 0;
  },

  async removeAll(userId, catalogId) {
    const removed = await db
      .delete(haiUserMemories)
      .where(
        catalogId
          ? and(
              eq(haiUserMemories.userId, userId),
              eq(haiUserMemories.trainingCatalogId, catalogId)
            )
          : eq(haiUserMemories.userId, userId)
      )
      .returning({ id: haiUserMemories.id });
    return removed.length;
  },

  async countOpen(userId, catalogId) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(haiUserMemories)
      .where(
        and(
          eq(haiUserMemories.userId, userId),
          eq(haiUserMemories.trainingCatalogId, catalogId),
          inArray(haiUserMemories.status, ['active', 'proposed'])
        )
      );
    return Number(row?.n ?? 0);
  },

  async latestDerivedAt(userId, catalogId) {
    const [row] = await db
      .select({ latest: sql<string | null>`max(${haiUserMemories.createdAt})` })
      .from(haiUserMemories)
      .where(
        and(
          eq(haiUserMemories.userId, userId),
          eq(haiUserMemories.trainingCatalogId, catalogId),
          eq(haiUserMemories.source, 'derived')
        )
      );
    return row?.latest ? new Date(row.latest) : null;
  },

  async getEnabled(userId) {
    const [row] = await db
      .select({ enabled: haiUserMemorySettings.enabled })
      .from(haiUserMemorySettings)
      .where(eq(haiUserMemorySettings.userId, userId))
      .limit(1);
    return row ? row.enabled : true;
  },

  async setEnabled(userId, enabled) {
    await db
      .insert(haiUserMemorySettings)
      .values({ userId, enabled })
      .onConflictDoUpdate({
        target: haiUserMemorySettings.userId,
        set: { enabled, updatedAt: new Date() },
      });
  },

  async sessionAskedMemory(sessionId) {
    try {
      const rows = await db
        .select({ id: haiChatMessages.id })
        .from(haiChatMessages)
        .where(
          and(
            eq(haiChatMessages.sessionId, sessionId),
            sql`${haiChatMessages.metadata}->>'memoryProposalId' is not null`
          )
        )
        .limit(1);
      return rows.length > 0;
    } catch {
      // not sure: count it as asked, so nothing is proposed
      return true;
    }
  },
};

export const dbGlobalMemoryRepo: GlobalMemoryRepo = {
  async list(filter = {}) {
    const rows = await db
      .select()
      .from(haiGlobalMemories)
      .where(
        filter.statuses && filter.statuses.length > 0
          ? inArray(haiGlobalMemories.status, [...filter.statuses])
          : undefined
      )
      .orderBy(desc(haiGlobalMemories.createdAt));
    return rows.map(toGlobalRow);
  },

  async get(id) {
    const [row] = await db
      .select()
      .from(haiGlobalMemories)
      .where(eq(haiGlobalMemories.id, id))
      .limit(1);
    return row ? toGlobalRow(row) : null;
  },

  async findByKey(catalogId, proposalKey) {
    const [row] = await db
      .select()
      .from(haiGlobalMemories)
      .where(
        and(
          eq(haiGlobalMemories.proposalKey, proposalKey),
          catalogId === null
            ? isNull(haiGlobalMemories.trainingCatalogId)
            : eq(haiGlobalMemories.trainingCatalogId, catalogId)
        )
      )
      .limit(1);
    return row ? toGlobalRow(row) : null;
  },

  async insert(row) {
    const [saved] = await db
      .insert(haiGlobalMemories)
      .values({
        trainingCatalogId: row.trainingCatalogId,
        proposalKey: row.proposalKey,
        content: row.content,
        status: row.status,
        origin: row.origin,
        supportCount: row.supportCount,
        createdBy: row.createdBy,
        approvedBy: row.approvedBy ?? null,
        approvedAt: row.approvedAt ?? null,
      })
      .onConflictDoNothing()
      .returning();
    return saved ? toGlobalRow(saved) : null;
  },

  async update(id, patch) {
    const [saved] = await db
      .update(haiGlobalMemories)
      .set({
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.supportCount !== undefined
          ? { supportCount: patch.supportCount }
          : {}),
        ...(patch.approvedBy !== undefined
          ? { approvedBy: patch.approvedBy }
          : {}),
        ...(patch.approvedAt !== undefined
          ? { approvedAt: patch.approvedAt }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(haiGlobalMemories.id, id))
      .returning();
    return saved ? toGlobalRow(saved) : null;
  },

  async listApproved(catalogId) {
    const rows = await db
      .select()
      .from(haiGlobalMemories)
      .where(
        and(
          eq(haiGlobalMemories.status, 'approved'),
          catalogId === null
            ? isNull(haiGlobalMemories.trainingCatalogId)
            : sql`(${haiGlobalMemories.trainingCatalogId} = ${catalogId} or ${haiGlobalMemories.trainingCatalogId} is null)`
        )
      )
      .orderBy(desc(haiGlobalMemories.approvedAt));
    return rows.map(toGlobalRow);
  },
};
