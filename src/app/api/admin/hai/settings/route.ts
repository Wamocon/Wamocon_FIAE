/**
 * HAI admin settings: the speech provider of the voice assistant.
 *
 * GET /api/admin/hai/settings -> { settings: { primary, fallback }, options }
 * PUT /api/admin/hai/settings { primary?, fallback? } -> { settings }
 *
 * Only the platform admin (SUPER_ADMIN, or an ADMIN of the platform
 * organization). The values are validated (src/lib/hai/voice/settings.ts): the
 * main provider is soniox, haus or browser, the fallback is haus or browser and
 * the two must differ. A field that is left out keeps its value. The platform
 * admin who saved last is written to updated_by. The switch per organization
 * (voice_assistant_enabled) is not touched here and stays decisive.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireSuperAdmin } from '@/lib/auth/session';
import {
  VOICE_FALLBACKS,
  VOICE_PROVIDERS,
  validateSettingsUpdate,
} from '@/lib/hai/voice/settings';
import {
  readVoiceSettings,
  writeVoiceSettings,
} from '@/lib/hai/voice/settingsStore';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

const OPTIONS = { primary: VOICE_PROVIDERS, fallback: VOICE_FALLBACKS };

export async function GET(req: NextRequest) {
  const me = await requireSuperAdmin(req);
  if (isErrorResponse(me)) return me;
  const settings = await readVoiceSettings();
  return NextResponse.json(
    { settings, options: OPTIONS },
    { headers: PRIVATE }
  );
}

export async function PUT(req: NextRequest) {
  const me = await requireSuperAdmin(req);
  if (isErrorResponse(me)) return me;

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const current = await readVoiceSettings();
  const checked = validateSettingsUpdate(body, current);
  if (!checked.ok) {
    return NextResponse.json(
      { error: 'Invalid settings', code: checked.code },
      { status: 400, headers: PRIVATE }
    );
  }

  try {
    await writeVoiceSettings(checked.values, me.id);
  } catch (error) {
    // the table is missing (migration not applied yet) or the database fails
    console.error(
      'HAI settings: saving failed:',
      error instanceof Error ? error.message : 'unknown error'
    );
    return NextResponse.json(
      { error: 'Settings could not be saved', code: 'SAVE_FAILED' },
      { status: 500, headers: PRIVATE }
    );
  }
  return NextResponse.json({ settings: checked.values }, { headers: PRIVATE });
}
