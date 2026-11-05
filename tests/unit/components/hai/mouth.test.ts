import { describe, it, expect } from '@jest/globals';
import {
  LEVEL_CLOSED,
  LEVEL_HALF,
  MouthDriver,
  type MouthShape,
} from '@/components/hai/voice-mode/mouth';

// The four shapes of the mouth of the HAI figure and where they come from.

/** A random source that walks through a fixed list of values. */
function sequence(values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('the mouth from a loudness', () => {
  it('is closed in silence, half open when quiet, open or round when loud', () => {
    const driver = new MouthDriver();
    expect(driver.fromLevel(0)).toBe('closed');
    expect(driver.fromLevel(LEVEL_CLOSED - 0.01)).toBe('closed');
    expect(driver.fromLevel(LEVEL_CLOSED + 0.01)).toBe('half');
    expect(driver.fromLevel(LEVEL_HALF - 0.01)).toBe('half');
    expect(['open', 'round']).toContain(driver.fromLevel(LEVEL_HALF + 0.1));
    expect(['open', 'round']).toContain(driver.fromLevel(1));
  });

  it('makes every third beat a round "o" instead of an open "a"', () => {
    const driver = new MouthDriver();
    const shapes: MouthShape[] = [];
    // three syllables, each rises out of silence and is loud
    for (let beat = 0; beat < 3; beat++) {
      shapes.push(driver.fromLevel(0.5));
      driver.fromLevel(0);
    }
    expect(shapes).toEqual(['open', 'open', 'round']);
  });

  it('starts the next beat after a pause even if it is the same loudness', () => {
    const driver = new MouthDriver();
    expect(driver.fromLevel(0.4)).toBe('open');
    // louder or quieter without silence in between is the same beat
    expect(driver.fromLevel(0.6)).toBe('open');
    driver.fromLevel(0);
    expect(driver.fromLevel(0.4)).toBe('open');
  });
});

describe('the mouth from a rhythm (speech without a level)', () => {
  it('changes its shape in the beat of syllables, between 110 and 230 ms', () => {
    // no scatter: the random source never skips and never pauses
    const driver = new MouthDriver(() => 0.5);
    const first = driver.fromRhythm(1000);
    // inside the beat nothing changes
    expect(driver.fromRhythm(1050)).toBe(first);
    expect(driver.fromRhythm(1100)).toBe(first);
    // after the beat (110 + 0.5 * 120 = 170 ms) the next shape comes
    const second = driver.fromRhythm(1171);
    expect(second).not.toBe(first);
  });

  it('uses all four shapes over a few syllables', () => {
    const driver = new MouthDriver(() => 0.5);
    const seen = new Set<MouthShape>();
    let now = 0;
    for (let i = 0; i < 40; i++) {
      seen.add(driver.fromRhythm(now));
      now += 175;
    }
    expect(seen).toEqual(new Set(['closed', 'half', 'open', 'round']));
  });

  it('pauses with closed lips between words now and then', () => {
    // 0.05 < 0.12: after an open beat the word ends
    const driver = new MouthDriver(sequence([0.05]));
    driver.fromRhythm(0); // a first beat (closed start, picks a shape)
    const shape = driver.fromRhythm(10_000);
    expect(shape).toBe('closed');
    // the pause lasts 200 to 380 ms
    expect(driver.fromRhythm(10_100)).toBe('closed');
  });

  it('is scattered: the same clock gives different runs for different random numbers', () => {
    const run = (random: () => number) => {
      const driver = new MouthDriver(random);
      const out: MouthShape[] = [];
      let now = 0;
      for (let i = 0; i < 30; i++) {
        out.push(driver.fromRhythm(now));
        now += 200;
      }
      return out.join(',');
    };
    expect(run(sequence([0.9, 0.3, 0.7, 0.2]))).not.toBe(run(sequence([0.5])));
  });

  it('starts over after a reset', () => {
    const driver = new MouthDriver(() => 0.5);
    const first = driver.fromRhythm(0);
    driver.fromRhythm(500);
    driver.reset();
    expect(driver.fromRhythm(0)).toBe(first);
  });
});
