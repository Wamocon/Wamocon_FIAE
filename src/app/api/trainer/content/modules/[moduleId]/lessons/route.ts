import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { lessons } from '@/db/migrations/schemas/schema';
import { verifyPlatformOwner } from '@/lib/auth-helpers';
import { notFoundUnlessUuid } from '@/lib/uuid';

export async function POST(req: NextRequest, { params }: { params: Promise<{ moduleId: string }> }) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const { moduleId } = await params;
    const moduleIdNotFound = notFoundUnlessUuid(moduleId);
    if (moduleIdNotFound) return moduleIdNotFound;
    const body = await req.json();
    const title: string | undefined = body?.title;
    const order_index: number | undefined = body?.order_index ? Number(body.order_index) : undefined;
    const duration_weeks: number | undefined = body?.duration_weeks ? Number(body.duration_weeks) : undefined;
    const created_by: string = session.id;

    if (!(await verifyPlatformOwner(created_by))) {
      return NextResponse.json(
        { error: 'Only platform administrators can manage curriculum content' },
        { status: 403 }
      );
    }

    if (!title) return NextResponse.json({ error: 'Missing title' }, { status: 400 });

    const values: any = { module_id: moduleId, title, order_index: order_index ?? 999 };
    if (typeof duration_weeks !== 'undefined') values.duration_weeks = duration_weeks;
    if (created_by) values.created_by = created_by;

    const [row] = await db.insert(lessons).values(values).returning();
    return NextResponse.json({ lesson: row });
  } catch (e) {
    console.error('Create lesson error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
