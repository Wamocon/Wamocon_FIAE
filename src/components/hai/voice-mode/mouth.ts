/**
 * The mouth of the HAI figure: which of the four shapes it has right now.
 *
 * Pure logic, no React and no clock of its own (the caller passes the time and
 * a random source), so it is easy to test.
 *
 *  - closed:  lips together
 *  - half:    slightly open
 *  - open:    wide open (an "a")
 *  - round:   a small "o"
 *
 * Two sources drive it while the HAI speaks:
 *  1. a level (0 to 1) of the audio that is played (Web Audio providers, see
 *     lib/hai/voice/client/outputLevel.ts): `MouthDriver.fromLevel`
 *  2. no level (the browser's own speech has none): a rhythm pattern of
 *     syllable-like beats with a little scatter: `MouthDriver.fromRhythm`
 */

export type MouthShape = 'closed' | 'half' | 'open' | 'round';

/** Below this level the lips are together. */
export const LEVEL_CLOSED = 0.05;
/** Up to this level the mouth is half open, above it wide open or round. */
export const LEVEL_HALF = 0.16;

/** Shapes of one rhythm run, the way a mouth moves over a few syllables. */
const RHYTHM: readonly MouthShape[] = [
  'half',
  'open',
  'half',
  'round',
  'open',
  'half',
  'closed',
  'open',
];

export class MouthDriver {
  private wasOpen = false;
  private beats = 0;
  private rhythmIndex = 0;
  private rhythmUntil = 0;
  private rhythmShape: MouthShape = 'closed';

  constructor(private readonly random: () => number = Math.random) {}

  /**
   * The shape for a measured loudness. Every rise out of silence is a new beat
   * (a syllable); every third beat is a round "o" instead of an open "a".
   */
  fromLevel(level: number): MouthShape {
    const open = level >= LEVEL_CLOSED;
    if (open && !this.wasOpen) this.beats += 1;
    this.wasOpen = open;
    if (!open) return 'closed';
    if (level < LEVEL_HALF) return 'half';
    return this.beats % 3 === 0 ? 'round' : 'open';
  }

  /**
   * The shape for speech without a level: beats of 110 to 230 ms with the
   * shapes of RHYTHM, now and then a short pause like the gap between two words.
   */
  fromRhythm(nowMs: number): MouthShape {
    if (nowMs < this.rhythmUntil) return this.rhythmShape;
    if (this.rhythmShape !== 'closed' && this.random() < 0.12) {
      // a word ends
      this.rhythmShape = 'closed';
      this.rhythmUntil = nowMs + 200 + this.random() * 180;
      return this.rhythmShape;
    }
    this.rhythmIndex = (this.rhythmIndex + 1) % RHYTHM.length;
    // a little scatter: sometimes a beat is skipped ahead
    if (this.random() < 0.25) {
      this.rhythmIndex = (this.rhythmIndex + 1) % RHYTHM.length;
    }
    this.rhythmShape = RHYTHM[this.rhythmIndex];
    this.rhythmUntil = nowMs + 110 + this.random() * 120;
    return this.rhythmShape;
  }

  /** Start over (the next answer begins with a fresh rhythm). */
  reset(): void {
    this.wasOpen = false;
    this.beats = 0;
    this.rhythmIndex = 0;
    this.rhythmUntil = 0;
    this.rhythmShape = 'closed';
  }
}
