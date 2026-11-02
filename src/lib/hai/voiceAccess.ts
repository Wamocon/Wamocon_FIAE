/**
 * Who may use the voice assistant of the HAI (day companion, WMCNL-2907).
 *
 * The switch is per organization (organizations.voice_assistant_enabled, default
 * off) and is decided on the server: the chat route refuses a spoken question of
 * an organization where it is off, whatever the browser sends. An inactive
 * organization never gets it. Speech itself stays in the browser (recognition
 * and reading aloud), the server sees only the text of the question, exactly as
 * in the typed chat, and stores no audio.
 *
 * @module lib/hai/voiceAccess
 */

import db from '@/db';
import { eq } from 'drizzle-orm';
import { organizations, profiles } from '@/db/migrations/schemas/schema';

export interface VoiceOrganizationRow {
  enabled: boolean | null | undefined;
  active: boolean | null | undefined;
}

/** Pure rule: only an active organization with the switch explicitly on. */
export function voiceAllowed(row: VoiceOrganizationRow | undefined): boolean {
  return !!row && row.enabled === true && row.active === true;
}

/** The switch of the organization of this person. Fails closed: no row, no voice. */
export async function isVoiceAssistantEnabled(
  userId: string
): Promise<boolean> {
  const rows = await db
    .select({
      enabled: organizations.voiceAssistantEnabled,
      active: organizations.isActive,
    })
    .from(profiles)
    .innerJoin(organizations, eq(organizations.id, profiles.organizationId))
    .where(eq(profiles.id, userId))
    .limit(1);
  return voiceAllowed(rows[0]);
}
