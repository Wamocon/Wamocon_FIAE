/**
 * Arguments and target protection of scripts/reindex-gemini.ts. Pure
 * functions, no database access, no process access, so the tests can run them.
 *
 * Rules:
 *  - the default is a dry run (counts chunks, no model call, no write);
 *    a real run needs --apply
 *  - --target preview|production|local is always required and is compared with
 *    the facts of the connection (host, current_schema, role) before anything
 *    else happens
 *  - production is refused without --confirm-production AND an approved
 *    rollout gate (KFBM_ROLLOUT_APPROVED = "true", see scripts/db/rollout-gate.mjs)
 *  - --purge and --purge-stale only together with --catalog
 *
 * @module lib/hai/reindexArgs
 */

export type ReindexTarget = 'preview' | 'production' | 'local';

export interface ReindexOptions {
  /** Real run. false = dry run (the default). */
  apply: boolean;
  force: boolean;
  purge: boolean;
  purgeStale: boolean;
  pdfsOnly: boolean;
  /** Code of the training catalog the run is limited to, upper case. */
  catalogCode: string | null;
  target: ReindexTarget | null;
  confirmProduction: boolean;
}

export type ParsedReindexArgs =
  | { ok: true; options: ReindexOptions }
  | { ok: false; errors: string[] };

export interface ConnectionFacts {
  host: string | null;
  currentSchema: string | null;
  currentUser: string | null;
}

/** Roles of the Preview database (supabase/preview-setup/01-preview-role.sql). */
export const PREVIEW_ROLES = ['app_preview', 'app_preview_migrator'];
export const PREVIEW_SCHEMA = 'public_preview';
export const PRODUCTION_SCHEMA = 'public';

const TARGETS: ReindexTarget[] = ['preview', 'production', 'local'];
const CATALOG_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const FLAGS = new Set([
  '--apply',
  '--dry-run',
  '--force',
  '--purge',
  '--purge-stale',
  '--pdfs-only',
  '--confirm-production',
]);
const VALUE_OPTIONS = new Set(['--catalog', '--target']);

/** Splits "--name=value" into name and value, otherwise leaves the token. */
function splitToken(token: string): [string, string | undefined] {
  const eq = token.indexOf('=');
  return token.startsWith('--') && eq > 0
    ? [token.slice(0, eq), token.slice(eq + 1)]
    : [token, undefined];
}

export function parseReindexArgs(argv: string[]): ParsedReindexArgs {
  const errors: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const [name, inline] = splitToken(argv[i]);
    if (FLAGS.has(name) && inline === undefined) {
      flags.add(name);
    } else if (VALUE_OPTIONS.has(name)) {
      const value = inline ?? argv[++i];
      if (value === undefined || value.startsWith('--') || value === '') {
        errors.push(`${name} needs a value`);
      } else {
        values.set(name, value);
      }
    } else {
      errors.push(`Unknown argument: ${argv[i]}`);
    }
  }

  const apply = flags.has('--apply');
  if (apply && flags.has('--dry-run')) {
    errors.push('--apply and --dry-run exclude each other');
  }

  const rawCatalog = values.get('--catalog');
  let catalogCode: string | null = null;
  if (rawCatalog !== undefined) {
    if (!CATALOG_CODE.test(rawCatalog)) {
      errors.push('--catalog needs a catalog code such as FIAE or KFBM');
    } else {
      catalogCode = rawCatalog.toUpperCase();
    }
  }

  const rawTarget = values.get('--target');
  let target: ReindexTarget | null = null;
  if (rawTarget === undefined) {
    if (!errors.some(e => e.startsWith('--target'))) {
      errors.push('--target preview|production|local is required');
    }
  } else if (!TARGETS.includes(rawTarget as ReindexTarget)) {
    errors.push('--target must be preview, production or local');
  } else {
    target = rawTarget as ReindexTarget;
  }

  const purge = flags.has('--purge');
  const purgeStale = flags.has('--purge-stale');
  if ((purge || purgeStale) && rawCatalog === undefined) {
    errors.push('--purge and --purge-stale are only allowed with --catalog');
  }

  const confirmProduction = flags.has('--confirm-production');
  if (confirmProduction && target !== 'production') {
    errors.push('--confirm-production only belongs to --target production');
  }
  if (target === 'production' && !confirmProduction) {
    errors.push(
      'Production is refused without --confirm-production (and an approved rollout gate)'
    );
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    options: {
      apply,
      force: flags.has('--force'),
      purge,
      purgeStale,
      pdfsOnly: flags.has('--pdfs-only'),
      catalogCode,
      target,
      confirmProduction,
    },
  };
}

/** Host of a connection string, or null if it cannot be read. */
export function connectionHost(connectionString: string): string | null {
  try {
    return new URL(connectionString).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

export function isLoopbackHost(host: string | null): boolean {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]'
  );
}

/**
 * Compare the declared target with the facts of the connection. Returns the
 * reasons to stop, an empty list means the connection fits the target.
 *
 *  - local: loopback host and schema public
 *  - preview: schema public_preview and a Preview role
 *  - production: non-loopback host, schema public, no Preview role, an
 *    approved rollout gate (env value exactly "true"); the flag
 *    --confirm-production is checked by parseReindexArgs
 */
export function checkTargetAgainstConnection(
  options: Pick<ReindexOptions, 'target' | 'confirmProduction'>,
  facts: ConnectionFacts,
  env: Record<string, string | undefined>
): string[] {
  const errors: string[] = [];
  const loopback = isLoopbackHost(facts.host);
  const previewRole = PREVIEW_ROLES.includes(facts.currentUser ?? '');

  if (!facts.host) errors.push('The host of the connection cannot be read.');
  if (!facts.currentSchema || !facts.currentUser) {
    errors.push('current_schema or the role of the connection is unknown.');
  }
  if (errors.length > 0) return errors;

  switch (options.target) {
    case 'local':
      if (!loopback) {
        errors.push(
          `--target local needs a loopback host, the connection goes to ${facts.host}.`
        );
      }
      if (facts.currentSchema !== PRODUCTION_SCHEMA) {
        errors.push(
          `--target local expects the schema public, current_schema is ${facts.currentSchema}.`
        );
      }
      break;
    case 'preview':
      if (facts.currentSchema !== PREVIEW_SCHEMA) {
        errors.push(
          `--target preview expects the schema ${PREVIEW_SCHEMA}, current_schema is ${facts.currentSchema}.`
        );
      }
      if (!previewRole) {
        errors.push(
          `--target preview expects a Preview role (${PREVIEW_ROLES.join(', ')}), the role is ${facts.currentUser}.`
        );
      }
      break;
    case 'production':
      if (loopback) {
        errors.push(
          'The connection goes to a loopback host, that is not production. Use --target local.'
        );
      }
      if (facts.currentSchema !== PRODUCTION_SCHEMA) {
        errors.push(
          `--target production expects the schema public, current_schema is ${facts.currentSchema}.`
        );
      }
      if (previewRole) {
        errors.push(
          `The role ${facts.currentUser} is a Preview role, not a production role.`
        );
      }
      if (!options.confirmProduction) {
        errors.push('Production needs --confirm-production.');
      }
      if (env.KFBM_ROLLOUT_APPROVED !== 'true') {
        errors.push(
          'The rollout gate is not suspended (KFBM_ROLLOUT_APPROVED is not "true"). Production is refused.'
        );
      }
      break;
    default:
      errors.push('--target is missing.');
  }
  return errors;
}

// ============================================================================
// Dry run count
// ============================================================================

export interface PlanRow {
  sourceType: string;
  catalog: string;
  visibility: string;
  chunks: number;
}

/** Counts chunks per source type, catalog and visibility. */
export class ChunkPlan {
  private readonly counts = new Map<string, PlanRow>();

  add(
    sourceType: string,
    catalog: string | null,
    visibility: string,
    chunks: number
  ): void {
    if (chunks <= 0) return;
    const label = catalog ?? '(no catalog)';
    const key = `${sourceType}\u0000${label}\u0000${visibility}`;
    const row = this.counts.get(key) ?? {
      sourceType,
      catalog: label,
      visibility,
      chunks: 0,
    };
    row.chunks += chunks;
    this.counts.set(key, row);
  }

  rows(): PlanRow[] {
    return [...this.counts.values()].sort(
      (a, b) =>
        a.sourceType.localeCompare(b.sourceType) ||
        a.catalog.localeCompare(b.catalog) ||
        a.visibility.localeCompare(b.visibility)
    );
  }

  total(): number {
    return this.rows().reduce((sum, row) => sum + row.chunks, 0);
  }
}
