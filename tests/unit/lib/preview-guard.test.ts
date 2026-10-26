/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import {
  blockInPreview,
  blockPreviewAccountInProduction,
  PREVIEW_ADMIN_BLOCKED_MESSAGE,
} from '@/lib/preview-guard';
import { PREVIEW_ACCOUNT_REJECTED_MESSAGE } from '@/lib/preview-account';

describe('lib/preview-guard blockInPreview', () => {
  it('returns null outside of Preview', () => {
    expect(blockInPreview(false)).toBeNull();
  });

  it('answers 403 with a clear message and a code in Preview', async () => {
    const res = blockInPreview(true);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body: any = await res!.json();
    expect(body.error).toBe(PREVIEW_ADMIN_BLOCKED_MESSAGE);
    expect(body.code).toBe('PREVIEW_ADMIN_DISABLED');
  });

  it('is off by default in the test environment (no schema variable set)', () => {
    expect(blockInPreview()).toBeNull();
  });
});

describe('lib/preview-guard blockPreviewAccountInProduction', () => {
  const flagged = { app_metadata: { preview_only: true } };

  it('answers 403 with a German message and a code for a flagged account outside of Preview', async () => {
    const res = blockPreviewAccountInProduction(flagged, false);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body: any = await res!.json();
    expect(body.error).toBe(PREVIEW_ACCOUNT_REJECTED_MESSAGE);
    expect(body.code).toBe('PREVIEW_ACCOUNT_REJECTED');
  });

  it('lets a flagged account into Preview', () => {
    expect(blockPreviewAccountInProduction(flagged, true)).toBeNull();
  });

  it('never blocks a normal account', () => {
    expect(
      blockPreviewAccountInProduction(
        { app_metadata: { provider: 'email' } },
        false
      )
    ).toBeNull();
    expect(blockPreviewAccountInProduction({}, false)).toBeNull();
  });

  it('is the Production behavior by default in the test environment', () => {
    expect(blockPreviewAccountInProduction(flagged)).not.toBeNull();
    expect(blockPreviewAccountInProduction({})).toBeNull();
  });
});
