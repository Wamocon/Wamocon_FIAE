/**
 * The occupation choice page (/berufswahl) and when it is shown. Pure
 * functions without server or React imports.
 *
 * After a sign in the page is shown only if the platform has more than one
 * active occupation AND the person did not already choose an occupation they
 * have with the login link (/login?catalog=CODE). A platform with one active
 * occupation (Production today: only FIAE) never shows it, the sign in goes to
 * the dashboard as it always did.
 */

import { isTrainerLevelRole } from '@/lib/auth/roles';

/** Path of the occupation choice page. */
export const OCCUPATION_CHOICE_PATH = '/berufswahl';

/**
 * What the login link said about the occupation, as far as the server checked:
 *  - none      no (usable) occupation in the link
 *  - allowed   the link named an occupation the account has
 *  - denied    the link named an occupation the account does not have
 *  - unknown   the check failed (network error, server error)
 */
export type LoginLinkChoice = 'none' | 'allowed' | 'denied' | 'unknown';

/**
 * Whether the sign in leads to the occupation choice page. `activeCatalogCount`
 * is the number of active occupations of the platform (public list), null if
 * it is not known. Everything uncertain keeps today's behavior: the dashboard.
 */
export function needsOccupationChoice(input: {
  activeCatalogCount: number | null;
  link: LoginLinkChoice;
}): boolean {
  const count = input.activeCatalogCount;
  if (count === null || count <= 1) return false;
  return input.link === 'none' || input.link === 'denied';
}

/**
 * Dashboard of a role: trainer level (trainer and every admin level) works in
 * the trainer area, everyone else in the trainee area. Same rule as
 * getDashboardPath in src/contexts/AuthContext.tsx.
 */
export function dashboardPathForRole(role?: string | null): string {
  return isTrainerLevelRole(role) ? '/trainer/dashboard' : '/trainee/dashboard';
}
