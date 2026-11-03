/**
 * Shared HAI memory (for all users), admin side.
 *
 * GET  /api/admin/hai/memory -> { available, k, catalogs, entries }
 * POST /api/admin/hai/memory { content, catalogId: uuid | null, approve? } -> { entry }
 *
 * Only the platform admin (requireSuperAdmin). The list shows the shared entries:
 * proposals (with the NUMBER of users they rest on) and the approved and rejected
 * ones. It NEVER shows an entry of one person: the memory of a user lives in
 * another table that no admin route reads. A manual entry is approved at once by
 * default (`approve: false` leaves it as a proposal). While the switch HAI_MEMORY
 * is off, GET answers { available: false } and every write answers 404.
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { trainingCatalogs } from '@/db/migrations/schemas/schema';
import { isErrorResponse, requireSuperAdmin } from '@/lib/auth/session';
import { GLOBAL_MIN_SUPPORT_K, isMemoryEnabled } from '@/lib/hai/memory/config';
import { createManualGlobalMemory } from '@/lib/hai/memory/globalStore';
import { dbGlobalMemoryRepo } from '@/lib/hai/memory/repoDb';
import {
  PRIVATE,
  memoryOffResponse,
  storeErrorResponse,
  toPublicGlobalEntry,
} from '@/lib/hai/memory/routeHelpers';
import { badRequestUnlessUuid } from '@/lib/uuid';

export async function GET(req: NextRequest) {
  const me = await requireSuperAdmin(req);
  if (isErrorResponse(me)) return me;
  if (!isMemoryEnabled()) {
    return NextResponse.json({ available: false }, { headers: PRIVATE });
  }
  try {
    const [rows, catalogs] = await Promise.all([
      dbGlobalMemoryRepo.list(),
      db
        .select({
          id: trainingCatalogs.id,
          code: trainingCatalogs.code,
          title: trainingCatalogs.title,
        })
        .from(trainingCatalogs),
    ]);
    return NextResponse.json(
      {
        available: true,
        k: GLOBAL_MIN_SUPPORT_K,
        catalogs: catalogs.map(c => ({
          id: String(c.id),
          code: String(c.code),
          title: String(c.title),
        })),
        entries: rows.map(toPublicGlobalEntry),
      },
      { headers: PRIVATE }
    );
  } catch (error) {
    console.error(
      'HAI memory admin: list failed:',
      error instanceof Error ? error.message : 'unknown error'
    );
    return NextResponse.json(
      { error: 'Memory could not be loaded', code: 'LOAD_FAILED' },
      { status: 500, headers: PRIVATE }
    );
  }
}

export async function POST(req: NextRequest) {
  const me = await requireSuperAdmin(req);
  if (isErrorResponse(me)) return me;
  const off = memoryOffResponse();
  if (off) return off;

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const { content, catalogId, approve } = (body ?? {}) as {
    content?: unknown;
    catalogId?: unknown;
    approve?: unknown;
  };
  if (
    typeof content !== 'string' ||
    (approve !== undefined && typeof approve !== 'boolean')
  ) {
    return NextResponse.json(
      { error: 'Invalid body', code: 'INVALID' },
      { status: 400, headers: PRIVATE }
    );
  }
  if (catalogId !== null && catalogId !== undefined) {
    const bad = badRequestUnlessUuid('catalogId', catalogId);
    if (bad) return bad;
  }
  try {
    const result = await createManualGlobalMemory(dbGlobalMemoryRepo, {
      content,
      catalogId: typeof catalogId === 'string' ? catalogId : null,
      adminId: me.id,
      approve: approve !== false,
    });
    return result.ok
      ? NextResponse.json(
          { entry: toPublicGlobalEntry(result.value) },
          { status: 201, headers: PRIVATE }
        )
      : storeErrorResponse(result);
  } catch (error) {
    console.error(
      'HAI memory admin: create failed:',
      error instanceof Error ? error.message : 'unknown error'
    );
    return NextResponse.json(
      { error: 'Entry could not be saved', code: 'SAVE_FAILED' },
      { status: 500, headers: PRIVATE }
    );
  }
}
