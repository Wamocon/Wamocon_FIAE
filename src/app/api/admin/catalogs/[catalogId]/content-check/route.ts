import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import db from '@/db';
import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { isUuid, readJsonObject } from '@/lib/catalog/admin';
import { buildContentCheckReport } from '@/lib/catalog/content-check/report';
import { checkRateLimit } from '@/lib/rate-limit';

// The script checks take a few seconds, the AI review up to 40 seconds more
export const maxDuration = 60;

const bodySchema = z.object({ ki: z.boolean().optional() }).strict();

/** Catalogs with an AI review under way on this server instance. */
const kiRunning = new Set<string>();

/**
 * Content check (Inhaltsprüfung) of one training catalog. Body: { ki?: boolean }.
 *
 * Without `ki` only the script checks run (deterministic, no AI). With `ki: true`
 * the AI review of the own AI Sokrates runs as well, within the budget and the
 * limits of the content upload (src/lib/catalog/content-check/ki-review.ts), and
 * only where the content upload may run. The answer is the report; nothing is
 * stored (no table, no log of the findings).
 *
 * Platform admin only (the same right as the targets): the check contains
 * targets and planning, so an admin of an organization does not get it. At most
 * one AI review per catalog at the same time (409), and a rate limit per person.
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

    // The body is optional: no body means the script checks only
    const raw = await readJsonObject(req);
    const parsed = bodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'The body must be { ki?: boolean }', code: 'INVALID_BODY' },
        { status: 400 }
      );
    }
    const ki = parsed.data.ki === true;

    const rate = ki
      ? checkRateLimit(`content-check-ki:${session.id}`, {
          limit: 5,
          windowMs: 10 * 60_000,
        })
      : checkRateLimit(`content-check:${session.id}`, {
          limit: 20,
          windowMs: 60_000,
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

    if (ki) {
      if (kiRunning.has(catalogId)) {
        return NextResponse.json(
          {
            error: 'An AI review of this catalog is already running',
            code: 'KI_RUNNING',
          },
          { status: 409 }
        );
      }
      kiRunning.add(catalogId);
    }
    try {
      const report = await buildContentCheckReport(db, catalogId, { ki });
      if (!report) {
        return NextResponse.json(
          { error: 'Training catalog not found', code: 'CATALOG_NOT_FOUND' },
          { status: 404 }
        );
      }
      return NextResponse.json(report, {
        headers: { 'Cache-Control': 'no-store' },
      });
    } finally {
      if (ki) kiRunning.delete(catalogId);
    }
  } catch (e) {
    console.error('Admin content check error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
