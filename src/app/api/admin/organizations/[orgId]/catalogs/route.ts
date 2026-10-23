import {
  requireAdmin,
  requireSuperAdmin,
  isErrorResponse,
  scopeOrg,
  isInOrgScope,
} from '@/lib/auth/session';
import {
  isUuid,
  listOrganizationCatalogs,
  readJsonObject,
  ruleFailureBody,
  setOrganizationCatalog,
} from '@/lib/catalog/admin';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { organizations } from '@/db/migrations/schemas/schema';

const orgNotFound = () =>
  NextResponse.json({ error: 'Organization not found' }, { status: 404 });

async function organizationExists(orgId: string): Promise<boolean> {
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return !!org;
}

/**
 * The training catalogs of an organization and whether each one is enabled.
 * The platform admin reads every organization and also sees inactive
 * catalogs. ADMIN and TEMP_ADMIN read their own organization only (another one
 * is 404) and only see active catalogs.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const { orgId } = await params;
    // The caller's identity comes from the bearer token, never from the URL
    const session = await requireAdmin(req);
    if (isErrorResponse(session)) return session;

    // Org admins can only open their own organization
    if (!isUuid(orgId) || !isInOrgScope(scopeOrg(session), orgId)) {
      return orgNotFound();
    }
    if (!(await organizationExists(orgId))) return orgNotFound();

    const catalogs = await listOrganizationCatalogs(orgId, {
      includeInactive: session.isSuperAdmin,
    });
    return NextResponse.json({ organizationId: orgId, catalogs });
  } catch (e) {
    console.error('Admin list organization catalogs error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * Enable or disable one training catalog for an organization. Platform admin
 * only. Answers 409 instead of locking users out: an organization keeps at
 * least one enabled catalog, and a catalog with enrolled trainees of the
 * organization stays enabled.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const { orgId } = await params;
    // The caller's identity comes from the bearer token, never from the URL
    const session = await requireSuperAdmin(req);
    if (isErrorResponse(session)) return session;

    if (!isUuid(orgId)) return orgNotFound();

    const body = await readJsonObject(req);
    if (
      !body ||
      !isUuid(body.catalogId) ||
      typeof body.isEnabled !== 'boolean'
    ) {
      return NextResponse.json(
        { error: 'catalogId (uuid) and isEnabled (boolean) are required' },
        { status: 400 }
      );
    }

    if (!(await organizationExists(orgId))) return orgNotFound();

    const result = await setOrganizationCatalog(
      orgId,
      body.catalogId,
      body.isEnabled
    );
    if (!result.ok) {
      return NextResponse.json(ruleFailureBody(result), {
        status: result.status,
      });
    }

    const catalogs = await listOrganizationCatalogs(orgId, {
      includeInactive: true,
    });
    return NextResponse.json({ organizationId: orgId, catalogs });
  } catch (e) {
    console.error('Admin update organization catalog error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
