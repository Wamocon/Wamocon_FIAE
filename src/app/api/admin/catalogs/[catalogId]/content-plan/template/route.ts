import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { isUuid } from '@/lib/catalog/admin';
import {
  buildTemplateJson,
  buildTemplateXlsx,
} from '@/lib/catalog/content-plan/template';
import { NextRequest, NextResponse } from 'next/server';

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * The template of the plan document as a download: ?format=xlsx (default) or
 * ?format=json. Example rows (invented) and an explanation of every column
 * included. Platform admin only, like the rest of the plan.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ catalogId: string }> }
) {
  try {
    const { catalogId } = await params;
    const session = await requireCurriculumEditor(req);
    if (isErrorResponse(session)) return session;
    if (!isUuid(catalogId)) {
      return NextResponse.json(
        { error: 'Training catalog not found', code: 'CATALOG_NOT_FOUND' },
        { status: 404 }
      );
    }

    const format = req.nextUrl.searchParams.get('format') ?? 'xlsx';
    if (format !== 'xlsx' && format !== 'json') {
      return NextResponse.json(
        { error: 'format must be xlsx or json', code: 'INVALID_FORMAT' },
        { status: 400 }
      );
    }
    const headers = {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="plan-vorlage.${format}"`,
    };
    if (format === 'json') {
      return new NextResponse(buildTemplateJson(), {
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
    const buffer = await buildTemplateXlsx();
    return new NextResponse(new Uint8Array(buffer), {
      headers: { ...headers, 'Content-Type': XLSX_TYPE },
    });
  } catch (e) {
    console.error('Admin content plan template error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
