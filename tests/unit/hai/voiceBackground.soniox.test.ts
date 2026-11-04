import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import {
  SonioxRecognition,
  readTranscriptMessage,
} from '@/lib/hai/voice/client/soniox';
import type { UtteranceInfo } from '@/lib/hai/voice/client/types';
import { makeDeps } from './voiceClient.helpers';

// What the recognition tells the loop beside the text: the clock time of the words and the
// mean confidence. The loop judges the utterance by it (loudness gate, confidence). Soniox
// documents per token start_ms, end_ms, confidence (0.0 to 1.0) and, only when asked for,
// speaker (https://docs.soniox.com/stt/api-reference/websocket-api, checked 04.11.2026).

describe('readTranscriptMessage: time and confidence of final tokens', () => {
  it('collects start, end and confidence of the final tokens, never their text', () => {
    const update = readTranscriptMessage(
      JSON.stringify({
        tokens: [
          {
            text: 'Was',
            is_final: true,
            start_ms: 120,
            end_ms: 400,
            confidence: 0.98,
          },
          {
            text: ' ist',
            is_final: false,
            start_ms: 400,
            end_ms: 600,
            confidence: 0.5,
          },
          {
            text: ' ein',
            is_final: true,
            start_ms: 410,
            end_ms: 560,
            confidence: 0.9,
          },
          { text: '<end>', is_final: true },
        ],
      })
    );
    expect(update.finalTokens).toEqual([
      { startMs: 120, endMs: 400, confidence: 0.98 },
      { startMs: 410, endMs: 560, confidence: 0.9 },
    ]);
    expect(update.endpoint).toBe(true);
  });

  it('a token without the fields (or with nonsense) gives an empty entry', () => {
    const update = readTranscriptMessage(
      JSON.stringify({
        tokens: [
          { text: 'a', is_final: true },
          {
            text: 'b',
            is_final: true,
            start_ms: 'x',
            end_ms: null,
            confidence: 'high',
          },
        ],
      })
    );
    expect(update.finalTokens).toEqual([{}, {}]);
  });
});

describe('SonioxRecognition in live mode: what an utterance carries', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-04T10:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  async function live() {
    const t = makeDeps();
    const rec = new SonioxRecognition(t.deps);
    rec.continuous = true;
    const heard: Array<{ text: string; info?: UtteranceInfo }> = [];
    rec.onutterance = (text, info) => heard.push({ text, info });
    rec.start();
    await jest.advanceTimersByTimeAsync(0);
    const socket = t.sockets[0];
    socket.open();
    return { t, rec, socket, heard, origin: Date.now() };
  }

  it('gives the clock time of the first and last word and the mean confidence', async () => {
    const { socket, heard, origin } = await live();
    await jest.advanceTimersByTimeAsync(3_000);
    socket.receive({
      tokens: [
        {
          text: 'Was',
          is_final: true,
          start_ms: 500,
          end_ms: 900,
          confidence: 1,
        },
        {
          text: ' ist',
          is_final: true,
          start_ms: 900,
          end_ms: 1_200,
          confidence: 0.8,
        },
        {
          text: ' das?',
          is_final: true,
          start_ms: 1_200,
          end_ms: 1_700,
          confidence: 0.6,
        },
        { text: '<end>', is_final: true },
      ],
    });
    expect(heard).toHaveLength(1);
    expect(heard[0].text).toBe('Was ist das?');
    expect(heard[0].info?.startAt).toBe(origin + 500);
    expect(heard[0].info?.endAt).toBe(origin + 1_700);
    expect(heard[0].info?.confidence).toBeCloseTo(0.8, 5);
  });

  it('the next utterance starts with fresh numbers', async () => {
    const { socket, heard, origin } = await live();
    await jest.advanceTimersByTimeAsync(10_000);
    socket.receive({
      tokens: [
        {
          text: 'Eins',
          is_final: true,
          start_ms: 1_000,
          end_ms: 1_400,
          confidence: 0.3,
        },
        { text: '<end>', is_final: true },
      ],
    });
    socket.receive({
      tokens: [
        {
          text: 'Zwei',
          is_final: true,
          start_ms: 6_000,
          end_ms: 6_400,
          confidence: 0.99,
        },
        { text: '<end>', is_final: true },
      ],
    });
    expect(heard[0].info?.confidence).toBeCloseTo(0.3, 5);
    expect(heard[1].info?.startAt).toBe(origin + 6_000);
    expect(heard[1].info?.confidence).toBeCloseTo(0.99, 5);
  });

  it('without time in the tokens the time the words arrived in is the window, without confidence there is none', async () => {
    const { socket, heard } = await live();
    await jest.advanceTimersByTimeAsync(2_000);
    const arrived = Date.now();
    socket.receive({ tokens: [{ text: 'Hallo', is_final: false }] });
    await jest.advanceTimersByTimeAsync(800);
    socket.receive({
      tokens: [
        { text: 'Hallo', is_final: true },
        { text: '<end>', is_final: true },
      ],
    });
    expect(heard[0].info?.startAt).toBe(arrived - 600);
    expect(heard[0].info?.endAt).toBe(Date.now());
    expect(heard[0].info?.confidence).toBeUndefined();
  });

  it('a window that does not fit the clock (words in the future) is replaced by the arrival time', async () => {
    const { socket, heard } = await live();
    await jest.advanceTimersByTimeAsync(1_000);
    socket.receive({
      tokens: [
        {
          text: 'Hallo',
          is_final: true,
          start_ms: 90_000,
          end_ms: 91_000,
          confidence: 0.9,
        },
        { text: '<end>', is_final: true },
      ],
    });
    const info = heard[0].info as UtteranceInfo;
    expect(info.endAt).toBe(Date.now());
    expect(info.startAt).toBe(Date.now() - 600);
  });

  it('an endpoint without a word delivers nothing and leaves nothing behind for the next', async () => {
    const { socket, heard, origin } = await live();
    await jest.advanceTimersByTimeAsync(5_000);
    socket.receive({ tokens: [{ text: '<end>', is_final: true }] });
    expect(heard).toHaveLength(0);
    socket.receive({
      tokens: [
        {
          text: 'Ja',
          is_final: true,
          start_ms: 4_000,
          end_ms: 4_300,
          confidence: 0.7,
        },
        { text: '<end>', is_final: true },
      ],
    });
    expect(heard[0].info?.startAt).toBe(origin + 4_000);
    expect(heard[0].info?.confidence).toBeCloseTo(0.7, 5);
  });
});
