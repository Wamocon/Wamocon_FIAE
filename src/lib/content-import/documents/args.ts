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
//  - --from-word: the source folder is the Word tree (Komponente), the PDFs are made from the Word
//    files by a local LibreOffice (see word.ts and scripts/import/kfbm-documents-word.mjs).
//    --soffice <file> names the program, --convert-timeout <seconds> is the limit per file.

import { parseApplyArgs } from '../apply/target';
import type { ApplyArgs } from '../apply/target';

export type DocumentsArgs = ApplyArgs & {
  overwriteFiles: boolean;
  /** Host (and port) of the storage address that a real run is meant for, lower case. */
  confirmStorageHost: string | null;
  /** The source is the Word tree, the PDFs are made from it. */
  fromWord: boolean;
  /** Path of the LibreOffice program (--from-word, check and run). */
  soffice: string | null;
  /** Limit in seconds for the conversion of one file (--from-word, check and run). */
  convertTimeoutSeconds: number | null;
};

/** The limit per file: LibreOffice needs a few seconds to start, a large file much longer. */
export const CONVERT_TIMEOUT_MIN = 10;
export const CONVERT_TIMEOUT_MAX = 600;

export type ParsedDocumentsArgs =
  | { ok: true; args: DocumentsArgs }
  | { ok: false; errors: string[] };

const OVERWRITE = '--overwrite-files';
const STORAGE_HOST = '--confirm-storage-host';
const FROM_WORD = '--from-word';
const SOFFICE = '--soffice';
const CONVERT_TIMEOUT = '--convert-timeout';
const VALUES = [STORAGE_HOST, SOFFICE, CONVERT_TIMEOUT] as const;
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
  const fromWord = argv.includes(FROM_WORD);
  // --confirm-storage-host <host>, --soffice <file>, --convert-timeout <seconds>, each also as
  // --name=value, each at most once
  const values = new Map<string, string>();
  const withoutValues: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const name = VALUES.find(v => token === v || token.startsWith(`${v}=`));
    if (name) {
      const value = token.includes('=')
        ? token.slice(token.indexOf('=') + 1)
        : argv[(i += 1)];
      if (!value || value.startsWith('--') || values.has(name)) {
        extra.push(`${name} needs one value`);
      } else {
        values.set(name, value);
      }
    } else {
      withoutValues.push(token);
    }
  }
  const confirmStorageHost = values.has(STORAGE_HOST)
    ? (values.get(STORAGE_HOST) as string).toLowerCase()
    : null;
  const soffice = values.get(SOFFICE) ?? null;
  let convertTimeoutSeconds: number | null = null;
  if (values.has(CONVERT_TIMEOUT)) {
    const raw = values.get(CONVERT_TIMEOUT) as string;
    const seconds = Number(raw);
    if (
      !/^\d+$/.test(raw) ||
      seconds < CONVERT_TIMEOUT_MIN ||
      seconds > CONVERT_TIMEOUT_MAX
    ) {
      extra.push(
        `${CONVERT_TIMEOUT} needs whole seconds from ${CONVERT_TIMEOUT_MIN} to ${CONVERT_TIMEOUT_MAX}`
      );
    } else {
      convertTimeoutSeconds = seconds;
    }
  }
  const rest = withoutValues
    .filter(token => token !== OVERWRITE && token !== FROM_WORD)
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
  if (soffice !== null || convertTimeoutSeconds !== null) {
    if (!fromWord || command === 'plan') {
      extra.push(
        `${SOFFICE} and ${CONVERT_TIMEOUT} belong to check and run with ${FROM_WORD} (plan does not convert)`
      );
    }
  }
  if (soffice !== null && !/^(?:[A-Za-z]:[\\/]|\/(?!\/))/.test(soffice)) {
    extra.push(`${SOFFICE} needs an absolute path`);
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
    args: {
      ...parsed.args,
      overwriteFiles,
      confirmStorageHost,
      fromWord,
      soffice,
      convertTimeoutSeconds,
    },
  };
}
