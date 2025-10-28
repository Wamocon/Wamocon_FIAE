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
      trainerId ? eq(acceptanceProtocols.trainerId, trainerId as any) : undefined,
      traineeId ? eq(acceptanceProtocols.traineeId, traineeId as any) : undefined,
    );

    const rows = await db
      .select({
        id: acceptanceProtocols.id,
        traineeId: acceptanceProtocols.traineeId,
        trainerId: acceptanceProtocols.trainerId,
        milestone: acceptanceProtocols.milestone,
        comments: acceptanceProtocols.comments,
        pdfUrl: acceptanceProtocols.pdfUrl,
        acceptanceDate: acceptanceProtocols.acceptanceDate,
        generatedAt: acceptanceProtocols.generatedAt,
      })
      .from(acceptanceProtocols)
      .where(where as any)
      .orderBy(desc(acceptanceProtocols.generatedAt));

    return NextResponse.json({ items: rows });
  } catch (e) {
    console.error('List acceptance protocols error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
  const trainee_id = (body?.trainee_id || body?.traineeId) as string | undefined;
  const trainer_id = (body?.trainer_id || body?.trainerId) as string | undefined; // profiles.id
  const milestone_name = String(body?.milestone_name || body?.milestone || '').trim();
  const comments = String(body?.comments || '').trim();
  const acceptance_date = body?.acceptance_date || body?.acceptanceDate || null;
  const protocol_pdf_url = body?.protocol_pdf_url || body?.pdfUrl || null;

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
      .values({
        traineeId: trainee_id,
        trainerId: trainer_id,
        milestone: milestone_name,
        comments,
        acceptanceDate: acceptance_date ? new Date(acceptance_date) : new Date(),
        pdfUrl: protocol_pdf_url,
      })
      .returning();

    return NextResponse.json({ protocol: row }, { status: 201 });
  } catch (e) {
    console.error('Create acceptance protocol error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
