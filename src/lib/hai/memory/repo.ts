/**
 * HAI memory: the shape of the rows and the two repositories the logic talks to.
 *
 * The logic (memoryStore, globalStore, turn, derive) never touches the database
 * itself, it works on these interfaces. The real implementation is repoDb.ts
 * (Drizzle), the tests use an in memory one. Every method of the user repository
 * takes the id of the OWNER and puts it into the WHERE clause: there is no way to
 * read, change or delete the entry of another person, and no method lists entries
 * across users (the only cross-user numbers are the aggregated counters of
 * globalPropose.ts, which carry no person).
 *
 * @module lib/hai/memory/repo
 */

export type UserMemoryKind =
  | 'preference'
  | 'learning_style'
  | 'learning_state'
  | 'weakness';
export type UserMemorySource = 'stated' | 'derived';
export type UserMemoryStatus = 'proposed' | 'active' | 'rejected';

export interface UserMemoryRow {
  id: string;
  userId: string;
  trainingCatalogId: string;
  kind: UserMemoryKind;
  proposalKey: string;
  content: string;
  source: UserMemorySource;
  status: UserMemoryStatus;
  createdAt: Date;
  updatedAt: Date;
  confirmedAt: Date | null;
}

export interface NewUserMemory {
  userId: string;
  trainingCatalogId: string;
  kind: UserMemoryKind;
  proposalKey: string;
  content: string;
  source: UserMemorySource;
  status: UserMemoryStatus;
  confirmedAt?: Date | null;
}

export interface UserMemoryPatch {
  content?: string;
  status?: UserMemoryStatus;
  confirmedAt?: Date | null;
}

export interface UserMemoryRepo {
  /** Own entries, newest first. `statuses` and `catalogId` narrow the list. */
  list(
    userId: string,
    filter?: {
      catalogId?: string;
      statuses?: readonly UserMemoryStatus[];
    }
  ): Promise<UserMemoryRow[]>;
  get(userId: string, id: string): Promise<UserMemoryRow | null>;
  findByKey(
    userId: string,
    catalogId: string,
    proposalKey: string
  ): Promise<UserMemoryRow | null>;
  /** Null when the key already exists for this user and occupation. */
  insert(row: NewUserMemory): Promise<UserMemoryRow | null>;
  update(
    userId: string,
    id: string,
    patch: UserMemoryPatch
  ): Promise<UserMemoryRow | null>;
  remove(userId: string, id: string): Promise<boolean>;
  /** Deletes the own entries (of one occupation, or of all), returns how many. */
  removeAll(userId: string, catalogId?: string): Promise<number>;
  /** Active plus proposed entries of the user in the occupation (for the cap). */
  countOpen(userId: string, catalogId: string): Promise<number>;
  /** When the user last got a DERIVED proposal in the occupation, or null. */
  latestDerivedAt(userId: string, catalogId: string): Promise<Date | null>;
  /** The switch of the user (a missing row counts as on). */
  getEnabled(userId: string): Promise<boolean>;
  setEnabled(userId: string, enabled: boolean): Promise<void>;
  /** True when an answer of this session already carried a memory question. */
  sessionAskedMemory(sessionId: string): Promise<boolean>;
}

export type GlobalMemoryStatus = 'proposed' | 'approved' | 'rejected';
export type GlobalMemoryOrigin = 'auto' | 'manual';

export interface GlobalMemoryRow {
  id: string;
  trainingCatalogId: string | null;
  proposalKey: string | null;
  content: string;
  status: GlobalMemoryStatus;
  origin: GlobalMemoryOrigin;
  supportCount: number;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewGlobalMemory {
  trainingCatalogId: string | null;
  proposalKey: string | null;
  content: string;
  status: GlobalMemoryStatus;
  origin: GlobalMemoryOrigin;
  supportCount: number;
  createdBy: string | null;
  approvedBy?: string | null;
  approvedAt?: Date | null;
}

export interface GlobalMemoryPatch {
  content?: string;
  status?: GlobalMemoryStatus;
  supportCount?: number;
  approvedBy?: string | null;
  approvedAt?: Date | null;
}

export interface GlobalMemoryRepo {
  list(filter?: {
    statuses?: readonly GlobalMemoryStatus[];
  }): Promise<GlobalMemoryRow[]>;
  get(id: string): Promise<GlobalMemoryRow | null>;
  findByKey(
    catalogId: string | null,
    proposalKey: string
  ): Promise<GlobalMemoryRow | null>;
  insert(row: NewGlobalMemory): Promise<GlobalMemoryRow | null>;
  update(id: string, patch: GlobalMemoryPatch): Promise<GlobalMemoryRow | null>;
  /** Approved entries for one occupation: its own plus the ones for all (null). */
  listApproved(catalogId: string | null): Promise<GlobalMemoryRow[]>;
}

/** One counter of a proposal for the shared memory: a number, never a person. */
export interface PreferenceCounter {
  catalogId: string;
  proposalKey: string;
  support: number;
}

export interface WeaknessCounter {
  catalogId: string;
  enablerId: string;
  title: string;
  support: number;
}
