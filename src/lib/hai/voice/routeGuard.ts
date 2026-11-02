/**
 * What every voice route of the HAI checks first (server).
 *
 *  1. a signed-in, active user (requireUser),
 *  2. the switch of the organization (organizations.voice_assistant_enabled,
 *     decided on the server, fails closed): without it 403 VOICE_DISABLED, the
 *     same answer as the chat route gives a spoken question,
 *  3. a rate limit per person and route (in the memory of one instance, see
 *     src/lib/rate-limit.ts), so a script cannot burn the quota of Soniox or
 *     keep Sokrates busy.
 *
 * The answers never carry a key, an address or a value of a variable.
 *
 * @module lib/hai/voice/routeGuard
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  isErrorResponse,
  requireUser,
  type SessionUser,
} from '@/lib/auth/session';
import { isVoiceAssistantEnabled } from '@/lib/hai/voiceAccess';
import { checkRateLimit } from '@/lib/rate-limit';

export const PRIVATE = { 'Cache-Control': 'private, no-store' };

/** The one place that says "voice is off for this organization". */
export function voiceDisabledResponse(): NextResponse {
  return NextResponse.json(
    {
      error:
        'Der Sprachassistent ist für Ihre Organisation nicht freigeschaltet.',
      code: 'VOICE_DISABLED',
    },
    { status: 403, headers: PRIVATE }
  );
}

/** A refusal the client answers by falling back to the next provider. */
export function unavailableResponse(
  code: 'NOT_CONFIGURED' | 'UPSTREAM_FAILED',
  reason: string
): NextResponse {
  return NextResponse.json(
    { error: 'Speech provider not available', code, reason },
    { status: 503, headers: PRIVATE }
  );
}

export function rateLimitedResponse(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests', code: 'RATE_LIMITED' },
    {
      status: 429,
      headers: { ...PRIVATE, 'Retry-After': String(retryAfterSec) },
    }
  );
}

export interface VoiceLimit {
  /** Name of the route, part of the counter key. */
  bucket: string;
  limit: number;
  windowMs: number;
}

/**
 * The checks 1 to 3 above. Returns the user, or the ready-made refusal (401,
 * 403, 429). `limit` is left out for the routes that need no counter.
 */
export async function requireVoiceUser(
  req: NextRequest,
  limit?: VoiceLimit
): Promise<SessionUser | NextResponse> {
  const me = await requireUser(req);
  if (isErrorResponse(me)) return me;
  if (!(await isVoiceAssistantEnabled(me.id))) return voiceDisabledResponse();
  if (limit) {
    const rate = checkRateLimit(`hai-voice:${limit.bucket}:${me.id}`, {
      limit: limit.limit,
      windowMs: limit.windowMs,
    });
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSec);
  }
  return me;
}
