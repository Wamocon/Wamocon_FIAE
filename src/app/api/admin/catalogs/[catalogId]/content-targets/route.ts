import { requireCurriculumEditor, isErrorResponse } from '@/lib/auth/session';
import { isUuid, readJsonObject } from '@/lib/catalog/admin';
import { contentTargetsBodySchema } from '@/lib/catalog/content-targets';
import { saveContentTargets } from '@/lib/catalog/content-stats';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Set the content targets (Soll) of a training catalog. Body:
 * { targets: { components?, enablers?, scenarios?, useCases?, lessonQuizzes?,
 * globalQuizzes?, learningFields? } }, every value a whole number from 0 to
 * 100000 or null. The save replaces the whole set: a missing key or null means
 * "no target". Unknown keys and bad values are answered with 400. Platform
 * admin only (the same right as every other change of the curriculum).
 */
export async function PUT(
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

    const body = await readJsonObject(req);
    const parsed = contentTargetsBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            'targets must be an object with whole numbers from 0 to 100000 (or null) for known keys only',
          code: 'INVALID_TARGETS',
        },
        { status: 400 }
      );
    }

    const targets = await saveContentTargets(catalogId, parsed.data.targets);
    if (targets === null) {
      return NextResponse.json(
        { error: 'Training catalog not found', code: 'CATALOG_NOT_FOUND' },
        { status: 404 }
      );
    }
    return NextResponse.json({ catalogId, targets });
  } catch (e) {
    console.error('Admin update content targets error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
