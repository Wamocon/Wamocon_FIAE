/**
 * HAI memory: what the API routes share (switch gate, the occupations of the
 * caller, the public shape of an entry, the mapping of a store error to HTTP).
 *
 * The person is ALWAYS the session user of the route, there is no id of a user in
 * any request of the memory (no path, query or body field names a person). The
 * occupations come from the catalog scope of the server.
 *
 * @module lib/hai/memory/routeHelpers
 */

import { inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import db from '@/db';
import { trainingCatalogs } from '@/db/migrations/schemas/schema';
import { getCatalogScopeForUserId } from '@/lib/catalog/scope';
import { isMemoryEnabled } from './config';
import type { StoreError, StoreResult } from './memoryStore';
import type { GlobalMemoryRow, UserMemoryRow } from './repo';

export const PRIVATE = { 'Cache-Control': 'private, no-store' };

/** 404 while the switch HAI_MEMORY is off: the feature does not exist then. */
export function memoryOffResponse(): NextResponse | null {
  return isMemoryEnabled()
    ? null
    : NextResponse.json(
        { error: 'Not found', code: 'MEMORY_OFF' },
        { status: 404, headers: PRIVATE }
      );
}

export interface OccupationLabel {
  id: string;
  code: string;
  title: string;
}

/** The labels of occupations by id (an unknown id is left out). */
export async function loadOccupationLabels(
  ids: readonly string[]
): Promise<Map<string, OccupationLabel>> {
  const unique = Array.from(new Set(ids.map(String)));
  if (unique.length === 0) return new Map();
  const rows = (await db
    .select({
      id: trainingCatalogs.id,
      code: trainingCatalogs.code,
      title: trainingCatalogs.title,
    })
    .from(trainingCatalogs)
    .where(inArray(trainingCatalogs.id, unique))) as Array<{
    id: string;
    code: string;
    title: string;
  }>;
  return new Map(
    rows.map(row => [
      String(row.id),
      { id: String(row.id), code: String(row.code), title: String(row.title) },
    ])
  );
}

/** The occupations of the caller (catalog scope of the server), empty when unknown. */
export async function loadAllowedCatalogIds(userId: string): Promise<string[]> {
  try {
    const scope = await getCatalogScopeForUserId(userId);
    return scope ? scope.allowedCatalogIds.map(String) : [];
  } catch {
    return [];
  }
}

/** An own entry as the browser gets it. */
export function toPublicUserEntry(row: UserMemoryRow) {
  return {
    id: row.id,
    catalogId: row.trainingCatalogId,
    kind: row.kind,
    source: row.source,
    status: row.status,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
  };
}

/** A shared entry as the admin page gets it (a count, never a person). */
export function toPublicGlobalEntry(row: GlobalMemoryRow) {
  return {
    id: row.id,
    catalogId: row.trainingCatalogId,
    content: row.content,
    status: row.status,
    origin: row.origin,
    supportCount: row.supportCount,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const STATUS: Record<StoreError, number> = {
  invalid: 400,
  occupation: 403,
  not_found: 404,
  exists: 409,
  limit: 409,
  state: 409,
  content: 422,
};

/** The HTTP answer of a failed store call (a stable code, never the text of a person). */
export function storeErrorResponse(
  failure: Extract<StoreResult<unknown>, { ok: false }>
): NextResponse {
  return NextResponse.json(
    {
      error: failure.error === 'not_found' ? 'Not found' : 'Rejected',
      code: failure.error.toUpperCase(),
      ...(failure.reason ? { reason: failure.reason } : {}),
    },
    { status: STATUS[failure.error], headers: PRIVATE }
  );
}
