/**
 * Reads and writes the voice settings of the platform (table hai_settings, see
 * supabase/migrations/20261102000100_hai_settings.sql). Server only.
 *
 * Reading never fails the voice assistant: if the table does not exist yet (the
 * migration is applied by the release, Production gets it later) or the query
 * fails, the defaults apply. Writing does fail loudly, the admin must know that
 * the choice was not saved.
 *
 * @module lib/hai/voice/settingsStore
 */

import db from '@/db';
import { inArray, sql } from 'drizzle-orm';
import { haiSettings } from '@/db/migrations/schemas/schema';
import {
  DEFAULT_VOICE_SETTINGS,
  VOICE_SETTING_KEYS,
  parseVoiceSettings,
  type VoiceSettings,
} from './settings';

const KEYS = [VOICE_SETTING_KEYS.primary, VOICE_SETTING_KEYS.fallback];

export async function readVoiceSettings(): Promise<VoiceSettings> {
  try {
    const rows = await db
      .select({ key: haiSettings.key, value: haiSettings.value })
      .from(haiSettings)
      .where(inArray(haiSettings.key, KEYS));
    const stored: Record<string, unknown> = {};
    for (const row of rows) stored[row.key] = row.value;
    return parseVoiceSettings(stored);
  } catch {
    // no table yet, or the database does not answer: the defaults
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

/**
 * Saves both choices in ONE statement (upsert, so both change or none) and
 * remembers who saved them.
 */
export async function writeVoiceSettings(
  values: VoiceSettings,
  userId: string
): Promise<void> {
  await db
    .insert(haiSettings)
    .values([
      {
        key: VOICE_SETTING_KEYS.primary,
        value: values.primary,
        updatedBy: userId,
      },
      {
        key: VOICE_SETTING_KEYS.fallback,
        value: values.fallback,
        updatedBy: userId,
      },
    ])
    .onConflictDoUpdate({
      target: haiSettings.key,
      set: {
        value: sql`excluded.value`,
        updatedBy: userId,
        updatedAt: sql`now()`,
      },
    });
}
