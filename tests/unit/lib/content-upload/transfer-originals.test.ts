/**
 * @jest-environment node
 */
import { describe, expect, it, jest } from '@jest/globals';

import { createContentBucket } from '@/lib/content-upload/transfer/content-bucket';
import {
  OriginalsError,
  checkOriginalBytes,
  copyOriginals,
  enablerOfOriginal,
  evaluateOriginals,
  originalStoragePath,
  originalTitle,
  toEnablerOriginals,
} from '@/lib/content-upload/transfer/originals';
import {
  runTransfer,
  type TransferRequest,
} from '@/lib/content-upload/transfer/run';
import type { TransferFile } from '@/lib/content-upload/transfer/types';

import { CREATOR_ID } from '../../../helpers/memoryImportDb';
import { harness } from '../../../helpers/memoryTransfer';
import {
  docx,
  enablerFiles,
  fixtureFile,
  sha256,
  type FixtureFile,
} from '../../../helpers/transferFixtures';
import {
  CANARY,
  b,
  blocksToBody,
  docxBytes,
  enablerBlocks,
  pdfBytes,
  t,
} from '../../../helpers/uploadFixtures';

const OWNER = '11111111-0000-4000-8000-0000000000a7';

const lehrtext = async () =>
  new Uint8Array(await docxBytes(blocksToBody(enablerBlocks({ code: '4a' }))));
const pdf = (lines?: string[]) =>
  new Uint8Array(
    pdfBytes({
      pages: [
        lines ?? [
          'Ein erfundener Lehrtext über Netzwerke.',
          'Zweite Zeile des Lehrtexts über Router und Switches, lang genug.',
        ],
      ],
    })
  );

describe('checkOriginalBytes', () => {
  it('takes a plain enabler text, Word and PDF', async () => {
    expect(await checkOriginalBytes('docx', await lehrtext(), [])).toEqual({
      ok: true,
      pageCount: null,
    });
    expect(await checkOriginalBytes('pdf', pdf(), [])).toEqual({
      ok: true,
      pageCount: 1,
    });
  });

  it.each([
    [
      'comments',
      () =>
        docxBytes(blocksToBody(enablerBlocks({ code: '4a' })), {
          parts: { 'word/comments.xml': '<w:comments xmlns:w="x"/>' },
        }),
    ],
    [
      'tracked changes',
      () =>
        docxBytes(
          `${blocksToBody(enablerBlocks({ code: '4a' }))}<w:p><w:ins w:id="1" w:author="x"><w:r><w:t>neu</w:t></w:r></w:ins></w:p>`
        ),
    ],
    [
      'text boxes',
      () =>
        docxBytes(
          `${blocksToBody(enablerBlocks({ code: '4a' }))}<w:p><w:r><w:pict><w:txbxContent><w:p><w:r><w:t>Kasten</w:t></w:r></w:p></w:txbxContent></w:pict></w:r></w:p>`
        ),
    ],
    [
      'hidden text',
      () =>
        docxBytes(
          blocksToBody([
            ...enablerBlocks({ code: '4a' }),
            { text: 'Versteckt', hidden: true },
          ])
        ),
    ],
    [
      'an embedded object',
      () =>
        docxBytes(blocksToBody(enablerBlocks({ code: '4a' })), {
          parts: { 'word/embeddings/oleObject1.bin': Buffer.from('x') },
        }),
    ],
  ])('refuses a Word file with %s', async (_name, make) => {
    const bytes = new Uint8Array(await make());
    expect(await checkOriginalBytes('docx', bytes, [])).toMatchObject({
      ok: false,
      code: 'ORIGINAL_FEATURES',
    });
  });

  it('refuses a PDF with a script or an action', async () => {
    const withScript = new Uint8Array(
      pdfBytes({
        pages: [
          ['Ein erfundener Lehrtext, lang genug für den Test des Lesers.'],
        ],
        catalog: '/OpenAction << /S /JavaScript /JS (app.alert(1)) >>',
      })
    );
    expect(await checkOriginalBytes('pdf', withScript, [])).toMatchObject({
      ok: false,
      code: 'ORIGINAL_FEATURES',
    });
  });

  it('refuses a file that cannot be read', async () => {
    expect(
      await checkOriginalBytes('docx', new Uint8Array([1, 2, 3]), [])
    ).toMatchObject({ ok: false, code: 'ORIGINAL_UNREADABLE' });
    expect(
      await checkOriginalBytes('pdf', new Uint8Array([1, 2, 3]), [])
    ).toMatchObject({ ok: false, code: 'ORIGINAL_UNREADABLE' });
  });

  it('refuses a marker word of a solution and a long solution text of the plan', async () => {
    const marker = new Uint8Array(
      await docxBytes(
        blocksToBody([
          ...enablerBlocks({ code: '4a' }),
          b('Musterlösung'),
          t('Etwas'),
        ])
      )
    );
    expect(await checkOriginalBytes('docx', marker, [])).toMatchObject({
      ok: false,
      code: 'SOLUTION_MARKER',
    });
    const leak = new Uint8Array(
      await docxBytes(
        blocksToBody([
          ...enablerBlocks({ code: '4a' }),
          t(CANARY.scenarioSolution),
        ])
      )
    );
    expect(
      await checkOriginalBytes('docx', leak, [CANARY.scenarioSolution])
    ).toMatchObject({ ok: false, code: 'SOLUTION_TEXT' });
    expect(await checkOriginalBytes('docx', leak, [])).toMatchObject({
      ok: true,
    });
    expect(
      await checkOriginalBytes(
        'pdf',
        pdf([
          'Ein erfundener Lehrtext ueber Netzwerke, der lang genug ist fuer den Leser.',
          'Richtige Antwort: B zum Test',
        ]),
        []
      )
    ).toMatchObject({ ok: false, code: 'SOLUTION_MARKER' });
  });
});

async function textFile(
  options: Partial<Parameters<typeof fixtureFile>[1]> = {}
): Promise<FixtureFile> {
  return fixtureFile(await lehrtext(), {
    name: '4a.docx',
    docType: 'enabler',
    componentCode: 'K4',
    enablerCode: 'K4-a',
    ...options,
  });
}
const pdfOriginal = (
  options: Partial<Parameters<typeof fixtureFile>[1]> = {}
) =>
  fixtureFile(pdf(), {
    ext: 'pdf',
    name: '4a.pdf',
    docType: 'pdf_original',
    componentCode: 'K4',
    enablerCode: 'K4-a',
    dupKey: 'pdf:enabler:4a',
    ...options,
  });

describe('enablerOfOriginal', () => {
  it('knows the Word file of an enabler text and the PDF original of one', async () => {
    expect(enablerOfOriginal((await textFile()).file)).toBe('K4-a');
    expect(enablerOfOriginal(pdfOriginal().file)).toBe('K4-a');
  });

  it('knows nothing else: no quiz, no scenario, no use case, no PDF of a quiz, nothing not accepted', async () => {
    for (const docType of ['quiz', 'scenario', 'use_case', 'global_quiz']) {
      expect(enablerOfOriginal((await textFile({ docType })).file)).toBeNull();
    }
    expect(
      enablerOfOriginal(pdfOriginal({ dupKey: 'pdf:quiz:4a:low' }).file)
    ).toBeNull();
    expect(enablerOfOriginal(pdfOriginal({ dupKey: null }).file)).toBeNull();
    expect(
      enablerOfOriginal((await textFile({ action: 'reject' })).file)
    ).toBeNull();
    expect(
      enablerOfOriginal((await textFile({ enablerCode: null })).file)
    ).toBeNull();
    // a Word file typed as a PDF original, and a PDF typed as an enabler
    expect(enablerOfOriginal(pdfOriginal({ ext: 'docx' }).file)).toBeNull();
    expect(enablerOfOriginal((await textFile({ ext: 'pdf' })).file)).toBeNull();
  });
});

describe('evaluateOriginals', () => {
  const run = async (
    fixtures: FixtureFile[],
    requested: string[],
    solutions: string[] = []
  ) => {
    const bytes = new Map(fixtures.map(f => [f.file.id, f.bytes]));
    return evaluateOriginals({
      requested,
      files: fixtures.map(f => f.file),
      readBytes: async (f: TransferFile) => bytes.get(f.id) ?? null,
      solutions,
      plannedFileIds: new Set(fixtures.map(f => f.file.id)),
    });
  };

  it('takes the files that pass and says why it refuses the others, in order of the ids', async () => {
    const good = await textFile();
    const quiz = (await enablerFiles({ tree: true })).find(
      f => f.file.decision.docType === 'quiz'
    )!;
    const skipped = await textFile({ dupChoice: 'skip', name: 'x.docx' });
    const gone = await textFile({ objectDeleted: true, name: 'y.docx' });
    const marker = fixtureFile(
      new Uint8Array(
        await docxBytes(
          blocksToBody([...enablerBlocks({ code: '4a' }), b('Lösung')])
        )
      ),
      {
        name: 'z.docx',
        docType: 'enabler',
        componentCode: 'K4',
        enablerCode: 'K4-b',
      }
    );
    const result = await run(
      [good, quiz, skipped, gone, marker],
      [
        good.file.id,
        quiz.file.id,
        skipped.file.id,
        gone.file.id,
        marker.file.id,
        'bbbbbbbb-0000-4000-8000-000000000999',
        good.file.id,
      ]
    );
    expect(result.plans).toEqual([
      {
        fileId: good.file.id,
        sha256: good.file.sha256,
        enablerCode: 'K4-a',
        ext: 'docx',
        sizeBytes: good.file.sizeBytes,
        pageCount: null,
      },
    ]);
    expect(
      Object.fromEntries(result.refused.map(r => [r.fileId, r.code]))
    ).toEqual({
      [quiz.file.id]: 'NOT_AN_ENABLER_TEXT',
      [skipped.file.id]: 'FILE_NOT_USABLE',
      [gone.file.id]: 'FILE_NOT_USABLE',
      [marker.file.id]: 'SOLUTION_MARKER',
      'bbbbbbbb-0000-4000-8000-000000000999': 'FILE_NOT_FOUND',
    });
    // no refusal quotes a text of a file
    expect(JSON.stringify(result.refused)).not.toMatch(/Netzwerk|Router/);
  });

  it('takes Word and PDF of one enabler, and only one of each', async () => {
    const word = await textFile();
    const second = await textFile({ name: 'again.docx' });
    const pdfFile = pdfOriginal();
    const result = await run(
      [word, second, pdfFile],
      [word.file.id, second.file.id, pdfFile.file.id]
    );
    expect(result.plans.map(p => p.ext).sort()).toEqual(['docx', 'pdf']);
    expect(result.plans.find(p => p.ext === 'pdf')?.pageCount).toBe(1);
    expect(result.refused.map(r => r.code)).toEqual(['DUPLICATE_ORIGINAL']);
  });

  it('refuses a Word file that the plan left out, but takes a PDF original', async () => {
    const word = await textFile();
    const pdfFile = pdfOriginal();
    const result = await evaluateOriginals({
      requested: [word.file.id, pdfFile.file.id],
      files: [word.file, pdfFile.file],
      readBytes: async f =>
        f.id === word.file.id ? word.bytes : pdfFile.bytes,
      solutions: [],
      plannedFileIds: new Set(),
    });
    expect(result.plans.map(p => p.ext)).toEqual(['pdf']);
    expect(result.refused).toEqual([
      expect.objectContaining({ fileId: word.file.id, code: 'NOT_IN_PLAN' }),
    ]);
  });

  it('treats an object that cannot be read like a missing one', async () => {
    const f = await textFile();
    const result = await evaluateOriginals({
      requested: [f.file.id],
      files: [f.file],
      readBytes: async () => {
        throw new Error('storage down');
      },
      solutions: [],
      plannedFileIds: new Set([f.file.id]),
    });
    expect(result.plans).toEqual([]);
    expect(result.refused[0]).toMatchObject({ code: 'FILE_NOT_USABLE' });
    const none = await evaluateOriginals({
      requested: [f.file.id],
      files: [f.file],
      readBytes: async () => null,
      solutions: [],
      plannedFileIds: new Set([f.file.id]),
    });
    expect(none.refused[0].code).toBe('FILE_NOT_USABLE');
  });
});

describe('the path and the row of an original', () => {
  it('has the one form of the document bucket: <owner>/<timestamp>_<ascii name>', () => {
    const path = originalStoragePath(
      OWNER,
      { enablerCode: 'K6.2-d', ext: 'pdf' },
      1730000000000
    );
    expect(path).toBe(`${OWNER}/1730000000000_K6.2-d_lehrtext.pdf`);
    expect(
      originalStoragePath(OWNER, { enablerCode: 'K ö/..', ext: 'docx' }, 5)
    ).toBe(`${OWNER}/5_K___.._lehrtext.docx`);
  });

  it('gives no path for an owner that is no id', () => {
    expect(
      originalStoragePath('../x', { enablerCode: 'K1-a', ext: 'pdf' }, 1)
    ).toBeNull();
    expect(
      originalStoragePath('', { enablerCode: 'K1-a', ext: 'pdf' }, 1)
    ).toBeNull();
  });

  it('builds the engine input with a title per enabler and format', () => {
    const [pdfRow, wordRow] = toEnablerOriginals(
      [
        {
          fileId: 'a',
          sha256: 'x',
          enablerCode: 'K4-a',
          ext: 'pdf',
          sizeBytes: 100,
          pageCount: 3,
        },
        {
          fileId: 'b',
          sha256: 'y',
          enablerCode: 'K4-a',
          ext: 'docx',
          sizeBytes: 200,
          pageCount: null,
        },
      ],
      OWNER,
      0
    );
    expect(pdfRow.original).toMatchObject({
      enablerCode: 'K4-a',
      title: originalTitle('K4-a', 'pdf'),
      mimeType: 'application/pdf',
      fileSize: 100,
      pageCount: 3,
      fileName: '0_K4-a_lehrtext.pdf',
    });
    expect(wordRow.original.mimeType).toContain('wordprocessingml');
    expect(pdfRow.original.title).not.toBe(wordRow.original.title);
    expect(toEnablerOriginals([pdfRow.plan], '../x', 0)).toEqual([]);
  });
});

describe('copyOriginals', () => {
  const item = async (name = '4a.docx') => {
    const f = await textFile({ name });
    const [{ original }] = toEnablerOriginals(
      [
        {
          fileId: f.file.id,
          sha256: f.file.sha256,
          enablerCode: 'K4-a',
          ext: 'docx',
          sizeBytes: f.bytes.length,
          pageCount: null,
        },
      ],
      OWNER,
      42
    );
    return { fixture: f, original };
  };

  it('copies every file after it compared the hash, and returns the paths', async () => {
    const { fixture, original } = await item();
    const put = jest.fn(async () => undefined);
    const stored = await copyOriginals(
      { put, remove: async () => undefined },
      [{ file: fixture.file, original }],
      async () => fixture.bytes
    );
    expect(stored).toEqual([original.storagePath]);
    expect(put).toHaveBeenCalledWith(
      original.storagePath,
      fixture.bytes,
      original.mimeType
    );
  });

  it('removes what it copied when a later file fails, and throws', async () => {
    const one = await item('one.docx');
    const two = await item('two.docx');
    two.original = { ...two.original, storagePath: `${OWNER}/43_other.docx` };
    const removed: string[][] = [];
    const calls: string[] = [];
    await expect(
      copyOriginals(
        {
          put: async path => {
            calls.push(path);
            if (calls.length === 2) throw new Error('bucket full');
          },
          remove: async paths => {
            removed.push([...paths]);
          },
        },
        [
          { file: one.fixture.file, original: one.original },
          { file: two.fixture.file, original: two.original },
        ],
        async f =>
          f.id === one.fixture.file.id ? one.fixture.bytes : two.fixture.bytes
      )
    ).rejects.toThrow('bucket full');
    expect(removed).toEqual([[one.original.storagePath]]);
  });

  it('refuses a file whose bytes do not match the hash, and one that is gone', async () => {
    const { fixture, original } = await item();
    const removed: string[][] = [];
    const port = {
      put: async () => undefined,
      remove: async (p: readonly string[]) => {
        removed.push([...p]);
      },
    };
    await expect(
      copyOriginals(
        port,
        [{ file: fixture.file, original }],
        async () => new Uint8Array([9])
      )
    ).rejects.toMatchObject({ code: 'ORIGINAL_HASH' });
    await expect(
      copyOriginals(port, [{ file: fixture.file, original }], async () => null)
    ).rejects.toMatchObject({ code: 'ORIGINAL_MISSING' });
    expect(sha256(fixture.bytes)).toBe(fixture.file.sha256);
    expect(removed).toEqual([[], []]);
  });

  it('keeps the first error when the clean up fails as well', async () => {
    const { fixture, original } = await item();
    await expect(
      copyOriginals(
        {
          put: async () => {
            throw new Error('first');
          },
          remove: async () => {
            throw new Error('second');
          },
        },
        [{ file: fixture.file, original }],
        async () => fixture.bytes
      )
    ).rejects.toThrow('first');
  });
});

describe('the time of the copies', () => {
  it('stops with COPY_TIMEOUT when the time is over, and takes out what it copied', async () => {
    const one = await textFile();
    const [{ original }] = toEnablerOriginals(
      [
        {
          fileId: one.file.id,
          sha256: one.file.sha256,
          enablerCode: 'K4-a',
          ext: 'docx',
          sizeBytes: 1,
          pageCount: null,
        },
      ],
      OWNER,
      9
    );
    const put = jest.fn(async () => undefined);
    await expect(
      copyOriginals(
        { put, remove: async () => undefined },
        [{ file: one.file, original }],
        async () => one.bytes,
        { deadline: Date.now() - 1 }
      )
    ).rejects.toMatchObject({ code: 'COPY_TIMEOUT' });
    expect(put).not.toHaveBeenCalled();
  });

  it('refuses a Word file with footnotes: they are not read by the guard', async () => {
    const bytes = new Uint8Array(
      await docxBytes(blocksToBody(enablerBlocks({ code: '4a' })), {
        parts: { 'word/footnotes.xml': '<w:footnotes xmlns:w="x"/>' },
      })
    );
    expect(await checkOriginalBytes('docx', bytes, [])).toMatchObject({
      ok: false,
      code: 'ORIGINAL_FEATURES',
    });
  });
});

describe('the document bucket', () => {
  const OK = `${OWNER}/42_K4-a_lehrtext.pdf`;
  function bucket(result: { error: unknown } = { error: null }) {
    const upload = jest.fn(async () => result);
    const remove = jest.fn(async () => result);
    const from = jest.fn(() => ({ upload, remove }));
    const port = createContentBucket({
      supabaseUrl: 'https://project.example',
      secretKey: 'key',
      createClientImpl: (() => ({ storage: { from } })) as any,
    });
    return { port, upload, remove, from };
  }

  it('writes only to the bucket content, never replaces and sets the type', async () => {
    const { port, upload, from } = bucket();
    await port.put(OK, new Uint8Array([1]), 'application/pdf');
    expect(from).toHaveBeenCalledWith('content');
    expect(upload).toHaveBeenCalledWith(OK, new Uint8Array([1]), {
      contentType: 'application/pdf',
      upsert: false,
    });
  });

  it.each([
    'upload/x/y.pdf',
    `${OWNER}/../x/1_a.pdf`,
    `${OWNER}/a/b.pdf`,
    `${OWNER}/name.pdf`,
    `${OWNER}/42_a b.pdf`,
    `/${OWNER}/42_a.pdf`,
    'https://x.example/storage/v1/object/public/content/a/1_b.pdf',
    '',
  ])('refuses the path %s before any call', async path => {
    const { port, upload, remove } = bucket();
    await expect(
      port.put(path, new Uint8Array([1]), 'application/pdf')
    ).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
    await expect(port.remove([OK, path])).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
    expect(upload).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('removes paths of the form and does nothing for an empty list', async () => {
    const { port, remove } = bucket();
    await port.remove([]);
    expect(remove).not.toHaveBeenCalled();
    await port.remove([OK]);
    expect(remove).toHaveBeenCalledWith([OK]);
  });

  it('reports a failure of the storage without its text', async () => {
    const { port } = bucket({ error: new Error('secret detail') });
    await expect(
      port.put(OK, new Uint8Array([1]), 'application/pdf')
    ).rejects.toMatchObject({
      code: 'PUT_FAILED',
      message: expect.not.stringContaining('secret'),
    });
    await expect(port.remove([OK])).rejects.toMatchObject({
      code: 'REMOVE_FAILED',
    });
  });

  it('is not available without a project and a key', () => {
    const original = { ...process.env };
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    try {
      expect(() => createContentBucket({ secretKey: 'k' })).toThrow(
        OriginalsError
      );
      expect(() =>
        createContentBucket({ supabaseUrl: 'https://x.example', secretKey: '' })
      ).toThrow(OriginalsError);
    } finally {
      process.env = original;
    }
  });
});

describe('runTransfer with originals', () => {
  const request = (
    mode: 'dry_run' | 'apply',
    extra: Partial<TransferRequest> = {}
  ): TransferRequest => ({
    runId: 'cccccccc-0000-4000-8000-000000000001',
    callerId: CREATOR_ID,
    mode,
    replaceFiles: [],
    publishOriginals: [],
    ...(mode === 'apply' ? { confirm: 'KFBM' } : {}),
    ...extra,
  });

  async function withOriginal() {
    const files = await enablerFiles({ tree: true });
    const original = pdfOriginal();
    const h = harness([...files, original]);
    const enablerId = files[0].file.id;
    return { h, files, original, enablerId };
  }

  it('shows the original in the dry run and does not touch the bucket', async () => {
    const { h, original } = await withOriginal();
    const result = await runTransfer(
      h.deps,
      request('dry_run', { publishOriginals: [original.file.id] })
    );
    expect(result.ok && result.data.originals).toEqual({
      published: 1,
      refused: [],
    });
    expect(result.ok && result.data.tables.content_documents.insert).toBe(3);
    expect(h.bucket.objects.size).toBe(0);
    expect(h.timeline.events).not.toContain('bucket.put');
  });

  it('the dry run of another list of originals does not open the gate', async () => {
    const { h, original } = await withOriginal();
    await runTransfer(
      h.deps,
      request('dry_run', { publishOriginals: [original.file.id] })
    );
    expect(await runTransfer(h.deps, request('apply'))).toMatchObject({
      code: 'DRY_RUN_REQUIRED',
    });
    expect(h.bucket.objects.size).toBe(0);
  });

  it('copies before the transaction and writes the row with the data of the copy', async () => {
    const { h, original } = await withOriginal();
    const ids = [original.file.id];
    await runTransfer(h.deps, request('dry_run', { publishOriginals: ids }));
    h.timeline.events.length = 0;
    const result = await runTransfer(
      h.deps,
      request('apply', { publishOriginals: ids })
    );
    expect(result.ok && result.data.originals.published).toBe(1);
    const e = h.timeline.events;
    expect(e.indexOf('store.beginApplying')).toBeLessThan(
      e.indexOf('bucket.put')
    );
    // after the target check inside the transaction, before it is committed
    expect(e.indexOf('connection.begin')).toBeLessThan(e.indexOf('bucket.put'));
    expect(e.indexOf('bucket.put')).toBeLessThan(
      e.indexOf('connection.commit')
    );
    expect(h.bucket.objects.size).toBe(1);
    const [path] = [...h.bucket.objects.keys()];
    expect(path).toMatch(
      new RegExp(`^${CREATOR_ID}/\\d+_K4-a_lehrtext\\.pdf$`)
    );
    const row = h.db.tables.content_documents.find(
      d => d.document_type === 'THEORY' && d.storage_path
    )!;
    expect(row).toMatchObject({
      storage_path: path,
      visibility: 'ALL',
      mime_type: 'application/pdf',
      uploaded_by_id: CREATOR_ID,
    });
    // the protocol names the file of the original
    const protocolRow = h.store.appliedRows.find(r => r.rowId === row.id)!;
    expect(protocolRow.fileId).toBe(original.file.id);
  });

  it('takes the copies out again when the apply fails, and keeps them when the commit was only lost', async () => {
    const failed = await withOriginal();
    const ids = [failed.original.file.id];
    await runTransfer(
      failed.h.deps,
      request('dry_run', { publishOriginals: ids })
    );
    failed.h.store.failProtocolAt = 'insertAppliedRows';
    await expect(
      runTransfer(failed.h.deps, request('apply', { publishOriginals: ids }))
    ).rejects.toThrow();
    expect(failed.h.bucket.objects.size).toBe(0);
    expect(failed.h.bucket.removed).toHaveLength(1);

    // the connection broke while COMMIT was sent, the run says applied: the files stay
    const lost = await withOriginal();
    const lostIds = [lost.original.file.id];
    await runTransfer(
      lost.h.deps,
      request('dry_run', { publishOriginals: lostIds })
    );
    const real = lost.h.store.protocol.bind(lost.h.store);
    lost.h.store.protocol = tx => real(tx);
    lost.h.deps.connections = (
      await import('../../../helpers/memoryTransfer')
    ).memoryConnections(lost.h.timeline, lost.h.db, { failCommit: true });
    const result = await runTransfer(
      lost.h.deps,
      request('apply', { publishOriginals: lostIds })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      code: 'COMMIT_UNCERTAIN',
    });
    // finishRunApplied ran before the lost commit: the memory run says applied
    expect(lost.h.store.state.status).toBe('applied');
    expect(lost.h.bucket.objects.size).toBe(1);
    // and no "failed" entry is written next to the apply that may well be there
    expect(lost.h.store.attempts.some(a => a.status === 'failed')).toBe(false);
  });

  it('keeps the copies when the state of the run cannot be read after a failure', async () => {
    const { h, original } = await withOriginal();
    const ids = [original.file.id];
    await runTransfer(h.deps, request('dry_run', { publishOriginals: ids }));
    h.store.failProtocolAt = 'insertAppliedRows';
    const real = h.store.getRunState.bind(h.store);
    let calls = 0;
    h.store.getRunState = async id => {
      calls += 1;
      if (calls > 1) throw new Error('database gone');
      return real(id);
    };
    const result = await runTransfer(
      h.deps,
      request('apply', { publishOriginals: ids })
    );
    expect(result).toMatchObject({ ok: false, code: 'COMMIT_UNCERTAIN' });
    expect(h.bucket.objects.size).toBe(1);
  });

  it('shows the real error when the clean up fails too, and still gives the run back', async () => {
    const { h, original } = await withOriginal();
    const ids = [original.file.id];
    await runTransfer(h.deps, request('dry_run', { publishOriginals: ids }));
    h.store.failProtocolAt = 'insertAppliedRows';
    h.bucket.remove = async () => {
      throw new Error('bucket down');
    };
    h.store.recordAttempt = async () => {
      throw new Error('database down');
    };
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    await expect(
      runTransfer(h.deps, request('apply', { publishOriginals: ids }))
    ).rejects.toThrow('broke');
    expect(h.store.state.status).toBe('review');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('gives the conflict as a report even when the attempt cannot be logged', async () => {
    const { ImportAbort } = await import('@/lib/content-import/apply/db');
    const files = await enablerFiles({ tree: true });
    const h = harness(files, {
      deps: {
        makeDb: () => {
          throw new ImportAbort('CONFLICTS', 'x', [
            { table: 'quizzes', key: 'k', reason: 'r' },
          ]);
        },
      },
    });
    h.store.recordAttempt = async () => {
      throw new Error('database down');
    };
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const result = await runTransfer(h.deps, request('dry_run'));
    expect(result.ok && result.data.status).toBe('conflict');
    expect(h.store.state.status).toBe('review');
    error.mockRestore();
  });

  it('takes a copy out again when its row exists already and nothing was written for it', async () => {
    const { h, original } = await withOriginal();
    const ids = [original.file.id];
    let now = 1_800_000_000_000;
    h.deps.clock = () => new Date((now += 1000));
    await runTransfer(h.deps, request('dry_run', { publishOriginals: ids }));
    expect(
      (await runTransfer(h.deps, request('apply', { publishOriginals: ids })))
        .ok
    ).toBe(true);
    expect(h.bucket.objects.size).toBe(1);
    // another round for the same files: the row is there, the new copy is not needed
    h.store.state = { ...h.store.state, status: 'review' };
    await runTransfer(h.deps, request('dry_run', { publishOriginals: ids }));
    const again = await runTransfer(
      h.deps,
      request('apply', { publishOriginals: ids })
    );
    expect(again.ok && again.data.originals.published).toBe(0);
    expect(h.bucket.objects.size).toBe(1);
    expect(h.bucket.removed).toHaveLength(1);
  });

  it('names the originals it refused and still transfers the rest', async () => {
    const files = await enablerFiles({ tree: true });
    const bad = pdfOriginal({ dupKey: 'pdf:quiz:4a:low' });
    const h = harness([...files, bad]);
    const result = await runTransfer(
      h.deps,
      request('dry_run', { publishOriginals: [bad.file.id] })
    );
    expect(result.ok && result.data.originals).toEqual({
      published: 0,
      refused: [
        expect.objectContaining({
          fileId: bad.file.id,
          code: 'NOT_AN_ENABLER_TEXT',
        }),
      ],
    });
    expect(result.ok && result.data.status).toBe('ok');
  });

  it('fails clearly when originals are asked for and the document bucket is not there', async () => {
    const { h, original } = await withOriginal();
    const ids = [original.file.id];
    await runTransfer(h.deps, request('dry_run', { publishOriginals: ids }));
    h.deps.contentBucket = undefined;
    await expect(
      runTransfer(h.deps, request('apply', { publishOriginals: ids }))
    ).rejects.toThrow('document bucket');
    expect(h.store.state.status).toBe('review');
    expect(h.db.totalRows()).toBe(0);
  });

  it('transfers originals alone, without any item in the plan', async () => {
    const only = pdfOriginal();
    const h = harness([only]);
    const result = await runTransfer(
      h.deps,
      request('dry_run', { publishOriginals: [only.file.id] })
    );
    // the enabler of the original is in neither the plan nor the database
    expect(result.ok && result.data.status).toBe('conflict');
    expect(result.ok && result.data.conflicts[0]).toMatchObject({
      table: 'content_documents',
    });
  });
});
