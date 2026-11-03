import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, it, expect, afterEach, jest } from '@jest/globals';
import {
  HaiCharacter,
  DIVE_MS,
  RISE_MS,
  type CharacterState,
} from '@/components/hai/voice-mode/HaiCharacter';
import type { MouthSources } from '@/components/hai/voice-mode/useMouthShape';

// The HAI figure: a cartoon shark with head, arms, hands, body and legs, in a
// round basin of water. The look of each state is carried by data attributes.
// The figure is decoration (aria-hidden), the voice mode writes the state as text.

const originalMatchMedia = window.matchMedia;

function preferReducedMotion(reduce: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: originalMatchMedia,
  });
});

const figure = () => screen.getByTestId('hai-character');

describe('the parts of the figure', () => {
  it('has a head, eyes, a dorsal fin, arms with hands, a body and legs with feet', () => {
    render(<HaiCharacter state="waiting" />);
    const root = figure();
    // everything is one SVG, no picture file
    expect(root.querySelector('svg')).not.toBeNull();
    expect(root.querySelector('img')).toBeNull();

    // the figure is drawn twice (above and below the water line): look at the first
    const above = root.querySelector('[data-copy="above"]')!;
    expect(above.querySelector('.hf-head')).not.toBeNull();
    expect(above.querySelectorAll('[data-eye]')).toHaveLength(2);
    expect(above.querySelectorAll('.hf-fin').length).toBeGreaterThanOrEqual(2);
    expect(above.querySelector('.hf-belly')).not.toBeNull();
    const arms = Array.from(above.querySelectorAll('[data-arm]')).map(a =>
      a.getAttribute('data-arm')
    );
    expect(arms).toEqual(['left', 'right']);
    for (const arm of Array.from(above.querySelectorAll('[data-arm]'))) {
      expect(arm.querySelector('[data-segment="upper"]')).not.toBeNull();
      expect(arm.querySelector('[data-segment="fore"]')).not.toBeNull();
      expect(arm.querySelector('[data-segment="hand"]')).not.toBeNull();
    }
    const legs = above.querySelector('[data-part="legs"]')!;
    expect(legs.querySelectorAll('.hf-limb')).toHaveLength(2);
    expect(legs.querySelector('.hf-foot-left')).not.toBeNull();
    expect(legs.querySelector('.hf-foot-right')).not.toBeNull();
  });

  it('stands in a round basin: water, waves, ripples, and a copy of the figure under the water line', () => {
    render(<HaiCharacter state="waiting" />);
    const root = figure();
    expect(root.querySelector('.hf-rim')).not.toBeNull();
    expect(root.querySelector('.hf-water')).not.toBeNull();
    expect(root.querySelectorAll('.hf-wave').length).toBeGreaterThanOrEqual(2);
    expect(root.querySelectorAll('.hf-ripple')).toHaveLength(2);
    // the feet are visible under the surface: a second copy, clipped to the water
    expect(root.querySelector('.hf-under .hf-legs')).not.toBeNull();
    expect(root.querySelectorAll('.hf-foam')).toHaveLength(2);
    // the clip paths of two figures do not collide
    const ids = Array.from(root.querySelectorAll('clipPath')).map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has four mouth shapes (closed, half open, open, round)', () => {
    render(<HaiCharacter state="waiting" />);
    const above = figure().querySelector('[data-copy="above"]')!;
    for (const shape of ['closed', 'half', 'open', 'round']) {
      expect(above.querySelector(`.hf-mouth-${shape}`)).not.toBeNull();
    }
    expect(figure().getAttribute('data-mouth')).toBe('closed');
  });

  it('does not fill the screen: no fixed position, no inset-0, no dark layer', () => {
    render(<HaiCharacter state="speaking" />);
    for (const node of [
      figure(),
      ...Array.from(figure().querySelectorAll('*')),
    ]) {
      const classes = String(node.getAttribute('class') ?? '');
      expect(classes).not.toMatch(/\bfixed\b/);
      expect(classes).not.toContain('inset-0');
    }
  });

  it('is decoration: hidden from assistive technology, nothing to focus, no text', () => {
    render(<HaiCharacter state="speaking" />);
    expect(figure().getAttribute('aria-hidden')).toBe('true');
    expect(figure().querySelector('button, a, input, [tabindex]')).toBeNull();
    expect(figure().querySelector('title, desc, text')).toBeNull();
  });
});

describe('the look of each state', () => {
  const expected: Array<
    [CharacterState, { arms: string; head: string; eyes: string; pool: string }]
  > = [
    [
      'waiting',
      { arms: 'loose', head: 'straight', eyes: 'blink', pool: 'calm' },
    ],
    ['listening', { arms: 'ear', head: 'tilt', eyes: 'wide', pool: 'listen' }],
    ['thinking', { arms: 'chin', head: 'think', eyes: 'up', pool: 'calm' }],
    [
      'speaking',
      { arms: 'gesture', head: 'straight', eyes: 'blink', pool: 'speak' },
    ],
    ['paused', { arms: 'shrug', head: 'lean', eyes: 'droop', pool: 'warn' }],
    [
      'error',
      { arms: 'worry', head: 'straight', eyes: 'worried', pool: 'warn' },
    ],
  ];

  it.each(expected)('shows the state %s', (state, look) => {
    render(<HaiCharacter state={state} />);
    expect(figure().getAttribute('data-state')).toBe(state);
    expect(figure().getAttribute('data-arms')).toBe(look.arms);
    expect(figure().getAttribute('data-head')).toBe(look.head);
    expect(figure().getAttribute('data-eyes')).toBe(look.eyes);
    expect(figure().getAttribute('data-pool')).toBe(look.pool);
  });

  it('gives every state a different arm pose', () => {
    const arms = expected.map(([, look]) => look.arms);
    expect(new Set(arms).size).toBe(arms.length);
  });

  it('warns with the color of the basin when the conversation pauses or fails', () => {
    for (const state of ['paused', 'error'] as const) {
      const { unmount } = render(<HaiCharacter state={state} />);
      expect(figure().getAttribute('data-pool')).toBe('warn');
      expect(figure().querySelector('.hf-warn')).not.toBeNull();
      unmount();
    }
    for (const state of [
      'waiting',
      'listening',
      'thinking',
      'speaking',
    ] as const) {
      const { unmount } = render(<HaiCharacter state={state} />);
      expect(figure().getAttribute('data-pool')).not.toBe('warn');
      unmount();
    }
  });

  it('has a thought bubble of three dots for thinking', () => {
    render(<HaiCharacter state="thinking" />);
    expect(figure().querySelectorAll('.hf-thought circle')).toHaveLength(3);
  });

  it('lets the water react while the person talks, and to the loudness of the recording', () => {
    const { rerender } = render(<HaiCharacter state="listening" />);
    expect(figure().getAttribute('data-activity')).toBe('false');
    expect(figure().getAttribute('data-level')).toBe('none');
    expect(figure().style.getPropertyValue('--hai-level')).toBe('');

    rerender(<HaiCharacter state="listening" activity level={0.7} />);
    expect(figure().getAttribute('data-activity')).toBe('true');
    expect(figure().getAttribute('data-level')).toBe('0.7');
    expect(figure().style.getPropertyValue('--hai-level')).toBe('0.7');

    // a level outside of listening is ignored
    rerender(<HaiCharacter state="speaking" level={0.9} />);
    expect(figure().getAttribute('data-level')).toBe('none');
  });
});

describe('rising out of the water and diving in', () => {
  it('rises first, then stands', () => {
    jest.useFakeTimers();
    try {
      render(<HaiCharacter state="waiting" />);
      expect(figure().getAttribute('data-phase')).toBe('rising');
      act(() => {
        jest.advanceTimersByTime(RISE_MS - 1);
      });
      expect(figure().getAttribute('data-phase')).toBe('rising');
      act(() => {
        jest.advanceTimersByTime(2);
      });
      expect(figure().getAttribute('data-phase')).toBe('standing');
      // it keeps standing
      act(() => {
        jest.advanceTimersByTime(60_000);
      });
      expect(figure().getAttribute('data-phase')).toBe('standing');
    } finally {
      jest.useRealTimers();
    }
  });

  it('dives when the mode ends', () => {
    const { rerender } = render(<HaiCharacter state="waiting" />);
    rerender(<HaiCharacter state="waiting" leaving />);
    expect(figure().getAttribute('data-phase')).toBe('diving');
    expect(DIVE_MS).toBeGreaterThan(0);
  });

  it('splashes while it rises: the drops are part of the figure', () => {
    render(<HaiCharacter state="waiting" />);
    expect(figure().querySelectorAll('.hf-splash circle').length).toBe(6);
  });
});

describe('the mouth moves with the speech', () => {
  function frames() {
    let pending: (() => void) | null = null;
    return {
      schedule: (cb: () => void) => {
        pending = cb;
        return () => {
          pending = null;
        };
      },
      step: () => {
        const run = pending;
        pending = null;
        run?.();
      },
    };
  }

  it('shows the mouth shape of the level while it speaks', () => {
    const f = frames();
    let level: number | null = 0;
    const sources: MouthSources = {
      readLevel: () => level,
      browserSpeaking: () => false,
      random: () => 0.5,
      now: () => 0,
      schedule: f.schedule,
    };
    render(<HaiCharacter state="speaking" mouthSources={sources} />);
    expect(figure().getAttribute('data-mouth')).toBe('closed');

    level = 0.1;
    act(() => f.step());
    expect(figure().getAttribute('data-mouth')).toBe('half');
    level = 0.6;
    act(() => f.step());
    expect(['open', 'round']).toContain(figure().getAttribute('data-mouth'));
    expect(figure().getAttribute('data-mouth-source')).toBe('level');
  });

  it('keeps the mouth closed in every other state, even with sound', () => {
    const f = frames();
    const sources: MouthSources = {
      readLevel: () => 0.9,
      browserSpeaking: () => true,
      random: () => 0.5,
      now: () => 0,
      schedule: f.schedule,
    };
    for (const state of [
      'waiting',
      'listening',
      'thinking',
      'paused',
      'error',
    ] as const) {
      const { unmount } = render(
        <HaiCharacter state={state} mouthSources={sources} />
      );
      act(() => f.step());
      expect(figure().getAttribute('data-mouth')).toBe('closed');
      unmount();
    }
  });

  it('closes the mouth when the figure dives, even while it was speaking', () => {
    const f = frames();
    const sources: MouthSources = {
      readLevel: () => 0.9,
      browserSpeaking: () => false,
      random: () => 0.5,
      now: () => 0,
      schedule: f.schedule,
    };
    const { rerender } = render(
      <HaiCharacter state="speaking" mouthSources={sources} />
    );
    act(() => f.step());
    expect(figure().getAttribute('data-mouth')).not.toBe('closed');
    rerender(<HaiCharacter state="speaking" leaving mouthSources={sources} />);
    expect(figure().getAttribute('data-mouth')).toBe('closed');
  });
});

describe('reduced motion', () => {
  it('says so on the figure (the stylesheet then stops every animation and transition)', () => {
    preferReducedMotion(true);
    render(<HaiCharacter state="listening" />);
    expect(figure().getAttribute('data-motion')).toBe('reduced');
  });

  it('stands at once without the rise, and keeps state, pose and basin color', () => {
    preferReducedMotion(true);
    render(<HaiCharacter state="error" />);
    expect(figure().getAttribute('data-phase')).toBe('standing');
    expect(figure().getAttribute('data-state')).toBe('error');
    expect(figure().getAttribute('data-arms')).toBe('worry');
    expect(figure().getAttribute('data-pool')).toBe('warn');
  });

  it('still moves the mouth shape (data attribute) while it speaks', () => {
    preferReducedMotion(true);
    let pending: (() => void) | null = null;
    const sources: MouthSources = {
      readLevel: () => 0.5,
      browserSpeaking: () => false,
      random: () => 0.5,
      now: () => 0,
      schedule: cb => {
        pending = cb;
        return () => undefined;
      },
    };
    render(<HaiCharacter state="speaking" mouthSources={sources} />);
    act(() => (pending as (() => void) | null)?.());
    expect(figure().getAttribute('data-motion')).toBe('reduced');
    expect(['open', 'round']).toContain(figure().getAttribute('data-mouth'));
  });

  it('moves with the normal setting', () => {
    preferReducedMotion(false);
    render(<HaiCharacter state="speaking" />);
    expect(figure().getAttribute('data-motion')).toBe('full');
    expect(figure().getAttribute('data-phase')).toBe('rising');
  });
});
