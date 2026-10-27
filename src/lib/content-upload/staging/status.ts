// State models of the content upload (concept section 2.3). The database only
// checks the list of values (content_upload_runs_status_check and
// content_upload_files_status_check), the transitions live here. Every change
// of a status goes through a conditional update ("... where status = <expected>")
// so two calls at the same time cannot both do the same step, and the target
// has to be a transition of the tables below.

export const RUN_STATUSES = [
  'draft',
  'uploading',
  'processing',
  'review',
  'applying',
  'applied',
  'failed',
  'discarded',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  draft: ['uploading', 'discarded'],
  uploading: ['processing', 'discarded'],
  processing: ['review', 'discarded'],
  review: ['applying', 'processing', 'discarded'],
  applying: ['review', 'applied', 'failed'],
  applied: ['review', 'discarded'],
  failed: ['review', 'discarded'],
  discarded: [],
};

/** Runs that count against the limit of active runs of one person. */
export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = [
  'draft',
  'uploading',
  'processing',
  'review',
  'applying',
  'failed',
];

export function isRunStatus(value: unknown): value is RunStatus {
  return (RUN_STATUSES as readonly unknown[]).includes(value);
}

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export const FILE_STATUSES = [
  'announced',
  'uploaded',
  'verified',
  'extracted',
  'proposed_rules',
  'unclear',
  'ki_pending',
  'proposed_ki',
  'decided',
  'applied',
  'failed',
  'rejected',
  'expired',
  'merged',
  'skipped',
  'superseded',
] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

/**
 * announced -> uploaded -> verified -> extracted -> proposed_rules -> decided -> applied,
 * with the branches of the diagram in 2.3: rejected (quarantine after the upload
 * check), failed (a step could not read the file), unclear and the model step
 * (ki_pending, proposed_ki), expired (never reported as done).
 * merged is only ever created (an exact copy inside a run), never reached.
 */
export const FILE_TRANSITIONS: Record<FileStatus, readonly FileStatus[]> = {
  announced: ['uploaded', 'rejected', 'expired'],
  uploaded: ['verified', 'rejected', 'failed'],
  verified: ['extracted', 'rejected', 'failed'],
  extracted: ['proposed_rules', 'unclear', 'failed'],
  proposed_rules: ['decided', 'skipped', 'superseded'],
  unclear: ['ki_pending', 'decided', 'skipped', 'superseded'],
  ki_pending: ['proposed_ki', 'unclear'],
  proposed_ki: ['decided', 'skipped', 'superseded'],
  decided: ['applied', 'skipped', 'superseded'],
  applied: [],
  failed: [],
  rejected: [],
  expired: [],
  merged: [],
  skipped: [],
  superseded: [],
};

export function isFileStatus(value: unknown): value is FileStatus {
  return (FILE_STATUSES as readonly unknown[]).includes(value);
}

export function canTransitionFile(from: FileStatus, to: FileStatus): boolean {
  return FILE_TRANSITIONS[from].includes(to);
}

/**
 * Files in these states have an object in the staging bucket (until the
 * marker `objectDeleted` in parse_summary says it is gone). merged copies and
 * expired files never have one that counts.
 */
export const OBJECT_FILE_STATUSES: readonly FileStatus[] = FILE_STATUSES.filter(
  s => s !== 'merged' && s !== 'expired'
);
