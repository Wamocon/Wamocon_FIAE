/**
 * Settings of the voice assistant that the platform admin changes in the HAI
 * admin page: which provider listens and speaks first, and which one takes over
 * when the first one is not set up or fails. Pure, no database and no server
 * imports, so the routes, the admin page and the tests share it. Reading and
 * writing the table is in settingsStore.ts.
 *
 * Providers:
 *   soniox   speech recognition and speech output of Soniox (external service,
 *            the browser talks to it with a short lived key from the server)
 *   haus     Sokrates, the own server (OpenAI compatible audio endpoints, the
 *            audio goes through the server of this application to Sokrates)
 *   browser  speech recognition and speech output of the browser itself
 *
 * @module lib/hai/voice/settings
 */

export const VOICE_PROVIDERS = ['soniox', 'haus', 'browser'] as const;
export type VoiceProviderId = (typeof VOICE_PROVIDERS)[number];

/**
 * The two things a provider does: listening (speech recognition, 'stt') and
 * speaking (speech output, 'tts'). A failure is kept per function.
 */
export const VOICE_FUNCTIONS = ['stt', 'tts'] as const;
export type VoiceFunction = (typeof VOICE_FUNCTIONS)[number];

/** The providers that may take over when the main provider fails. */
export const VOICE_FALLBACKS = ['haus', 'browser'] as const;
export type VoiceFallbackId = (typeof VOICE_FALLBACKS)[number];

export const VOICE_SETTING_KEYS = {
  primary: 'voice_provider_primary',
  fallback: 'voice_provider_fallback',
} as const;

export interface VoiceSettings {
  primary: VoiceProviderId;
  fallback: VoiceFallbackId;
}

/** Used when a row is missing (also when the table does not exist yet). */
export const DEFAULT_VOICE_SETTINGS: Readonly<VoiceSettings> = Object.freeze({
  primary: 'soniox',
  fallback: 'browser',
});

export function isVoiceProvider(value: unknown): value is VoiceProviderId {
  return (
    typeof value === 'string' &&
    (VOICE_PROVIDERS as readonly string[]).includes(value)
  );
}

export function isVoiceFallback(value: unknown): value is VoiceFallbackId {
  return (
    typeof value === 'string' &&
    (VOICE_FALLBACKS as readonly string[]).includes(value)
  );
}

/**
 * The effective settings from the stored values. A value that is missing or not
 * valid falls back to its default, so a damaged row never breaks the voice
 * assistant. The two choices must differ: if they do not, the fallback becomes
 * the browser (or Sokrates when the browser is the main provider).
 */
export function parseVoiceSettings(
  stored: Partial<Record<string, unknown>> | null | undefined
): VoiceSettings {
  const rawPrimary = stored?.[VOICE_SETTING_KEYS.primary];
  const rawFallback = stored?.[VOICE_SETTING_KEYS.fallback];
  const primary = isVoiceProvider(rawPrimary)
    ? rawPrimary
    : DEFAULT_VOICE_SETTINGS.primary;
  let fallback = isVoiceFallback(rawFallback)
    ? rawFallback
    : DEFAULT_VOICE_SETTINGS.fallback;
  if (fallback === primary)
    fallback = primary === 'browser' ? 'haus' : 'browser';
  return { primary, fallback };
}

export type SettingsErrorCode =
  | 'INVALID_BODY'
  | 'INVALID_PRIMARY'
  | 'INVALID_FALLBACK'
  | 'SAME_PROVIDER'
  | 'NOTHING_TO_UPDATE';

export type SettingsValidation =
  | { ok: true; values: VoiceSettings }
  | { ok: false; code: SettingsErrorCode };

/**
 * Validates the body of PUT /api/admin/hai/settings: `{ primary?, fallback? }`.
 * A field that is left out keeps the current value (`current`). Unknown fields
 * are refused, so a typo is not silently ignored. Both choices must differ.
 */
export function validateSettingsUpdate(
  body: unknown,
  current: VoiceSettings
): SettingsValidation {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, code: 'INVALID_BODY' };
  }
  const input = body as Record<string, unknown>;
  const unknown = Object.keys(input).filter(
    key => key !== 'primary' && key !== 'fallback'
  );
  if (unknown.length > 0) return { ok: false, code: 'INVALID_BODY' };
  if (input.primary === undefined && input.fallback === undefined) {
    return { ok: false, code: 'NOTHING_TO_UPDATE' };
  }
  let primary = current.primary;
  let fallback = current.fallback;
  if (input.primary !== undefined) {
    if (!isVoiceProvider(input.primary)) {
      return { ok: false, code: 'INVALID_PRIMARY' };
    }
    primary = input.primary;
  }
  if (input.fallback !== undefined) {
    if (!isVoiceFallback(input.fallback)) {
      return { ok: false, code: 'INVALID_FALLBACK' };
    }
    fallback = input.fallback;
  }
  if (primary === fallback) return { ok: false, code: 'SAME_PROVIDER' };
  return { ok: true, values: { primary, fallback } };
}
