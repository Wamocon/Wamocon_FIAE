import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { isUuid } from '@/lib/catalog/admin';
import { checkDocumentFiles } from '@/lib/catalog/content-check/file-check';
import { checkRateLimit } from '@/lib/rate-limit';

// A sample of at most 50 existence questions, each a few hundred milliseconds
export const maxDuration = 60;

/** Catalogs with a file check under way on this server instance. */
const running = new Set<string>();

/**
 * Check of the storage for the documents of one training catalog, on request
 * (button "Dateien prüfen"). No body. A random sample of at most 50 documents is
 * checked for the existence of its file in the storage (the files are not loaded,
 * src/lib/catalog/content-check/file-check.ts). The answer is the result with the
 * duration; nothing is stored.
 *
 * Platform admin only, like the content check itself. At most one file check per
 * catalog at the same time (409), and a rate limit per person.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ catalogId: string }> }
) {
  try {
    const { catalogId } = await params;
    // The caller's identity comes from the bearer token, never from the URL
    const session = await requireCurriculumEditor(req);
    if (isErrorResponse(session)) return session;

    if (!isUuid(catalogId)) {
      return NextResponse.json(
        { error: 'Training catalog not found', code: 'CATALOG_NOT_FOUND' },
        { status: 404 }
      );
    }

    const rate = checkRateLimit(`content-check-files:${session.id}`, {
      limit: 10,
      windowMs: 10 * 60_000,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', code: 'RATE_LIMITED' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.max(1, rate.retryAfterSec)) },
        }
      );
    }

    if (running.has(catalogId)) {
      return NextResponse.json(
        {
          error: 'A file check of this catalog is already running',
          code: 'FILES_RUNNING',
        },
        { status: 409 }
      );
    }
    running.add(catalogId);
    try {
      const result = await checkDocumentFiles(db, catalogId);
      if (!result) {
        return NextResponse.json(
          { error: 'Training catalog not found', code: 'CATALOG_NOT_FOUND' },
          { status: 404 }
        );
      }
      return NextResponse.json(result, {
        headers: { 'Cache-Control': 'no-store' },
      });
    } finally {
      running.delete(catalogId);
    }
  } catch (e) {
    console.error('Admin content check files error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
