/**
 * HAI.ai voice assistant: speech output on Sokrates (the own server).
 *
 * POST /api/hai/voice/haus/speech  { text }  ->  audio/wav
 *
 * The browser sends one sentence at a time. This route passes it on to the
 * OpenAI compatible endpoint of Sokrates (<base>/audio/speech) with the model and
 * voice of the server (HAI_TTS_HAUS_MODEL, HAI_TTS_HAUS_VOICE) and returns the
 * audio. The text is not stored and not logged. Limits: 1000 characters per call,
 * 120 calls per minute and person.
 *
 * 503 with a code and a reason when Sokrates is not set up (a variable is
 * missing), does not offer the model or does not answer: the client then falls
 * back to the next provider of the chain.
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
import { hausSpeech, loadHausTts } from '@/lib/hai/voice/hausServer';

const MAX_TEXT_CHARS = 1_000;
const LIMIT = { bucket: 'haus-speech', limit: 120, windowMs: 60_000 };

export async function POST(req: NextRequest) {
  const me = await requireVoiceUser(req, LIMIT);
  if (isErrorResponse(me)) return me;

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const text = (body as { text?: unknown } | null)?.text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'INVALID_REQUEST' },
      { status: 400, headers: PRIVATE }
    );
  }
  if (text.length > MAX_TEXT_CHARS) {
    return NextResponse.json(
      { error: 'Text too long', code: 'TEXT_TOO_LONG' },
      { status: 413, headers: PRIVATE }
    );
  }

  const tts = loadHausTts(process.env);
  if (!tts.ok) return unavailableResponse('NOT_CONFIGURED', tts.reason);

  const result = await hausSpeech(tts.config, text.trim());
  if (!result.ok) {
    reportProviderFailure('haus', 'tts', result.reason);
    console.warn(`HAI voice: Sokrates speech failed (${result.reason})`);
    return unavailableResponse(
      result.reason === 'MODEL_NOT_OFFERED'
        ? 'NOT_CONFIGURED'
        : 'UPSTREAM_FAILED',
      result.reason
    );
  }
  reportProviderSuccess('haus', 'tts');
  return new NextResponse(result.audio, {
    status: 200,
    headers: { ...PRIVATE, 'Content-Type': result.contentType },
  });
}
