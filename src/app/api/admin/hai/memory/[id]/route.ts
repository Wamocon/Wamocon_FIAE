/**
 * One entry of the shared HAI memory, admin side.
 *
 * PATCH /api/admin/hai/memory/[id] { status?: 'approved' | 'rejected', content? } -> { entry }
 *   - approved: the entry acts from now on (who and when are written down)
 *   - rejected: a proposal is turned down, an approved entry is deactivated
 *   - content: the admin changes the text (checked like any text)
 *
 * Only the platform admin (requireSuperAdmin).
 */

import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireSuperAdmin } from '@/lib/auth/session';
import { decideGlobalMemory } from '@/lib/hai/memory/globalStore';
import { dbGlobalMemoryRepo } from '@/lib/hai/memory/repoDb';
import {
  PRIVATE,
  memoryOffResponse,
  storeErrorResponse,
  toPublicGlobalEntry,
} from '@/lib/hai/memory/routeHelpers';
import { notFoundUnlessUuid } from '@/lib/uuid';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const me = await requireSuperAdmin(req);
  if (isErrorResponse(me)) return me;
  const { id } = await params;
  const notFound = notFoundUnlessUuid(id);
  if (notFound) return notFound;
  const off = memoryOffResponse();
  if (off) return off;

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const { status, content } = (body ?? {}) as {
    status?: unknown;
    content?: unknown;
  };
  if (
    (status !== undefined && status !== 'approved' && status !== 'rejected') ||
    (content !== undefined && typeof content !== 'string') ||
    (status === undefined && content === undefined)
  ) {
    return NextResponse.json(
      { error: 'Invalid body', code: 'INVALID' },
      { status: 400, headers: PRIVATE }
    );
  }
  try {
    const result = await decideGlobalMemory(dbGlobalMemoryRepo, {
      id,
      adminId: me.id,
      status: status as 'approved' | 'rejected' | undefined,
      content: content as string | undefined,
    });
    return result.ok
      ? NextResponse.json(
          { entry: toPublicGlobalEntry(result.value) },
          { headers: PRIVATE }
        )
      : storeErrorResponse(result);
  } catch (error) {
    console.error(
      'HAI memory admin: change failed:',
      error instanceof Error ? error.message : 'unknown error'
    );
    return NextResponse.json(
      { error: 'Entry could not be saved', code: 'SAVE_FAILED' },
      { status: 500, headers: PRIVATE }
    );
  }
}
