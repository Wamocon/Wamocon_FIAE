import { describe, it, expect } from '@jest/globals';
import {
  assertDbConfig,
  assertRoleMatchesSchema,
  assertSchemaMatchesEnvironment,
  isAnyPreviewDbRole,
  isPreviewDbRole,
  resolveDbSchema,
  withStoragePrefix,
} from '@/lib/db-schema';

const PREVIEW_URL =
  'postgresql://app_preview.abcdefghijklmnopqrst:PLACEHOLDER@aws-0-eu.pooler.supabase.com:5432/postgres';
const PROD_URL =
  'postgresql://postgres.abcdefghijklmnopqrst:PLACEHOLDER@aws-0-eu.pooler.supabase.com:5432/postgres';

describe('lib/db-schema resolveDbSchema', () => {
  it('falls back to public without any variable', () => {
    expect(resolveDbSchema({})).toBe('public');
    expect(resolveDbSchema({ NEXT_PUBLIC_DB_SCHEMA: '  ' })).toBe('public');
  });

  it('reads either variable', () => {
    expect(resolveDbSchema({ NEXT_PUBLIC_DB_SCHEMA: 'public_preview' })).toBe(
      'public_preview'
    );
    expect(resolveDbSchema({ SUPABASE_DB_SCHEMA: 'public_preview' })).toBe(
      'public_preview'
    );
  });

  it('accepts both variables with the same value', () => {
    expect(
      resolveDbSchema({
        NEXT_PUBLIC_DB_SCHEMA: 'public_preview',
        SUPABASE_DB_SCHEMA: 'public_preview',
      })
    ).toBe('public_preview');
  });

  it('rejects differing variables and unknown schemas', () => {
    expect(() =>
      resolveDbSchema({
        NEXT_PUBLIC_DB_SCHEMA: 'public',
        SUPABASE_DB_SCHEMA: 'public_preview',
      })
    ).toThrow(/differ/);
    expect(() => resolveDbSchema({ NEXT_PUBLIC_DB_SCHEMA: 'auth' })).toThrow(
      /not allowed/
    );
  });
});

describe('lib/db-schema assertSchemaMatchesEnvironment', () => {
  it('does not check the schema public outside of Vercel', () => {
    expect(() =>
      assertSchemaMatchesEnvironment('public', undefined)
    ).not.toThrow();
    expect(() =>
      assertSchemaMatchesEnvironment('public', 'development')
    ).not.toThrow();
  });

  it('refuses a production build with the preview schema and vice versa', () => {
    expect(() =>
      assertSchemaMatchesEnvironment('public_preview', 'production')
    ).toThrow(/production build/);
    expect(() => assertSchemaMatchesEnvironment('public', 'preview')).toThrow(
      /preview build/
    );
    expect(() =>
      assertSchemaMatchesEnvironment('public', 'production')
    ).not.toThrow();
    expect(() =>
      assertSchemaMatchesEnvironment('public_preview', 'preview')
    ).not.toThrow();
  });
});

describe('lib/db-schema assertRoleMatchesSchema', () => {
  it('Preview needs the app_preview role', () => {
    expect(() =>
      assertRoleMatchesSchema(PREVIEW_URL, 'public_preview')
    ).not.toThrow();
    expect(() => assertRoleMatchesSchema(PROD_URL, 'public_preview')).toThrow(
      /app_preview/
    );
  });

  it('Production must not use the app_preview role', () => {
    expect(() => assertRoleMatchesSchema(PROD_URL, 'public')).not.toThrow();
    expect(() => assertRoleMatchesSchema(PREVIEW_URL, 'public')).toThrow(
      /must not be used/
    );
  });

  it('local development with public and a plain postgres user keeps working', () => {
    expect(() =>
      assertRoleMatchesSchema(
        'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
        'public'
      )
    ).not.toThrow();
  });

  it('an unreadable string is refused for Preview, left to the driver otherwise', () => {
    expect(() =>
      assertRoleMatchesSchema('not a url', 'public_preview')
    ).toThrow(/cannot be parsed/);
    expect(() => assertRoleMatchesSchema('not a url', 'public')).not.toThrow();
  });

  it('never prints the connection string', () => {
    try {
      assertRoleMatchesSchema(PROD_URL, 'public_preview');
    } catch (e) {
      expect((e as Error).message).not.toContain('PLACEHOLDER');
    }
  });
});

describe('lib/db-schema storage prefix', () => {
  it('Preview uploads get the prefix once, Production paths stay', () => {
    expect(withStoragePrefix('u1/file.pdf', 'public_preview')).toBe(
      'preview/u1/file.pdf'
    );
    expect(withStoragePrefix('preview/u1/file.pdf', 'public_preview')).toBe(
      'preview/u1/file.pdf'
    );
    expect(withStoragePrefix('u1/file.pdf', 'public')).toBe('u1/file.pdf');
  });
});

describe('lib/db-schema exact role names', () => {
  it('accepts exactly app_preview and app_preview.<project ref>', () => {
    expect(isPreviewDbRole('app_preview')).toBe(true);
    expect(isPreviewDbRole('app_preview.abcdefghijklmnopqrst')).toBe(true);
  });

  it('rejects names that merely start with app_preview, also the migration role', () => {
    for (const user of [
      'app_preview_migrator',
      'app_preview_migrator.abcdefghijklmnopqrst',
      'app_previewx',
      'app_preview.',
      'app_preview.ABC',
      'xapp_preview',
      'app_preview.a.b',
      'postgres',
    ]) {
      expect(isPreviewDbRole(user)).toBe(false);
    }
    expect(isAnyPreviewDbRole('app_preview_migrator.ref')).toBe(true);
    expect(isAnyPreviewDbRole('postgres.ref')).toBe(false);
  });

  it('the Preview schema refuses the migration role and lookalikes', () => {
    const url = user =>
      `postgresql://${user}:PLACEHOLDER@aws-0-eu.pooler.supabase.com:5432/postgres`;
    expect(() =>
      assertRoleMatchesSchema(
        url('app_preview_migrator.abcdefghij'),
        'public_preview'
      )
    ).toThrow(/exactly/);
    expect(() =>
      assertRoleMatchesSchema(url('app_previewx'), 'public_preview')
    ).toThrow(/exactly/);
    expect(() =>
      assertRoleMatchesSchema(url('app_preview'), 'public_preview')
    ).not.toThrow();
  });

  it('Production refuses every Preview role', () => {
    const url = user => `postgresql://${user}:PLACEHOLDER@h:5432/postgres`;
    expect(() =>
      assertRoleMatchesSchema(url('app_preview_migrator'), 'public')
    ).toThrow(/must not be used/);
    expect(() =>
      assertRoleMatchesSchema(url('app_preview.abc'), 'public')
    ).toThrow(/must not be used/);
  });
});

describe('lib/db-schema build guard without VERCEL_ENV', () => {
  it('the Preview schema outside of Vercel needs the Preview role in DB_CONNECTION_STRING', () => {
    expect(() =>
      assertSchemaMatchesEnvironment('public_preview', undefined)
    ).toThrow(/needs DB_CONNECTION_STRING/);
    expect(() =>
      assertSchemaMatchesEnvironment('public_preview', undefined, PROD_URL)
    ).toThrow(/exactly/);
    expect(() =>
      assertSchemaMatchesEnvironment('public_preview', 'development', PROD_URL)
    ).toThrow(/exactly/);
    expect(() =>
      assertSchemaMatchesEnvironment('public_preview', undefined, PREVIEW_URL)
    ).not.toThrow();
  });

  it('the schema public needs nothing without VERCEL_ENV', () => {
    expect(() =>
      assertSchemaMatchesEnvironment('public', undefined)
    ).not.toThrow();
  });

  it('a Vercel preview build keeps working with the pinned schema', () => {
    expect(() =>
      assertSchemaMatchesEnvironment('public_preview', 'preview')
    ).not.toThrow();
  });
});

describe('lib/db-schema assertDbConfig (start of the clients)', () => {
  it('does nothing in the browser', () => {
    expect(() =>
      assertDbConfig('public_preview', undefined, false)
    ).not.toThrow();
  });

  it('fails closed for the Preview schema without a connection string', () => {
    expect(() => assertDbConfig('public_preview', undefined, true)).toThrow(
      /needs DB_CONNECTION_STRING/
    );
  });

  it('public without a connection string is fine, with a Preview role it fails', () => {
    expect(() => assertDbConfig('public', undefined, true)).not.toThrow();
    expect(() => assertDbConfig('public', PROD_URL, true)).not.toThrow();
    expect(() => assertDbConfig('public', PREVIEW_URL, true)).toThrow();
  });

  it('the Preview schema needs exactly the Preview role', () => {
    expect(() =>
      assertDbConfig('public_preview', PREVIEW_URL, true)
    ).not.toThrow();
    expect(() => assertDbConfig('public_preview', PROD_URL, true)).toThrow();
  });
});
