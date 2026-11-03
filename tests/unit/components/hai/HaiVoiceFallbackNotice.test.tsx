import { render, screen } from '@testing-library/react';
import { describe, it, expect, jest } from '@jest/globals';
import de from '@/locales/de.json';
import en from '@/locales/en.json';
import {
  HaiVoiceFallbackNotice,
  fallbackLines,
} from '@/components/hai/HaiVoiceFallbackNotice';
import type {
  FallbackReason,
  ProviderFallback,
} from '@/lib/hai/voice/client/fallback';

// The notice that makes a fallback visible: "I am listening through the browser" with the
// reason in a few words. German and English, every reason has its text.

jest.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) =>
      (require('@/locales/de.json') as Record<string, string>)[key] ?? key,
  }),
}));

const fb = (
  fn: 'stt' | 'tts',
  to: ProviderFallback['to'],
  reason: FallbackReason
): ProviderFallback => ({
  function: fn,
  from: 'soniox',
  to,
  reason,
  code: 'x',
});

const tDe = (key: string) => (de as Record<string, string>)[key] ?? key;

describe('fallbackLines', () => {
  it('names what runs now and why, per function', () => {
    const lines = fallbackLines(
      {
        stt: fb('stt', 'browser', 'key-refused'),
        tts: fb('tts', 'haus', 'limit'),
      },
      tDe
    );
    expect(lines).toEqual([
      {
        function: 'stt',
        text: 'Ich höre über den Browser.',
        reason: 'Der Dienst hat den Schlüssel abgelehnt.',
      },
      {
        function: 'tts',
        text: 'Ich spreche über den eigenen Server (Sokrates).',
        reason: 'Das Limit des Dienstes ist erreicht.',
      },
    ]);
  });

  it('nothing is left: says so', () => {
    const [line] = fallbackLines(
      { stt: fb('stt', null, 'network'), tts: null },
      tDe
    );
    expect(line.text).toBe('Die Spracherkennung ist gerade nicht verfügbar.');
    const [speech] = fallbackLines(
      { stt: null, tts: fb('tts', null, 'timeout') },
      tDe
    );
    expect(speech.text).toContain('die Antwort steht im Chat');
  });

  it('is empty as long as everything runs as planned', () => {
    expect(fallbackLines({ stt: null, tts: null }, tDe)).toEqual([]);
    expect(fallbackLines(null, tDe)).toEqual([]);
    expect(fallbackLines(undefined, tDe)).toEqual([]);
  });

  it('has a text in German and English for every reason and every target', () => {
    const reasons: FallbackReason[] = [
      'key-refused',
      'not-configured',
      'region',
      'organization',
      'limit',
      'timeout',
      'network',
      'unavailable',
    ];
    for (const locale of [de, en] as Array<Record<string, string>>) {
      for (const reason of reasons) {
        expect(locale[`hai.voice.fallback.reason.${reason}`]).toBeTruthy();
      }
      for (const fn of ['stt', 'tts']) {
        for (const to of ['browser', 'haus', 'none']) {
          expect(locale[`hai.voice.fallback.${fn}.${to}`]).toBeTruthy();
        }
      }
      expect(locale['hai.voice.phase.preparing']).toBeTruthy();
      expect(locale['hai.voice.wait']).toBeTruthy();
      expect(locale['hai.voice.micOpen']).toBeTruthy();
      expect(locale['hai.voice.consent.live']).toBeTruthy();
    }
  });

  it('writes no dash as a separator and real umlauts in the German texts', () => {
    const keys = Object.keys(de).filter(
      k =>
        k.startsWith('hai.voice.fallback.') ||
        k === 'hai.voice.consent.live' ||
        k === 'hai.voice.phase.preparing'
    );
    for (const key of keys) {
      const text = (de as Record<string, string>)[key];
      expect(text).not.toMatch(/ [-–—] /);
      expect(text).not.toMatch(/ae|oe|ue/i);
    }
  });
});

describe('HaiVoiceFallbackNotice', () => {
  it('renders nothing while everything runs as planned', () => {
    const { container } = render(
      <HaiVoiceFallbackNotice fallback={{ stt: null, tts: null }} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a status with what runs now and the reason', () => {
    render(
      <HaiVoiceFallbackNotice
        fallback={{ stt: fb('stt', 'browser', 'organization'), tts: null }}
      />
    );
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('Ich höre über den Browser.');
    expect(notice).toHaveTextContent(
      'Die Organisation hat keine Berechtigung für den Dienst.'
    );
  });

  it('shows both functions when both fell back', () => {
    render(
      <HaiVoiceFallbackNotice
        fallback={{
          stt: fb('stt', 'browser', 'key-refused'),
          tts: fb('tts', 'browser', 'key-refused'),
        }}
      />
    );
    expect(screen.getByRole('status').querySelectorAll('p')).toHaveLength(2);
  });
});
