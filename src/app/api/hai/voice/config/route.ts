/**
 * HAI.ai voice assistant: which speech provider is in charge for this caller?
 *
 * GET /api/hai/voice/config -> { provider, chain, region }
 *
 * `provider` is the effective provider (the head of the chain), `chain` the
 * order in which the browser tries the providers (the browser itself is always
 * part of it), `region` is set when Soniox is in the chain ('eu' or 'us', for
 * the consent text). The answer never carries a key, an address or a model name.
 *
 * The choice of the platform admin (hai_settings) is combined with what the
 * server is set up for and with recent failures (src/lib/hai/voice/provider.ts).
 * Needs a signed-in user of an organization with the voice assistant switched on.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse } from '@/lib/auth/session';
import { PRIVATE, requireVoiceUser } from '@/lib/hai/voice/routeGuard';
import { providerStates, resolveChain } from '@/lib/hai/voice/provider';
import { readVoiceSettings } from '@/lib/hai/voice/settingsStore';
import { loadSonioxConfig } from '@/lib/hai/voice/sonioxServer';

export async function GET(req: NextRequest) {
  const me = await requireVoiceUser(req);
  if (isErrorResponse(me)) return me;

  const settings = await readVoiceSettings();
  const { provider, chain } = resolveChain(
    settings,
    providerStates(process.env)
  );
  const soniox = loadSonioxConfig(process.env);
  const region =
    chain.includes('soniox') && soniox.ok ? soniox.config.region : null;
  return NextResponse.json({ provider, chain, region }, { headers: PRIVATE });
}
