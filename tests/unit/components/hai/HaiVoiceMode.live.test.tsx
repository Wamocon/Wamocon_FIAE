import React from 'react';
import { act, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, jest } from '@jest/globals';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { HaiVoiceModeOverlay } from '@/components/hai/voice-mode/HaiVoiceModeOverlay';
import {
  SessionContext,
  type HaiVoiceSession,
} from '@/components/hai/voice-mode/voiceSessionContext';
import type { ProviderFallback } from '@/lib/hai/voice/client/fallback';

// The voice mode (the figure in its basin) shows what the live mode gives it: the
// microphone is "open" only when it is, the open microphone is named while the HAI
// answers, a fallback is written next to the basin, an interruption by voice puts the
// figure from "speaks" back to "listens". The session is a double, the loop itself
// is tested in useHaiVoice.live.test.tsx.

type VoiceDouble = Record<string, unknown>;

function session(voice: VoiceDouble, extra: Partial<HaiVoiceSession> = {}) {
  const value = {
    voice: {
      phase: 'listening',
      error: null,
      interim: '',
      heard: '',
      spoken: [],
      level: null,
      consented: true,
      chain: ['soniox', 'browser'],
      region: 'eu',
      provider: 'soniox',
      localRecognition: false,
      micOpen: false,
      live: false,
      fallback: { stt: null, tts: null },
      start: jest.fn(),
      stop: jest.fn(),
      interrupt: jest.fn(),
      ...voice,
    },
    available: true,
    view: 'open',
    captions: true,
    setCaptions: jest.fn(),
    offer: null,
    openNavigation: jest.fn(),
    openMode: jest.fn(),
    closeMode: jest.fn(),
    muted: false,
    toggleMic: jest.fn(),
    acceptConsent: jest.fn(),
    ...extra,
  } as unknown as HaiVoiceSession;
  return value;
}

function Harness({ value }: { value: HaiVoiceSession }) {
  return (
    <SessionContext.Provider value={value}>
      <HaiVoiceModeOverlay />
    </SessionContext.Provider>
  );
}

const status = () => screen.getByTestId('hai-voice-status').textContent;
const mic = () => screen.getByTestId('hai-voice-mic');
const figureState = () =>
  screen.getByTestId('hai-voice-figure').getAttribute('data-state');

const fb = (
  fn: 'stt' | 'tts',
  to: ProviderFallback['to'],
  reason: ProviderFallback['reason']
): ProviderFallback => ({
  function: fn,
  from: 'soniox',
  to,
  reason,
  code: 'x',
});

describe('the voice mode with the live microphone', () => {
  it('does not say "listening" before the microphone is open', () => {
    renderWithProviders(<Harness value={session({ micOpen: false })} />);
    expect(status()).toBe('HAI richtet das Mikrofon ein');
    expect(mic().getAttribute('data-mic-open')).toBe('false');
    expect(mic().className).not.toContain('animate-pulse');
  });

  it('says "listening" and pulses the microphone symbol when it is open', () => {
    renderWithProviders(<Harness value={session({ micOpen: true })} />);
    expect(status()).toBe('HAI hört zu');
    expect(mic().getAttribute('data-mic-open')).toBe('true');
    expect(mic().className).toContain('animate-pulse');
  });

  it('names the open microphone while the HAI thinks and speaks (you can interrupt it)', () => {
    const view = renderWithProviders(
      <Harness value={session({ phase: 'thinking', micOpen: true })} />
    );
    expect(screen.getByTestId('hai-voice-mic-open')).toHaveTextContent(
      'Mikrofon offen'
    );
    expect(status()).toBe('HAI denkt nach');
    view.rerender(
      <Harness value={session({ phase: 'speaking', micOpen: true })} />
    );
    expect(screen.getByTestId('hai-voice-mic-open')).toBeInTheDocument();
    expect(status()).toBe('HAI spricht');
  });

  it('shows no open microphone where none is: a round while the HAI speaks, or off by the person', () => {
    const view = renderWithProviders(
      <Harness value={session({ phase: 'speaking', micOpen: false })} />
    );
    expect(screen.queryByTestId('hai-voice-mic-open')).toBeNull();
    view.rerender(
      <Harness
        value={session({ phase: 'speaking', micOpen: true }, { muted: true })}
      />
    );
    expect(screen.queryByTestId('hai-voice-mic-open')).toBeNull();
    expect(status()).toBe('Mikrofon ist aus');
    expect(mic().getAttribute('data-mic-open')).toBe('false');
    expect(mic().className).not.toContain('animate-pulse');
  });

  it('an interruption by voice turns the figure from "speaks" to "listens"', () => {
    const view = renderWithProviders(
      <Harness value={session({ phase: 'speaking', micOpen: true })} />
    );
    expect(figureState()).toBe('speaking');
    act(() => {
      view.rerender(
        <Harness value={session({ phase: 'listening', micOpen: true })} />
      );
    });
    expect(figureState()).toBe('listening');
    expect(status()).toBe('HAI hört zu');
  });

  it('a tap on the microphone button switches it off through the session', () => {
    const value = session({ micOpen: true });
    renderWithProviders(<Harness value={value} />);
    fireEvent.click(mic());
    expect(value.toggleMic).toHaveBeenCalledTimes(1);
  });

  it('the info says that the microphone stays open and that speaking interrupts, in live mode only', () => {
    const view = renderWithProviders(
      <Harness value={session({ micOpen: true, live: true })} />
    );
    fireEvent.click(screen.getByLabelText('Hinweise zum Sprachmodus'));
    expect(screen.getByTestId('hai-voice-info')).toHaveTextContent(
      'Das Mikrofon bleibt offen, solange der Sprachmodus läuft'
    );
    view.rerender(<Harness value={session({ micOpen: true, live: false })} />);
    expect(screen.getByTestId('hai-voice-info')).not.toHaveTextContent(
      'bleibt offen'
    );
  });
});

describe('the voice mode shows a fallback', () => {
  it('writes next to the figure what runs now and why', () => {
    renderWithProviders(
      <Harness
        value={session({
          fallback: { stt: fb('stt', 'browser', 'key-refused'), tts: null },
        })}
      />
    );
    const notice = screen.getByTestId('hai-voice-fallback');
    expect(notice).toHaveTextContent('Ich höre über den Browser.');
    expect(notice).toHaveTextContent('Der Dienst hat den Schlüssel abgelehnt.');
  });

  it('shows both functions, and nothing while everything runs as planned', () => {
    const view = renderWithProviders(<Harness value={session({})} />);
    expect(screen.queryByTestId('hai-voice-fallback')).toBeNull();
    view.rerender(
      <Harness
        value={session({
          fallback: {
            stt: fb('stt', 'browser', 'limit'),
            tts: fb('tts', 'haus', 'timeout'),
          },
        })}
      />
    );
    const notice = screen.getByTestId('hai-voice-fallback');
    expect(notice).toHaveTextContent('Ich höre über den Browser.');
    expect(notice).toHaveTextContent('Ich spreche über den eigenen Server');
    expect(notice).toHaveTextContent('Das Limit des Dienstes ist erreicht.');
  });
});
