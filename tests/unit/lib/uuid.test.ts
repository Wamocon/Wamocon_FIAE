/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import { badRequestUnlessUuid, isUuid, notFoundUnlessUuid } from '@/lib/uuid';

// Behavior under test: src/lib/uuid.ts, the one place that decides whether a
// value has the shape of a uuid. A route that hands an id to a uuid column
// without this check answers a typo or a probe with 500, because the database
// rejects the value. A path id that is no uuid is a record that cannot exist
// (404), a body id that is no uuid is a malformed request (400).

const ID = '8b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11';

describe('isUuid', () => {
  it('accepts the usual forms, in both cases', () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid(ID.toUpperCase())).toBe(true);
    expect(isUuid('00000000-0000-0000-0000-000000000001')).toBe(true);
  });

  it.each([
    ['an empty string', ''],
    ['a word', 'not-a-uuid'],
    ['a short number', '42'],
    ['a uuid with a character too many', `${ID}0`],
    ['a uuid with a character too few', ID.slice(0, -1)],
    ['a uuid with a non hex character', ID.replace('8b1d', 'zb1d')],
    ['a uuid in braces', `{${ID}}`],
    ['a uuid without dashes', ID.replace(/-/g, '')],
    ['a uuid with a trailing newline', `${ID}\n`],
    ['a uuid followed by SQL', `${ID}'; drop table x; --`],
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
    ['an array holding a uuid', [ID]],
  ])('rejects %s', (_name, value) => {
    expect(isUuid(value)).toBe(false);
  });
});

describe('notFoundUnlessUuid (a path id)', () => {
  it('lets a uuid through', () => {
    expect(notFoundUnlessUuid(ID)).toBeNull();
  });

  it('answers 404 for anything else, with the message of the route', async () => {
    const res = notFoundUnlessUuid('abc', 'Block not found');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
    expect(await res!.json()).toEqual({ error: 'Block not found' });
  });

  it('says "Not found" without a message', async () => {
    expect(await notFoundUnlessUuid(undefined)!.json()).toEqual({
      error: 'Not found',
    });
  });
});

describe('badRequestUnlessUuid (a body id)', () => {
  it('lets a uuid through', () => {
    expect(badRequestUnlessUuid('criterionId', ID)).toBeNull();
  });

  it('answers 400 and names the field, never the value', async () => {
    const res = badRequestUnlessUuid('criterionId', 'x<script>');
    expect(res!.status).toBe(400);
    const body = await res!.json();
    expect(body).toEqual({ error: 'Invalid criterionId' });
    expect(JSON.stringify(body)).not.toContain('script');
  });
});
