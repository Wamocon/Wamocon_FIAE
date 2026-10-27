import fs from 'fs';
import path from 'path';
import {
  FILE_STATUSES,
  FILE_TRANSITIONS,
  RUN_STATUSES,
  RUN_TRANSITIONS,
  canTransitionFile,
  canTransitionRun,
  isFileStatus,
  isRunStatus,
} from '@/lib/content-upload/staging/status';

function checkValues(constraint: string): string[] {
  const migration = fs.readFileSync(
    path.join(
      process.cwd(),
      'supabase/migrations/20261030000100_content_upload_tables.sql'
    ),
    'utf8'
  );
  const match = new RegExp(
    `${constraint}\\s+check \\(status in \\(([^)]*)\\)\\)`
  ).exec(migration);
  expect(match).not.toBeNull();
  return match![1].split(',').map(s => s.trim().replace(/'/g, ''));
}

describe('run status model (concept 2.3)', () => {
  it('has exactly the eight states of the database check', () => {
    expect([...RUN_STATUSES].sort()).toEqual(
      checkValues('content_upload_runs_status_check').sort()
    );
  });

  it.each([
    ['draft', ['uploading', 'discarded']],
    ['uploading', ['processing', 'discarded']],
    ['processing', ['review', 'discarded']],
    ['review', ['applying', 'processing', 'discarded']],
    ['applying', ['review', 'applied', 'failed']],
    ['applied', ['review', 'discarded']],
    ['failed', ['review', 'discarded']],
    ['discarded', []],
  ] as const)('%s may go to %j and nowhere else', (from, allowed) => {
    expect([...RUN_TRANSITIONS[from]].sort()).toEqual([...allowed].sort());
    for (const to of RUN_STATUSES) {
      expect(canTransitionRun(from, to)).toBe(
        (allowed as readonly string[]).includes(to)
      );
    }
  });

  it('knows its own values', () => {
    expect(isRunStatus('review')).toBe(true);
    expect(isRunStatus('REVIEW')).toBe(false);
    expect(isRunStatus(undefined)).toBe(false);
  });
});

describe('file status model (concept 2.3)', () => {
  it('has exactly the sixteen states of the database check', () => {
    expect([...FILE_STATUSES].sort()).toEqual(
      checkValues('content_upload_files_status_check').sort()
    );
  });

  it('follows the main line announced to applied', () => {
    const line = [
      'announced',
      'uploaded',
      'verified',
      'extracted',
      'proposed_rules',
      'decided',
      'applied',
    ] as const;
    for (let i = 0; i < line.length - 1; i++) {
      expect(canTransitionFile(line[i], line[i + 1])).toBe(true);
    }
  });

  it('has the branches of the diagram', () => {
    expect(canTransitionFile('extracted', 'unclear')).toBe(true);
    expect(canTransitionFile('unclear', 'ki_pending')).toBe(true);
    expect(canTransitionFile('ki_pending', 'proposed_ki')).toBe(true);
    expect(canTransitionFile('ki_pending', 'unclear')).toBe(true);
    expect(canTransitionFile('proposed_ki', 'decided')).toBe(true);
    expect(canTransitionFile('unclear', 'decided')).toBe(true);
    expect(canTransitionFile('announced', 'expired')).toBe(true);
    expect(canTransitionFile('announced', 'rejected')).toBe(true);
    expect(canTransitionFile('uploaded', 'rejected')).toBe(true);
    expect(canTransitionFile('uploaded', 'failed')).toBe(true);
    expect(canTransitionFile('verified', 'failed')).toBe(true);
    expect(canTransitionFile('extracted', 'failed')).toBe(true);
  });

  it('does not skip steps or go backwards', () => {
    expect(canTransitionFile('announced', 'verified')).toBe(false);
    expect(canTransitionFile('announced', 'applied')).toBe(false);
    expect(canTransitionFile('uploaded', 'extracted')).toBe(false);
    expect(canTransitionFile('verified', 'uploaded')).toBe(false);
    expect(canTransitionFile('decided', 'verified')).toBe(false);
    expect(canTransitionFile('applied', 'decided')).toBe(false);
  });

  it.each(['rejected', 'expired', 'merged', 'applied', 'failed'] as const)(
    '%s is final',
    status => {
      expect(FILE_TRANSITIONS[status]).toEqual([]);
      for (const to of FILE_STATUSES) {
        expect(canTransitionFile(status, to)).toBe(false);
      }
    }
  );

  it('a merged copy is only created, never reached', () => {
    for (const from of FILE_STATUSES) {
      expect(canTransitionFile(from, 'merged')).toBe(false);
    }
  });

  it('knows its own values', () => {
    expect(isFileStatus('uploaded')).toBe(true);
    expect(isFileStatus('done')).toBe(false);
    expect(isFileStatus(3)).toBe(false);
  });
});
