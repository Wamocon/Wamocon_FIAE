/**
 * HAI admin: the state of every speech provider of the voice assistant.
 *
 * GET /api/admin/hai/voice-status
 *   -> { providers: { soniox, haus, browser }, effective: { provider, chain } }
 *
 * Only the platform admin. Per provider: `status` (ready, not_configured,
 * disturbed) and `reason`, a stable code that the page turns into a sentence.
 * It says whether the key is set (yes or no) and, for Sokrates, whether the
 * server is reachable and offers the two audio models. It never returns a key,
 * an address, a model name or a voice.
 *
 * Sokrates is asked for its list of models (GET <base>/models). Some servers do
 * not list audio models there, then the page reports the model as not offered
 * although the audio endpoint may work. That check is for the admin only, the
 * chain of providers at run time does not depend on it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireSuperAdmin } from '@/lib/auth/session';
import {
  disturbedReason,
  providerStates,
  resolveChain,
  type ProviderState,
} from '@/lib/hai/voice/provider';
import { readVoiceSettings } from '@/lib/hai/voice/settingsStore';
import { loadSonioxConfig } from '@/lib/hai/voice/sonioxServer';
import {
  HAUS_ENV,
  hausConfigReason,
  hausModelStatus,
  loadHausConnection,
} from '@/lib/hai/voice/hausServer';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

export async function GET(req: NextRequest) {
  const me = await requireSuperAdmin(req);
  if (isErrorResponse(me)) return me;

  const env = process.env;
  const settings = await readVoiceSettings();
  const states = providerStates(env);
  const effective = resolveChain(settings, states);

  const soniox = loadSonioxConfig(env);
  const connection = loadHausConnection(env);
  const configReason = hausConfigReason(env);

  // Sokrates: configuration first, then the network check for the admin
  let haus: ProviderState = states.haus;
  let models = {
    reachable: null as boolean | null,
    sttOffered: null as boolean | null,
    ttsOffered: null as boolean | null,
  };
  if (!configReason) {
    const checked = await hausModelStatus(env);
    models = checked;
    if (!checked.reachable) {
      haus = { id: 'haus', status: 'disturbed', reason: 'UNREACHABLE' };
    } else if (checked.sttOffered === false || checked.ttsOffered === false) {
      haus = {
        id: 'haus',
        status: 'not_configured',
        reason: 'MODEL_NOT_OFFERED',
      };
    } else {
      const failure = disturbedReason('haus');
      haus = failure
        ? { id: 'haus', status: 'disturbed', reason: failure }
        : { id: 'haus', status: 'ready', reason: null };
    }
  }

  return NextResponse.json(
    {
      providers: {
        soniox: {
          ...states.soniox,
          keySet: soniox.ok || soniox.reason !== 'NO_KEY',
          region: soniox.ok ? soniox.config.region : null,
        },
        haus: {
          ...haus,
          keySet: connection.ok || connection.reason !== 'NO_KEY',
          sttModelSet: !!(env[HAUS_ENV.sttModel] ?? '').trim(),
          ttsModelSet: !!(env[HAUS_ENV.ttsModel] ?? '').trim(),
          ttsVoiceSet: !!(env[HAUS_ENV.ttsVoice] ?? '').trim(),
          reachable: models.reachable,
          sttOffered: models.sttOffered,
          ttsOffered: models.ttsOffered,
        },
        browser: states.browser,
      },
      effective,
    },
    { headers: PRIVATE }
  );
}
