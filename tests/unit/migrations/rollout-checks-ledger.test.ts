/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// Found in the rehearsal of 02.11.2026 (B3): check N01 of the rollout checks lists the
// ledger versions the release has to apply. It had been written for 34 files and was not
// extended when four more migration files were added, so it did not know them. The list
// has to follow the migration folder: every file of the series (from 20261023100000 on,
// plus the repaired 202606260001) must be in N01, and nothing else.

const ROOT = process.cwd();
const CHECKS = fs.readFileSync(
  path.join(ROOT, 'docs/kfbm-production-rollout-checks.sql'),
  'utf8'
);

function n01Block(): string {
  const start = CHECKS.indexOf('-- N01.');
  const end = CHECKS.indexOf('-- N02.');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return CHECKS.slice(start, end);
}

function versionsInN01(): string[] {
  return [...n01Block().matchAll(/\('(\d{12,14})'\)/g)].map(m => m[1]);
}

function seriesFiles(): string[] {
  return fs
    .readdirSync(path.join(ROOT, 'supabase/migrations'))
    .filter(f => f.endsWith('.sql'))
    .map(f => f.split('_')[0])
    .filter(v => v >= '20261023');
}

describe('rollout check N01 follows the migration folder', () => {
  it('lists every migration file of the series and the repaired baseline', () => {
    const expected = ['202606260001', ...seriesFiles()].sort();
    expect([...versionsInN01()].sort()).toEqual(expected);
  });

  it('has no version twice', () => {
    const versions = versionsInN01();
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('states the number of files in its comment', () => {
    const files = seriesFiles().length;
    expect(n01Block()).toContain(`${files + 1} files of the repository`);
    expect(n01Block()).toContain(`the ${files} files`);
  });
});
