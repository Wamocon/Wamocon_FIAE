// Row types of the content upload as the application sees them (the columns of
// the tables of migration 20261030000100, camel cased, bigint as number).

import type {
  FileStatus,
  RunStatus,
} from '@/lib/content-upload/staging/status';
import type { UploadExt } from '@/lib/content-upload/staging/paths';

export interface RunRow {
  id: string;
  trainingCatalogId: string;
  createdById: string;
  label: string;
  status: RunStatus;
  kiEnabled: boolean;
  declarationAcceptedAt: Date;
  /** Folder of the run in the staging bucket. Never part of an answer. */
  storagePrefix: string;
  decisionsVersion: number;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
  purgeAfter: Date | null;
}

export interface FileRow {
  id: string;
  runId: string;
  relPath: string;
  fileName: string;
  ext: UploadExt;
  sizeBytes: number;
  sha256: string;
  clientMtimeMs: number | null;
  /** Server chosen path of the object. Never part of an answer except the signed upload. */
  storagePath: string;
  status: FileStatus;
  statusCode: string | null;
  attempts: number;
  lockedUntil: Date | null;
  claimId: string | null;
  duplicateOfId: string | null;
  docType: string | null;
  pageCount: number | null;
  charCount: number | null;
  parseSummary: Record<string, unknown> | null;
  dupKey: string | null;
  createdAt: Date;
  completedAt: Date | null;
  processedAt: Date | null;
}

/** Values a step of the queue may write next to the status. */
export interface FilePatch {
  docType?: string | null;
  pageCount?: number | null;
  charCount?: number | null;
  dupKey?: string | null;
  /** Merged into parse_summary: numbers and finding codes only, never document text. */
  parseSummary?: Record<string, unknown>;
}

/** Counters of one run for the progress answer. */
export interface RunProgress {
  counts: Partial<Record<FileStatus, number>>;
  totalFiles: number;
  totalBytes: number;
}

/** Marker in parse_summary: the object of the file is gone from the bucket. */
export const OBJECT_DELETED_KEY = 'objectDeleted';
