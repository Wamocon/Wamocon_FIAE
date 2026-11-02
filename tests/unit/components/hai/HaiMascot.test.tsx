import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, afterEach } from '@jest/globals';
import {
  HaiMascot,
  type MascotState,
} from '@/components/hai/voice-mode/HaiMascot';

// The mascot of the voice mode: the shark of the app (public/images/hai-logo.png)
// in a round frame, with one look per state. The state is also written as text
// by the voice mode, the mascot itself is decoration.

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

const mascot = () => screen.getByTestId('hai-mascot');

describe('HaiMascot', () => {
  it('uses the picture the app already has for the HAI and is decoration only', () => {
    render(<HaiMascot state="waiting" />);
    const img = mascot().querySelector('img');
    expect(img).not.toBeNull();
    expect(decodeURIComponent(img!.getAttribute('src') ?? '')).toContain(
      'hai-logo.png'
    );
    // no alternative text and hidden from assistive technology: the state is text elsewhere
    expect(img!.getAttribute('alt')).toBe('');
    expect(mascot().getAttribute('aria-hidden')).toBe('true');
  });

  it.each<MascotState>([
    'waiting',
    'listening',
    'thinking',
    'speaking',
    'paused',
    'error',
  ])('shows the state %s', state => {
    render(<HaiMascot state={state} />);
    expect(mascot().getAttribute('data-state')).toBe(state);
    const body = mascot().querySelector('.hai-mascot-body');
    expect(body?.getAttribute('data-state')).toBe(state);
  });

  it('spreads rings while it listens, calmly, and faster while the person talks', () => {
    const { rerender } = render(<HaiMascot state="listening" />);
    const rings = screen.getAllByTestId('hai-mascot-ring');
    expect(rings).toHaveLength(2);
    expect(rings.every(r => r.getAttribute('data-fast') === 'false')).toBe(
      true
    );

    rerender(<HaiMascot state="listening" activity />);
    expect(
      screen
        .getAllByTestId('hai-mascot-ring')
        .every(r => r.getAttribute('data-fast') === 'true')
    ).toBe(true);
    expect(mascot().getAttribute('data-activity')).toBe('true');
  });

  it('spreads rings in the beat of the speech and circles a ring while it thinks', () => {
    const { rerender } = render(<HaiMascot state="speaking" />);
    expect(screen.getAllByTestId('hai-mascot-ring')).toHaveLength(2);
    expect(screen.queryByTestId('hai-mascot-orbit')).toBeNull();

    rerender(<HaiMascot state="thinking" />);
    expect(screen.getByTestId('hai-mascot-orbit')).toBeTruthy();
    expect(screen.queryAllByTestId('hai-mascot-ring')).toHaveLength(0);
  });

  it('has no rings while it waits, pauses or shows an error', () => {
    for (const state of ['waiting', 'paused', 'error'] as const) {
      const { unmount } = render(<HaiMascot state={state} />);
      expect(screen.queryAllByTestId('hai-mascot-ring')).toHaveLength(0);
      expect(screen.queryByTestId('hai-mascot-orbit')).toBeNull();
      unmount();
    }
  });

  it('lets the glow follow the loudness of the recording when there is a value', () => {
    const { rerender } = render(<HaiMascot state="listening" level={0} />);
    const glow = () => screen.getByTestId('hai-mascot-glow');
    expect(glow().style.transform).toBe('scale(1)');
    expect(mascot().getAttribute('data-level')).toBe('0');

    rerender(<HaiMascot state="listening" level={1} />);
    expect(glow().style.transform).toBe('scale(1.6)');
    expect(glow().style.opacity).toBe('1');
  });

  it('keeps the glow calm without a value, and ignores a value outside of listening', () => {
    const { rerender } = render(<HaiMascot state="listening" level={null} />);
    expect(screen.getByTestId('hai-mascot-glow').style.transform).toBe('');
    expect(mascot().getAttribute('data-level')).toBe('none');

    rerender(<HaiMascot state="speaking" level={0.9} />);
    expect(screen.getByTestId('hai-mascot-glow').style.transform).toBe('');
  });

  it('stands still with reduced motion: no rings, no ring around the mark, no movement', () => {
    preferReducedMotion(true);
    const { rerender } = render(<HaiMascot state="listening" />);
    expect(mascot().getAttribute('data-motion')).toBe('reduced');
    expect(screen.queryAllByTestId('hai-mascot-ring')).toHaveLength(0);
    // the picture gets no movement class: its state attribute says "still"
    expect(
      mascot().querySelector('.hai-mascot-body')?.getAttribute('data-state')
    ).toBe('still');

    rerender(<HaiMascot state="thinking" />);
    expect(screen.queryByTestId('hai-mascot-orbit')).toBeNull();
    rerender(<HaiMascot state="speaking" />);
    expect(screen.queryAllByTestId('hai-mascot-ring')).toHaveLength(0);
    // the state is still there (the voice mode writes it as text as well)
    expect(mascot().getAttribute('data-state')).toBe('speaking');
  });

  it('moves with the normal setting', () => {
    preferReducedMotion(false);
    render(<HaiMascot state="speaking" />);
    expect(mascot().getAttribute('data-motion')).toBe('full');
    expect(
      mascot().querySelector('.hai-mascot-body')?.getAttribute('data-state')
    ).toBe('speaking');
  });

  it('comes in a large and a small size', () => {
    const { rerender } = render(<HaiMascot state="waiting" size="lg" />);
    expect(mascot().className).toContain('h-56');
    rerender(<HaiMascot state="waiting" size="sm" />);
    expect(mascot().className).toContain('h-14');
  });
});
