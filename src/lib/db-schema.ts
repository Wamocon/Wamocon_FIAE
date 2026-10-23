/**
 * Central database schema selection.
 *
 * Production and Preview share one Supabase database. Production uses the
 * schema `public`, Preview uses `public_preview` (a structural copy, see
 * docs/release-prozess.md). Without any variable everything runs on `public`
 * exactly as before.
 *
 * Source: NEXT_PUBLIC_DB_SCHEMA or SUPABASE_DB_SCHEMA. next.config.ts passes the
 * value on as NEXT_PUBLIC_DB_SCHEMA, which Next.js inlines at BUILD time, so
 * every deployment needs its own build. No other code names a schema.
 *
 * Drizzle: queries use unqualified table names. The Preview deployment
 * connects with the database role `app_preview` whose search_path is
 * `public_preview` and which has no rights on `public`. A role based
 * search_path is more robust than a startup parameter behind the pooler, and
 * it fails closed. assertRoleMatchesSchema() checks that role and schema fit.
 */

export type DbSchema = 'public' | 'public_preview';

export const ALLOWED_DB_SCHEMAS: readonly DbSchema[] = [
  'public',
  'public_preview',
];

/** Database role of the Preview deployment (user name prefix, the pooler appends the project ref). */
export const PREVIEW_DB_ROLE = 'app_preview';

/** Path prefix for uploads from Preview into the shared storage buckets. */
export const PREVIEW_STORAGE_PREFIX = 'preview/';

interface SchemaEnv {
  NEXT_PUBLIC_DB_SCHEMA?: string;
  SUPABASE_DB_SCHEMA?: string;
}

/**
 * Resolves and validates the schema. Both variables set to different values is
 * an error (a mix would be a configuration accident), any value other than the
 * two allowed ones is an error, nothing set means public.
 */
export function resolveDbSchema(env: SchemaEnv): DbSchema {
  const publicValue = env.NEXT_PUBLIC_DB_SCHEMA?.trim() || undefined;
  const serverValue = env.SUPABASE_DB_SCHEMA?.trim() || undefined;
  if (publicValue && serverValue && publicValue !== serverValue) {
    throw new Error(
      'NEXT_PUBLIC_DB_SCHEMA and SUPABASE_DB_SCHEMA differ; set both to the same value or only one.'
    );
  }
  const value = publicValue || serverValue || 'public';
  if (!ALLOWED_DB_SCHEMAS.includes(value as DbSchema)) {
    throw new Error(
      `Database schema "${value}" is not allowed, expected one of: ${ALLOWED_DB_SCHEMAS.join(', ')}.`
    );
  }
  return value as DbSchema;
}

/**
 * Build guard: a Vercel production build must use `public`, a Vercel preview
 * build must use `public_preview`. VERCEL_ENV is unset outside of Vercel (local
 * development, Docker), then nothing is checked.
 */
export function assertSchemaMatchesEnvironment(
  schema: DbSchema,
  vercelEnv: string | undefined
): void {
  if (vercelEnv === 'production' && schema !== 'public') {
    throw new Error(
      `A production build must use the schema "public", but it is "${schema}".`
    );
  }
  if (vercelEnv === 'preview' && schema !== 'public_preview') {
    throw new Error(
      `A preview build must use the schema "public_preview", but it is "${schema}". The deploy workflows pin it; do not build Preview on another path.`
    );
  }
}

/**
 * Fails closed if the database role does not fit the schema: Preview must
 * connect as app_preview, everything else must not. Never prints the
 * connection string.
 */
export function assertRoleMatchesSchema(
  connectionString: string,
  schema: DbSchema
): void {
  let user = '';
  try {
    user = decodeURIComponent(new URL(connectionString).username);
  } catch {
    // An unreadable string is checked by the driver; for Preview it is refused here.
    if (schema === 'public_preview') {
      throw new Error(
        'DB_CONNECTION_STRING cannot be parsed, refusing to start with the Preview schema.'
      );
    }
    return;
  }
  const isPreviewRole = user.startsWith(PREVIEW_DB_ROLE);
  if (schema === 'public_preview' && !isPreviewRole) {
    throw new Error(
      `The Preview schema requires the database role ${PREVIEW_DB_ROLE} (search_path public_preview, no rights on public).`
    );
  }
  if (schema === 'public' && isPreviewRole) {
    throw new Error(
      `The role ${PREVIEW_DB_ROLE} must not be used with the schema "public".`
    );
  }
}

/** Schema of this build. The literal process.env.NEXT_PUBLIC_DB_SCHEMA is required for inlining. */
export const DB_SCHEMA: DbSchema = resolveDbSchema({
  NEXT_PUBLIC_DB_SCHEMA: process.env.NEXT_PUBLIC_DB_SCHEMA,
  SUPABASE_DB_SCHEMA: process.env.SUPABASE_DB_SCHEMA,
});

export const IS_PREVIEW_SCHEMA = DB_SCHEMA === 'public_preview';

/**
 * Option for the Supabase clients. public_preview has the same structure as
 * public, so the generated types of public apply there too.
 */
export const DB_OPTION = { schema: DB_SCHEMA as 'public' };

/** Uploads from Preview go under preview/ in the shared buckets, Production keeps its paths. */
export function withStoragePrefix(
  path: string,
  schema: DbSchema = DB_SCHEMA
): string {
  if (schema !== 'public_preview' || path.startsWith(PREVIEW_STORAGE_PREFIX)) {
    return path;
  }
  return `${PREVIEW_STORAGE_PREFIX}${path}`;
}

/**
 * Sign-up metadata. A user created by Preview carries env=preview, so the
 * Production auth trigger skips the user and the Preview twin trigger creates
 * the profile in public_preview (supabase/preview-setup/02 and 03).
 */
export function signupMetadata(
  schema: DbSchema = DB_SCHEMA
): Record<string, string> {
  return schema === 'public_preview' ? { env: 'preview' } : {};
}
