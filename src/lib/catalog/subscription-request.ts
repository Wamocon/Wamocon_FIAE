/**
 * "Abo anfragen": a trainer-level user asks the platform administration for an
 * occupation (catalog) that their organization does not have.
 *
 * The only effect is a notification (table notifications) for every platform
 * administrator, so there is no mail, no new table and no migration. A
 * platform administrator then enables the occupation for the organization
 * (organization administration, src/lib/catalog/admin.ts).
 *
 * Rules (the route checks the session and the rate limit first):
 *  - The occupation must exist and be active (unknown and inactive give the
 *    same answer, so the existence of an inactive occupation is not leaked).
 *  - It must not be enabled for the organization of the user yet. A platform
 *    administrator needs no request, every active occupation is open to them.
 *  - One open request per person and occupation: while a notification of this
 *    person for this occupation is younger than 14 days, a new request writes
 *    nothing and answers alreadyRequested.
 *  - Recipients: all active platform administrators, that is SUPER_ADMIN and
 *    the ADMIN of the platform organization (the same rule as isSuperAdmin in
 *    src/lib/auth/roles.ts). Each one gets the notification in their own
 *    organization (notifications.organization_id is NOT NULL).
 *
 * The check for an open request and the write run in one transaction behind an
 * advisory lock per person and occupation, so two requests at the same time
 * cannot both pass the check.
 */

import { and, eq, isNull, or, sql } from 'drizzle-orm';
import db from '@/db';
import {
  notifications,
  organizationCatalogs,
  organizations,
  profiles,
  trainingCatalogs,
} from '@/db/migrations/schemas/schema';
import { WAMOCON_ORG_ID } from '@/lib/auth-helpers';
import { ROLE } from '@/lib/auth/roles';
import { isCatalogEnabled } from '@/lib/catalog/admin';
import { withDbRetry } from '@/lib/db-retry';

export const CATALOG_REQUEST_NOTIFICATION_TYPE = 'catalog_request';
/** Where the notification leads: the organization administration. */
export const CATALOG_REQUEST_LINK_URL = '/trainer/admin/organizations';
/** Longest message of the person (in characters, not in UTF-16 units). */
export const CATALOG_REQUEST_MESSAGE_MAX = 500;
/** A new request for the same occupation waits this long. */
export const CATALOG_REQUEST_WINDOW_DAYS = 14;

/** Names in the notification are cut to this length. */
const NAME_MAX = 100;

export type CatalogRequester = {
  id: string;
  fullName: string | null;
  email: string | null;
  organizationId: string;
  isSuperAdmin: boolean;
};

export type CatalogRequestFailure =
  | { ok: false; status: 404; code: 'CATALOG_NOT_FOUND' }
  | { ok: false; status: 409; code: 'ALREADY_ENABLED' }
  | { ok: false; status: 503; code: 'NO_RECIPIENT' };

export type CatalogRequestResult =
  | { ok: true; alreadyRequested: boolean }
  | CatalogRequestFailure;

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * Characters that never belong in a one-line name or a short note: control
 * characters (except the line break and the tab), the soft hyphen, zero width
 * characters, direction overrides and the byte order mark. They could hide
 * text or reverse the reading direction of a notification.
 */
function isUnsafeCharacter(code: number): boolean {
  if (code === 0x0a || code === 0x09) return false;
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0xad ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

/** Characters of a text without the unsafe ones, line breaks normalized. */
function safeCharacters(value: string): string[] {
  return Array.from(value.replace(/\r\n?/g, '\n')).filter(
    char => !isUnsafeCharacter(char.codePointAt(0) ?? 0)
  );
}

/**
 * The message of the person, cleaned: no unsafe characters, runs of blanks and
 * of blank lines shortened, trimmed, cut to CATALOG_REQUEST_MESSAGE_MAX
 * characters. Empty (or not a string) gives ''.
 */
export function sanitizeRequestMessage(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = safeCharacters(value)
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return Array.from(text).slice(0, CATALOG_REQUEST_MESSAGE_MAX).join('');
}

/** A name for one line of the notification: no line breaks, cut to NAME_MAX. */
function sanitizeName(value: string | null | undefined, fallback: string) {
  const text = safeCharacters(value ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, NAME_MAX).join('') || fallback;
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

type CatalogRow = {
  id: string;
  code: string;
  title: string;
  isActive: boolean | null;
};

async function findActiveCatalog(code: string): Promise<CatalogRow | null> {
  const rows = (await withDbRetry(() =>
    db
      .select({
        id: trainingCatalogs.id,
        code: trainingCatalogs.code,
        title: trainingCatalogs.title,
        isActive: trainingCatalogs.isActive,
      })
      .from(trainingCatalogs)
      .where(sql`lower(${trainingCatalogs.code}) = ${code.toLowerCase()}`)
      .limit(1)
  )) as CatalogRow[];
  const row = rows[0];
  return row && row.isActive === true ? row : null;
}

/**
 * Ask for an occupation: validates the rules and writes the notifications.
 * `catalogCode` has the shape of a code already, `message` is the raw text of
 * the person (it is cleaned here).
 */
export async function requestCatalogSubscription(input: {
  requester: CatalogRequester;
  catalogCode: string;
  message?: unknown;
}): Promise<CatalogRequestResult> {
  const { requester } = input;

  const catalog = await findActiveCatalog(input.catalogCode);
  if (!catalog) return { ok: false, status: 404, code: 'CATALOG_NOT_FOUND' };

  if (requester.isSuperAdmin) {
    return { ok: false, status: 409, code: 'ALREADY_ENABLED' };
  }
  const orgRows = (await withDbRetry(() =>
    db
      .select({
        trainingCatalogId: organizationCatalogs.trainingCatalogId,
        isEnabled: organizationCatalogs.isEnabled,
      })
      .from(organizationCatalogs)
      .where(eq(organizationCatalogs.organizationId, requester.organizationId))
  )) as { trainingCatalogId: string; isEnabled: boolean | null }[];
  if (isCatalogEnabled(orgRows, String(catalog.id))) {
    return { ok: false, status: 409, code: 'ALREADY_ENABLED' };
  }

  const note = sanitizeRequestMessage(input.message);

  return db.transaction(async tx => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`catalog_request:${requester.id}:${catalog.code}`}))`
    );

    const open = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.type, CATALOG_REQUEST_NOTIFICATION_TYPE),
          eq(notifications.actorId, requester.id),
          sql`${notifications.createdAt} > now() - ${sql.raw(
            `interval '${CATALOG_REQUEST_WINDOW_DAYS} days'`
          )}`,
          sql`${notifications.context}->>'catalogCode' = ${catalog.code}`
        )
      )
      .limit(1);
    if (open.length > 0) return { ok: true as const, alreadyRequested: true };

    const recipients = await tx
      .select({ id: profiles.id, organizationId: profiles.organizationId })
      .from(profiles)
      .leftJoin(organizations, eq(profiles.organizationId, organizations.id))
      .where(
        and(
          or(isNull(profiles.isActive), eq(profiles.isActive, true)),
          or(
            eq(profiles.role, ROLE.SUPER_ADMIN),
            and(
              eq(profiles.role, ROLE.ADMIN),
              eq(organizations.isPlatformOwner, true)
            )
          )
        )
      );
    if (recipients.length === 0) {
      return {
        ok: false as const,
        status: 503 as const,
        code: 'NO_RECIPIENT' as const,
      };
    }

    const [organization] = await tx
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, requester.organizationId))
      .limit(1);

    const who = sanitizeName(
      requester.fullName,
      sanitizeName(requester.email, 'Unbekannte Person')
    );
    const organizationName = sanitizeName(
      organization?.name,
      'unbekannte Organisation'
    );
    const catalogCode = sanitizeName(catalog.code, input.catalogCode);
    const catalogTitle = sanitizeName(catalog.title, catalogCode);
    const message =
      `${who} (${organizationName}) fragt den Beruf ${catalogTitle} an.` +
      (note ? `\nNachricht: ${note}` : '');

    await tx.insert(notifications).values(
      recipients.map(recipient => ({
        userId: recipient.id,
        actorId: requester.id,
        organizationId: recipient.organizationId
          ? String(recipient.organizationId)
          : WAMOCON_ORG_ID,
        type: CATALOG_REQUEST_NOTIFICATION_TYPE,
        title: `Abo-Anfrage für den Beruf ${catalogCode}`,
        message,
        linkUrl: CATALOG_REQUEST_LINK_URL,
        context: {
          catalogCode: catalog.code,
          requesterId: requester.id,
          organizationId: requester.organizationId,
        },
        isRead: false,
      }))
    );
    return { ok: true as const, alreadyRequested: false };
  });
}
