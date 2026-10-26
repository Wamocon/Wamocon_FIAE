/**
 * Session guard for the HAI routes that manage the shared knowledge base
 * (embed, sync, verify-pin). The rule itself lives in indexAccess.ts.
 *
 * Chat, session, insights and action only need `requireUser`: the person is
 * always the session, never a userId from the query or the body.
 */

import { NextResponse } from 'next/server';
import {
  isErrorResponse,
  requireTrainer,
  type RequestLike,
  type SessionUser,
} from '@/lib/auth/session';
import { canManageHaiIndex } from '@/lib/hai/indexAccess';

/**
 * A trainer-level session that may manage the shared index, or the ready-made
 * 401 / 403 response. The role comes from the database through the session.
 */
export async function requireHaiIndexManager(
  request: RequestLike
): Promise<SessionUser | NextResponse> {
  const session = await requireTrainer(request);
  if (isErrorResponse(session)) return session;
  if (!canManageHaiIndex(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return session;
}
