/**
 * The consent text of the voice assistant for the providers that are in charge.
 * Pure: the translation function comes in, so the chat and the tests share it.
 *
 * The text names who gets the audio. For the browser alone it is the text as it
 * always was. For Soniox it says that the audio goes to the external service and
 * in which region, for Sokrates that it stays in house. If a second provider takes
 * over when the first one is not available, the text names that one too, because
 * the audio would go there.
 *
 * @module lib/hai/voice/consentText
 */

import type { VoiceProviderId } from './settings';

export type Translate = (
  key: string,
  data?: Record<string, string | number>
) => string;

export function consentParagraphs(
  chain: VoiceProviderId[],
  region: 'eu' | 'us' | null,
  t: Translate
): string[] {
  // the browser alone: the text as it always was
  if (chain.length === 1 && chain[0] === 'browser') {
    return [t('hai.voice.consent.text')];
  }
  const regionLabel = t(
    region === 'us' ? 'hai.voice.region.us' : 'hai.voice.region.eu'
  );
  const describe = (id: VoiceProviderId) =>
    t(`hai.voice.consent.provider.${id}`, { region: regionLabel });
  const [first, ...rest] = chain;
  const paragraphs = [t('hai.voice.consent.intro'), describe(first)];
  if (rest.length > 0) {
    paragraphs.push(t('hai.voice.consent.fallback'));
    for (const id of rest) paragraphs.push(describe(id));
  }
  return paragraphs;
}
