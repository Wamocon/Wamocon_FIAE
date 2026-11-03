/**
 * HAI.ai voice assistant: a short lived Soniox key for one websocket.
 *
 * POST /api/hai/voice/soniox-token  { purpose: 'stt' | 'tts' }
 *   -> { apiKey, wsUrl, expiresInSeconds, config }
 *
 * The browser talks to Soniox directly (speech recognition and speech output
 * over a websocket). The real key (SONIOX_API_KEY) stays on the server, the
 * browser only gets a key that lives 90 seconds and cannot do anything else
 * (https://docs.soniox.com/stt/api-reference/auth/create_temporary_api_key).
 * `config` is what the browser sends first on the websocket, decided here.
 *
 * 503 with a code and a reason when Soniox is not set up or does not answer:
 * the client then falls back to the next provider of the chain. The reasons are
 * stable codes, never a key or a message of Soniox.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse } from '@/lib/auth/session';
import {
  PRIVATE,
  requireVoiceUser,
  unavailableResponse,
} from '@/lib/hai/voice/routeGuard';
import {
  reportProviderFailure,
  reportProviderSuccess,
} from '@/lib/hai/voice/provider';
import {
  createSonioxToken,
  loadSonioxConfig,
} from '@/lib/hai/voice/sonioxServer';

// one round of listening or one answer per call, a generous limit per minute
const LIMIT = { bucket: 'soniox-token', limit: 40, windowMs: 60_000 };

export async function POST(req: NextRequest) {
  const me = await requireVoiceUser(req, LIMIT);
  if (isErrorResponse(me)) return me;

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const purpose = (body as { purpose?: unknown } | null)?.purpose;
  if (purpose !== 'stt' && purpose !== 'tts') {
    return NextResponse.json(
      { error: 'Invalid request', code: 'INVALID_REQUEST' },
      { status: 400, headers: PRIVATE }
    );
  }

  const config = loadSonioxConfig(process.env);
  if (!config.ok) return unavailableResponse('NOT_CONFIGURED', config.reason);

  // live: the recognition stays open over the whole conversation (longer session)
  const live =
    purpose === 'stt' && (body as { live?: unknown } | null)?.live === true;
  const result = await createSonioxToken(
    config.config,
    purpose,
    `hai-voice:${me.id}`,
    fetch,
    { live }
  );
  if (!result.ok) {
    // the failure counts for the function that was asked for: a refused key for
    // listening does not take speaking away
    reportProviderFailure('soniox', purpose, result.reason);
    // the status of Soniox is logged, never the request or a key
    console.warn(
      `HAI voice: Soniox key refused (${result.reason}${result.status ? `, HTTP ${result.status}` : ''})`
    );
    return unavailableResponse('UPSTREAM_FAILED', result.reason);
  }
  reportProviderSuccess('soniox', purpose);
  return NextResponse.json(result.grant, { headers: PRIVATE });
}
