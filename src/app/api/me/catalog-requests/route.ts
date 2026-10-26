import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireTrainer } from '@/lib/auth/session';
import { readJsonObject } from '@/lib/catalog/admin';
import { normalizeCatalogCode } from '@/lib/catalog/client';
import { requestCatalogSubscription } from '@/lib/catalog/subscription-request';
import { checkRateLimit } from '@/lib/rate-limit';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

// Simple limit against misuse: five requests per person in ten minutes. The
// counter lives in the memory of one server instance (see src/lib/rate-limit.ts),
// which is enough here, the rule "one open request per person and occupation"
// is what really holds.
const REQUEST_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 };

const invalid = () =>
  NextResponse.json(
    { error: 'Invalid request', code: 'INVALID_REQUEST' },
    { status: 400, headers: PRIVATE }
  );

// "Abo anfragen": a trainer-level user asks the platform administration for an
// occupation their organization does not have. A trainee gets 403 (the trainer
// asks for the organization), a request for an unknown or inactive occupation
// 404, one for an occupation the organization already has 409 ALREADY_ENABLED.
// The effect is a notification for every platform administrator, nothing else
// (rules: src/lib/catalog/subscription-request.ts).
export async function POST(req: NextRequest) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const rate = checkRateLimit(`catalog-request:${session.id}`, REQUEST_LIMIT);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', code: 'RATE_LIMITED' },
        {
          status: 429,
          headers: { ...PRIVATE, 'Retry-After': String(rate.retryAfterSec) },
        }
      );
    }

    const body = await readJsonObject(req);
    if (!body) return invalid();
    const { catalogCode, message } = body;
    if (typeof catalogCode !== 'string' || catalogCode.trim() === '') {
      return invalid();
    }
    if (
      message !== undefined &&
      message !== null &&
      typeof message !== 'string'
    ) {
      return invalid();
    }

    const code = normalizeCatalogCode(catalogCode);
    // A value that is no occupation code is answered like an unknown one
    if (!code) {
      return NextResponse.json(
        { error: 'Training catalog not found' },
        { status: 404, headers: PRIVATE }
      );
    }

    const result = await requestCatalogSubscription({
      requester: {
        id: session.id,
        fullName: session.fullName,
        email: session.email,
        organizationId: session.organizationId,
        isSuperAdmin: session.isSuperAdmin,
      },
      catalogCode: code,
      message,
    });

    if (result.ok) {
      return NextResponse.json(
        { ok: true, alreadyRequested: result.alreadyRequested },
        { status: result.alreadyRequested ? 200 : 201, headers: PRIVATE }
      );
    }
    if (result.status === 404) {
      return NextResponse.json(
        { error: 'Training catalog not found' },
        { status: 404, headers: PRIVATE }
      );
    }
    if (result.status === 409) {
      return NextResponse.json(
        {
          error: 'The occupation is already enabled for the organization',
          code: result.code,
        },
        { status: 409, headers: PRIVATE }
      );
    }
    return NextResponse.json(
      { error: 'No recipient available', code: result.code },
      { status: 503, headers: PRIVATE }
    );
  } catch (error) {
    console.error('Error in me/catalog-requests API:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500, headers: PRIVATE }
    );
  }
}
