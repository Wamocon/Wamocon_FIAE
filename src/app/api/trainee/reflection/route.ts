import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { desc, eq } from 'drizzle-orm';
import { reflections } from '@/db/migrations/schemas/schema';

// GET /api/trainee/reflection?traineeId=...
// Returns the latest reflection for a trainee, or null if none exists
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const traineeId = searchParams.get('traineeId');
    if (!traineeId) return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    const rows = await db
      .select({
        id: reflections.id,
        traineeId: reflections.traineeId,
        strengths: reflections.strengths,
        weaknesses: reflections.weaknesses,
        mesMore: reflections.mesMore,
        mesEqual: reflections.mesEqual,
        isReviewed: reflections.isReviewed,
        reviewedById: reflections.reviewedById,
        createdAt: reflections.createdAt,
      })
      .from(reflections)
      .where(eq(reflections.traineeId, traineeId as any))
      .orderBy(desc(reflections.createdAt));

    // For backwards compatibility on the trainee page, return both latest and all
    const reflection = rows[0] || null;
    return NextResponse.json({ reflection, reflections: rows });
  } catch (e) {
    console.error('Trainee reflection GET error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST /api/trainee/reflection
// Body: { trainee_id, strengths, weaknesses, mes_more, mes_equal }
// Always creates a new reflection entry (no overwrite)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const trainee_id = body?.trainee_id as string | undefined;
    const strengths = (body?.strengths ?? '').toString();
    const weaknesses = (body?.weaknesses ?? '').toString();
    const mes_more = (body?.mes_more ?? '').toString();
    const mes_equal = (body?.mes_equal ?? '').toString();

    if (!trainee_id) return NextResponse.json({ error: 'trainee_id required' }, { status: 400 });

    const [row] = await db
      .insert(reflections)
      .values({ traineeId: trainee_id as any, strengths, weaknesses, mesMore: mes_more, mesEqual: mes_equal })
      .returning();

    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (e) {
    console.error('Trainee reflection POST error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT /api/trainee/reflection
// Body: { trainee_id, strengths, weaknesses, mes_more, mes_equal }
// Upserts the reflection by updating the latest one if present, otherwise inserting a new one
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const trainee_id = body?.trainee_id as string | undefined;
    const strengths = (body?.strengths ?? '').toString();
    const weaknesses = (body?.weaknesses ?? '').toString();
    const mes_more = (body?.mes_more ?? '').toString();
    const mes_equal = (body?.mes_equal ?? '').toString();

    if (!trainee_id) return NextResponse.json({ error: 'trainee_id required' }, { status: 400 });

    const existing = await db
      .select({ id: reflections.id })
      .from(reflections)
      .where(eq(reflections.traineeId, trainee_id as any))
      .orderBy(desc(reflections.createdAt))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(reflections)
        .set({ strengths, weaknesses, mesMore: mes_more, mesEqual: mes_equal })
        .where(eq(reflections.id, existing[0].id as any));
      return NextResponse.json({ id: existing[0].id, updated: true });
    } else {
      const [row] = await db
        .insert(reflections)
        .values({ traineeId: trainee_id as any, strengths, weaknesses, mesMore: mes_more, mesEqual: mes_equal })
        .returning();
      return NextResponse.json({ id: row.id, created: true }, { status: 201 });
    }
  } catch (e) {
    console.error('Trainee reflection PUT error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
