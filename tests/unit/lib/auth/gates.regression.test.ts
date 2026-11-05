/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  makeRequest,
  mockSupabaseAuth,
  sessionProfileRow,
} from '../../../helpers/mockNext';
import {
  isAccountStopped,
  isAwaitingActivation,
  resolveAccessState,
} from '@/lib/auth/access-state';

// R5 of the FIAE regression (docs/kfbm-rollout-regression.md): roles and gates.
// The gate AWAITING_ACTIVATION stops a TRAINEE whose trainer_activated is exactly
// false, nobody else. Every other role, and every row without the flag, keeps its
// session as before the rebuild. The server (session.ts) and the screens
// (access-state.ts) follow the same rule.

const ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'TEMP_ADMIN',
  'TRAINER',
  'TRAINEE',
] as const;
const FLAGS = [false, true, null] as const;

async function load(profile: Record<string, unknown>) {
  jest.resetModules();
  mockSupabaseAuth({ good: { id: 'session-user', email: 'a@example.test' } });
  const { db } = createTableDb({ profiles: [sessionProfileRow(profile)] });
  jest.doMock('@/db', () => ({ __esModule: true, default: db }));
  return import('@/lib/auth/session');
}

const authed = () =>
  makeRequest('GET', 'http://localhost/api/x', { token: 'good' });

describe('R5: server gate of the session layer', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  });

  const cases = ROLES.flatMap(role => FLAGS.map(flag => [role, flag] as const));

  it.each(cases)('role %s with trainer_activated %p', async (role, flag) => {
    const { requireUser, isErrorResponse } = await load({
      role,
      trainerActivated: flag,
    });
    const result = await requireUser(authed());
    const blocked = role === 'TRAINEE' && flag === false;
    expect(isErrorResponse(result)).toBe(blocked);
    if (blocked) {
      expect((result as Response).status).toBe(403);
      expect(await (result as Response).json()).toEqual({
        error: 'Forbidden',
        code: 'AWAITING_ACTIVATION',
      });
    }
  });

  it('a deactivated account is a plain 403 without the activation code', async () => {
    const { requireUser } = await load({
      role: 'TRAINEE',
      trainerActivated: true,
      isActive: false,
    });
    const res = (await requireUser(authed())) as Response;
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
  });

  it('the release lets the same account in without a new sign in', async () => {
    const waiting = await load({ role: 'TRAINEE', trainerActivated: false });
    expect(waiting.isErrorResponse(await waiting.requireUser(authed()))).toBe(
      true
    );
    const released = await load({ role: 'TRAINEE', trainerActivated: true });
    expect(released.isErrorResponse(await released.requireUser(authed()))).toBe(
      false
    );
  });

  it('every guard helper keeps the gate closed for a waiting trainee, none opens the trainer or admin area', async () => {
    const {
      requireUser,
      requireTrainer,
      requireAdmin,
      requireSuperAdmin,
      isErrorResponse,
    } = await load({ role: 'TRAINEE', trainerActivated: false });
    for (const guard of [
      requireUser,
      requireTrainer,
      requireAdmin,
      requireSuperAdmin,
    ]) {
      expect(isErrorResponse(await guard(authed()))).toBe(true);
    }
    const released = await load({ role: 'TRAINEE', trainerActivated: true });
    for (const guard of [
      released.requireTrainer,
      released.requireAdmin,
      released.requireSuperAdmin,
    ]) {
      const res = (await guard(authed())) as Response;
      expect(res.status).toBe(403);
      expect(await res.json()).not.toHaveProperty('code');
    }
  });

  it('role levels: every trainer-level role passes the trainer guard, a trainee does not', async () => {
    const results: Record<string, boolean> = {};
    for (const role of ROLES) {
      const m = await load({ role, trainerActivated: true });
      results[role] = !m.isErrorResponse(await m.requireTrainer(authed()));
    }
    expect(results).toEqual({
      SUPER_ADMIN: true,
      ADMIN: true,
      TEMP_ADMIN: true,
      TRAINER: true,
      TRAINEE: false,
    });
  });
});

describe('R5: the screens follow the same rule', () => {
  const profileOf = (role: string, trainerActivated: boolean | null) => ({
    role,
    isActive: true,
    trainerActivated: trainerActivated as boolean,
  });

  it.each(ROLES.flatMap(role => FLAGS.map(flag => [role, flag] as const)))(
    'role %s with trainer_activated %p',
    (role, flag) => {
      const waiting = role === 'TRAINEE' && flag === false;
      expect(isAwaitingActivation(profileOf(role, flag))).toBe(waiting);
      expect(isAccountStopped(profileOf(role, flag))).toBe(waiting);
      const area = role === 'TRAINEE' ? 'trainee' : 'trainer';
      const state = resolveAccessState({
        area,
        loading: false,
        signedIn: true,
        profile: profileOf(role, flag),
      });
      expect(state).toEqual(
        waiting
          ? { kind: 'blocked', reason: 'awaitingActivation' }
          : { kind: 'allowed' }
      );
    }
  );

  it('a waiting trainee is told so in the trainer area as well, and learns nothing else', () => {
    expect(
      resolveAccessState({
        area: 'trainer',
        loading: false,
        signedIn: true,
        profile: profileOf('TRAINEE', false),
      })
    ).toEqual({ kind: 'blocked', reason: 'awaitingActivation' });
  });

  it('a released trainee in the trainer area is a wrong area, a trainer in the trainee area too', () => {
    expect(
      resolveAccessState({
        area: 'trainer',
        loading: false,
        signedIn: true,
        profile: profileOf('TRAINEE', true),
      })
    ).toEqual({ kind: 'blocked', reason: 'wrongArea' });
    expect(
      resolveAccessState({
        area: 'trainee',
        loading: false,
        signedIn: true,
        profile: profileOf('TRAINER', true),
      })
    ).toEqual({ kind: 'blocked', reason: 'wrongArea' });
  });

  it('a FIAE trainee without a catalog problem is allowed, a signed out visitor goes to the login', () => {
    expect(
      resolveAccessState({
        area: 'trainee',
        loading: false,
        signedIn: true,
        profile: profileOf('TRAINEE', true),
        noCatalog: false,
      })
    ).toEqual({ kind: 'allowed' });
    expect(
      resolveAccessState({
        area: 'trainee',
        loading: false,
        signedIn: false,
        profile: null,
      })
    ).toEqual({ kind: 'signedOut' });
  });
});
