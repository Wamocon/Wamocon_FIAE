/**
 * One entry of the HAI memory of the signed-in user.
 *
 * PATCH  /api/hai/memory/[id] { decision: 'confirm' | 'reject', content? } -> { entry }
 *        the answer to the question of the HAI (yes, no, change): `confirm` makes
 *        the entry active (with `content` it is the changed text), `reject` keeps
 *        it as rejected so the HAI never asks for it again
 * PATCH  /api/hai/memory/[id] { content } -> { entry }   (change the text of an own entry)
 * DELETE /api/hai/memory/[id] -> { deleted: true }
 *
 * The entry is looked up with the user id of the SESSION: the entry of another
 * person is answered with 404, exactly like one that does not exist. Every text is
 * checked (a wish for a solution, a role, another occupation, a link or an
 * instruction to the model is rejected with 422).
 */

import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import {
  decideUserMemory,
  editUserMemory,
  removeUserMemory,
} from '@/lib/hai/memory/memoryStore';
import { dbUserMemoryRepo } from '@/lib/hai/memory/repoDb';
import {
  PRIVATE,
  memoryOffResponse,
  storeErrorResponse,
  toPublicUserEntry,
} from '@/lib/hai/memory/routeHelpers';
import { notFoundUnlessUuid } from '@/lib/uuid';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const me = await requireUser(req);
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
  const { decision, content } = (body ?? {}) as {
    decision?: unknown;
    content?: unknown;
  };
  const bad = () =>
    NextResponse.json(
      { error: 'Invalid body', code: 'INVALID' },
      { status: 400, headers: PRIVATE }
    );
  if (content !== undefined && typeof content !== 'string') return bad();

  try {
    if (decision !== undefined) {
      if (decision !== 'confirm' && decision !== 'reject') return bad();
      if (decision === 'reject' && content !== undefined) return bad();
      const result = await decideUserMemory(dbUserMemoryRepo, {
        userId: me.id,
        id,
        decision,
        content: content as string | undefined,
      });
      return result.ok
        ? NextResponse.json(
            { entry: toPublicUserEntry(result.value) },
            { headers: PRIVATE }
          )
        : storeErrorResponse(result);
    }
    if (content === undefined) return bad();
    const result = await editUserMemory(dbUserMemoryRepo, {
      userId: me.id,
      id,
      content: content as string,
    });
    return result.ok
      ? NextResponse.json(
          { entry: toPublicUserEntry(result.value) },
          { headers: PRIVATE }
        )
      : storeErrorResponse(result);
  } catch (error) {
    console.error(
      'HAI memory: change failed:',
      error instanceof Error ? error.message : 'unknown error'
    );
    return NextResponse.json(
      { error: 'Entry could not be saved', code: 'SAVE_FAILED' },
      { status: 500, headers: PRIVATE }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const me = await requireUser(req);
  if (isErrorResponse(me)) return me;
  const { id } = await params;
  const notFound = notFoundUnlessUuid(id);
  if (notFound) return notFound;
  const off = memoryOffResponse();
  if (off) return off;

  try {
    const result = await removeUserMemory(dbUserMemoryRepo, me.id, id);
    return result.ok
      ? NextResponse.json({ deleted: true }, { headers: PRIVATE })
      : storeErrorResponse(result);
  } catch (error) {
    console.error(
      'HAI memory: delete failed:',
      error instanceof Error ? error.message : 'unknown error'
    );
    return NextResponse.json(
      { error: 'Entry could not be deleted', code: 'DELETE_FAILED' },
      { status: 500, headers: PRIVATE }
    );
  }
}
