/**
 * HAI.ai voice assistant: is it available for the organization of the caller?
 *
 * GET /api/hai/voice -> { enabled: boolean }
 *
 * The browser asks once when the chat opens and shows the microphone button only
 * when the answer is true. The answer is a convenience for the interface; the
 * chat route checks the same switch again for every spoken question.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import { isVoiceAssistantEnabled } from '@/lib/hai/voiceAccess';

export async function GET(req: NextRequest) {
  const me = await requireUser(req);
  if (isErrorResponse(me)) return me;
  const enabled = await isVoiceAssistantEnabled(me.id);
  return NextResponse.json({ enabled });
}
