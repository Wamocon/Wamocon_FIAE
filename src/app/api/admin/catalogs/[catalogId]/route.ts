import { requireSuperAdmin, isErrorResponse } from '@/lib/auth/session';
import {
  isUuid,
  readJsonObject,
  ruleFailureBody,
  setCatalogActive,
} from '@/lib/catalog/admin';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Switch a training catalog on or off for the whole platform. Platform admin
 * only. Answers 409 instead of locking users out: FIAE stays active, a catalog
 * with enrolled trainees or one that an organization depends on stays active.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ catalogId: string }> }
) {
  try {
    const { catalogId } = await params;
    // The caller's identity comes from the bearer token, never from the URL
    const session = await requireSuperAdmin(req);
    if (isErrorResponse(session)) return session;

    if (!isUuid(catalogId)) {
      return NextResponse.json(
        { error: 'Training catalog not found', code: 'CATALOG_NOT_FOUND' },
        { status: 404 }
      );
    }

    const body = await readJsonObject(req);
    if (!body || typeof body.isActive !== 'boolean') {
      return NextResponse.json(
        { error: 'isActive (boolean) is required' },
        { status: 400 }
      );
    }

    const result = await setCatalogActive(catalogId, body.isActive);
    if (!result.ok) {
      return NextResponse.json(ruleFailureBody(result), {
        status: result.status,
      });
    }
    return NextResponse.json({ catalog: result.value });
  } catch (e) {
    console.error('Admin update catalog error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
