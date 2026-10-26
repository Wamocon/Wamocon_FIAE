/**
 * The one place that decides whether a value has the shape of a uuid.
 *
 * A route that hands an id to a uuid column without this check answers a typo
 * or a probe with 500, because the database rejects the value. Use it before
 * the first query:
 *
 *  - an id in the PATH is a record that cannot exist: 404, the same answer as
 *    for a record that is missing (notFoundUnlessUuid)
 *  - an id in the BODY is a malformed request: 400 (badRequestUnlessUuid)
 *
 * The module has no dependency on the database, so every route and every test
 * can import it without mocks.
 */

import { NextResponse } from 'next/server';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value has the shape of a uuid (the database rejects others). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * 404 for a path id that is no uuid, null otherwise. Pass the message of the
 * route's own 404 so a malformed id answers exactly like a missing record.
 */
export function notFoundUnlessUuid(
  id: unknown,
  message = 'Not found'
): NextResponse | null {
  return isUuid(id)
    ? null
    : NextResponse.json({ error: message }, { status: 404 });
}

/**
 * 400 for a body (or query) id that is no uuid, null otherwise. The answer
 * names the field, not the value.
 */
export function badRequestUnlessUuid(
  field: string,
  value: unknown
): NextResponse | null {
  return isUuid(value)
    ? null
    : NextResponse.json({ error: `Invalid ${field}` }, { status: 400 });
}
