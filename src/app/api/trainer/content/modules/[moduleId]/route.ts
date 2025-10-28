import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { lessons, modules, subLessons } from '@/db/migrations/schemas/schema';
import { eq, inArray } from 'drizzle-orm';

export async function GET(_req: NextRequest, { params }: { params: { moduleId: string } }) {
  try {
    const { moduleId } = params;
    const [mod] = await db
      .select({ id: modules.id, title: modules.title, training_year: modules.training_year, order_index: modules.order_index })
      .from(modules)
      .where(eq(modules.id, moduleId));
    if (!mod) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ls = await db
      .select({ id: lessons.id, title: lessons.title, order_index: lessons.order_index, duration_weeks: lessons.duration_weeks })
      .from(lessons)
      .where(eq(lessons.module_id, moduleId))
      .orderBy(lessons.order_index);
    return NextResponse.json({ module: mod, lessons: ls });
  } catch (e) {
    console.error('Get module error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { moduleId: string } }) {
  try {
    const { moduleId } = params;
    const body = await req.json();
    const updates: any = {};
    if (typeof body?.title === 'string') updates.title = body.title;
    if (typeof body?.training_year !== 'undefined') updates.training_year = Number(body.training_year);
    if (typeof body?.order_index !== 'undefined') updates.order_index = Number(body.order_index);
    const inputLessons: Array<{ id?: string; title: string; order_index?: number; duration_weeks?: number }> | undefined = Array.isArray(body?.lessons)
      ? body.lessons
      : undefined;

    const result = await db.transaction(async (tx) => {
      let modRow = null as any;
      if (Object.keys(updates).length > 0) {
        const [row] = await tx.update(modules).set(updates).where(eq(modules.id, moduleId)).returning();
        modRow = row;
      } else {
        const [row] = await tx
          .select({ id: modules.id, title: modules.title, training_year: modules.training_year, order_index: modules.order_index })
          .from(modules)
          .where(eq(modules.id, moduleId));
        modRow = row;
      }

      if (inputLessons) {
        // Load existing lessons for this module
        const existing = await tx
          .select({ id: lessons.id })
          .from(lessons)
          .where(eq(lessons.module_id, moduleId));
        const existingIds = new Set(existing.map((l) => String(l.id)));
        const providedIds = new Set(
          inputLessons.filter((l) => !!l.id).map((l) => String(l.id))
        );

        // Delete lessons that are not provided anymore
        const toDelete = Array.from(existingIds).filter((id) => !providedIds.has(id));
        if (toDelete.length > 0) {
          await tx.delete(subLessons).where(inArray(subLessons.lesson_id, toDelete as any));
          await tx.delete(lessons).where(inArray(lessons.id, toDelete as any));
        }

        // Upsert provided lessons
        for (let i = 0; i < inputLessons.length; i++) {
          const l = inputLessons[i];
          const payload: any = {
            title: l.title,
            order_index: typeof l.order_index !== 'undefined' ? Number(l.order_index) : i + 1,
          };
          if (typeof l.duration_weeks !== 'undefined') payload.duration_weeks = Number(l.duration_weeks);
          if (l.id && existingIds.has(String(l.id))) {
            await tx.update(lessons).set(payload).where(eq(lessons.id, l.id));
          } else {
            await tx.insert(lessons).values({ module_id: moduleId, ...payload });
          }
        }
      }

      return modRow;
    });

    return NextResponse.json({ module: result });
  } catch (e) {
    console.error('Update module error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { moduleId: string } }) {
  try {
    const { moduleId } = params;
    // Delete subLessons -> lessons -> module
    const lessonRows = await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.module_id, moduleId));
    const lessonIds = lessonRows.map(r => r.id);
    if (lessonIds.length > 0) {
      await db.delete(subLessons).where(inArray(subLessons.lesson_id, lessonIds as any));
      await db.delete(lessons).where(eq(lessons.module_id, moduleId));
    }
    await db.delete(modules).where(eq(modules.id, moduleId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Delete module error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
