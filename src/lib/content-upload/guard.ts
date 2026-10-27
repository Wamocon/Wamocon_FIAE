// First line of every route of the content upload after the session.

import { NextResponse } from 'next/server';
import {
  DISABLED_MESSAGE,
  contentUploadAvailability,
} from '@/lib/content-upload/config';

/**
 * First line of every route after the session: the answer for a deployment
 * where the content upload is switched off, or null when it may run. 404, like
 * a route that does not exist there (measure G1 of the concept), with a message
 * that says why. The reason code is not part of the answer.
 */
export function contentUploadDisabledResponse(): NextResponse | null {
  const availability = contentUploadAvailability();
  if (availability.enabled) return null;
  return NextResponse.json({ error: DISABLED_MESSAGE }, { status: 404 });
}
