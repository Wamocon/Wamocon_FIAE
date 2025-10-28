import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, desc, eq } from 'drizzle-orm';
import { knowledgeNotes } from '@/db/migrations/schemas/schema';

// GET /api/trainee/knowledge-notes?traineeId=...
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const traineeId = searchParams.get('traineeId');
    if (!traineeId) return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    const rows = await db
      .select({
        id: knowledgeNotes.id,
        title: knowledgeNotes.title,
        content: knowledgeNotes.content,
        oneDriveLink: knowledgeNotes.oneDriveLink,
        createdAt: knowledgeNotes.createdAt,
        updatedAt: knowledgeNotes.updatedAt,
      })
      .from(knowledgeNotes)
      .where(eq(knowledgeNotes.traineeId, traineeId as any))
      .orderBy(desc(knowledgeNotes.createdAt));

    return NextResponse.json({ notes: rows });
  } catch (e) {
    console.error('List knowledge notes error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST /api/trainee/knowledge-notes
// Body: { trainee_id, title, content, one_drive_link? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const trainee_id = body?.trainee_id as string | undefined;
    const title = String(body?.title || '').trim();
    const content = String(body?.content || '').trim();
    const one_drive_link = body?.one_drive_link ? String(body.one_drive_link) : null;

    if (!trainee_id) return NextResponse.json({ error: 'trainee_id required' }, { status: 400 });
    if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });
    if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 });

    const [row] = await db
      .insert(knowledgeNotes)
      .values({ traineeId: trainee_id as any, title, content, oneDriveLink: one_drive_link })
      .returning();

    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (e) {
    console.error('Create knowledge note error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
