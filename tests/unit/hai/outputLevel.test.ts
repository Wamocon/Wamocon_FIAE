import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  OrderedPlayback,
  type AnalyserLike,
  type AudioContextLike,
  type AudioSourceLike,
} from '@/lib/hai/voice/client/audio';
import {
  getOutputTap,
  readOutputLevel,
  resetOutputLevel,
} from '@/lib/hai/voice/client/outputLevel';

// The read only tap on the speech output: the mouth of the HAI figure reads the
// loudness of what is played. The sound itself must stay exactly as it was.

class FakeAnalyser implements AnalyserLike {
  fftSize = 2048;
  /** The block of samples the next read returns. */
  block: number[] = [];
  getFloatTimeDomainData(array: Float32Array) {
    for (let i = 0; i < array.length; i++) {
      array[i] = this.block[i % Math.max(1, this.block.length)] ?? 0;
    }
  }
}

function makeContext(withAnalyser: boolean) {
  const analysers: FakeAnalyser[] = [];
  const connections: Array<{ from: AudioSourceLike; to: unknown }> = [];
  const destination = { name: 'destination' };
  const ctx = {
    currentTime: 0,
    destination,
    resume: async () => undefined,
    createBuffer: () => ({ duration: 1, copyToChannel() {} }),
    createBufferSource(): AudioSourceLike {
      const source: AudioSourceLike = {
        buffer: null,
        onended: null,
        connect(to: unknown) {
          connections.push({ from: source, to });
        },
        start() {},
        stop() {},
      };
      return source;
    },
    decodeAudioData: async () => ({ duration: 1, copyToChannel() {} }),
  } as unknown as AudioContextLike & { createAnalyser?: () => AnalyserLike };
  if (withAnalyser) {
    ctx.createAnalyser = () => {
      const analyser = new FakeAnalyser();
      analysers.push(analyser);
      return analyser;
    };
  }
  return { ctx, analysers, connections, destination };
}

beforeEach(() => resetOutputLevel());

describe('the tap on the speech output', () => {
  it('makes one analyser per audio context and reuses it', () => {
    const { ctx, analysers } = makeContext(true);
    const first = getOutputTap(ctx);
    const second = getOutputTap(ctx);
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(analysers).toHaveLength(1);
    expect(first!.fftSize).toBe(512);
  });

  it('is not there when the context cannot make an analyser', () => {
    const { ctx } = makeContext(false);
    expect(getOutputTap(ctx)).toBeNull();
    expect(readOutputLevel()).toBeNull();
  });

  it('gives up quietly when the analyser cannot be made', () => {
    const { ctx } = makeContext(true);
    ctx.createAnalyser = () => {
      throw new Error('no analyser');
    };
    expect(getOutputTap(ctx)).toBeNull();
    expect(readOutputLevel()).toBeNull();
  });

  it('connects every played source to the destination as before AND to the tap', () => {
    const { ctx, analysers, connections, destination } = makeContext(true);
    const playback = new OrderedPlayback(ctx);
    const slot = playback.open();
    slot.push({ duration: 1, copyToChannel() {} });
    slot.push({ duration: 1, copyToChannel() {} });
    expect(connections).toHaveLength(4);
    // each source: the destination first (unchanged path), then the tap
    expect(connections[0].to).toBe(destination);
    expect(connections[1].to).toBe(analysers[0]);
    expect(connections[2].to).toBe(destination);
    expect(connections[3].to).toBe(analysers[0]);
    // still one analyser for all pieces
    expect(analysers).toHaveLength(1);
  });

  it('plays exactly as before where there is no analyser', () => {
    const { ctx, connections, destination } = makeContext(false);
    const playback = new OrderedPlayback(ctx);
    playback.open().push({ duration: 1, copyToChannel() {} });
    expect(connections).toHaveLength(1);
    expect(connections[0].to).toBe(destination);
  });
});

describe('the loudness of the speech output', () => {
  it('is null before anything was played', () => {
    expect(readOutputLevel()).toBeNull();
  });

  it('is 0 for silence and grows with the loudness, never above 1', () => {
    const { ctx, analysers } = makeContext(true);
    getOutputTap(ctx);
    const analyser = analysers[0];

    analyser.block = [0, 0, 0, 0];
    expect(readOutputLevel()).toBe(0);

    analyser.block = [0.1, -0.1, 0.1, -0.1];
    const quiet = readOutputLevel()!;
    expect(quiet).toBeGreaterThan(0.2);
    expect(quiet).toBeLessThan(0.5);

    analyser.block = [0.3, -0.3, 0.3, -0.3];
    const loud = readOutputLevel()!;
    expect(loud).toBeGreaterThan(quiet);

    analyser.block = [1, -1, 1, -1];
    expect(readOutputLevel()).toBe(1);
  });

  it('is null when the analyser cannot be read', () => {
    const { ctx, analysers } = makeContext(true);
    getOutputTap(ctx);
    jest
      .spyOn(analysers[0], 'getFloatTimeDomainData')
      .mockImplementation(() => {
        throw new Error('closed');
      });
    expect(readOutputLevel()).toBeNull();
  });
});
