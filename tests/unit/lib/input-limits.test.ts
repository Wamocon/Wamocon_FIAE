/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import {
  MAX_COMMENT_LENGTH,
  MAX_REASON_LENGTH,
  invalidText,
  readJsonObject,
} from '@/lib/input-limits';

// Behavior under test: src/lib/input-limits.ts. Free text of a trainer (grade
// comments, the reason of a change) and the body of a request have to be
// bounded and well formed. Anything else is a 400, never a 500 and never a
// megabyte in a text column.

describe('limits', () => {
  it('allow a long comment but not an essay, and a short reason', () => {
    // 4000 characters are about one page, longer than any grade comment of a
    // trainer. The existing feedback of a report review allows 5000.
    expect(MAX_COMMENT_LENGTH).toBe(4000);
    expect(MAX_REASON_LENGTH).toBe(1000);
    expect(MAX_REASON_LENGTH).toBeLessThan(MAX_COMMENT_LENGTH);
  });
});

describe('invalidText', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['a short text', 'gut gemacht'],
    ['a text of exactly the limit', 'x'.repeat(50)],
    ['text with umlauts', 'Prüfung bestanden, äöüß'],
  ])('lets %s through', (_name, value) => {
    expect(invalidText('comment', value, 50)).toBeNull();
  });

  it.each(['a\u0000b', '\u0000'])(
    'answers 400 for a text with a NUL character (%j), which a text column cannot hold',
    async value => {
      const res = invalidText('comment', value, 50);
      expect(res!.status).toBe(400);
    }
  );

  it('answers 400 for a text over the limit and names field and limit', async () => {
    const res = invalidText('comment', 'x'.repeat(11), 10);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    expect(await res!.json()).toEqual({
      error: 'comment must be text of at most 10 characters',
    });
  });

  it.each([
    ['a number', 42],
    ['an object', { a: 1 }],
    ['an array', ['x']],
    ['true', true],
  ])('answers 400 for %s', (_name, value) => {
    expect(invalidText('editReason', value, 10)!.status).toBe(400);
  });

  it('does not echo the value', async () => {
    const res = invalidText('comment', '<script>' + 'x'.repeat(20), 10);
    expect(JSON.stringify(await res!.json())).not.toContain('script');
  });

  it('counts characters of the string, not bytes', () => {
    expect(invalidText('comment', 'ä'.repeat(10), 10)).toBeNull();
  });
});

describe('readJsonObject', () => {
  const request = (body: unknown, fail = false) => ({
    json: async () => {
      if (fail) throw new SyntaxError('Unexpected token');
      return body;
    },
  });

  it('returns a plain object', async () => {
    expect(await readJsonObject(request({ a: 1 }))).toEqual({ a: 1 });
  });

  it('answers 400 for a body that is not JSON', async () => {
    const res = (await readJsonObject(request(null, true))) as Response;
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['a number', 7],
    ['an array', [1]],
    ['true', true],
  ])('answers 400 for JSON that is %s', async (_name, body) => {
    const res = (await readJsonObject(request(body))) as Response;
    expect(res.status).toBe(400);
  });
});
