import React, { useRef } from 'react';
import { act, render } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  defaultMouthSources,
  useMouthShape,
  type MouthSources,
} from '@/components/hai/voice-mode/useMouthShape';
import {
  getOutputTap,
  resetOutputLevel,
} from '@/lib/hai/voice/client/outputLevel';
import type {
  AnalyserLike,
  AudioContextLike,
} from '@/lib/hai/voice/client/audio';

// The hook that writes the shape of the mouth (data-mouth) for the HAI figure,
// per frame, without React state. Tested with a fake analyser node and a clock
// that is stepped by hand.

let renders = 0;
function Mouth({
  active,
  sources,
}: {
  active: boolean;
  sources?: MouthSources;
}) {
  renders += 1;
  const ref = useRef<HTMLDivElement>(null);
  useMouthShape(ref, active, sources);
  return (
    <div ref={ref} data-testid="mouth" data-mouth="open" data-mouth-source="" />
  );
}

/** A frame scheduler that runs only when the test says so. */
function manualFrames() {
  let pending: (() => void) | null = null;
  return {
    schedule: (callback: () => void) => {
      pending = callback;
      return () => {
        if (pending === callback) pending = null;
      };
    },
    step: () => {
      const run = pending;
      pending = null;
      run?.();
    },
    hasPending: () => pending !== null,
  };
}

function makeSources(overrides: Partial<MouthSources> = {}) {
  const frames = manualFrames();
  let clock = 0;
  const state = { level: null as number | null, browser: false };
  const sources: MouthSources = {
    readLevel: () => state.level,
    browserSpeaking: () => state.browser,
    random: () => 0.5,
    now: () => clock,
    schedule: frames.schedule,
    ...overrides,
  };
  return {
    sources,
    state,
    frames,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const mouth = () => document.querySelector('[data-testid="mouth"]')!;

beforeEach(() => {
  renders = 0;
});

describe('the mouth from the played audio (fake analyser)', () => {
  it('follows the loudness: closed, half open, open', () => {
    const t = makeSources();
    render(<Mouth active sources={t.sources} />);

    t.state.level = 0.5;
    act(() => t.frames.step());
    expect(mouth().getAttribute('data-mouth-source')).toBe('level');
    expect(['open', 'round']).toContain(mouth().getAttribute('data-mouth'));

    t.state.level = 0.1;
    act(() => t.frames.step());
    expect(mouth().getAttribute('data-mouth')).toBe('half');

    // silence between two sentences: the level is below the audible edge
    t.state.level = 0.005;
    act(() => t.frames.step());
    expect(mouth().getAttribute('data-mouth')).toBe('closed');
    expect(mouth().getAttribute('data-mouth-source')).toBe('none');
  });

  it('reads a real analyser node through the tap of the output (fake node)', () => {
    resetOutputLevel();
    const analyser: AnalyserLike & { block: number } = {
      fftSize: 2048,
      block: 0,
      getFloatTimeDomainData(array: Float32Array) {
        array.fill(this.block);
      },
    };
    const ctx = {
      createAnalyser: () => analyser,
    } as unknown as AudioContextLike;
    getOutputTap(ctx);

    const frames = manualFrames();
    const sources: MouthSources = {
      ...defaultMouthSources,
      schedule: frames.schedule,
    };
    render(<Mouth active sources={sources} />);

    analyser.block = 0.2; // loud speech
    act(() => frames.step());
    expect(mouth().getAttribute('data-mouth-source')).toBe('level');
    expect(['open', 'round']).toContain(mouth().getAttribute('data-mouth'));

    analyser.block = 0.02; // a quiet syllable
    act(() => frames.step());
    expect(mouth().getAttribute('data-mouth')).toBe('half');

    analyser.block = 0; // silence
    act(() => frames.step());
    expect(mouth().getAttribute('data-mouth')).toBe('closed');
    resetOutputLevel();
  });
});

describe('the mouth with the browser speech (no level)', () => {
  it('uses the rhythm while the browser speaks, and closes when it stops', () => {
    const t = makeSources();
    render(<Mouth active sources={t.sources} />);
    t.state.browser = true;
    const seen = new Set<string | null>();
    for (let i = 0; i < 40; i++) {
      t.advance(180);
      act(() => t.frames.step());
      seen.add(mouth().getAttribute('data-mouth'));
      expect(mouth().getAttribute('data-mouth-source')).toBe('rhythm');
    }
    // it really moves
    expect(seen.size).toBeGreaterThanOrEqual(3);

    t.state.browser = false;
    act(() => t.frames.step());
    expect(mouth().getAttribute('data-mouth')).toBe('closed');
    expect(mouth().getAttribute('data-mouth-source')).toBe('none');
  });

  it('prefers the real level over the rhythm when both exist', () => {
    const t = makeSources();
    render(<Mouth active sources={t.sources} />);
    t.state.browser = true;
    t.state.level = 0.3;
    act(() => t.frames.step());
    expect(mouth().getAttribute('data-mouth-source')).toBe('level');
  });
});

describe('the hook in general', () => {
  it('keeps the mouth closed and does not run frames while the HAI is not speaking', () => {
    const t = makeSources();
    t.state.level = 0.9;
    t.state.browser = true;
    render(<Mouth active={false} sources={t.sources} />);
    expect(mouth().getAttribute('data-mouth')).toBe('closed');
    expect(mouth().getAttribute('data-mouth-source')).toBe('none');
    expect(t.frames.hasPending()).toBe(false);
  });

  it('closes the mouth and stops the frames when the speech ends or the figure goes', () => {
    const t = makeSources();
    t.state.level = 0.5;
    const { rerender, unmount } = render(<Mouth active sources={t.sources} />);
    expect(t.frames.hasPending()).toBe(true);

    rerender(<Mouth active={false} sources={t.sources} />);
    expect(mouth().getAttribute('data-mouth')).toBe('closed');
    expect(t.frames.hasPending()).toBe(false);

    rerender(<Mouth active sources={t.sources} />);
    expect(t.frames.hasPending()).toBe(true);
    unmount();
    expect(t.frames.hasPending()).toBe(false);
  });

  it('writes an attribute only: React does not render again for a frame', () => {
    const t = makeSources();
    render(<Mouth active sources={t.sources} />);
    const before = renders;
    t.state.level = 0.5;
    for (let i = 0; i < 20; i++) act(() => t.frames.step());
    expect(renders).toBe(before);
  });
});

describe('the default sources', () => {
  const original = Object.getOwnPropertyDescriptor(window, 'speechSynthesis');
  afterEach(() => {
    if (original) Object.defineProperty(window, 'speechSynthesis', original);
    else Reflect.deleteProperty(window, 'speechSynthesis');
  });

  it('read the browser speech from speechSynthesis.speaking', () => {
    expect(defaultMouthSources.browserSpeaking()).toBe(false);
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speaking: true },
    });
    expect(defaultMouthSources.browserSpeaking()).toBe(true);
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speaking: false },
    });
    expect(defaultMouthSources.browserSpeaking()).toBe(false);
  });

  it('count time and schedule frames', () => {
    expect(typeof defaultMouthSources.now()).toBe('number');
    const cancel = defaultMouthSources.schedule(() => undefined);
    expect(typeof cancel).toBe('function');
    cancel();
  });
});
