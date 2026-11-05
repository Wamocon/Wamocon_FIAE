/**
 * @jest-environment node
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

const saved = { ...process.env };

async function load(env: Record<string, string | undefined>) {
  jest.resetModules();
  process.env = { ...saved } as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined)
      delete (process.env as Record<string, unknown>)[key];
    else (process.env as Record<string, unknown>)[key] = value;
  }
  return import('@/lib/submission-file/availability');
}

afterEach(() => {
  process.env = saved as NodeJS.ProcessEnv;
});

describe('submission file availability', () => {
  it('is on in a Vercel preview deployment on the Preview schema', async () => {
    const mod = await load({
      VERCEL_ENV: 'preview',
      NEXT_PUBLIC_DB_SCHEMA: 'public_preview',
      SUPABASE_DB_SCHEMA: undefined,
    });
    expect(mod.isSubmissionFileEnabled()).toBe(true);
    expect(mod.submissionFileDisabledResponse()).toBeNull();
  });

  it('is off in Production and answers 404', async () => {
    const mod = await load({
      VERCEL_ENV: 'production',
      NEXT_PUBLIC_DB_SCHEMA: undefined,
      SUPABASE_DB_SCHEMA: undefined,
    });
    expect(mod.isSubmissionFileEnabled()).toBe(false);
    const response = mod.submissionFileDisabledResponse();
    expect(response?.status).toBe(404);
    expect(await response?.json()).toEqual({
      error: 'The file of a submission is not available in this environment.',
    });
  });

  it('is off in a preview build on the wrong schema', async () => {
    const mod = await load({
      VERCEL_ENV: 'preview',
      NEXT_PUBLIC_DB_SCHEMA: undefined,
      SUPABASE_DB_SCHEMA: undefined,
    });
    expect(mod.submissionFileAvailability()).toMatchObject({ enabled: false });
  });
});
