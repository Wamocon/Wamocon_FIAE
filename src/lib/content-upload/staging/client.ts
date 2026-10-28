// The browser side of the content upload, without a page (the page is package U6).
//
// What it does for a folder or a list of files (concept 4.3):
//   1. SHA-256 of every file with Web Crypto, three files at the same time
//   2. announces them in batches of 50 and learns for each file what the server
//      made of it (new, copy of another file of the run, already known, refused)
//   3. asks for signed upload urls per batch, right before the upload
//   4. uploads straight into the staging bucket with uploadToSignedUrl, three files
//      at the same time, a failed upload is repeated up to three times with a
//      growing wait
//   5. reports the uploads as done, in batches
//   6. works the queue: calls the pump route in a loop until it is empty
//
// Resuming after an abort needs nothing special: the server's announce is
// idempotent (the same relative path and hash is the same file), so the browser
// announces the same files again and the answer says per file what is left to
// do (`announced` still needs its upload, everything else is past it).
// getRunFiles() reads the state of a run for a page that wants to show it.
//
// Every call to the app goes through authFetch (the bearer token), the upload
// itself goes to the signed url of the storage.

import { authFetch } from '@/lib/authFetch';
import { LIMITS, UPLOAD_BUCKET } from '@/lib/content-upload/staging/config';
import type {
  AnnounceResponse,
  AnnounceItemResult,
  CompleteItem,
  UploadUrlItem,
} from '@/lib/content-upload/staging/files';
import type {
  FileDto,
  RunDto,
  RunWithProgress,
} from '@/lib/content-upload/staging/runs';
import type { PumpResult } from '@/lib/content-upload/staging/queue';

const RUNS = '/api/trainer/content-upload/runs';

export const HASH_CONCURRENCY = 3;
export const UPLOAD_CONCURRENCY = 3;
export const UPLOAD_RETRIES = 3;
export const RETRY_BASE_MS = 1000;

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  json: 'application/json',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// ---------------------------------------------------------------------------
// Dependencies (replaced in the tests)
// ---------------------------------------------------------------------------

export interface UploadResult {
  error: { message?: string; statusCode?: string | number } | null;
}

export interface UploadClientDeps {
  /** fetch for the own API, adds the bearer token. */
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** Uploads one file to a signed url (the call of the storage client). */
  uploadToSignedUrl: (
    path: string,
    token: string,
    file: Blob,
    contentType: string
  ) => Promise<UploadResult>;
  /** SHA-256 of a buffer. */
  digest: (data: ArrayBuffer) => Promise<ArrayBuffer>;
  sleep: (ms: number) => Promise<void>;
}

export function defaultDeps(): UploadClientDeps {
  return {
    fetch: (input, init) => authFetch(input, init),
    uploadToSignedUrl: async (path, token, file, contentType) => {
      // Loaded on first use: the storage client of the browser
      const { supabase } = await import('@/lib/supabase');
      const { error } = await supabase.storage
        .from(UPLOAD_BUCKET)
        .uploadToSignedUrl(path, token, file, { contentType });
      return { error: error as UploadResult['error'] };
    },
    digest: data => crypto.subtle.digest('SHA-256', data),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  };
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

export class UploadApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfterSec?: number;
  constructor(
    status: number,
    message: string,
    code?: string,
    retryAfterSec?: number
  ) {
    super(message);
    this.name = 'UploadApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), b =>
    b.toString(16).padStart(2, '0')
  ).join('');
}

/** SHA-256 of a file as 64 lower case hex characters. */
export async function sha256OfFile(
  file: Blob,
  digest: UploadClientDeps['digest'] = defaultDeps().digest
): Promise<string> {
  return toHex(await digest(await file.arrayBuffer()));
}

/** Items in groups of at most `size` (50 by default, the limit of a request). */
export function makeBatches<T>(
  items: readonly T[],
  size: number = LIMITS.maxFilesPerRequest
): T[][] {
  if (!Number.isInteger(size) || size < 1)
    throw new Error('size must be 1 or more');
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    batches.push(items.slice(i, i + size));
  return batches;
}

/** Runs `fn` over the items, at most `limit` at the same time, results in order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker)
  );
  return results;
}

/**
 * Calls `fn`, and again after a failure, up to `retries` times, with a wait that
 * doubles (base, 2 x base, 4 x base). The last error is thrown.
 */
export async function withRetries<T>(
  fn: (attempt: number) => Promise<T>,
  options: {
    retries?: number;
    baseMs?: number;
    sleep: UploadClientDeps['sleep'];
  }
): Promise<T> {
  const retries = options.retries ?? UPLOAD_RETRIES;
  const base = options.baseMs ?? RETRY_BASE_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= retries) throw error;
      await options.sleep(base * 2 ** attempt);
    }
  }
}

/** The relative path the browser knows for a file: the folder path of a folder upload, else the name. */
export function relativePathOf(file: File): string {
  const withPath = file as File & { webkitRelativePath?: string };
  return withPath.webkitRelativePath || file.name;
}

export interface UploadCandidate {
  file: File;
  /** The relative path that is announced (the server cleans it). */
  path: string;
}

export function candidatesFromFiles(files: ArrayLike<File>): UploadCandidate[] {
  return Array.from(files, file => ({ file, path: relativePathOf(file) }));
}

function contentTypeOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Calls to the routes
// ---------------------------------------------------------------------------

export function createUploadClient(partial: Partial<UploadClientDeps> = {}) {
  const deps: UploadClientDeps = { ...defaultDeps(), ...partial };

  async function api<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const response = await deps.fetch(path, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      any
    >;
    if (!response.ok) {
      const retryAfter = Number(response.headers.get('Retry-After'));
      throw new UploadApiError(
        response.status,
        typeof data.error === 'string'
          ? data.error
          : `Request failed (${response.status})`,
        typeof data.code === 'string' ? data.code : undefined,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined
      );
    }
    return data as T;
  }

  const client = {
    createRun(input: { label: string; kiEnabled?: boolean }) {
      return api<{ run: RunDto }>('POST', RUNS, {
        label: input.label,
        declarationAccepted: true,
        kiEnabled: input.kiEnabled,
      });
    },
    listRuns() {
      return api<{ runs: RunDto[] }>('GET', RUNS);
    },
    getRun(runId: string) {
      return api<RunWithProgress>('GET', `${RUNS}/${runId}`);
    },
    discardRun(runId: string) {
      return api<{ run: RunDto }>('POST', `${RUNS}/${runId}/discard`, {});
    },
    /** Every file of the run (pages of 500). */
    async getRunFiles(runId: string): Promise<FileDto[]> {
      const files: FileDto[] = [];
      for (let offset = 0; ; offset += 500) {
        const page = await api<{ files: FileDto[] }>(
          'GET',
          `${RUNS}/${runId}/files?offset=${offset}&limit=500`
        );
        files.push(...page.files);
        if (page.files.length < 500) return files;
      }
    },
    announce(
      runId: string,
      entries: {
        path: string;
        size: number;
        sha256: string;
        lastModified?: number;
      }[]
    ) {
      return api<AnnounceResponse>('POST', `${RUNS}/${runId}/files`, {
        files: entries,
      });
    },
    /** Signed urls for a batch. A 429 is waited out (Retry-After) up to three times. */
    async requestUrls(
      runId: string,
      fileIds: string[]
    ): Promise<UploadUrlItem[]> {
      for (let attempt = 0; ; attempt++) {
        try {
          const answer = await api<{ items: UploadUrlItem[] }>(
            'POST',
            `${RUNS}/${runId}/upload-urls`,
            { fileIds }
          );
          return answer.items;
        } catch (error) {
          if (
            error instanceof UploadApiError &&
            error.status === 429 &&
            attempt < UPLOAD_RETRIES
          ) {
            await deps.sleep(Math.min(65, error.retryAfterSec ?? 5) * 1000);
            continue;
          }
          throw error;
        }
      }
    },
    complete(runId: string, fileIds: string[]) {
      return api<{ results: CompleteItem[] }>(
        'POST',
        `${RUNS}/${runId}/complete`,
        { fileIds }
      );
    },
    pump(
      runId: string,
      options: { closeUpload?: boolean; budgetMs?: number } = {}
    ) {
      return api<PumpResult>('POST', `${RUNS}/${runId}/pump`, options);
    },
  };

  // -------------------------------------------------------------------------
  // The whole upload of a list of files into a run
  // -------------------------------------------------------------------------

  type Phase = 'hashing' | 'announcing' | 'uploading' | 'completing';

  /**
   * Hash of every file, or null for a file that cannot be read (the browser
   * refuses it: a path over the limit of the system, a file that changed or was
   * removed). One such file must not end the upload of all the others.
   */
  async function hashAll(
    candidates: readonly UploadCandidate[],
    onProgress: (done: number) => void
  ): Promise<(string | null)[]> {
    let done = 0;
    return mapLimit(candidates, HASH_CONCURRENCY, async c => {
      let hash: string | null = null;
      try {
        hash = await sha256OfFile(c.file, deps.digest);
      } catch {
        hash = null;
      }
      onProgress(++done);
      return hash;
    });
  }

  /** One signed upload, repeated up to three times with a growing wait. */
  async function uploadOne(
    item: Extract<UploadUrlItem, { ok: true }>,
    file: Blob,
    path: string
  ) {
    await withRetries(
      async () => {
        const { error } = await deps.uploadToSignedUrl(
          item.path,
          item.token,
          file,
          contentTypeOf(path)
        );
        if (!error) return;
        // The object is there already (an earlier try got through): fine, the
        // server checks size and type when the upload is reported as done
        if (/already exists|duplicate/i.test(`${error.message ?? ''}`)) return;
        throw new Error(error.message ?? 'upload failed');
      },
      { sleep: deps.sleep }
    );
  }

  return Object.assign(client, {
    deps,

    /**
     * Uploads the candidates into the run and reports them as done. Call it again
     * with the same files to resume after an abort: nothing is uploaded twice.
     */
    async uploadFiles(
      runId: string,
      candidates: readonly UploadCandidate[],
      handlers: {
        onProgress?: (event: {
          phase: Phase;
          done: number;
          total: number;
        }) => void;
        signal?: AbortSignal;
      } = {}
    ): Promise<UploadSummary> {
      const progress = (phase: Phase, done: number, total: number) =>
        handlers.onProgress?.({ phase, done, total });
      const stop = () => {
        if (handlers.signal?.aborted) throw new UploadAbortedError();
      };

      const summary: UploadSummary = {
        announced: 0,
        merged: 0,
        existing: 0,
        alreadyPast: 0,
        rejected: [],
        uploaded: 0,
        failed: [],
        warnings: [],
      };

      // 1. hash
      const allHashes = await hashAll(candidates, done =>
        progress('hashing', done, candidates.length)
      );
      stop();
      // Files that could not be read are reported, the rest goes on
      const readable: UploadCandidate[] = [];
      const hashes: string[] = [];
      candidates.forEach((c, i) => {
        const hash = allHashes[i];
        if (hash === null) {
          summary.failed.push({ path: c.path, code: 'UNREADABLE' });
        } else {
          readable.push(c);
          hashes.push(hash);
        }
      });

      // 2. announce, in batches of 50
      const toUpload: { fileId: string; candidate: UploadCandidate }[] = [];
      const entries = readable.map((c, i) => ({
        path: c.path,
        size: c.file.size,
        sha256: hashes[i],
        lastModified: c.file.lastModified,
      }));
      let announcedDone = 0;
      for (const batch of makeBatches(entries.map((e, i) => i))) {
        stop();
        const answer = await client.announce(
          runId,
          batch.map(i => entries[i])
        );
        summary.warnings.push(...answer.warnings.map(w => w.code));
        answer.results.forEach((r: AnnounceItemResult) => {
          const candidate = readable[batch[r.index]];
          if (r.status === 'rejected') {
            summary.rejected.push({
              path: candidate.path,
              code: r.code ?? 'REJECTED',
            });
          } else if (r.status === 'merged') {
            summary.merged += 1;
          } else if (r.status === 'announced') {
            summary.announced += 1;
            toUpload.push({ fileId: r.fileId!, candidate });
          } else {
            summary.existing += 1;
            // Known already: only a file that never got its upload needs one
            if (r.fileStatus === 'announced') {
              toUpload.push({ fileId: r.fileId!, candidate });
            } else {
              summary.alreadyPast += 1;
            }
          }
        });
        announcedDone += batch.length;
        progress('announcing', announcedDone, readable.length);
      }

      // 3. to 5. urls, upload, report as done: per batch of 50
      let uploadedDone = 0;
      let completedDone = 0;
      for (const batch of makeBatches(toUpload)) {
        stop();
        const urls = await client.requestUrls(
          runId,
          batch.map(b => b.fileId)
        );
        const byId = new Map(urls.map(u => [u.fileId, u]));
        const uploadedIds: string[] = [];
        await mapLimit(batch, UPLOAD_CONCURRENCY, async entry => {
          if (handlers.signal?.aborted) return;
          const url = byId.get(entry.fileId);
          if (!url || !url.ok) {
            summary.failed.push({
              path: entry.candidate.path,
              code: url && !url.ok ? url.code : 'NO_URL',
            });
            return;
          }
          try {
            await uploadOne(url, entry.candidate.file, entry.candidate.path);
            uploadedIds.push(entry.fileId);
          } catch {
            summary.failed.push({
              path: entry.candidate.path,
              code: 'UPLOAD_FAILED',
            });
          }
          progress('uploading', ++uploadedDone, toUpload.length);
        });
        stop();
        if (uploadedIds.length > 0) {
          const done = await client.complete(runId, uploadedIds);
          for (const r of done.results) {
            const entry = batch.find(b => b.fileId === r.fileId)!;
            if (r.status === 'uploaded') summary.uploaded += 1;
            else
              summary.failed.push({
                path: entry.candidate.path,
                code: r.code ?? r.status,
              });
          }
          completedDone += done.results.length;
          progress('completing', completedDone, toUpload.length);
        }
      }
      return summary;
    },

    /**
     * Works the queue of the run: calls the pump until it is empty (or until
     * `signal` is aborted, which pauses it). Call it again to continue.
     */
    async processRun(
      runId: string,
      handlers: {
        onProgress?: (result: PumpResult) => void;
        signal?: AbortSignal;
        /** Wait in milliseconds when files are held by another call. */
        idleMs?: number;
        maxCalls?: number;
      } = {}
    ): Promise<PumpResult> {
      const maxCalls = handlers.maxCalls ?? 10_000;
      let last: PumpResult | undefined;
      for (let i = 0; i < maxCalls; i++) {
        if (handlers.signal?.aborted) break;
        last = await client.pump(runId, { closeUpload: true });
        handlers.onProgress?.(last);
        if (last.done) break;
        // Nothing was taken: the files are held (a retry waits) or announced
        if (last.processed === 0) await deps.sleep(handlers.idleMs ?? 2500);
      }
      if (!last) throw new UploadAbortedError();
      return last;
    },
  });
}

export class UploadAbortedError extends Error {
  constructor() {
    super('The upload was paused');
    this.name = 'UploadAbortedError';
  }
}

export interface UploadSummary {
  /** New files the server took. */
  announced: number;
  /** Exact copies inside the run (no upload needed). */
  merged: number;
  /** Files the server knew already (a resumed upload). */
  existing: number;
  /** Of those, the ones that were past their upload already. */
  alreadyPast: number;
  /** Refused files with the reason. */
  rejected: { path: string; code: string }[];
  uploaded: number;
  failed: { path: string; code: string }[];
  warnings: string[];
}
