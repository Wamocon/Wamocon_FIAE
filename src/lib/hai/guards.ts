/**
 * Session guard for the HAI routes that manage the shared knowledge base
 * (embed, sync, verify-pin). The rule itself lives in indexAccess.ts.
 * The routes that start work (embed POST and DELETE, sync POST) additionally
 * ask for the admin PIN proof, see requireHaiIndexAdmin.
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
import { ADMIN_PROOF_HEADER, verifyAdminProof } from '@/lib/auth/admin-proof';

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

/**
 * Like requireHaiIndexManager, and the person also has to show the proof of the
 * admin PIN (header x-admin-pin-proof, handed out by verify-pin). For the
 * routes that start expensive or dangerous work: reindex, delete embeddings,
 * sync. Order: session and role first (401 / 403), then the proof.
 *
 *  - no key on the server to check a proof: 503, the gate stays shut
 *  - no proof, a wrong, expired or foreign one: 403
 *
 * The proof is never logged.
 */
export async function requireHaiIndexAdmin(
  request: RequestLike
): Promise<SessionUser | NextResponse> {
  const session = await requireHaiIndexManager(request);
  if (isErrorResponse(session)) return session;

  const result = verifyAdminProof(
    request.headers.get(ADMIN_PROOF_HEADER),
    session.id,
    'hai-index-admin'
  );
  if (result === 'unconfigured') {
    console.error('[hai-admin-pin] no server key to check the PIN proof');
    return NextResponse.json(
      { error: 'Temporarily unavailable' },
      { status: 503 }
    );
  }
  if (result !== 'valid') {
    return NextResponse.json({ error: 'Admin PIN required' }, { status: 403 });
  }
  return session;
}
