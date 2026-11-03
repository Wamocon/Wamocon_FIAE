/**
 * HAI memory of the signed-in user (docs/hai-gedaechtnis.md).
 *
 * GET    /api/hai/memory -> { available, enabled, occupations: [{ id, code, title, entries }] }
 * PATCH  /api/hai/memory { enabled: boolean } -> { enabled }   (switch on or off)
 * DELETE /api/hai/memory[?catalogId=uuid] -> { deleted }        (all own entries)
 *
 * ONLY the user sees and changes the own entries: the person is the session, no
 * request names another user, and there is no route for trainers or admins. The
 * entries are listed per occupation. While the switch HAI_MEMORY is off, GET
 * answers { available: false } (the interface hides the section) and every write
 * answers 404.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import { isMemoryEnabled } from '@/lib/hai/memory/config';
import {
  listUserMemories,
  removeAllUserMemories,
} from '@/lib/hai/memory/memoryStore';
import { dbUserMemoryRepo } from '@/lib/hai/memory/repoDb';
import {
  PRIVATE,
  loadAllowedCatalogIds,
  loadOccupationLabels,
  memoryOffResponse,
  toPublicUserEntry,
} from '@/lib/hai/memory/routeHelpers';
import { isUuid } from '@/lib/uuid';

export async function GET(req: NextRequest) {
  const me = await requireUser(req);
  if (isErrorResponse(me)) return me;
  if (!isMemoryEnabled()) {
    return NextResponse.json({ available: false }, { headers: PRIVATE });
  }

  try {
    const [enabled, rows, allowed] = await Promise.all([
      dbUserMemoryRepo.getEnabled(me.id),
      listUserMemories(dbUserMemoryRepo, me.id),
      loadAllowedCatalogIds(me.id),
    ]);
    const labels = await loadOccupationLabels([
      ...allowed,
      ...rows.map(row => row.trainingCatalogId),
    ]);
    const catalogIds = Array.from(
      new Set([...allowed, ...rows.map(row => row.trainingCatalogId)])
    ).filter(id => labels.has(id));
    const occupations = catalogIds.map(id => ({
      ...labels.get(id)!,
      entries: rows
        .filter(row => row.trainingCatalogId === id)
        .map(toPublicUserEntry),
    }));
    return NextResponse.json(
      { available: true, enabled, occupations },
      { headers: PRIVATE }
    );
  } catch (error) {
    console.error(
      'HAI memory: list failed:',
      error instanceof Error ? error.message : 'unknown error'
    );
    return NextResponse.json(
      { error: 'Memory could not be loaded', code: 'LOAD_FAILED' },
      { status: 500, headers: PRIVATE }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const me = await requireUser(req);
  if (isErrorResponse(me)) return me;
  const off = memoryOffResponse();
  if (off) return off;

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const enabled = (body as { enabled?: unknown } | null)?.enabled;
  if (typeof enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'Invalid body', code: 'INVALID' },
      { status: 400, headers: PRIVATE }
    );
  }
  try {
    await dbUserMemoryRepo.setEnabled(me.id, enabled);
  } catch (error) {
    console.error(
      'HAI memory: switch failed:',
      error instanceof Error ? error.message : 'unknown error'
    );
    return NextResponse.json(
      { error: 'Switch could not be saved', code: 'SAVE_FAILED' },
      { status: 500, headers: PRIVATE }
    );
  }
  return NextResponse.json({ enabled }, { headers: PRIVATE });
}

export async function DELETE(req: NextRequest) {
  const me = await requireUser(req);
  if (isErrorResponse(me)) return me;
  const off = memoryOffResponse();
  if (off) return off;

  let catalogId: string | undefined;
  try {
    const raw = new URL(req.url).searchParams.get('catalogId');
    if (raw) {
      if (!isUuid(raw)) {
        return NextResponse.json(
          { error: 'Invalid occupation', code: 'INVALID' },
          { status: 400, headers: PRIVATE }
        );
      }
      catalogId = raw;
    }
  } catch {
    catalogId = undefined;
  }
  try {
    const deleted = await removeAllUserMemories(
      dbUserMemoryRepo,
      me.id,
      catalogId
    );
    return NextResponse.json({ deleted }, { headers: PRIVATE });
  } catch (error) {
    console.error(
      'HAI memory: delete all failed:',
      error instanceof Error ? error.message : 'unknown error'
    );
    return NextResponse.json(
      { error: 'Memory could not be deleted', code: 'DELETE_FAILED' },
      { status: 500, headers: PRIVATE }
    );
  }
}
