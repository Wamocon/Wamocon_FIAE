/**
 * The one sentence that says where the audio goes right now (the provider that
 * listens and speaks). Shown in the settings of the microphone and in the voice
 * mode, so the person can see it any time, not only at the consent.
 */

import type { VoiceProviderId } from '../useHaiVoice';

interface ProviderInfo {
  provider: VoiceProviderId;
  localRecognition: boolean;
  region: 'eu' | 'us' | null;
}

export function providerStatement(
  voice: ProviderInfo,
  t: (key: string, data?: Record<string, string | number>) => string
): string {
  if (voice.provider === 'browser') {
    return voice.localRecognition ? t('hai.voice.local') : t('hai.voice.cloud');
  }
  return t(`hai.voice.provider.${voice.provider}`, {
    region: t(
      voice.region === 'us' ? 'hai.voice.region.us' : 'hai.voice.region.eu'
    ),
  });
}
