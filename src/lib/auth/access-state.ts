/**
 * Access state of a signed in person for an area of the app (the trainee area
 * or the trainer area). One pure function decides what the layout shows, so no
 * case ends in a silent jump back to /login: a person who is not signed in goes
 * to the login (with a reason), every other case that stops a signed in person
 * is a page of its own with a clear message.
 *
 * The decision is for the presentation only. The server checks the same rules
 * for every request (src/lib/auth/session.ts).
 */

import { isTrainerLevelRole } from '@/lib/auth/roles';

export type AccessArea = 'trainee' | 'trainer';

/** Why a signed in person is stopped. Every value has its own message. */
export type AccessBlockReason =
  /** The account is created and waits for the release by a trainer or admin. */
  | 'awaitingActivation'
  /** The account is deactivated. */
  | 'deactivated'
  /** The organization of the account is deactivated. */
  | 'organizationDeactivated'
  /** The role does not fit the area (a trainee in the trainer area and back). */
  | 'wrongArea'
  /** The profile could not be loaded. */
  | 'profileUnavailable'
  /** The trainee has no occupation that can be worked in. */
  | 'noCatalog';

export type AccessState =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'blocked'; reason: AccessBlockReason }
  | { kind: 'allowed' };

/** The members of the profile the decision reads. */
export type AccessProfile = {
  role?: string | null;
  isActive?: boolean;
  trainerActivated?: boolean;
  organization?: { isActive?: boolean } | null;
} | null;

export type AccessInput = {
  area: AccessArea;
  /** The sign in state is still being determined. */
  loading: boolean;
  signedIn: boolean;
  profile: AccessProfile;
  /**
   * The profile is still expected (the layout waits a short time for it). Once
   * it is false, a missing profile is a case of its own.
   */
  waitingForProfile?: boolean;
  /** The server said the trainee has no occupation to work in. */
  noCatalog?: boolean;
};

/**
 * A trainee whose account waits for the release (trainer_activated is false).
 * Only a trainee waits for a release, like on the server (session.ts): trainer
 * level accounts created by scripts or by the database default carry the flag
 * false without ever having needed a release, and must not be locked out.
 */
export function isAwaitingActivation(profile: AccessProfile): boolean {
  return (
    !!profile &&
    profile.trainerActivated === false &&
    !isTrainerLevelRole(profile.role)
  );
}

/**
 * An account that is stopped whatever the area: not released, deactivated, or
 * its organization deactivated. The person sees the notice, so the extras of
 * the app (the tour, the HAI chat) stay away.
 */
export function isAccountStopped(profile: AccessProfile): boolean {
  return (
    !!profile &&
    (isAwaitingActivation(profile) ||
      profile.isActive === false ||
      profile.organization?.isActive === false)
  );
}

export function resolveAccessState(input: AccessInput): AccessState {
  const { area, loading, signedIn, profile } = input;
  if (loading) return { kind: 'loading' };
  if (!signedIn) return { kind: 'signedOut' };
  if (!profile) {
    return input.waitingForProfile
      ? { kind: 'loading' }
      : { kind: 'blocked', reason: 'profileUnavailable' };
  }
  if (profile.isActive === false) {
    return { kind: 'blocked', reason: 'deactivated' };
  }
  if (profile.organization?.isActive === false) {
    return { kind: 'blocked', reason: 'organizationDeactivated' };
  }
  // Before the role: a person who waits for the release is told so, wherever
  // they are, and learns nothing about the other area
  if (isAwaitingActivation(profile)) {
    return { kind: 'blocked', reason: 'awaitingActivation' };
  }
  const trainerLevel = isTrainerLevelRole(profile.role);
  const roleFitsArea = area === 'trainer' ? trainerLevel : !trainerLevel;
  if (!roleFitsArea) return { kind: 'blocked', reason: 'wrongArea' };
  if (area === 'trainee' && input.noCatalog) {
    return { kind: 'blocked', reason: 'noCatalog' };
  }
  return { kind: 'allowed' };
}

/** Where the login page was sent from, the reasons it explains. */
export const LOGIN_REASONS = [
  'signin-required',
  'deactivated',
  'organization-deactivated',
] as const;
export type LoginReason = (typeof LOGIN_REASONS)[number];

/** The value of ?reason= if it is one of the known reasons, otherwise null. */
export function normalizeLoginReason(value: unknown): LoginReason | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' &&
    (LOGIN_REASONS as readonly string[]).includes(raw)
    ? (raw as LoginReason)
    : null;
}

export function loginPathWithReason(reason: LoginReason): string {
  return `/login?reason=${reason}`;
}

/** How the session ended: by the person ('manual') or for a reason. */
export type SessionEnd = LoginReason | 'manual';

/**
 * Where a layout sends somebody who is not signed in. After a sign out that
 * navigated by itself it is the same place (the reason of the sign out, or the
 * start page after the person signed out), otherwise the login with the hint
 * that a sign in is needed. Two redirects to different places would let the
 * later one hide the reason.
 */
export function signedOutTarget(end: SessionEnd | null | undefined): string {
  if (end === 'manual') return '/';
  return loginPathWithReason(end ?? 'signin-required');
}

/** Codes of a sign in that is stopped after the credentials were right. */
export type SignInBlockCode =
  | 'deactivated'
  | 'organizationDeactivated'
  | 'profileUnavailable';

/**
 * The error of a sign in that is stopped. The message stays the German text of
 * the account (shown if nothing translates the code), the code lets the login
 * form show the text in the language of the visitor.
 */
export class SignInBlockedError extends Error {
  constructor(
    public readonly code: SignInBlockCode,
    message: string
  ) {
    super(message);
    this.name = 'SignInBlockedError';
  }
}

export function isSignInBlockedError(e: unknown): e is SignInBlockedError {
  return e instanceof SignInBlockedError;
}
