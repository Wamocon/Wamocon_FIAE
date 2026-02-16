import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { lernfelderSchema, useCases } from '@/db/migrations/schemas/schema';
import { eq, arrayContains } from 'drizzle-orm';

/**
 * GET /api/trainer/lernfelder/[id]
 * Get details of a specific Lernfeld.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [row] = await db
      .select()
      .from(lernfelderSchema)
      .where(eq(lernfelderSchema.id, id));
    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const relatedUseCases = await db
      .select({
        id: useCases.id,
        title: useCases.title,
        courseId: useCases.courseId,
        descriptionText: useCases.descriptionText,
        orderIndex: useCases.orderIndex,
        durationValue: useCases.durationValue,
        durationUnit: useCases.durationUnit,
        isActive: useCases.isActive,
        year: useCases.year,
        trainingStage: useCases.trainingStage,
        lernfelder: useCases.lernfelder,
      })
      .from(useCases)
      .where(arrayContains(useCases.lernfelder, [row.label]));

    return NextResponse.json({
      lernfeld: row,
      useCases: relatedUseCases,
    });
  } catch (e) {
    console.error('Get lernfeld detail error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/trainer/lernfelder/[id]
 * Update a Lernfeld.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { title, description, label } = body; // All optional

    const [updated] = await db
      .update(lernfelderSchema)
      .set({
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(label !== undefined ? { label } : {}),
        updatedAt: new Date(),
      })
      .where(eq(lernfelderSchema.id, id))
      .returning();

    return NextResponse.json({ lernfeld: updated });
  } catch (e) {
    console.error('Update lernfeld error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/trainer/lernfelder/[id]
 * Delete a Lernfeld.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.delete(lernfelderSchema).where(eq(lernfelderSchema.id, id));
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Delete lernfeld error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
