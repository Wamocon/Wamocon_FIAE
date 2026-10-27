// The log of the transmissions to Sokrates and the numbers the cost brake reads
// (docs/ki-upload-konzept.md 3.2, 6.3, 9.1 T7). One table: content_upload_ki_calls.
//
// What a row holds (metadata only, concept 6.5 and the decision of this package):
// the run and the file, the stage, the model and the HOST of the address (never a
// path, never a key), the length and the SHA-256 of the excerpt that was sent, the
// number of replaced patterns, the status, the times and token counts, the number
// of the try, and the checked answer as JSON WITHOUT the reason text. The excerpt
// column stays empty: the hash and the length let anyone check a re-built excerpt
// against what went out, and no text of a document is kept a second time.
//
// Two implementations (as with the other repositories of the upload): SQL in
// repo-pg.ts, memory in tests/helpers/memoryKiRepo.ts, held to the same rules by
// one contract test.

import type { KiStage } from '@/lib/content-upload/ki/prompt';

export type KiCallStatus =
  | 'ok'
  | 'invalid_json'
  | 'not_in_whitelist'
  | 'timeout'
  | 'http_error'
  | 'refused_by_guard'
  | 'skipped';

/** The statuses of a call that really reached the server (they cost something). */
export const CALL_STATUSES: readonly KiCallStatus[] = [
  'ok',
  'invalid_json',
  'not_in_whitelist',
  'timeout',
  'http_error',
];

/** The statuses that count as a failure for the circuit breaker. */
export const FAILURE_STATUSES: readonly KiCallStatus[] = [
  'invalid_json',
  'timeout',
  'http_error',
];

export interface KiCallWrite {
  runId: string;
  fileId: string;
  stage: KiStage;
  /** Null when nothing was sent (refused, skipped). */
  model: string | null;
  endpointHost: string | null;
  excerptChars: number;
  /** SHA-256 of the exact excerpt, 64 hex characters (of the empty string if none). */
  excerptSha256: string;
  redactions: number;
  status: KiCallStatus;
  httpStatus: number | null;
  latencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  /** Number of the try for this file, from 1. */
  attempt: number;
  /** The checked answer as JSON, at most 500 characters, without the reason text. */
  answer: string | null;
}

export interface KiUsage {
  /** Calls of the run that reached the server. */
  run: number;
  /** Calls of all runs in the last 24 hours. */
  day: number;
  /** Calls for this file. */
  file: number;
  /** The newest calls of the run that reached the server, newest first. */
  recent: { status: KiCallStatus; ageSec: number }[];
}

export interface KiRepo {
  recordCall(call: KiCallWrite): Promise<void>;
  /** The numbers for the brake. `recentLimit` newest calls of the run. */
  usage(
    runId: string,
    fileId: string | null,
    recentLimit: number
  ): Promise<KiUsage>;
}
