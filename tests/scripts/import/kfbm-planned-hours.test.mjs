import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  distributeHours,
  parseArgs,
} from '../../../scripts/import/kfbm-planned-hours.mjs';

test('the total hours are shared in whole hours and the sum stays the total', () => {
  assert.deepEqual(distributeHours(440, 6), [74, 74, 73, 73, 73, 73]);
  assert.deepEqual(distributeHours(440, 10), Array(10).fill(44));
  assert.deepEqual(distributeHours(80, 1), [80]);
  for (const [total, count] of [
    [880, 21],
    [200, 3],
    [80, 3],
    [360, 8],
  ]) {
    const share = distributeHours(total, count);
    assert.equal(share.length, count);
    assert.equal(
      share.reduce((a, b) => a + b, 0),
      total
    );
    assert.ok(Math.max(...share) - Math.min(...share) <= 1);
  }
});

test('nothing is shared without hours or without use cases', () => {
  assert.deepEqual(distributeHours(0, 5), []);
  assert.deepEqual(distributeHours(-10, 5), []);
  assert.deepEqual(distributeHours(NaN, 5), []);
  assert.deepEqual(distributeHours(100, 0), []);
  assert.deepEqual(distributeHours(100, 2.5), []);
});

test('the arguments allow only the Preview', () => {
  assert.deepEqual(parseArgs(['plan', '--target', 'preview']).errors, []);
  assert.ok(parseArgs(['plan', '--target', 'production']).errors.length);
  assert.ok(parseArgs(['plan']).errors.length);
  assert.ok(
    parseArgs(['plan', '--target', 'preview', '--apply']).errors.length
  );
  assert.ok(parseArgs(['rollback', '--target', 'preview']).errors.length);
  assert.deepEqual(
    parseArgs(['rollback', 'bericht.json', '--target', 'preview', '--apply'])
      .errors,
    []
  );
});
