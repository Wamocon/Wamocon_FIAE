'use client';

/**
 * The HAI mascot of the voice mode.
 *
 * Built on the picture the app already has for the HAI (public/images/
 * hai-logo.png, the wave with the shark fin, the same mark as the button and
 * the banner of the chat). It is shown in a round frame on the dark blue of the
 * mark, so it reads the same in the light and in the dark theme. No new logo and
 * no new picture file: the states are drawn around it with rings, a glow and a
 * swimming movement (CSS, see globals.css).
 *
 *  - waiting:   floats slowly
 *  - listening: calm rings spread; they speed up while the person is talking
 *               (text arrives), and the glow follows the loudness of the
 *               recording when the provider reports one (`level`)
 *  - thinking:  a ring circles the mark, the mark breathes
 *  - speaking:  the mark swims in the beat of the speech, rings spread
 *  - paused / error: amber frame, no movement of rings
 *
 * With prefers-reduced-motion nothing moves: the frame only changes its color.
 * The state is never the animation alone: the voice mode writes it as text
 * (aria-live) next to the mascot. The mascot itself is decoration (aria-hidden).
 */

import React from 'react';
import Image from 'next/image';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

export type MascotState =
  | 'waiting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'paused'
  | 'error';

interface HaiMascotProps {
  state: MascotState;
  /** The person is talking right now (text of the recognition arrives). */
  activity?: boolean;
  /** Loudness of the recording, 0 to 1, if the provider reports one. */
  level?: number | null;
  size?: 'lg' | 'sm';
  className?: string;
}

const SIZE = {
  lg: 'h-56 w-56 md:h-72 md:w-72',
  sm: 'h-14 w-14',
} as const;

const FRAME: Record<MascotState, string> = {
  waiting: 'border-cyan-400/40',
  listening: 'border-cyan-300/80',
  thinking: 'border-blue-400/70',
  speaking: 'border-emerald-300/80',
  paused: 'border-amber-400/70',
  error: 'border-amber-400/80',
};

const GLOW: Record<MascotState, string> = {
  waiting: 'bg-cyan-500/15',
  listening: 'bg-cyan-400/30',
  thinking: 'bg-blue-500/25',
  speaking: 'bg-emerald-400/30',
  paused: 'bg-amber-400/15',
  error: 'bg-amber-400/20',
};

export function HaiMascot({
  state,
  activity = false,
  level = null,
  size = 'lg',
  className = '',
}: HaiMascotProps) {
  const reduced = usePrefersReducedMotion();
  const ringsSpread =
    !reduced && (state === 'listening' || state === 'speaking');
  const measured = state === 'listening' && typeof level === 'number';
  const glowStyle: React.CSSProperties | undefined = measured
    ? {
        transform: `scale(${1 + (level as number) * 0.6})`,
        opacity: 0.5 + (level as number) * 0.5,
        transition: reduced ? 'none' : 'transform 80ms linear',
      }
    : undefined;

  return (
    <div
      aria-hidden="true"
      data-testid="hai-mascot"
      data-state={state}
      data-motion={reduced ? 'reduced' : 'full'}
      data-activity={activity ? 'true' : 'false'}
      data-level={measured ? String(level) : 'none'}
      className={`hai-mascot relative flex items-center justify-center ${SIZE[size]} ${className}`}
    >
      {/* glow: follows the loudness if there is a value, else it stays calm */}
      <span
        data-testid="hai-mascot-glow"
        className={`absolute -inset-3 rounded-full blur-2xl ${GLOW[state]}`}
        style={glowStyle}
      />

      {ringsSpread && (
        <>
          <span
            data-testid="hai-mascot-ring"
            data-fast={state === 'speaking' || activity ? 'true' : 'false'}
            className="hai-mascot-ring absolute inset-0 rounded-full border-2 border-cyan-300/60"
          />
          <span
            data-testid="hai-mascot-ring"
            data-fast={state === 'speaking' || activity ? 'true' : 'false'}
            data-delay="true"
            className="hai-mascot-ring absolute inset-0 rounded-full border-2 border-cyan-300/40"
          />
        </>
      )}

      {state === 'thinking' && !reduced && (
        <span
          data-testid="hai-mascot-orbit"
          className="hai-mascot-orbit absolute -inset-2 rounded-full border-2 border-transparent border-t-blue-300/80 border-r-blue-300/30"
        />
      )}

      <div
        data-state={reduced ? 'still' : state}
        className={`hai-mascot-body relative h-full w-full overflow-hidden rounded-full border-2 bg-[#020b1c] shadow-xl shadow-cyan-950/60 ${FRAME[state]} ${
          state === 'error' || state === 'paused' ? 'grayscale-[40%]' : ''
        }`}
      >
        <Image
          src="/images/hai-logo.png"
          alt=""
          fill
          sizes={size === 'lg' ? '(min-width: 768px) 288px, 224px' : '56px'}
          className="scale-110 object-cover"
          draggable={false}
        />
      </div>
    </div>
  );
}

export default HaiMascot;
