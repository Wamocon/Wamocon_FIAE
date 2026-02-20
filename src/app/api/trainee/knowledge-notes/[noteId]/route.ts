import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { knowledgeNotes } from '@/db/migrations/schemas/schema';

// GET /api/trainee/knowledge-notes/[noteId]?traineeId=...
export async function GET(req: NextRequest, ctx: { params: Promise<{ noteId: string }> }) {
  try {
    const url = new URL(req.url);
    const traineeId = url.searchParams.get('traineeId');
    const { noteId } = await ctx.params;
    if (!noteId) return NextResponse.json({ error: 'Missing noteId' }, { status: 400 });

    const rows = await db
      .select({
        id: knowledgeNotes.id,
        title: knowledgeNotes.title,
        content: knowledgeNotes.content,
        oneDriveLink: knowledgeNotes.oneDriveLink,
        createdAt: knowledgeNotes.createdAt,
        updatedAt: knowledgeNotes.updatedAt,
        traineeId: knowledgeNotes.traineeId,
      })
      .from(knowledgeNotes)
      .where(eq(knowledgeNotes.id, noteId as any));
    const note = rows[0];
    if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (traineeId && String(note.traineeId) !== String(traineeId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ note });
  } catch (e) {
    console.error('Get knowledge note error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE /api/trainee/knowledge-notes/[noteId]?traineeId=...
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ noteId: string }> }) {
  try {
    const url = new URL(_req.url);
    const traineeId = url.searchParams.get('traineeId');
    const { noteId } = await ctx.params;
    if (!noteId) return NextResponse.json({ error: 'Missing noteId' }, { status: 400 });
    if (!traineeId) return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    await db.delete(knowledgeNotes).where(and(eq(knowledgeNotes.id, noteId as any), eq(knowledgeNotes.traineeId, traineeId as any)));

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Delete knowledge note error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PATCH /api/trainee/knowledge-notes/[noteId]
// Body: { trainee_id, title?, content?, one_drive_link? }
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ noteId: string }> }) {
  try {
    const { noteId } = await ctx.params;
    if (!noteId) return NextResponse.json({ error: 'Missing noteId' }, { status: 400 });
    const body = await req.json();
    const trainee_id = body?.trainee_id as string | undefined;
    if (!trainee_id) return NextResponse.json({ error: 'Missing trainee_id' }, { status: 400 });

    const updates: any = {};
    if (body?.title !== undefined) updates.title = String(body.title);
    if (body?.content !== undefined) updates.content = String(body.content);
    if (body?.one_drive_link !== undefined) updates.oneDriveLink = body.one_drive_link ? String(body.one_drive_link) : null;

    // Scope update to the trainee to prevent cross-editing
    await db.update(knowledgeNotes).set(updates).where(and(eq(knowledgeNotes.id, noteId as any), eq(knowledgeNotes.traineeId, trainee_id as any)));

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Patch knowledge note error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
