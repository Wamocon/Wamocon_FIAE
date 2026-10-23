import { describe, it, expect } from '@jest/globals';
import {
  assertRoleMatchesSchema,
  assertSchemaMatchesEnvironment,
  resolveDbSchema,
  signupMetadata,
  withStoragePrefix,
} from '@/lib/db-schema';

const PREVIEW_URL =
  'postgresql://app_preview.abcdefghijklmnopqrst:secret@aws-0-eu.pooler.supabase.com:5432/postgres';
const PROD_URL =
  'postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-eu.pooler.supabase.com:5432/postgres';

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
  it('does not check outside of Vercel', () => {
    expect(() =>
      assertSchemaMatchesEnvironment('public_preview', undefined)
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
      expect((e as Error).message).not.toContain('secret');
    }
  });
});

describe('lib/db-schema storage prefix and signup metadata', () => {
  it('Preview uploads get the prefix once, Production paths stay', () => {
    expect(withStoragePrefix('u1/file.pdf', 'public_preview')).toBe(
      'preview/u1/file.pdf'
    );
    expect(withStoragePrefix('preview/u1/file.pdf', 'public_preview')).toBe(
      'preview/u1/file.pdf'
    );
    expect(withStoragePrefix('u1/file.pdf', 'public')).toBe('u1/file.pdf');
  });

  it('only Preview marks sign-ups with env=preview', () => {
    expect(signupMetadata('public_preview')).toEqual({ env: 'preview' });
    expect(signupMetadata('public')).toEqual({});
  });
});
