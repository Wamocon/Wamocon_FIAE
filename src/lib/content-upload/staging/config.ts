// Constants and the environment switch of the content upload (package U2 of
// docs/ki-upload-konzept.md, sections 4.5 and 9.3).
//
// The switch is the one place that decides whether the feature runs at all.
// Every route of the upload calls contentUploadDisabledResponse() (guard.ts) as
// the first line after the session, so a deployment where the feature is off
// answers all of them the same way, with a clear message. It fails closed: only a Vercel
// preview deployment (on the Preview schema) and a local, non-production run
// are active. Production, every unknown VERCEL_ENV and a production build
// without VERCEL_ENV (Docker, `next start`) are off.

import { IS_PREVIEW_SCHEMA } from '@/lib/db-schema';

/**
 * The private staging bucket (created by the owner, no policy). Limits and types of the
 * bucket: PDF and docx up to 25 MB; for JSON and Excel (package UP2) the owner adds the
 * MIME types application/json and the xlsx type and raises the size limit to 32 MB.
 */
export const UPLOAD_BUCKET = 'content-upload';

/** The only catalog of version 1 (concept K9, O9). */
export const UPLOAD_CATALOG_CODE = 'KFBM';

export const MEGABYTE = 1024 * 1024;
export const GIGABYTE = 1024 * MEGABYTE;

/** Limits of section 4.5 and 4.6 of the concept. */
export const LIMITS = {
  /** Size of one Word or PDF file (see maxFileBytesFor for the other kinds). */
  maxFileBytes: 25 * MEGABYTE,
  /** Size of one quiz JSON file (schema 1.0, like MAX_QUIZ_JSON_BYTES of the import script). */
  maxJsonBytes: 32 * MEGABYTE,
  /** Size of one Excel mapping file (a mapping table has a few hundred rows). */
  maxXlsxBytes: 5 * MEGABYTE,
  /** Files of one run (rows that are not expired). */
  maxFilesPerRun: 1500,
  /** Bytes of one run (copies that are merged have no object and do not count). */
  maxRunBytes: 1 * GIGABYTE,
  /** Bytes of all runs together in the staging bucket. */
  maxStagingBytes: 2 * GIGABYTE,
  /** The staging warning starts at this share of maxStagingBytes. */
  stagingWarnRatio: 0.8,
  /** Runs of one person that are not applied or discarded. */
  maxActiveRunsPerPerson: 3,
  /** Files in one announce, upload-url and complete request. */
  maxFilesPerRequest: 50,
  /** Requests for signed upload urls per person and window. */
  signedUrlRequestsPerWindow: 60,
  signedUrlWindowSeconds: 60,
  /** A file that was never reported as done is cleaned up after this. */
  expireAfterHours: 24,
  /** The rows of a discarded run are deleted after this (objects at once). */
  discardedRowsDays: 7,
  /** Staging files of an applied run are deleted after this (rollback window). */
  appliedFilesDays: 30,
  /** A run that was never applied and is idle for this long counts as orphaned. */
  orphanRunDays: 30,
  /** Only objects older than this may be deleted as orphans of the bucket. */
  orphanObjectMinAgeDays: 7,
  /** Shape of the cleaned relative path (concept 4.4). */
  maxRelPathChars: 500,
  maxPathSegments: 12,
  maxFileNameChars: 200,
  maxLabelChars: 120,
} as const;

/**
 * Largest size of a file of this kind in bytes. An unknown kind gets the smallest limit,
 * so a kind that was added without a limit here can never be larger than it should be.
 */
export function maxFileBytesFor(ext: string): number {
  switch (ext) {
    case 'json':
      return LIMITS.maxJsonBytes;
    case 'xlsx':
      return LIMITS.maxXlsxBytes;
    case 'docx':
    case 'pdf':
      return LIMITS.maxFileBytes;
    default:
      return Math.min(LIMITS.maxFileBytes, LIMITS.maxXlsxBytes);
  }
}

export type UploadAvailability =
  | { enabled: true }
  | { enabled: false; reason: string };

export type AvailabilityEnv = {
  vercelEnv?: string | null;
  nodeEnv?: string | null;
  previewSchema?: boolean;
};

export const DISABLED_MESSAGE =
  'The content upload is not available in this environment.';

/**
 * Whether the content upload may run here. Pure, takes the environment as an
 * argument so a test can try every case.
 *
 *  - VERCEL_ENV=preview: on, but only on the Preview schema (a preview build
 *    on another schema is a configuration accident)
 *  - VERCEL_ENV=production: off
 *  - VERCEL_ENV=development (vercel dev): on
 *  - any other VERCEL_ENV value: off (fail closed)
 *  - no VERCEL_ENV (local development, Docker, CI): on, unless NODE_ENV is
 *    production (a production build outside of Vercel is treated as production)
 */
export function evaluateAvailability(env: AvailabilityEnv): UploadAvailability {
  const vercel = (env.vercelEnv ?? '').trim().toLowerCase();
  const node = (env.nodeEnv ?? '').trim().toLowerCase();
  if (vercel === 'preview') {
    return env.previewSchema === true
      ? { enabled: true }
      : { enabled: false, reason: 'PREVIEW_SCHEMA_MISSING' };
  }
  if (vercel === 'development') return { enabled: true };
  if (vercel !== '') return { enabled: false, reason: 'ENVIRONMENT' };
  if (node === 'production') {
    return { enabled: false, reason: 'PRODUCTION_BUILD' };
  }
  return { enabled: true };
}

/** The availability of this deployment, read from the environment. */
export function contentUploadAvailability(): UploadAvailability {
  return evaluateAvailability({
    vercelEnv: process.env.VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
    previewSchema: IS_PREVIEW_SCHEMA,
  });
}
