import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { isUuid, readJsonObject } from '@/lib/catalog/admin';
import {
  deleteContentPlan,
  getContentPlan,
  saveContentPlan,
} from '@/lib/catalog/content-plan/store';
import { savePlanBodySchema } from '@/lib/catalog/content-plan/types';
import { NextRequest, NextResponse } from 'next/server';

const PRIVATE = { 'Cache-Control': 'no-store' };

const notFound = () =>
  NextResponse.json(
    { error: 'Training catalog not found', code: 'CATALOG_NOT_FOUND' },
    { status: 404, headers: PRIVATE }
  );

const failure = (e: unknown, what: string) => {
  console.error(`Admin ${what} content plan error`, e);
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
};

type Ctx = { params: Promise<{ catalogId: string }> };

/**
 * The stored plan document of an occupation with its source: { catalogId,
 * stored: { plan, source } | null }. Platform admin only, like the targets (an
 * organization admin sees neither plan nor targets).
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const { catalogId } = await params;
    const session = await requireCurriculumEditor(req);
    if (isErrorResponse(session)) return session;
    if (!isUuid(catalogId)) return notFound();

    const stored = await getContentPlan(catalogId);
    if (stored === undefined) return notFound();
    return NextResponse.json({ catalogId, stored }, { headers: PRIVATE });
  } catch (e) {
    return failure(e, 'read');
  }
}

/**
 * Save the CONFIRMED plan. Body: { plan, fileName, method: "script" | "ki" }.
 * The plan is checked against the strict plan model (bounded numbers, no
 * unknown keys, never null), the time and the number of fields are set by the
 * server, the file itself is never stored. The manual targets stay untouched
 * and win over the plan. An empty plan is refused (400), a plan above 200 KB
 * as JSON is refused (413).
 */
export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const { catalogId } = await params;
    const session = await requireCurriculumEditor(req);
    if (isErrorResponse(session)) return session;
    if (!isUuid(catalogId)) return notFound();

    const parsed = savePlanBodySchema.safeParse(await readJsonObject(req));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            'plan must follow the plan model, fileName and method (script or ki) are required',
          code: 'INVALID_PLAN',
        },
        { status: 400 }
      );
    }
    const result = await saveContentPlan(catalogId, parsed.data);
    if (!result.ok) {
      if (result.code === 'CATALOG_NOT_FOUND') return notFound();
      return NextResponse.json(
        { error: 'The plan was not saved', code: result.code },
        { status: result.code === 'TOO_LARGE' ? 413 : 400 }
      );
    }
    return NextResponse.json(
      { catalogId, stored: result.stored },
      { headers: PRIVATE }
    );
  } catch (e) {
    return failure(e, 'save');
  }
}

/** Remove the plan (idempotent). The manual targets stay as they are. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const { catalogId } = await params;
    const session = await requireCurriculumEditor(req);
    if (isErrorResponse(session)) return session;
    if (!isUuid(catalogId)) return notFound();

    if (!(await deleteContentPlan(catalogId))) return notFound();
    return NextResponse.json({ catalogId, stored: null }, { headers: PRIVATE });
  } catch (e) {
    return failure(e, 'delete');
  }
}
