import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { acceptanceProtocols, profiles } from '@/db/migrations/schemas/schema';
import { and, desc, eq } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId'); // profiles.id
    const traineeId = searchParams.get('traineeId'); // profiles.id

    const where = and(
      trainerId ? eq(acceptanceProtocols.trainer_id, trainerId as any) : undefined,
      traineeId ? eq(acceptanceProtocols.trainee_id, traineeId as any) : undefined,
    );

    const rows = await db
      .select({
        id: acceptanceProtocols.id,
        trainee_id: acceptanceProtocols.trainee_id,
        trainer_id: acceptanceProtocols.trainer_id,
        milestone_name: acceptanceProtocols.milestone_name,
        comments: acceptanceProtocols.comments,
        protocol_pdf_url: acceptanceProtocols.protocol_pdf_url,
        created_at: acceptanceProtocols.created_at,
      })
      .from(acceptanceProtocols)
      .where(where as any)
      .orderBy(desc(acceptanceProtocols.created_at));

    return NextResponse.json({ items: rows });
  } catch (e) {
    console.error('List acceptance protocols error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const trainee_id = body?.trainee_id as string | undefined;
    const trainer_id = body?.trainer_id as string | undefined; // profiles.id
    const milestone_name = (body?.milestone_name || '').trim();
    const comments = (body?.comments || '').trim();
    const protocol_pdf_url = body?.protocol_pdf_url || null;

    if (!trainee_id) return NextResponse.json({ error: 'trainee_id required' }, { status: 400 });
    if (!trainer_id) return NextResponse.json({ error: 'trainer_id required' }, { status: 400 });
    if (!milestone_name) return NextResponse.json({ error: 'milestone_name required' }, { status: 400 });
    if (!comments) return NextResponse.json({ error: 'comments required' }, { status: 400 });

    // Optional: verify both trainee and trainer exist
    const [tRow] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, trainee_id as any)).limit(1);
    const [rRow] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, trainer_id as any)).limit(1);
    if (!tRow) return NextResponse.json({ error: 'Invalid trainee_id' }, { status: 400 });
    if (!rRow) return NextResponse.json({ error: 'Invalid trainer_id' }, { status: 400 });

    const [row] = await db
      .insert(acceptanceProtocols)
      .values({ trainee_id, trainer_id, milestone_name, comments, protocol_pdf_url })
      .returning();

    return NextResponse.json({ protocol: row }, { status: 201 });
  } catch (e) {
    console.error('Create acceptance protocol error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
