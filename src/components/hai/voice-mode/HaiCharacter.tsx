'use client';

/**
 * The HAI as a figure: a friendly cartoon shark with a head, arms, hands, a
 * body and legs, standing with its feet in a round basin of water (the round
 * water of the HAI logo). It rises out of the water when the voice mode starts,
 * speaks with a moving mouth, and dives back in when the mode ends.
 *
 * Everything is one SVG (viewBox 260 x 300) drawn in the colors of the logo
 * (dark blue and turquoise). The figure is drawn twice: once above the water
 * line and once below it, clipped to the water, so the feet stay visible under
 * the surface (tinted and gently wobbling) while the basin hides what is under
 * the rim. Only `transform` and `opacity` are animated (globals.css).
 *
 * The look of each state is carried by data attributes on the root, CSS does
 * the rest, so the tests (and the stylesheet) read the same names:
 *
 *   state     data-arms  data-head  data-eyes  data-pool
 *   waiting   loose      straight   blink      calm     calm bobbing, arms loose
 *   listening ear        tilt       wide       listen   head tilted, a hand at the ear
 *   thinking  chin       think      up         calm     a hand at the chin, thought bubble
 *   speaking  gesture    straight   blink      speak    mouth moves, arms gesture in turn
 *   paused    shrug      lean       droop      warn     thoughtful, amber basin
 *   error     worry      straight   worried    warn     hands together, amber basin
 *
 * The mouth (data-mouth: closed, half, open, round) is written per frame by
 * useMouthShape without React state. With prefers-reduced-motion nothing
 * moves (no animation, no transition, no rise): the poses, the mouth shape and
 * the color of the basin still show the state. The figure is decoration
 * (aria-hidden), the voice mode writes the state as text (aria-live).
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { type MouthSources, useMouthShape } from './useMouthShape';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

export type CharacterState =
  | 'waiting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'paused'
  | 'error';

export type CharacterPhase = 'rising' | 'standing' | 'diving';

/** Time the figure needs to come out of the water, and to dive in again. */
export const RISE_MS = 1400;
export const DIVE_MS = 800;

const ARMS: Record<CharacterState, string> = {
  waiting: 'loose',
  listening: 'ear',
  thinking: 'chin',
  speaking: 'gesture',
  paused: 'shrug',
  error: 'worry',
};
const HEAD: Record<CharacterState, string> = {
  waiting: 'straight',
  listening: 'tilt',
  thinking: 'think',
  speaking: 'straight',
  paused: 'lean',
  error: 'straight',
};
const EYES: Record<CharacterState, string> = {
  waiting: 'blink',
  listening: 'wide',
  thinking: 'up',
  speaking: 'blink',
  paused: 'droop',
  error: 'worried',
};
const POOL: Record<CharacterState, string> = {
  waiting: 'calm',
  listening: 'listen',
  thinking: 'calm',
  speaking: 'speak',
  paused: 'warn',
  error: 'warn',
};

interface HaiCharacterProps {
  state: CharacterState;
  /** The person is talking right now (text of the recognition arrives). */
  activity?: boolean;
  /** Loudness of the recording, 0 to 1, if the provider reports one. */
  level?: number | null;
  /** The mode ends: the figure dives into the water. */
  leaving?: boolean;
  className?: string;
  /** Replaces the sources of the mouth (analyser, clock), for tests. */
  mouthSources?: MouthSources;
}

/** A row of waves, wide enough to slide by two wave lengths without a gap. */
function wavePath(y: number, amplitude: number): string {
  return `M-60 ${y} q13 ${-amplitude} 26 0${' t26 0'.repeat(14)}`;
}

/**
 * One arm. The right arm is the left one mirrored, so both use the same angles.
 * Drawn in two layers (outlines first, then the fills) so the joints between
 * the upper arm, the forearm and the hand have no seams.
 */
function Fore({ layer }: { layer: 'outline' | 'fill' }) {
  return (
    <g className="hf-arm-fore" data-segment="fore">
      {layer === 'outline' ? (
        <>
          <path className="hf-outline" d="M86 152 L86 177" strokeWidth="19" />
        </>
      ) : (
        <>
          <path className="hf-limb" d="M86 152 L86 177" strokeWidth="13" />
          <g className="hf-hand" data-segment="hand">
            <ellipse
              className="hf-hand-shape"
              cx="96"
              cy="181"
              rx="4.6"
              ry="7"
              transform="rotate(-28 96 181)"
            />
            <ellipse
              className="hf-hand-shape"
              cx="86"
              cy="186"
              rx="10.5"
              ry="11"
            />
            <path
              className="hf-finger"
              d="M82 190 L82 196 M87 191 L87 198"
              strokeWidth="1.8"
            />
          </g>
        </>
      )}
    </g>
  );
}

function Arm({ side }: { side: 'left' | 'right' }) {
  const mirror = side === 'right' ? 'translate(260 0) scale(-1 1)' : undefined;
  return (
    <g transform={mirror} data-arm={side}>
      <g className="hf-arm-upper" data-segment="upper">
        <path className="hf-outline" d="M86 124 L86 152" strokeWidth="21" />
        <Fore layer="outline" />
        <path className="hf-limb" d="M86 124 L86 152" strokeWidth="15" />
        <Fore layer="fill" />
      </g>
    </g>
  );
}

function Mouths() {
  return (
    <g className="hf-mouths">
      <path
        className="hf-mouth hf-mouth-closed"
        d="M113 90 Q130 99 147 90"
        fill="none"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <g className="hf-mouth hf-mouth-half">
        <path
          className="hf-mouth-inside"
          d="M115 89 Q130 92 145 89 Q142 101 130 101 Q118 101 115 89 Z"
        />
        <path
          className="hf-teeth"
          d="M118 90.2 Q130 93 142 90.2 L141.5 93 Q130 95.6 118.5 93 Z"
        />
      </g>
      <g className="hf-mouth hf-mouth-open">
        <path
          className="hf-mouth-inside"
          d="M110 87 Q130 91 150 87 Q149 111 130 111 Q111 111 110 87 Z"
        />
        <path
          className="hf-teeth"
          d="M113 88.4 Q130 92.4 147 88.4 L146 93.6 Q130 97.6 114 93.6 Z"
        />
        <ellipse className="hf-tongue" cx="130" cy="105" rx="11" ry="5" />
      </g>
      <g className="hf-mouth hf-mouth-round">
        <ellipse
          className="hf-mouth-inside"
          cx="130"
          cy="97"
          rx="8.5"
          ry="10"
        />
        <ellipse className="hf-tongue" cx="130" cy="102" rx="5" ry="3.4" />
      </g>
    </g>
  );
}

function Eye({ x }: { x: number }) {
  return (
    <g data-eye="">
      <ellipse className="hf-eye-white" cx={x} cy="66" rx="12" ry="14" />
      <g className="hf-pupil">
        <ellipse className="hf-pupil-shape" cx={x} cy="68" rx="6.4" ry="8" />
        <circle className="hf-eye-shine" cx={x + 2.4} cy="64" r="2.4" />
      </g>
      <ellipse className="hf-lid" cx={x} cy="66" rx="13" ry="15" />
    </g>
  );
}

/** The whole figure. Drawn twice (above and below the water line). */
function Figure() {
  return (
    <g className="hf-bob">
      {/* tail fin behind the body */}
      <path
        className="hf-fin"
        d="M168 178 C186 170 202 176 208 192 C194 190 184 196 174 206 Z"
      />
      {/* legs and feet */}
      <g className="hf-legs" data-part="legs">
        <path
          className="hf-outline"
          d="M112 184 C110 214 108 238 108 258"
          strokeWidth="31"
        />
        <path
          className="hf-outline"
          d="M148 184 C150 214 152 238 152 258"
          strokeWidth="31"
        />
        <path
          className="hf-foot hf-foot-left"
          d="M106 256 C92 252 72 256 66 264 C70 271 98 273 118 268 Z"
        />
        <path
          className="hf-foot hf-foot-right"
          d="M154 256 C168 252 188 256 194 264 C190 271 162 273 142 268 Z"
        />
        <path
          className="hf-limb"
          d="M112 184 C110 214 108 238 108 258"
          strokeWidth="25"
        />
        <path
          className="hf-limb"
          d="M148 184 C150 214 152 238 152 258"
          strokeWidth="25"
        />
        <path
          className="hf-toes"
          d="M80 266 l4 -5 M88 268 l3 -6 M176 266 l-4 -5 M168 268 l-3 -6"
          strokeWidth="1.6"
        />
      </g>
      {/* body */}
      <path
        className="hf-body"
        d="M90 108 C80 130 78 162 86 190 C98 202 162 202 174 190 C182 162 180 130 170 108 C156 116 104 116 90 108 Z"
      />
      <ellipse className="hf-belly" cx="130" cy="154" rx="29" ry="39" />
      <path
        className="hf-gills"
        d="M92 132 l-6 7 M94 143 l-6 7 M96 154 l-6 7 M168 132 l6 7 M166 143 l6 7 M164 154 l6 7"
        strokeWidth="2.2"
      />
      {/* arms in front of the body */}
      <Arm side="left" />
      <Arm side="right" />
      {/* head */}
      <g className="hf-head">
        <path
          className="hf-fin"
          d="M114 40 C116 24 126 12 146 4 C140 18 142 30 146 42 Z"
        />
        <path
          className="hf-body"
          d="M80 76 C80 46 102 34 130 34 C158 34 180 46 180 76 C180 100 160 112 130 112 C100 112 80 100 80 76 Z"
        />
        <circle className="hf-cheek" cx="96" cy="88" r="6.5" />
        <circle className="hf-cheek" cx="164" cy="88" r="6.5" />
        <Eye x={108} />
        <Eye x={152} />
        <path
          className="hf-brow hf-brow-left"
          d="M97 47 Q108 42 119 47"
          strokeWidth="3"
        />
        <path
          className="hf-brow hf-brow-right"
          d="M141 47 Q152 42 163 47"
          strokeWidth="3"
        />
        <circle className="hf-nostril" cx="124" cy="80" r="1.6" />
        <circle className="hf-nostril" cx="136" cy="80" r="1.6" />
        <Mouths />
      </g>
    </g>
  );
}

export function HaiCharacter({
  state,
  activity = false,
  level = null,
  leaving = false,
  className = '',
  mouthSources,
}: HaiCharacterProps) {
  const reduced = usePrefersReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');

  // risen: after the rise the figure stands (and idles)
  const [risen, setRisen] = useState(false);
  useEffect(() => {
    if (reduced) {
      setRisen(true);
      return;
    }
    const timer = setTimeout(() => setRisen(true), RISE_MS);
    return () => clearTimeout(timer);
  }, [reduced]);
  const phase: CharacterPhase = leaving
    ? 'diving'
    : risen
      ? 'standing'
      : 'rising';

  useMouthShape(
    rootRef,
    state === 'speaking' && phase !== 'diving',
    mouthSources
  );

  const measured = state === 'listening' && typeof level === 'number';
  const style = measured
    ? ({ '--hai-level': String(level) } as React.CSSProperties)
    : undefined;

  const above = `hf-above-${uid}`;
  const under = `hf-under-${uid}`;
  const surface = `hf-surface-${uid}`;

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      data-testid="hai-character"
      data-state={state}
      data-arms={ARMS[state]}
      data-head={HEAD[state]}
      data-eyes={EYES[state]}
      data-pool={POOL[state]}
      data-phase={phase}
      data-mouth="closed"
      data-mouth-source="none"
      data-motion={reduced ? 'reduced' : 'full'}
      data-activity={activity ? 'true' : 'false'}
      data-level={measured ? String(level) : 'none'}
      style={style}
      className={`hai-figure ${className}`}
    >
      <svg
        viewBox="0 0 260 300"
        className="h-full w-full overflow-visible"
        focusable="false"
      >
        <defs>
          <clipPath id={above}>
            <rect x="-40" y="-40" width="340" height="288" />
          </clipPath>
          <clipPath id={surface}>
            <ellipse cx="130" cy="248" rx="104" ry="27" />
          </clipPath>
          <clipPath id={under} clipPath={`url(#${surface})`}>
            <rect x="0" y="248" width="260" height="60" />
          </clipPath>
          <linearGradient id={`${uid}-wall`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0e7490" />
            <stop offset="1" stopColor="#0a3a5c" />
          </linearGradient>
          <radialGradient id={`${uid}-water`} cx="0.5" cy="0.35" r="0.8">
            <stop offset="0" stopColor="#67e8f9" />
            <stop offset="0.6" stopColor="#22b5d6" />
            <stop offset="1" stopColor="#1670b8" />
          </radialGradient>
        </defs>

        {/* the basin: floor shadow, glass wall, rim, water */}
        <ellipse className="hf-shadow" cx="130" cy="292" rx="112" ry="9" />
        <path
          className="hf-wall"
          fill={`url(#${uid}-wall)`}
          d="M14 246 V262 A116 32 0 0 0 246 262 V246 Z"
        />
        <ellipse className="hf-rim" cx="130" cy="246" rx="116" ry="32" />
        <ellipse
          className="hf-water"
          fill={`url(#${uid}-water)`}
          cx="130"
          cy="248"
          rx="104"
          ry="27"
        />
        <ellipse className="hf-warn" cx="130" cy="248" rx="104" ry="27" />

        {/* ripples that spread from the legs when the HAI listens or speaks */}
        <g clipPath={`url(#${surface})`}>
          <ellipse
            className="hf-ripple hf-ripple-1"
            cx="130"
            cy="248"
            rx="100"
            ry="25"
          />
          <ellipse
            className="hf-ripple hf-ripple-2"
            cx="130"
            cy="248"
            rx="100"
            ry="25"
          />
        </g>

        {/* the part of the figure under the water: tinted, wobbling */}
        <g clipPath={`url(#${under})`}>
          <g className="hf-refract">
            <g className="hf-rise hf-under">
              <Figure />
            </g>
          </g>
          <ellipse
            className="hf-under-tint"
            cx="130"
            cy="262"
            rx="104"
            ry="27"
          />
        </g>

        {/* waves on the surface */}
        <g clipPath={`url(#${surface})`}>
          <g className="hf-waves">
            <path className="hf-wave" d={wavePath(244, 5)} />
            <path className="hf-wave hf-wave-2" d={wavePath(256, 5)} />
            <path className="hf-wave hf-wave-3" d={wavePath(266, 4)} />
          </g>
        </g>

        {/* the part above the water */}
        <g clipPath={`url(#${above})`}>
          <g className="hf-rise hf-over" data-copy="above">
            <Figure />
          </g>
        </g>

        {/* foam where the legs enter the water */}
        <ellipse className="hf-foam" cx="109" cy="248" rx="17" ry="5" />
        <ellipse className="hf-foam" cx="151" cy="248" rx="17" ry="5" />

        {/* thought bubble: three dots */}
        <g className="hf-thought">
          <circle cx="188" cy="48" r="3.5" />
          <circle cx="199" cy="34" r="5" />
          <circle cx="214" cy="16" r="7.5" />
        </g>

        {/* splashes while it rises */}
        <g className="hf-splash">
          <circle
            cx="104"
            cy="240"
            r="3"
            style={{ '--dx': '-34px', '--dy': '-70px' } as React.CSSProperties}
          />
          <circle
            cx="118"
            cy="238"
            r="2.4"
            style={{ '--dx': '-14px', '--dy': '-92px' } as React.CSSProperties}
          />
          <circle
            cx="142"
            cy="238"
            r="2.6"
            style={{ '--dx': '16px', '--dy': '-96px' } as React.CSSProperties}
          />
          <circle
            cx="156"
            cy="240"
            r="3.2"
            style={{ '--dx': '38px', '--dy': '-66px' } as React.CSSProperties}
          />
          <circle
            cx="92"
            cy="244"
            r="2"
            style={{ '--dx': '-52px', '--dy': '-40px' } as React.CSSProperties}
          />
          <circle
            cx="168"
            cy="244"
            r="2.2"
            style={{ '--dx': '54px', '--dy': '-38px' } as React.CSSProperties}
          />
        </g>

        {/* the front rim and edge of the glass, over everything */}
        <path
          className="hf-edge"
          d="M14 246 A116 32 0 0 0 246 246 M14 246 V262 A116 32 0 0 0 246 262 V246"
        />
      </svg>
    </div>
  );
}

export default HaiCharacter;
