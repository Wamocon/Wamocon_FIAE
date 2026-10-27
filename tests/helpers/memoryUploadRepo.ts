// UploadRepo in memory, for the unit tests. It follows the rules of the SQL
// implementation (src/lib/content-upload/repo-pg.ts) and is held to them by the
// same contract test (tests/unit/lib/content-upload/repo-contract.ts).
//
// Every method does its work in one synchronous block after a single yield, so
// callers that run at the same time interleave between the calls but never
// inside one, which is the atomicity of one SQL statement.

import { randomUUID } from 'crypto';
import {
  existingKey,
  planAnnouncement,
  type AnnounceFacts,
  type Candidate,
} from '@/lib/content-upload/announce';
import { LIMITS } from '@/lib/content-upload/config';
import type {
  AnnounceRepoResult,
  ClaimOptions,
  CreateRunInput,
  CreateRunResult,
  FinishOptions,
  QueueState,
  TransitionOptions,
  UploadRepo,
  UrlRequestDecision,
} from '@/lib/content-upload/repo';
import {
  ACTIVE_RUN_STATUSES,
  canTransitionFile,
  canTransitionRun,
  type FileStatus,
  type RunStatus,
} from '@/lib/content-upload/status';
import {
  OBJECT_DELETED_KEY,
  type FileRow,
  type RunProgress,
  type RunRow,
} from '@/lib/content-upload/types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export class MemoryUploadRepo implements UploadRepo {
  runs = new Map<string, RunRow>();
  files = new Map<string, FileRow>();
  /** Rows of content_upload_applies, only what the rules look at. */
  applies: { runId: string; mode: 'dry_run' | 'apply' }[] = [];
  catalogs = new Map<string, string>([['KFBM', 'catalog-kfbm']]);
  private counters = new Map<string, { count: number; windowStart: number }>();
  private clockMs = Date.UTC(2026, 9, 28, 12, 0, 0);

  /** The clock of the repository, tests move it with advance(). */
  now(): Date {
    return new Date(this.clockMs);
  }
  advance(ms: number) {
    this.clockMs += ms;
  }

  private async tick() {
    await Promise.resolve();
  }

  private copyRun(run: RunRow): RunRow {
    return { ...run };
  }
  private copyFile(file: FileRow): FileRow {
    return {
      ...file,
      parseSummary: file.parseSummary ? { ...file.parseSummary } : null,
    };
  }

  private hasObjectMarker(file: FileRow): boolean {
    return file.parseSummary?.[OBJECT_DELETED_KEY] === true;
  }

  // ---- runs ----------------------------------------------------------------

  async catalogIdByCode(code: string) {
    await this.tick();
    return this.catalogs.get(code) ?? null;
  }

  async createRun(
    input: CreateRunInput,
    maxActive: number
  ): Promise<CreateRunResult> {
    await this.tick();
    const active = [...this.runs.values()].filter(
      r =>
        r.createdById === input.createdById &&
        (ACTIVE_RUN_STATUSES as readonly string[]).includes(r.status)
    ).length;
    if (active >= maxActive)
      return { ok: false, reason: 'TOO_MANY_ACTIVE_RUNS' };
    const now = this.now();
    const run: RunRow = {
      id: input.id,
      trainingCatalogId: input.catalogId,
      createdById: input.createdById,
      label: input.label,
      status: 'draft',
      kiEnabled: input.kiEnabled,
      declarationAcceptedAt: now,
      storagePrefix: input.storagePrefix,
      decisionsVersion: 0,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      purgeAfter: null,
    };
    this.runs.set(run.id, run);
    return { ok: true, run: this.copyRun(run) };
  }

  async getRun(id: string) {
    await this.tick();
    const run = this.runs.get(id);
    return run ? this.copyRun(run) : null;
  }

  async listRuns(options: { createdById?: string; limit: number }) {
    await this.tick();
    return [...this.runs.values()]
      .filter(
        r => !options.createdById || r.createdById === options.createdById
      )
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          b.id.localeCompare(a.id)
      )
      .slice(0, options.limit)
      .map(r => this.copyRun(r));
  }

  async transitionRun(
    id: string,
    from: readonly RunStatus[],
    to: RunStatus,
    options: { purgeAfterDays?: number } = {}
  ) {
    for (const f of from) {
      if (!canTransitionRun(f, to)) {
        throw new Error(`Run status ${f} -> ${to} is not a transition`);
      }
    }
    await this.tick();
    const run = this.runs.get(id);
    if (!run || !from.includes(run.status)) return null;
    run.status = to;
    run.updatedAt = this.now();
    if (options.purgeAfterDays !== undefined) {
      run.purgeAfter = new Date(this.clockMs + options.purgeAfterDays * DAY);
    }
    return this.copyRun(run);
  }

  async touchRun(id: string) {
    await this.tick();
    const run = this.runs.get(id);
    if (run) run.updatedAt = this.now();
  }

  async runProgress(runId: string): Promise<RunProgress> {
    await this.tick();
    const counts: RunProgress['counts'] = {};
    let totalFiles = 0;
    let totalBytes = 0;
    for (const f of this.files.values()) {
      if (f.runId !== runId) continue;
      counts[f.status] = (counts[f.status] ?? 0) + 1;
      totalFiles += 1;
      totalBytes += f.sizeBytes;
    }
    return { counts, totalFiles, totalBytes };
  }

  // ---- files ---------------------------------------------------------------

  async announce(
    runId: string,
    candidates: readonly Candidate[]
  ): Promise<AnnounceRepoResult> {
    await this.tick();
    const run = this.runs.get(runId);
    if (!run) return { ok: false, reason: 'RUN_NOT_FOUND' };
    if (run.status !== 'draft' && run.status !== 'uploading') {
      return { ok: false, reason: 'RUN_STATE', status: run.status };
    }

    const inRun = [...this.files.values()].filter(f => f.runId === runId);
    const shas = new Set(candidates.map(c => c.sha256));
    const existing: AnnounceFacts['existing'] = new Map();
    for (const f of inRun) {
      existing.set(existingKey(f.relPath, f.sha256), {
        id: f.id,
        status: f.status,
        storagePath: f.storagePath,
      });
    }
    const mainBySha: AnnounceFacts['mainBySha'] = new Map();
    for (const f of [...inRun].sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id)
    )) {
      if (
        shas.has(f.sha256) &&
        !['merged', 'expired', 'rejected'].includes(f.status) &&
        !mainBySha.has(f.sha256)
      ) {
        mainBySha.set(f.sha256, f.id);
      }
    }
    const appliedBySha: AnnounceFacts['appliedBySha'] = new Map();
    for (const f of [...this.files.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    )) {
      if (f.status === 'applied' && shas.has(f.sha256)) {
        if (!appliedBySha.has(f.sha256)) appliedBySha.set(f.sha256, f.runId);
      }
    }
    const holdsObject = (f: FileRow) =>
      f.status !== 'merged' && !this.hasObjectMarker(f);
    const facts: AnnounceFacts = {
      runFileCount: inRun.filter(f => f.status !== 'expired').length,
      runBytes: inRun.filter(holdsObject).reduce((n, f) => n + f.sizeBytes, 0),
      stagingBytes: [...this.files.values()]
        .filter(holdsObject)
        .reduce((n, f) => n + f.sizeBytes, 0),
      existing,
      mainBySha,
      appliedBySha,
    };

    const plan = planAnnouncement(candidates, facts, LIMITS);
    const now = this.now();
    let wrote = false;
    for (const item of plan.items) {
      if (item.kind === 'insert' || item.kind === 'merge') {
        const c = item.candidate;
        this.files.set(c.id, {
          id: c.id,
          runId,
          relPath: c.relPath,
          fileName: c.fileName,
          ext: c.ext,
          sizeBytes: c.sizeBytes,
          sha256: c.sha256,
          clientMtimeMs: c.clientMtimeMs,
          storagePath: c.storagePath,
          status: item.kind === 'merge' ? 'merged' : 'announced',
          statusCode: null,
          attempts: 0,
          lockedUntil: null,
          claimId: null,
          duplicateOfId: item.kind === 'merge' ? item.duplicateOfId : null,
          docType: null,
          pageCount: null,
          charCount: null,
          parseSummary: null,
          dupKey: null,
          createdAt: now,
          completedAt: null,
          processedAt: null,
        });
        wrote = true;
      } else if (item.kind === 'revive') {
        const f = this.files.get(item.fileId)!;
        f.status = 'announced';
        f.createdAt = now;
        f.completedAt = null;
        f.statusCode = null;
        f.attempts = 0;
        f.claimId = null;
        f.lockedUntil = null;
        f.processedAt = null;
        f.parseSummary = null;
        wrote = true;
      }
    }
    if (wrote) {
      if (run.status === 'draft') run.status = 'uploading';
      run.updatedAt = now;
    }
    return { ok: true, plan };
  }

  async listFiles(
    runId: string,
    options: { offset: number; limit: number }
  ): Promise<FileRow[]> {
    await this.tick();
    return [...this.files.values()]
      .filter(f => f.runId === runId)
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id)
      )
      .slice(options.offset, options.offset + options.limit)
      .map(f => this.copyFile(f));
  }

  async getFiles(runId: string, ids: readonly string[]): Promise<FileRow[]> {
    await this.tick();
    return [...this.files.values()]
      .filter(f => f.runId === runId && ids.includes(f.id))
      .map(f => this.copyFile(f));
  }

  async transitionFile(
    runId: string,
    fileId: string,
    from: FileStatus,
    to: FileStatus,
    options: TransitionOptions = {}
  ) {
    if (!canTransitionFile(from, to)) {
      throw new Error(`File status ${from} -> ${to} is not a transition`);
    }
    await this.tick();
    const f = this.files.get(fileId);
    if (!f || f.runId !== runId || f.status !== from) return null;
    f.status = to;
    f.statusCode = options.code ?? null;
    if (options.completed) f.completedAt = this.now();
    if (options.objectDeleted) {
      f.parseSummary = {
        ...(f.parseSummary ?? {}),
        [OBJECT_DELETED_KEY]: true,
      };
    }
    return this.copyFile(f);
  }

  // ---- queue ---------------------------------------------------------------

  async claimFiles(runId: string, options: ClaimOptions): Promise<FileRow[]> {
    await this.tick();
    const run = this.runs.get(runId);
    if (!run || !['uploading', 'processing', 'review'].includes(run.status)) {
      return [];
    }
    const now = this.clockMs;
    const claimed: FileRow[] = [];
    const candidates = [...this.files.values()]
      .filter(
        f =>
          f.runId === runId &&
          options.statuses.includes(f.status) &&
          (f.lockedUntil === null || f.lockedUntil.getTime() < now) &&
          f.attempts < options.maxAttempts
      )
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id)
      )
      .slice(0, options.limit);
    for (const f of candidates) {
      f.claimId = randomUUID();
      f.lockedUntil = new Date(now + options.lockSeconds * 1000);
      f.attempts += 1;
      claimed.push(this.copyFile(f));
    }
    return claimed;
  }

  async finishClaim(
    fileId: string,
    claimId: string,
    from: FileStatus,
    to: FileStatus,
    options: FinishOptions = {}
  ) {
    if (!canTransitionFile(from, to)) {
      throw new Error(`File status ${from} -> ${to} is not a transition`);
    }
    await this.tick();
    const f = this.files.get(fileId);
    if (!f || f.claimId !== claimId || f.status !== from) return false;
    f.status = to;
    f.statusCode = options.code ?? null;
    f.attempts = 0;
    f.claimId = null;
    f.lockedUntil = null;
    f.processedAt = this.now();
    const patch = options.patch ?? {};
    if (patch.docType != null) f.docType = patch.docType;
    if (patch.pageCount != null) f.pageCount = patch.pageCount;
    if (patch.charCount != null) f.charCount = patch.charCount;
    if (patch.dupKey != null) f.dupKey = patch.dupKey;
    if (patch.parseSummary) {
      f.parseSummary = { ...(f.parseSummary ?? {}), ...patch.parseSummary };
    }
    return true;
  }

  async releaseClaim(fileId: string, claimId: string, delaySeconds = 0) {
    await this.tick();
    const f = this.files.get(fileId);
    if (!f || f.claimId !== claimId) return false;
    f.claimId = null;
    f.lockedUntil =
      delaySeconds > 0 ? new Date(this.clockMs + delaySeconds * 1000) : null;
    return true;
  }

  async failExhausted(
    runId: string,
    statuses: readonly FileStatus[],
    maxAttempts: number,
    code: string
  ) {
    await this.tick();
    let n = 0;
    for (const f of this.files.values()) {
      if (
        f.runId === runId &&
        statuses.includes(f.status) &&
        f.attempts >= maxAttempts &&
        (f.lockedUntil === null || f.lockedUntil.getTime() < this.clockMs)
      ) {
        if (!canTransitionFile(f.status, 'failed')) continue;
        f.status = 'failed';
        f.statusCode = code;
        f.claimId = null;
        f.lockedUntil = null;
        n += 1;
      }
    }
    return n;
  }

  async queueState(
    runId: string,
    statuses: readonly FileStatus[],
    maxAttempts: number
  ): Promise<QueueState> {
    await this.tick();
    const state: QueueState = { announced: 0, claimable: 0, locked: 0 };
    for (const f of this.files.values()) {
      if (f.runId !== runId) continue;
      if (f.status === 'announced') state.announced += 1;
      if (!statuses.includes(f.status)) continue;
      const locked =
        f.lockedUntil !== null && f.lockedUntil.getTime() >= this.clockMs;
      if (locked) state.locked += 1;
      else if (f.attempts < maxAttempts) state.claimable += 1;
    }
    return state;
  }

  // ---- rate limit ----------------------------------------------------------

  async reserveUrlRequest(profileId: string): Promise<UrlRequestDecision> {
    await this.tick();
    const windowMs = LIMITS.signedUrlWindowSeconds * 1000;
    const entry = this.counters.get(profileId);
    if (!entry || entry.windowStart + windowMs <= this.clockMs) {
      this.counters.set(profileId, { count: 1, windowStart: this.clockMs });
      return { allowed: true, retryAfterSec: 0, count: 1 };
    }
    entry.count += 1;
    const allowed = entry.count <= LIMITS.signedUrlRequestsPerWindow;
    return {
      allowed,
      retryAfterSec: allowed
        ? 0
        : Math.max(
            1,
            Math.ceil((entry.windowStart + windowMs - this.clockMs) / 1000)
          ),
      count: entry.count,
    };
  }

  // ---- cleanup -------------------------------------------------------------

  async expireStaleAnnounced(hours: number, limit: number) {
    await this.tick();
    const cutoff = this.clockMs - hours * HOUR;
    let n = 0;
    const stale = [...this.files.values()]
      .filter(f => f.status === 'announced' && f.createdAt.getTime() < cutoff)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);
    for (const f of stale) {
      f.status = 'expired';
      n += 1;
    }
    return n;
  }

  async filesNeedingObjectRemoval(limit: number, runId?: string) {
    await this.tick();
    return [...this.files.values()]
      .filter(f => {
        if (runId !== undefined && f.runId !== runId) return false;
        if (f.status === 'merged' || this.hasObjectMarker(f)) return false;
        const run = this.runs.get(f.runId);
        if (!run) return false;
        return (
          f.status === 'rejected' ||
          f.status === 'expired' ||
          run.status === 'discarded' ||
          (run.status === 'applied' &&
            run.purgeAfter !== null &&
            run.purgeAfter.getTime() < this.clockMs)
        );
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit)
      .map(f => this.copyFile(f));
  }

  async markObjectsDeleted(fileIds: readonly string[]) {
    await this.tick();
    for (const id of fileIds) {
      const f = this.files.get(id);
      if (f) {
        f.parseSummary = {
          ...(f.parseSummary ?? {}),
          [OBJECT_DELETED_KEY]: true,
        };
      }
    }
  }

  async discardStaleRuns(idleDays: number, rowsDays: number, limit: number) {
    await this.tick();
    const cutoff = this.clockMs - idleDays * DAY;
    const ids: string[] = [];
    for (const run of this.runs.values()) {
      if (ids.length >= limit) break;
      if (
        ['draft', 'uploading', 'processing', 'review', 'failed'].includes(
          run.status
        ) &&
        run.updatedAt.getTime() < cutoff &&
        !this.applies.some(a => a.runId === run.id && a.mode === 'apply')
      ) {
        run.status = 'discarded';
        run.purgeAfter = new Date(this.clockMs + rowsDays * DAY);
        run.updatedAt = this.now();
        ids.push(run.id);
      }
    }
    return ids;
  }

  async deleteRunsPastPurge(limit: number) {
    await this.tick();
    let n = 0;
    for (const run of [...this.runs.values()]) {
      if (n >= limit) break;
      if (
        run.status !== 'discarded' ||
        run.purgeAfter === null ||
        run.purgeAfter.getTime() >= this.clockMs ||
        this.applies.some(a => a.runId === run.id)
      ) {
        continue;
      }
      const pending = [...this.files.values()].some(
        f =>
          f.runId === run.id &&
          f.status !== 'merged' &&
          !this.hasObjectMarker(f)
      );
      if (pending) continue;
      for (const f of [...this.files.values()]) {
        if (f.runId === run.id) this.files.delete(f.id);
      }
      this.runs.delete(run.id);
      n += 1;
    }
    return n;
  }

  async knownStoragePaths(paths: readonly string[]) {
    await this.tick();
    const wanted = new Set(paths);
    const known = new Set<string>();
    for (const f of this.files.values()) {
      if (wanted.has(f.storagePath)) known.add(f.storagePath);
    }
    return known;
  }

  // ---- backdoors for tests --------------------------------------------------

  forceRunStatus(id: string, status: RunStatus, purgeAfterDays?: number) {
    const run = this.runs.get(id)!;
    run.status = status;
    if (purgeAfterDays !== undefined) {
      run.purgeAfter = new Date(this.clockMs + purgeAfterDays * DAY);
    }
  }
  forceFileStatus(id: string, status: FileStatus) {
    this.files.get(id)!.status = status;
  }
  addApply(runId: string, mode: 'dry_run' | 'apply') {
    this.applies.push({ runId, mode });
  }
}
