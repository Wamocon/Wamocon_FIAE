/**
 * Bounds and shape checks for what a trainer sends: free text (grade comments,
 * the reason of a change) and the JSON body itself. A value that fails a check
 * is a 400, never a 500 and never a megabyte in a text column.
 *
 * Why these numbers: the columns are plain text without a limit, so the limit
 * is about abuse and about what a page can show, not about the column.
 *  - MAX_COMMENT_LENGTH 4000 characters is about one printed page, far more than
 *    a trainer writes for one grade. The existing review feedback of a report
 *    allows 5000, the HAI chat 5000.
 *  - MAX_REASON_LENGTH 1000 characters: the reason of a grade change is one or
 *    two sentences, it is shown in the history of changes.
 */

import { NextResponse } from 'next/server';

/** Comments of a trainer on a grade or a rating. */
export const MAX_COMMENT_LENGTH = 4000;

/** The reason given for changing a grade (audit trail). */
export const MAX_REASON_LENGTH = 1000;

/**
 * 400 for a text field that is no text or longer than `max`, null otherwise.
 * An absent value (undefined, null, empty string) is fine: such a field is
 * optional. The answer names the field and the limit, never the value.
 */
export function invalidText(
  field: string,
  value: unknown,
  max: number
): NextResponse | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && value.length <= max) return null;
  return NextResponse.json(
    { error: `${field} must be text of at most ${max} characters` },
    { status: 400 }
  );
}

/**
 * The JSON body as a plain object, or a ready-made 400 for a body that is not
 * JSON or not an object (null, an array, a number).
 */
export async function readJsonObject(request: {
  json(): Promise<unknown>;
}): Promise<Record<string, unknown> | NextResponse> {
  const invalid = () =>
    NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid();
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return invalid();
  }
  return body as Record<string, unknown>;
}
