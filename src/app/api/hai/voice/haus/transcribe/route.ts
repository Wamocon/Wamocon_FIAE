/**
 * HAI.ai voice assistant: speech recognition on Sokrates (the own server).
 *
 * POST /api/hai/voice/haus/transcribe   multipart/form-data, field `audio`
 *   -> { text }
 *
 * The browser records one utterance, this route passes it on to the OpenAI
 * compatible endpoint of Sokrates (<base>/audio/transcriptions) and returns the
 * text. The audio is not stored and not logged. Limits: 5 MB per utterance
 * (about a minute of compressed audio), 30 calls per minute and person.
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
import { hausTranscribe, loadHausStt } from '@/lib/hai/voice/hausServer';

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
// a little more than the file for the multipart envelope
const MAX_BODY_BYTES = MAX_AUDIO_BYTES + 64 * 1024;
const LIMIT = { bucket: 'haus-transcribe', limit: 30, windowMs: 60_000 };

const tooLarge = () =>
  NextResponse.json(
    { error: 'Audio too large', code: 'AUDIO_TOO_LARGE' },
    { status: 413, headers: PRIVATE }
  );
const invalid = () =>
  NextResponse.json(
    { error: 'Invalid request', code: 'INVALID_REQUEST' },
    { status: 400, headers: PRIVATE }
  );

/** A plain file name for the upload, taken from the type of the audio only. */
function fileNameFor(type: string): string {
  if (type.includes('webm')) return 'speech.webm';
  if (type.includes('ogg')) return 'speech.ogg';
  if (type.includes('mp4') || type.includes('aac')) return 'speech.mp4';
  if (type.includes('wav')) return 'speech.wav';
  return 'speech.webm';
}

export async function POST(req: NextRequest) {
  const me = await requireVoiceUser(req, LIMIT);
  if (isErrorResponse(me)) return me;

  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();

  const stt = loadHausStt(process.env);
  if (!stt.ok) return unavailableResponse('NOT_CONFIGURED', stt.reason);

  let audio: FormDataEntryValue | null = null;
  try {
    const form = await req.formData();
    audio = form.get('audio');
  } catch {
    return invalid();
  }
  if (!audio || typeof audio === 'string') return invalid();
  if (audio.size === 0) return invalid();
  if (audio.size > MAX_AUDIO_BYTES) return tooLarge();

  const result = await hausTranscribe(
    stt.config,
    audio,
    fileNameFor(audio.type)
  );
  if (!result.ok) {
    reportProviderFailure('haus', 'stt', result.reason);
    console.warn(`HAI voice: Sokrates recognition failed (${result.reason})`);
    return unavailableResponse(
      result.reason === 'MODEL_NOT_OFFERED'
        ? 'NOT_CONFIGURED'
        : 'UPSTREAM_FAILED',
      result.reason
    );
  }
  reportProviderSuccess('haus', 'stt');
  return NextResponse.json({ text: result.text }, { headers: PRIVATE });
}
