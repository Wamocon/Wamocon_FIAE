/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import de from '@/locales/de.json';
import en from '@/locales/en.json';
import { consentParagraphs } from '@/lib/hai/voice/consentText';
import { VOICE_PROVIDERS } from '@/lib/hai/voice/settings';

// The consent text names who gets the audio: the effective provider and the one that
// takes over. Read with the real locale files, so a missing key shows up here.

const translator =
  (locale: Record<string, string>) =>
  (key: string, data?: Record<string, string | number>) => {
    let text = locale[key] ?? key;
    for (const [name, value] of Object.entries(data ?? {})) {
      text = text.replace(`{${name}}`, String(value));
    }
    return text;
  };
const tDe = translator(de as Record<string, string>);

describe('consent text', () => {
  it('for the browser alone it is the text as it always was', () => {
    expect(consentParagraphs(['browser'], null, tDe)).toEqual([
      de['hai.voice.consent.text'],
    ]);
  });

  it('Soniox: the audio goes to Soniox, the region is named, the browser is named as the replacement', () => {
    const text = consentParagraphs(['soniox', 'browser'], 'eu', tDe).join('\n');
    expect(text).toContain('Soniox');
    expect(text).toContain('Region: Europäische Union');
    expect(text).toContain('direkt von Ihrem Browser an Soniox gesendet');
    expect(text).toContain('nächste');
    expect(text).toContain('Ihrem Browser');
    expect(text).not.toContain('{region}');
  });

  it('Soniox: says that the microphone stays open for the whole conversation, how it ends and that the audio flows during that time', () => {
    const paragraphs = consentParagraphs(['soniox', 'browser'], 'eu', tDe);
    const live = paragraphs.find(p => p.includes('ganze Gespräch'));
    expect(live).toBe(de['hai.voice.consent.live']);
    expect(live).toContain('auch während die HAI antwortet');
    expect(live).toContain('unterbrechen');
    expect(live).toContain('laufend an Soniox gesendet');
    expect(live).toContain('Esc');
    expect(live).toContain('Gespräch beenden');
    // and the way out of the open microphone: push to talk
    expect(live).toContain('Drücken zum Sprechen');
    expect(live).toContain('von selbst ab');
    // the sentence comes after the one that names Soniox as the recipient
    expect(paragraphs.indexOf(live!)).toBeGreaterThan(
      paragraphs.findIndex(p => p.includes('direkt von Ihrem Browser'))
    );
  });

  it('the other providers and the browser alone do not mention an open microphone', () => {
    expect(
      consentParagraphs(['haus', 'browser'], null, tDe).join(' ')
    ).not.toContain('ganze Gespräch');
    expect(consentParagraphs(['browser'], null, tDe).join(' ')).not.toContain(
      'ganze Gespräch'
    );
  });

  it('names the region of the US when that is the region', () => {
    expect(consentParagraphs(['soniox'], 'us', tDe).join('\n')).toContain(
      'Region: USA'
    );
  });

  it('Sokrates: the audio stays in house, nothing is stored, no other service', () => {
    const text = consentParagraphs(['haus', 'browser'], null, tDe)[1];
    expect(text).toContain('Sokrates');
    expect(text).toContain('nicht gespeichert');
    expect(text).toContain('keinen anderen Dienst');
  });

  it('with the browser as the main provider, Sokrates is named as the replacement', () => {
    const paragraphs = consentParagraphs(['browser', 'haus'], null, tDe);
    expect(paragraphs[1]).toContain('Ihrem Browser');
    expect(paragraphs.join('\n')).toContain('Sokrates');
  });

  it('always says that no audio is stored and that the voice is not assessed', () => {
    for (const chain of [
      ['soniox', 'browser'],
      ['haus', 'browser'],
      ['soniox', 'haus', 'browser'],
    ] as const) {
      const first = consentParagraphs([...chain], 'eu', tDe)[0];
      expect(first).toContain('keinen Ton auf');
      expect(first).toContain('weder Ihre Stimme noch Ihre Stimmung');
    }
  });
});

describe('locale files of the voice providers', () => {
  const keys = (locale: Record<string, string>) =>
    Object.keys(locale).filter(
      key => key.startsWith('hai.voice.') || key.startsWith('admin.hai.')
    );

  it('German and English have the same keys', () => {
    expect(keys(en as Record<string, string>).sort()).toEqual(
      keys(de as Record<string, string>).sort()
    );
  });

  it('every provider has a consent text, a settings text and a privacy text, in both languages', () => {
    for (const locale of [de, en] as Array<Record<string, string>>) {
      for (const id of VOICE_PROVIDERS) {
        expect(locale[`hai.voice.consent.provider.${id}`]).toBeTruthy();
        expect(locale[`admin.hai.privacy.${id}`]).toBeTruthy();
        expect(locale[`admin.hai.provider.${id}`]).toBeTruthy();
      }
      expect(locale['hai.voice.provider.soniox']).toBeTruthy();
      expect(locale['hai.voice.provider.haus']).toBeTruthy();
    }
  });

  it('the German texts have no dash in the running text', () => {
    for (const key of keys(de as Record<string, string>)) {
      expect((de as Record<string, string>)[key]).not.toMatch(/ [-–—] /);
    }
  });
});
