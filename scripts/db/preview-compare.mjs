// Compares the structure of public and public_preview. Both schemas must be
// equal after every migration; only the schema name and the Preview names of
// shared objects (bucket ids and cron jobs with suffix -preview) may differ.
//
// PRODUCTION job only (needs the Supabase access token): the Preview roles cannot read public.
// Usage: node scripts/db/preview-compare.mjs --linked | --local | --db-url <url> [--only-if-same-state]
//   --only-if-same-state: only compare if public and public_preview have applied
//   the same migrations. Preview runs ahead of public (migrations of open
//   branches); then only the differences in the history are reported, in CI as
//   ::warning::.
// CLI as in preview-migrate.mjs (SUPABASE_CLI or "supabase" from the PATH).

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, query, targetFrom } from './preview-cli.mjs';
import { LEDGER } from './preview-migrate.mjs';
import { PREVIEW_SCHEMA } from './preview-rewrite.mjs';

const HEAD = /^-- Name: (.+); Type: (.+); Schema: (.*?); Owner: (.*)$/;

export function objects(dump) {
  const map = new Map();
  let key = null;
  // on both sides, because public may mention public_preview explicitly
  // The clone calls preview_support.auth_uid() where public calls auth.uid(): same meaning
  const align = t =>
    t
      .replaceAll(PREVIEW_SCHEMA, 'public')
      .replace(
        /"?(?:preview_support"?\."?auth_|auth"?\."?)(uid|role|jwt|email)"?\(/g,
        'auth.$1('
      );
  for (const line of dump.split('\n')) {
    const head = HEAD.exec(line);
    if (head) {
      const [, name, type] = head;
      const skip =
        type === 'SCHEMA' ||
        type === 'DEFAULT ACL' ||
        ((type === 'COMMENT' || type === 'ACL') && name.startsWith('SCHEMA '));
      key = skip ? null : `${type} ${align(name)}`;
      if (key && !map.has(key)) map.set(key, []);
      continue;
    }
    if (
      !key ||
      !line.trim() ||
      line.startsWith('--') ||
      /^(SET |SELECT pg_catalog\.set_config)/.test(line)
    ) {
      continue;
    }
    map.get(key).push(align(line.trimEnd()));
  }
  // Foreign keys to tables of other schemas (auth.users) are not cloned into
  // public_preview: the Preview role has no REFERENCES right there.
  for (const [k, lines] of [...map]) {
    if (
      k.startsWith('FK CONSTRAINT ') &&
      lines.some(l => /REFERENCES\s+"?(?!public)[a-z_]+"?\./i.test(l))
    ) {
      map.delete(k);
    }
  }
  return new Map([...map].map(([k, v]) => [k, v.join('\n')]));
}

export function differences(source, copy) {
  const list = [];
  for (const [k, v] of source) {
    if (!copy.has(k))
      list.push({ kind: 'missing in public_preview', object: k });
    else if (copy.get(k) !== v) {
      const a = v.split('\n');
      const b = copy.get(k).split('\n');
      const i = a.findIndex((line, n) => line !== b[n]);
      list.push({
        kind: 'differs',
        object: k,
        public: a[i] ?? '(end)',
        public_preview: b[i] ?? '(end)',
      });
    }
  }
  for (const k of copy.keys()) {
    if (!source.has(k))
      list.push({ kind: 'only in public_preview', object: k });
  }
  return list;
}

/** Versions that stand in only one of the two histories. */
export function historyDifference(publicVersions, previewVersions) {
  const p = new Set(publicVersions);
  const v = new Set(previewVersions);
  return {
    onlyPreview: [...v].filter(x => !p.has(x)).sort(),
    onlyPublic: [...p].filter(x => !v.has(x)).sort(),
  };
}

/**
 * For --only-if-same-state: compare or skip. A dump cannot be limited to the
 * common versions, so skipping it is.
 * @returns {{ compare: boolean, lines: string[] }} lines: finished output
 */
export function decideComparison(
  publicVersions,
  previewVersions,
  { inCi = false } = {}
) {
  const d = historyDifference(publicVersions, previewVersions);
  if (d.onlyPreview.length === 0 && d.onlyPublic.length === 0) {
    return { compare: true, lines: [] };
  }
  const lines = [
    `${inCi ? '::warning::' : 'WARNING: '}Structure comparison skipped: public and ${PREVIEW_SCHEMA} have a different migration state ` +
      `(only ${PREVIEW_SCHEMA}: ${d.onlyPreview.join(', ') || '-'}; only public: ${d.onlyPublic.join(', ') || '-'}).`,
  ];
  if (d.onlyPreview.length > 0) {
    lines.push(
      `  only in ${PREVIEW_SCHEMA} (open or closed branches): ${d.onlyPreview.join(', ')}`
    );
    lines.push(
      '  If this stays so after all branches are merged or closed: run the preview-reset workflow (mode execute).'
    );
  }
  if (d.onlyPublic.length > 0) {
    lines.push(
      `  only in public (Preview catches up on the next run): ${d.onlyPublic.join(', ')}`
    );
  }
  return { compare: false, lines };
}

function main() {
  const args = process.argv.slice(2);
  const target = targetFrom(args);
  if (!target) {
    console.error(
      'Usage: node scripts/db/preview-compare.mjs --linked|--local|--db-url <url> [--only-if-same-state]'
    );
    process.exit(2);
  }
  const dir = mkdtempSync(join(tmpdir(), 'preview-compare-'));
  try {
    if (args.includes('--only-if-same-state')) {
      const versions = table =>
        query(target, `select version from ${table}`).map(r => r.version);
      const decision = decideComparison(
        versions('supabase_migrations.schema_migrations'),
        versions(LEDGER),
        { inCi: Boolean(process.env.GITHUB_ACTIONS) }
      );
      for (const line of decision.lines) console.log(line);
      if (!decision.compare) return;
    }
    const load = schema => {
      const file = join(dir, `${schema}.sql`);
      cli([
        'db',
        'dump',
        ...target,
        '-s',
        schema,
        '--keep-comments',
        '-f',
        file,
      ]);
      return objects(readFileSync(file, 'utf8'));
    };
    const source = load('public');
    const copy = load(PREVIEW_SCHEMA);
    const list = differences(source, copy);
    if (list.length === 0) {
      console.log(
        `Structure comparison: public and ${PREVIEW_SCHEMA} are equal (${source.size} objects).`
      );
      return;
    }
    console.error(
      `Structure comparison: ${list.length} difference(s) between public and ${PREVIEW_SCHEMA}`
    );
    for (const u of list.slice(0, 40)) {
      console.error(`  - ${u.kind}: ${u.object}`);
      if (u.kind === 'differs') {
        console.error(
          `      public:         ${u.public}\n      public_preview: ${u.public_preview}`
        );
      }
    }
    if (list.length > 40) console.error(`  ... and ${list.length - 40} more`);
    process.exitCode = 1;
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exitCode = 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
