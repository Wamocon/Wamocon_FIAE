// Arguments of scripts/import/kfbm-documents.mjs. Pure functions: no process access, no
// database, so the tests can run them.
//
// The arguments are those of the apply script (apply/target.ts): plan, check and run, the source
// folder, --target local|preview, --created-by, the dry run as default, --apply, --confirm-host
// for a real run against the Preview, production refused in every case. Differences:
//  - the source folder is always needed (the files are read again for the copy), no --plan file
//  - --overwrite-files (run --apply only): replace files that exist
//  - --confirm-storage-host <host> (run --apply, always): the host of the storage address. The
//    secret key goes to that address and the buckets are shared with Production
//  - no --update-existing, no --scenario-solutions, no --decisions: rows are never changed here

import { parseApplyArgs } from '../apply/target';
import type { ApplyArgs } from '../apply/target';

export type DocumentsArgs = ApplyArgs & {
  overwriteFiles: boolean;
  /** Host (and port) of the storage address that a real run is meant for, lower case. */
  confirmStorageHost: string | null;
};

export type ParsedDocumentsArgs =
  | { ok: true; args: DocumentsArgs }
  | { ok: false; errors: string[] };

const OVERWRITE = '--overwrite-files';
const STORAGE_HOST = '--confirm-storage-host';
const REFUSED = [
  ['--plan', /^--plan(?:=|$)/],
  ['--decisions', /^--decisions(?:=|$)/],
  ['--update-existing', /^--update-existing(?:=|$)/],
  ['--scenario-solutions', /^--scenario-solutions(?:=|$)/],
] as const;

export function parseDocumentsArgs(argv: string[]): ParsedDocumentsArgs {
  const extra: string[] = [];
  for (const [name, pattern] of REFUSED) {
    if (argv.some(token => pattern.test(token))) {
      extra.push(`Unknown argument: ${name}`);
    }
  }
  const overwriteFiles = argv.includes(OVERWRITE);
  // --confirm-storage-host <host> or --confirm-storage-host=<host>
  let confirmStorageHost: string | null = null;
  const withoutHost: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === STORAGE_HOST || token.startsWith(`${STORAGE_HOST}=`)) {
      const value = token.includes('=')
        ? token.slice(token.indexOf('=') + 1)
        : argv[(i += 1)];
      if (!value || value.startsWith('--') || confirmStorageHost !== null) {
        extra.push(`${STORAGE_HOST} needs one value`);
      } else {
        confirmStorageHost = value.toLowerCase();
      }
    } else {
      withoutHost.push(token);
    }
  }
  const rest = withoutHost
    .filter(token => token !== OVERWRITE)
    .filter(token => !REFUSED.some(([, pattern]) => pattern.test(token)));
  const parsed = parseApplyArgs(rest);
  if (!parsed.ok) {
    return { ok: false, errors: [...new Set([...parsed.errors, ...extra])] };
  }
  const { command, source, out, reportOut, apply } = parsed.args;
  if (!source) {
    extra.push(
      'The source folder is needed (the files are read again for the copy)'
    );
  }
  if (overwriteFiles && !(command === 'run' && apply)) {
    extra.push(`${OVERWRITE} belongs to run --apply`);
  }
  if (confirmStorageHost !== null && !(command === 'run' && apply)) {
    extra.push(`${STORAGE_HOST} belongs to run --apply`);
  }
  if (command === 'run' && apply && confirmStorageHost === null) {
    extra.push(
      `A real run needs ${STORAGE_HOST} <host of the storage address>`
    );
  }
  if (command === 'plan' && out && !/\.json$/i.test(out)) {
    extra.push(
      '--out must be a .json file (the summary is written next to it)'
    );
  }
  if (reportOut && !/\.md$/i.test(reportOut)) {
    extra.push('--report-out must be a .md file');
  }
  if (extra.length > 0) return { ok: false, errors: [...new Set(extra)] };
  return {
    ok: true,
    args: { ...parsed.args, overwriteFiles, confirmStorageHost },
  };
}
