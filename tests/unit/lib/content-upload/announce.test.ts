import { LIMITS } from '@/lib/content-upload/config';
import {
  parseAnnounceBody,
  planAnnouncement,
  validateEntry,
  type AnnounceFacts,
  type Candidate,
} from '@/lib/content-upload/announce';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const MB = 1024 * 1024;

function entry(overrides: Record<string, unknown> = {}) {
  return {
    path: 'K1/Enabler/a.docx',
    size: 1000,
    sha256: HASH_A,
    lastModified: 1_700_000_000_000,
    ...overrides,
  };
}

describe('parseAnnounceBody', () => {
  it('takes 1 to 50 entries', () => {
    expect(parseAnnounceBody({ files: [entry()] })).toEqual({
      ok: true,
      entries: [entry()],
    });
    const fifty = Array.from({ length: 50 }, () => entry());
    expect(parseAnnounceBody({ files: fifty }).ok).toBe(true);
  });

  it.each([
    [null],
    [undefined],
    ['x'],
    [[]],
    [{}],
    [{ files: 'x' }],
    [{ files: [] }],
    [{ files: Array.from({ length: 51 }, () => entry()) }],
  ])('refuses the body %j', body => {
    const result = parseAnnounceBody(body);
    expect(result.ok).toBe(false);
  });
});

describe('validateEntry', () => {
  it('cleans the path and lower cases the hash', () => {
    const result = validateEntry(
      entry({ path: 'C:\\x\\..\\a.PDF', sha256: HASH_A.toUpperCase() }),
      3
    );
    expect(result).toEqual({
      ok: true,
      entry: {
        index: 3,
        relPath: 'x/a.PDF',
        fileName: 'a.PDF',
        ext: 'pdf',
        sizeBytes: 1000,
        sha256: HASH_A,
        clientMtimeMs: 1_700_000_000_000,
      },
    });
  });

  it('reports a wrong extension with the reason and the cleaned path', () => {
    expect(validateEntry(entry({ path: 'a/b.doc' }), 0)).toEqual({
      ok: false,
      index: 0,
      code: 'UNSUPPORTED_EXTENSION',
      relPath: 'a/b.doc',
    });
  });

  it('reports a path that cannot be cleaned without a path', () => {
    expect(validateEntry(entry({ path: 42 }), 1)).toEqual({
      ok: false,
      index: 1,
      code: 'PATH_INVALID',
    });
  });

  it('rejects a bad size', () => {
    for (const size of [-1, 1.5, NaN, Infinity, '12', null, undefined]) {
      const r = validateEntry(entry({ size }), 0);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.code).toBe('SIZE_INVALID');
    }
    expect(validateEntry(entry({ size: 0 }), 0)).toMatchObject({
      ok: false,
      code: 'EMPTY_FILE',
    });
    expect(
      validateEntry(entry({ size: LIMITS.maxFileBytes + 1 }), 0)
    ).toMatchObject({ ok: false, code: 'TOO_LARGE' });
    expect(validateEntry(entry({ size: LIMITS.maxFileBytes }), 0).ok).toBe(
      true
    );
  });

  it('rejects a bad hash', () => {
    for (const sha256 of ['', 'abc', 'g'.repeat(64), HASH_A + 'a', 12, null]) {
      expect(validateEntry(entry({ sha256 }), 0)).toMatchObject({
        ok: false,
        code: 'HASH_INVALID',
      });
    }
  });

  it('drops a change time that is not plausible', () => {
    for (const lastModified of [-1, 1.5, 'x', null, 99999999999999999]) {
      const r = validateEntry(entry({ lastModified }), 0);
      expect(r.ok && r.entry.clientMtimeMs).toBeNull();
    }
    const missing = validateEntry(
      { path: 'a.pdf', size: 1, sha256: HASH_A },
      0
    );
    expect(missing.ok && missing.entry.clientMtimeMs).toBeNull();
  });

  it('treats a non-object entry as invalid', () => {
    expect(validateEntry(null, 0)).toMatchObject({
      ok: false,
      code: 'ENTRY_INVALID',
    });
    expect(validateEntry('a.pdf', 0)).toMatchObject({
      ok: false,
      code: 'ENTRY_INVALID',
    });
  });
});

function candidate(
  index: number,
  overrides: Partial<Candidate> = {}
): Candidate {
  return {
    index,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    relPath: `f${index}.docx`,
    fileName: `f${index}.docx`,
    ext: 'docx',
    sizeBytes: 1000,
    sha256: HASH_A,
    clientMtimeMs: null,
    storagePath: `upload/r/${index}.docx`,
    ...overrides,
  };
}

function facts(overrides: Partial<AnnounceFacts> = {}): AnnounceFacts {
  return {
    runFileCount: 0,
    runBytes: 0,
    stagingBytes: 0,
    existing: new Map(),
    mainBySha: new Map(),
    appliedBySha: new Map(),
    ...overrides,
  };
}

describe('planAnnouncement', () => {
  it('inserts new files as announced', () => {
    const plan = planAnnouncement(
      [candidate(0, { sha256: HASH_A }), candidate(1, { sha256: HASH_B })],
      facts()
    );
    expect(plan.items.map(i => i.kind)).toEqual(['insert', 'insert']);
    expect(plan.warnings).toEqual([]);
  });

  it('is idempotent: the same path and hash again is the existing file', () => {
    const existing = new Map([
      [
        'f0.docx\u0000' + HASH_A,
        { id: 'old-id', status: 'uploaded', storagePath: 'upload/r/old.docx' },
      ],
    ]);
    const plan = planAnnouncement([candidate(0)], facts({ existing }));
    expect(plan.items).toEqual([
      { kind: 'existing', index: 0, fileId: 'old-id', status: 'uploaded' },
    ]);
  });

  it('counts an existing file neither against the limits nor twice', () => {
    const existing = new Map([
      [
        'f0.docx\u0000' + HASH_A,
        { id: 'old-id', status: 'announced', storagePath: 'p' },
      ],
    ]);
    const plan = planAnnouncement(
      [candidate(0)],
      facts({
        existing,
        runFileCount: LIMITS.maxFilesPerRun,
        runBytes: LIMITS.maxRunBytes,
        stagingBytes: LIMITS.maxStagingBytes,
      })
    );
    expect(plan.items[0].kind).toBe('existing');
  });

  it('revives an expired file under the same id and path', () => {
    const existing = new Map([
      [
        'f0.docx\u0000' + HASH_A,
        { id: 'old-id', status: 'expired', storagePath: 'upload/r/old.docx' },
      ],
    ]);
    const plan = planAnnouncement([candidate(0)], facts({ existing }));
    expect(plan.items).toEqual([
      {
        kind: 'revive',
        index: 0,
        fileId: 'old-id',
        storagePath: 'upload/r/old.docx',
      },
    ]);
  });

  it('a revived file counts against the limits like a new one', () => {
    const existing = new Map([
      [
        'f0.docx\u0000' + HASH_A,
        { id: 'old-id', status: 'expired', storagePath: 'p' },
      ],
    ]);
    const plan = planAnnouncement(
      [candidate(0)],
      facts({ existing, runFileCount: LIMITS.maxFilesPerRun })
    );
    expect(plan.items).toEqual([
      { kind: 'reject', index: 0, code: 'RUN_FILE_LIMIT' },
    ]);
  });

  it('merges an exact copy inside the run, without an object', () => {
    const plan = planAnnouncement(
      [candidate(0, { sha256: HASH_A }), candidate(1, { sha256: HASH_A })],
      facts()
    );
    expect(plan.items[0].kind).toBe('insert');
    expect(plan.items[1]).toMatchObject({
      kind: 'merge',
      index: 1,
      duplicateOfId: candidate(0).id,
    });
  });

  it('merges into a file that is already in the run', () => {
    const mainBySha = new Map([[HASH_A, 'main-id']]);
    const plan = planAnnouncement(
      [candidate(0, { relPath: 'copy/x.docx' })],
      facts({ mainBySha })
    );
    expect(plan.items[0]).toMatchObject({
      kind: 'merge',
      duplicateOfId: 'main-id',
    });
  });

  it('a merged copy counts as a file but not as bytes', () => {
    const plan = planAnnouncement(
      [
        candidate(0, { sizeBytes: (600 * MB) / 24 }),
        candidate(1, { sizeBytes: (600 * MB) / 24 }),
      ],
      facts({
        mainBySha: new Map([[HASH_A, 'main']]),
        runFileCount: LIMITS.maxFilesPerRun - 1,
        runBytes: LIMITS.maxRunBytes,
        stagingBytes: LIMITS.maxStagingBytes,
      })
    );
    // the first merge takes the last file slot, the second one is over the limit
    expect(plan.items.map(i => i.kind)).toEqual(['merge', 'reject']);
    expect(plan.items[1]).toMatchObject({ code: 'RUN_FILE_LIMIT' });
  });

  it('the same path and hash twice in one request is one file', () => {
    const plan = planAnnouncement(
      [candidate(0), candidate(1, { relPath: 'f0.docx' })],
      facts()
    );
    expect(plan.items[0].kind).toBe('insert');
    expect(plan.items[1]).toEqual({
      kind: 'existing',
      index: 1,
      fileId: candidate(0).id,
      status: 'announced',
    });
  });

  it('rejects over the file limit of the run, later files still get their turn', () => {
    const plan = planAnnouncement(
      [
        candidate(0, { sha256: HASH_A }),
        candidate(1, { sha256: HASH_B }),
        candidate(2, { sha256: HASH_C }),
      ],
      facts({ runFileCount: LIMITS.maxFilesPerRun - 1 })
    );
    expect(plan.items.map(i => i.kind)).toEqual(['insert', 'reject', 'reject']);
    expect(plan.items[1]).toMatchObject({ code: 'RUN_FILE_LIMIT' });
  });

  it('rejects over the byte limit of the run and goes on with a smaller file', () => {
    const plan = planAnnouncement(
      [
        candidate(0, { sizeBytes: 20 * MB, sha256: HASH_A }),
        candidate(1, { sizeBytes: 1000, sha256: HASH_B }),
      ],
      facts({ runBytes: LIMITS.maxRunBytes - 10 * MB })
    );
    expect(plan.items[0]).toMatchObject({
      kind: 'reject',
      code: 'RUN_SIZE_LIMIT',
    });
    expect(plan.items[1].kind).toBe('insert');
  });

  it('accepts a file that fills the run to exactly the limit', () => {
    const plan = planAnnouncement(
      [candidate(0, { sizeBytes: 10 * MB })],
      facts({ runBytes: LIMITS.maxRunBytes - 10 * MB })
    );
    expect(plan.items[0].kind).toBe('insert');
  });

  it('rejects over the staging limit', () => {
    const plan = planAnnouncement(
      [candidate(0, { sizeBytes: 11 * MB })],
      facts({ stagingBytes: LIMITS.maxStagingBytes - 10 * MB })
    );
    expect(plan.items[0]).toMatchObject({
      kind: 'reject',
      code: 'STAGING_FULL',
    });
  });

  it('warns from 80 percent of the staging limit, with the numbers', () => {
    const used = Math.ceil(LIMITS.maxStagingBytes * 0.8) - 500;
    const plan = planAnnouncement(
      [candidate(0, { sizeBytes: 1000 })],
      facts({ stagingBytes: used })
    );
    expect(plan.items[0].kind).toBe('insert');
    expect(plan.warnings).toEqual([
      {
        code: 'STAGING_NEAR_LIMIT',
        usedBytes: used + 1000,
        limitBytes: LIMITS.maxStagingBytes,
      },
    ]);
  });

  it('does not warn below 80 percent', () => {
    const plan = planAnnouncement(
      [candidate(0)],
      facts({ stagingBytes: Math.floor(LIMITS.maxStagingBytes * 0.5) })
    );
    expect(plan.warnings).toEqual([]);
  });

  it('hints at a hash that an earlier run already applied', () => {
    const plan = planAnnouncement(
      [candidate(0, { sha256: HASH_A }), candidate(1, { sha256: HASH_B })],
      facts({ appliedBySha: new Map([[HASH_A, 'run-9']]) })
    );
    expect(plan.items[0]).toMatchObject({
      kind: 'insert',
      alreadyAppliedInRunId: 'run-9',
    });
    expect(plan.items[1]).not.toHaveProperty('alreadyAppliedInRunId');
  });
});
