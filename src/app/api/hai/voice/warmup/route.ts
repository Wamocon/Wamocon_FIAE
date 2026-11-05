/**
 * HAI.ai voice assistant: warm up the way to Sokrates before a question comes.
 *
 * POST /api/hai/voice/warmup  ->  { warmed: boolean, ms: number }
 *
 * The voice mode calls it when it starts and after every answer. It opens the
 * connection from this server to the own server (DNS, TLS, the gateway) with the
 * lightest call there is (GET <base>/models, the list of models, a health ping)
 * and a time limit, so the next chat call and the embedding call of the search do
 * not start cold. It carries no content, creates no session, stores nothing and
 * costs no external provider: only the own server is called, and only when the
 * chat or the embeddings run there. Providers outside (Gemini, OpenRouter,
 * Claude) are not called.
 *
 * Needs a signed-in user of an organization with the voice assistant on. A limit
 * of 20 calls per minute and person protects Sokrates from a loop.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse } from '@/lib/auth/session';
import { loadProviderConfig } from '@/lib/hai/providers/types';
import { PRIVATE, requireVoiceUser } from '@/lib/hai/voice/routeGuard';

const LIMIT = { bucket: 'warmup', limit: 20, windowMs: 60_000 };
/** The ping gives up after this long, a slow Sokrates must not hold the request. */
const WARMUP_TIMEOUT_MS = 3_000;

/** Does the chat or the search run on the own server (Sokrates) in the normal case? */
function usesSokrates(config: ReturnType<typeof loadProviderConfig>): boolean {
  return (
    config.chatProvider === 'openai-compatible' ||
    config.embeddingProvider === 'openai-compatible'
  );
}

export async function POST(req: NextRequest) {
  const me = await requireVoiceUser(req, LIMIT);
  if (isErrorResponse(me)) return me;

  const config = loadProviderConfig();
  const { baseUrl, apiKey } = config.openaiCompatible;
  if (!usesSokrates(config) || !baseUrl || !apiKey) {
    return NextResponse.json({ warmed: false, ms: 0 }, { headers: PRIVATE });
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WARMUP_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      cache: 'no-store',
    });
    // the answer is not read: only the connection counts
    void response.body?.cancel().catch(() => undefined);
    return NextResponse.json(
      { warmed: response.ok, ms: Date.now() - startedAt },
      { headers: PRIVATE }
    );
  } catch {
    // no answer in time or not reachable: nothing happens, the chat call asks itself
    return NextResponse.json(
      { warmed: false, ms: Date.now() - startedAt },
      { headers: PRIVATE }
    );
  } finally {
    clearTimeout(timer);
  }
}
