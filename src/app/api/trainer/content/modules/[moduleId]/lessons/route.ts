import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { lessons } from '@/db/migrations/schemas/schema';

export async function POST(req: NextRequest, { params }: { params: { moduleId: string } }) {
  try {
    const { moduleId } = params;
    const body = await req.json();
    const title: string | undefined = body?.title;
    const order_index: number | undefined = body?.order_index ? Number(body.order_index) : undefined;
    const duration_weeks: number | undefined = body?.duration_weeks ? Number(body.duration_weeks) : undefined;
    const created_by: string | undefined = body?.created_by;

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
