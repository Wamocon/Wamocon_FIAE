import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { modules, lessons } from '@/db/migrations/schemas/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import { verifyPlatformOwner } from '@/lib/auth-helpers';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const title: string | undefined = body?.title;
    const training_year: number | undefined = typeof body?.training_year === 'number' ? body.training_year : Number(body?.training_year);
    const order_index: number | undefined = body?.order_index ? Number(body.order_index) : undefined;
    const created_by: string | undefined = body?.created_by;
    const inputLessons: Array<{ title: string; order_index?: number; duration_weeks?: number }> | undefined = Array.isArray(body?.lessons)
      ? body.lessons
      : undefined;

    if (!created_by) {
      return NextResponse.json({ error: 'Missing created_by (trainer ID)' }, { status: 400 });
    }
    if (!(await verifyPlatformOwner(created_by))) {
      return NextResponse.json(
        { error: 'Only platform administrators can manage curriculum content' },
        { status: 403 }
      );
    }

    if (!title || !training_year) {
      return NextResponse.json({ error: 'Missing title or training_year' }, { status: 400 });
    }

    const values: any = { title, training_year, order_index: order_index ?? 999 };
    if (created_by) values.created_by = created_by;

    // Create module (and optional lessons) in a transaction
    const out = await db.transaction(async (tx) => {
      const [mod] = await tx.insert(modules).values(values).returning();
      if (inputLessons && inputLessons.length > 0) {
        for (let i = 0; i < inputLessons.length; i++) {
          const it = inputLessons[i];
          if (!it?.title) continue;
          await tx.insert(lessons).values({
            module_id: mod.id,
            title: it.title,
            order_index: typeof it.order_index !== 'undefined' ? Number(it.order_index) : i + 1,
            duration_weeks: typeof it.duration_weeks !== 'undefined' ? Number(it.duration_weeks) : null as any,
            created_by: created_by as any,
          });
        }
      }
      return mod;
    });

    return NextResponse.json({ module: out });
  } catch (e) {
    console.error('Create module error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
