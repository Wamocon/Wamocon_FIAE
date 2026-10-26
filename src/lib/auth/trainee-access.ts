/**
 * Responsibility check for trainer-level callers: may this session work with
 * the given trainee? One rule for every trainer route that is bound to a single
 * trainee (see resolveTraineeForRead in src/lib/auth/trainee-data-access.ts):
 *
 *  - the profile must be a trainee of the caller's organization (the super
 *    admin sees every organization),
 *  - and, if the caller chose an occupation with x-catalog, a trainee of that
 *    occupation.
 *
 * Everything else is answered with 404, the same answer as for a trainee that
 * does not exist, so nothing is leaked. Pass the request so the chosen
 * occupation is applied.
 */

import { NextResponse } from 'next/server';
import type { SessionUser } from '@/lib/auth/session';
import type { CatalogRequestLike } from '@/lib/catalog/scope';
import { resolveTraineeForRead } from '@/lib/auth/trainee-data-access';

export type TraineeAccess = { traineeId: string };

/**
 * Resolve the trainee and check that the session may access them. Returns the
 * trainee id, or a ready-made 404 (outside the scope or unknown), 403 (a
 * foreign occupation or no trainer level) or 503 (lookup failed) response.
 * Routes that look a record up first (an evaluation, a block, ...) pass the
 * message of their own 404, so a foreign record answers exactly like a missing
 * one.
 */
export async function requireTraineeAccess(
  session: SessionUser,
  traineeId: string,
  request: CatalogRequestLike = {},
  notFoundMessage = 'Not found'
): Promise<TraineeAccess | NextResponse> {
  const notFound = () =>
    NextResponse.json({ error: notFoundMessage }, { status: 404 });
  if (!session.isTrainerLevel) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!traineeId) return notFound();
  const resolved = await resolveTraineeForRead(session, request, traineeId);
  if (typeof resolved !== 'string') {
    // The record that was asked for (a report, a block, ...) is "not found"
    // in the words of the route, whether it is missing or foreign
    return resolved.status === 404 ? notFound() : resolved;
  }
  return { traineeId: resolved };
}
