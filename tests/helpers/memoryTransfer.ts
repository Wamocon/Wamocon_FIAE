// Fakes for the tests of the transfer that need no database: a store in memory, a
// connection source that records what is sent and rolls the memory database back
// with the transaction, and a bucket in memory. The SQL itself is tried against a
// real database in transfer-db.test.ts.
import type { Db } from '@/lib/content-import/apply/db';
import type { Queryable } from '@/lib/content-import/apply/pg-db';
import type {
  ConnectionSource,
  ReservedConnection,
} from '@/lib/content-upload/connection';
import type { ContentBucketPort } from '@/lib/content-upload/transfer/originals';
import type { TransferDeps } from '@/lib/content-upload/transfer/run';
import type {
  AppliedRowInput,
  ApplyRecord,
  ProtocolWriter,
  RunState,
  TransferStore,
} from '@/lib/content-upload/transfer/store';
import type {
  ComponentFact,
  TransferFile,
} from '@/lib/content-upload/transfer/types';

import { MemoryImportDb } from './memoryImportDb';

export interface Timeline {
  events: string[];
}

export class MemoryTransferStore implements TransferStore {
  state: RunState;
  files: TransferFile[];
  components: ComponentFact[];
  attempts: ApplyRecord[] = [];
  appliedRows: AppliedRowInput[] = [];
  markedFiles: string[] = [];
  gateCalls: Array<{ version: number; requireHash: string | null }> = [];
  /** Called before the gate answers: lets a test change the run behind its back. */
  beforeGate?: (state: RunState) => void;
  failProtocolAt?: 'insertApply' | 'insertAppliedRows' | 'finishRunApplied';
  /** Id of the connection the protocol writer was given (to prove it is the one of the tx). */
  protocolTx: Queryable | null = null;

  constructor(
    private readonly timeline: Timeline,
    files: TransferFile[],
    options: Partial<RunState> = {},
    components: ComponentFact[] = []
  ) {
    this.files = files;
    this.components = components;
    this.state = {
      id: 'cccccccc-0000-4000-8000-000000000001',
      status: 'review',
      decisionsVersion: 1,
      lastDryRunHash: null,
      createdById: 'dddddddd-0000-4000-8000-000000000001',
      catalogId: '00000000-0000-4000-8000-000000000002',
      catalogCode: 'KFBM',
      updatedAt: new Date(),
      ...options,
    };
  }

  async getRunState(runId: string) {
    return runId === this.state.id ? { ...this.state } : null;
  }

  async releaseStale(_runId: string, minutes: number) {
    this.timeline.events.push(`store.releaseStale(${minutes})`);
    if (
      this.state.status === 'applying' &&
      Date.now() - this.state.updatedAt.getTime() > minutes * 60_000
    ) {
      this.state = { ...this.state, status: 'review', lastDryRunHash: null };
      return true;
    }
    return false;
  }

  async loadFiles() {
    return this.files;
  }

  async loadComponents() {
    return this.components;
  }

  async beginApplying(
    _runId: string,
    options: { version: number; requireHash: string | null }
  ) {
    this.timeline.events.push('store.beginApplying');
    this.gateCalls.push(options);
    this.beforeGate?.(this.state);
    const ok =
      this.state.status === 'review' &&
      this.state.decisionsVersion === options.version &&
      (options.requireHash === null ||
        this.state.lastDryRunHash === options.requireHash);
    if (ok) this.state = { ...this.state, status: 'applying' };
    return ok;
  }

  async endApplying(_runId: string, hash: string | null) {
    this.timeline.events.push(
      `store.endApplying(${hash === null ? 'null' : 'hash'})`
    );
    if (this.state.status !== 'applying') return false;
    this.state = { ...this.state, status: 'review', lastDryRunHash: hash };
    return true;
  }

  async recordAttempt(record: ApplyRecord) {
    this.timeline.events.push(
      `store.recordAttempt(${record.mode},${record.status})`
    );
    this.attempts.push(record);
    return `attempt-${this.attempts.length}`;
  }

  protocol(tx: Queryable): ProtocolWriter {
    this.protocolTx = tx;
    const note = (name: string) =>
      this.timeline.events.push(`protocol.${name}`);
    return {
      insertApply: async record => {
        note('insertApply');
        if (this.failProtocolAt === 'insertApply') throw new Error('broke');
        this.attempts.push(record);
        return `apply-${this.attempts.length}`;
      },
      insertAppliedRows: async (_id, rows) => {
        note('insertAppliedRows');
        if (this.failProtocolAt === 'insertAppliedRows')
          throw new Error('broke');
        this.appliedRows.push(...rows);
      },
      markFilesApplied: async (_runId, ids) => {
        note('markFilesApplied');
        this.markedFiles.push(...ids);
        return ids.length;
      },
      finishRunApplied: async () => {
        note('finishRunApplied');
        if (this.failProtocolAt === 'finishRunApplied') return false;
        this.state = { ...this.state, status: 'applied', lastDryRunHash: null };
        return true;
      },
    };
  }
}

/** Connections that record the statements and undo the memory database on rollback. */
export function memoryConnections(
  timeline: Timeline,
  db: MemoryImportDb,
  options: { failCommit?: boolean; locked?: boolean } = {}
): ConnectionSource & { queries: string[]; reserved: number } {
  const queries: string[] = [];
  const source = {
    queries,
    reserved: 0,
    async reserve(): Promise<ReservedConnection> {
      source.reserved += 1;
      timeline.events.push('connection.reserve');
      let snapshot: string | null = null;
      return {
        async query(text: string) {
          const verb = text.trim().split(/\s+/)[0].toLowerCase();
          queries.push(
            verb === 'select' ? text.trim().slice(0, 40) : text.trim()
          );
          if (verb === 'begin') {
            snapshot = db.snapshot();
            timeline.events.push('connection.begin');
          }
          if (verb === 'commit') {
            if (options.failCommit) throw new Error('connection lost');
            timeline.events.push('connection.commit');
            snapshot = null;
          }
          if (verb === 'rollback') {
            if (snapshot !== null) db.restore(snapshot);
            snapshot = null;
            timeline.events.push('connection.rollback');
          }
          if (/pg_try_advisory_xact_lock/.test(text)) {
            return {
              rows: [{ locked: options.locked !== false }],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
        async release() {
          timeline.events.push('connection.release');
        },
      };
    },
  };
  return source;
}

export class MemoryBucket implements ContentBucketPort {
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  removed: string[] = [];
  failPut = false;

  constructor(private readonly timeline?: Timeline) {}

  async put(path: string, bytes: Uint8Array, contentType: string) {
    this.timeline?.events.push('bucket.put');
    if (this.failPut) throw new Error('put failed');
    if (this.objects.has(path)) throw new Error('exists');
    this.objects.set(path, { bytes, contentType });
  }

  async remove(paths: readonly string[]) {
    this.timeline?.events.push('bucket.remove');
    for (const path of paths) {
      this.objects.delete(path);
      this.removed.push(path);
    }
  }
}

export const LOCAL_FACTS = {
  host: '127.0.0.1',
  currentSchema: 'public',
  resolvedSchema: 'public',
  currentUser: 'postgres',
  sessionUser: 'postgres',
  hasPreviewMarkers: false,
};

export interface Harness {
  timeline: Timeline;
  store: MemoryTransferStore;
  db: MemoryImportDb;
  connections: ReturnType<typeof memoryConnections>;
  bucket: MemoryBucket;
  deps: TransferDeps;
  bytes: Map<string, Uint8Array>;
}

export function harness(
  fixtures: Array<{ file: TransferFile; bytes: Uint8Array }>,
  options: {
    run?: Partial<RunState>;
    components?: ComponentFact[];
    connections?: Parameters<typeof memoryConnections>[2];
    deps?: Partial<TransferDeps>;
  } = {}
): Harness {
  const timeline: Timeline = { events: [] };
  const db = new MemoryImportDb();
  const store = new MemoryTransferStore(
    timeline,
    fixtures.map(f => f.file),
    options.run,
    options.components
  );
  const bytes = new Map(fixtures.map(f => [f.file.id, f.bytes]));
  const connections = memoryConnections(timeline, db, options.connections);
  const bucket = new MemoryBucket(timeline);
  const deps: TransferDeps = {
    store,
    connections,
    readBytes: async file => bytes.get(file.id) ?? null,
    host: '127.0.0.1',
    makeDb: (): Db => db,
    readFacts: async () => LOCAL_FACTS,
    contentBucket: () => bucket,
    ...options.deps,
  };
  return { timeline, store, db, connections, bucket, deps, bytes };
}
