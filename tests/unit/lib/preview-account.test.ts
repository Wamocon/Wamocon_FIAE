/**
 * @jest-environment node
 */
import { describe, it, expect, jest } from '@jest/globals';
import {
  PREVIEW_ONLY_KEY,
  PREVIEW_ACCOUNT_REJECTED_MESSAGE,
  PREVIEW_CREATE_FAILED_MESSAGE,
  createUserFailureMessage,
  deleteAuthAccountIfPreviewOnly,
  isPreviewOnlyUser,
  isRejectedInProduction,
  previewAccountAppMetadata,
  shouldSendCredentialsEmail,
} from '@/lib/preview-account';

// Accounts created in Preview carry app_metadata.preview_only = true. Only the
// service role can write app_metadata, the user cannot change it.

const flagged = { app_metadata: { [PREVIEW_ONLY_KEY]: true } };

describe('lib/preview-account isPreviewOnlyUser', () => {
  it('is true only for the boolean true in app_metadata', () => {
    expect(isPreviewOnlyUser(flagged)).toBe(true);
  });

  it('is false for normal accounts and for anything that is not true', () => {
    expect(isPreviewOnlyUser(null)).toBe(false);
    expect(isPreviewOnlyUser(undefined)).toBe(false);
    expect(isPreviewOnlyUser({})).toBe(false);
    expect(isPreviewOnlyUser({ app_metadata: null })).toBe(false);
    expect(isPreviewOnlyUser({ app_metadata: 'preview_only' })).toBe(false);
    expect(isPreviewOnlyUser({ app_metadata: {} })).toBe(false);
    expect(isPreviewOnlyUser({ app_metadata: { preview_only: 'true' } })).toBe(
      false
    );
    expect(isPreviewOnlyUser({ app_metadata: { preview_only: 1 } })).toBe(
      false
    );
    expect(isPreviewOnlyUser({ app_metadata: { preview_only: false } })).toBe(
      false
    );
  });

  it('ignores user_metadata, which the user can change', () => {
    expect(
      isPreviewOnlyUser({ user_metadata: { preview_only: true } } as any)
    ).toBe(false);
  });
});

describe('lib/preview-account previewAccountAppMetadata', () => {
  it('adds the flag in Preview', () => {
    expect(previewAccountAppMetadata(true)).toEqual({
      app_metadata: { preview_only: true },
    });
  });

  it('adds nothing outside of Preview (no new field at all)', () => {
    expect(previewAccountAppMetadata(false)).toEqual({});
    expect(Object.keys(previewAccountAppMetadata(false))).toHaveLength(0);
  });

  it('is off by default in the test environment (no schema variable set)', () => {
    expect(previewAccountAppMetadata()).toEqual({});
  });
});

describe('lib/preview-account shouldSendCredentialsEmail', () => {
  it('outside of Preview sends unless it is switched off (as before)', () => {
    expect(shouldSendCredentialsEmail(undefined, false)).toBe(true);
    expect(shouldSendCredentialsEmail(true, false)).toBe(true);
    expect(shouldSendCredentialsEmail('yes', false)).toBe(true);
    expect(shouldSendCredentialsEmail(false, false)).toBe(false);
  });

  it('in Preview sends only when the administrator asks with true', () => {
    expect(shouldSendCredentialsEmail(true, true)).toBe(true);
    expect(shouldSendCredentialsEmail(undefined, true)).toBe(false);
    expect(shouldSendCredentialsEmail(false, true)).toBe(false);
    expect(shouldSendCredentialsEmail('true', true)).toBe(false);
    expect(shouldSendCredentialsEmail(1, true)).toBe(false);
    expect(shouldSendCredentialsEmail(null, true)).toBe(false);
  });

  it('is the Production behavior by default in the test environment', () => {
    expect(shouldSendCredentialsEmail(undefined)).toBe(true);
  });
});

describe('lib/preview-account isRejectedInProduction', () => {
  it('rejects a flagged account outside of Preview', () => {
    expect(isRejectedInProduction(flagged, false)).toBe(true);
  });

  it('lets a flagged account into Preview', () => {
    expect(isRejectedInProduction(flagged, true)).toBe(false);
  });

  it('never rejects a normal account', () => {
    expect(isRejectedInProduction({ app_metadata: {} }, false)).toBe(false);
    expect(isRejectedInProduction({}, false)).toBe(false);
    expect(isRejectedInProduction(null, false)).toBe(false);
  });

  it('works with the default of the test environment (Production)', () => {
    expect(isRejectedInProduction(flagged)).toBe(true);
  });

  it('has a German message that says where the account was created', () => {
    expect(PREVIEW_ACCOUNT_REJECTED_MESSAGE).toMatch(/Preview/);
    expect(PREVIEW_ACCOUNT_REJECTED_MESSAGE).toMatch(/Production/);
    expect(PREVIEW_ACCOUNT_REJECTED_MESSAGE).not.toMatch(/[–—]/);
  });
});

function authAdmin(options: {
  user?: unknown;
  getError?: unknown;
  getThrows?: boolean;
  deleteError?: unknown;
  deleteThrows?: boolean;
}) {
  const getUserById = jest.fn(async (_id: string) => {
    if (options.getThrows) throw new Error('network down');
    return {
      data: { user: options.user === undefined ? null : options.user },
      error: options.getError ?? null,
    };
  });
  const deleteUser = jest.fn(async (_id: string) => {
    if (options.deleteThrows) throw new Error('network down');
    return { error: options.deleteError ?? null };
  });
  return {
    auth: { admin: { getUserById, deleteUser } },
    getUserById,
    deleteUser,
  };
}

describe('lib/preview-account deleteAuthAccountIfPreviewOnly', () => {
  it('deletes the account that carries the flag', async () => {
    const admin = authAdmin({ user: flagged });
    const result = await deleteAuthAccountIfPreviewOnly(admin as any, 'u1');
    expect(result).toEqual({ deleted: true });
    expect(admin.getUserById).toHaveBeenCalledWith('u1');
    expect(admin.deleteUser).toHaveBeenCalledWith('u1');
  });

  it('keeps an account without the flag (a real, shared account)', async () => {
    const admin = authAdmin({ user: { app_metadata: { provider: 'email' } } });
    const result = await deleteAuthAccountIfPreviewOnly(admin as any, 'u1');
    expect(result).toEqual({ deleted: false, reason: 'SHARED_ACCOUNT' });
    expect(admin.deleteUser).not.toHaveBeenCalled();
  });

  it('keeps the account when the lookup fails (fail closed)', async () => {
    const admin = authAdmin({ getError: { message: 'boom' } });
    const result = await deleteAuthAccountIfPreviewOnly(admin as any, 'u1');
    expect(result).toEqual({ deleted: false, reason: 'CHECK_FAILED' });
    expect(admin.deleteUser).not.toHaveBeenCalled();
  });

  it('keeps the account when the lookup throws (fail closed)', async () => {
    const admin = authAdmin({ getThrows: true });
    const result = await deleteAuthAccountIfPreviewOnly(admin as any, 'u1');
    expect(result).toEqual({ deleted: false, reason: 'CHECK_FAILED' });
    expect(admin.deleteUser).not.toHaveBeenCalled();
  });

  it('keeps the account when the lookup returns no user, even with a flag in the error', async () => {
    const admin = authAdmin({ user: null });
    const result = await deleteAuthAccountIfPreviewOnly(admin as any, 'u1');
    expect(result).toEqual({ deleted: false, reason: 'CHECK_FAILED' });
    expect(admin.deleteUser).not.toHaveBeenCalled();
  });

  it('keeps the account when an error comes together with a flagged user', async () => {
    const admin = authAdmin({
      user: flagged,
      getError: { message: 'partial' },
    });
    const result = await deleteAuthAccountIfPreviewOnly(admin as any, 'u1');
    expect(result.deleted).toBe(false);
    expect(admin.deleteUser).not.toHaveBeenCalled();
  });

  it('reports a failed delete of a flagged account', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const failing = authAdmin({
      user: flagged,
      deleteError: { message: 'no' },
    });
    expect(await deleteAuthAccountIfPreviewOnly(failing as any, 'u1')).toEqual({
      deleted: false,
      reason: 'DELETE_FAILED',
    });
    const throwing = authAdmin({ user: flagged, deleteThrows: true });
    expect(await deleteAuthAccountIfPreviewOnly(throwing as any, 'u1')).toEqual(
      { deleted: false, reason: 'DELETE_FAILED' }
    );
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('lib/preview-account createUserFailureMessage', () => {
  const refused = {
    message: 'A user with this email address has already been registered',
  };

  it('Preview answers one generic text and does not tell about existing addresses', () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const text = createUserFailureMessage(refused, true);
    expect(text).toBe(PREVIEW_CREATE_FAILED_MESSAGE);
    expect(text).not.toMatch(/registered/);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('Production keeps the text of the auth server (as before)', () => {
    expect(createUserFailureMessage(refused, false)).toBe(refused.message);
    expect(createUserFailureMessage({}, false)).toBe(
      'Failed to create auth user'
    );
    expect(createUserFailureMessage(null, false)).toBe(
      'Failed to create auth user'
    );
  });

  it('is the Production behavior by default in the test environment', () => {
    expect(createUserFailureMessage(refused)).toBe(refused.message);
  });
});
