import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { useCases, courseMembers, useCaseSubmissions, useCaseSubmissionLinks } from '@/db/migrations/schemas/schema';

// POST submit or update a use-case submission
// Body: { traineeId: string, submissionText?: string, links?: Array<{ url: string, description?: string }> }
export async function POST(req: NextRequest, { params }: { params: Promise<{ useCaseId: string }> }) {
  try {
    const { useCaseId } = await params;
    const body = await req.json();
    const traineeId: string | undefined = body?.traineeId;
    const submissionText: string | undefined = body?.submissionText;
    const links: Array<{ url: string; description?: string }> = Array.isArray(body?.links) ? body.links : [];
    if (!traineeId) return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });

    const [u] = await db.select().from(useCases).where(eq(useCases.id, useCaseId as any));
    if (!u || !u.isActive) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const [member] = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, u.courseId as any), eq(courseMembers.userId, traineeId as any)));
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const result = await db.transaction(async (tx) => {
      // Check if a submission already exists for this trainee/useCase
      const existing = await tx
        .select()
        .from(useCaseSubmissions)
        .where(and(eq(useCaseSubmissions.useCaseId, useCaseId as any), eq(useCaseSubmissions.traineeId, traineeId as any)));
      let submissionId: string;
      if (existing.length) {
        const [updated] = await tx
          .update(useCaseSubmissions)
          .set({ submissionText: submissionText as any, status: 'PENDING' as any, reviewedById: null as any, reviewedAt: null as any })
          .where(and(eq(useCaseSubmissions.useCaseId, useCaseId as any), eq(useCaseSubmissions.traineeId, traineeId as any)))
          .returning();
        submissionId = updated.id as any;
        // Replace links
        await tx.delete(useCaseSubmissionLinks).where(eq(useCaseSubmissionLinks.submissionId, submissionId as any));
      } else {
        const [created] = await tx
          .insert(useCaseSubmissions)
          .values({ traineeId: traineeId as any, useCaseId: useCaseId as any, submissionText: submissionText as any, status: 'PENDING' as any })
          .returning();
        submissionId = created.id as any;
      }
      // Insert links
      if (links.length) {
        const values = links
          .filter((l) => l && l.url && String(l.url).trim())
          .map((l) => ({ submissionId: submissionId as any, url: String(l.url).trim(), description: (l.description ?? null) as any }));
        if (values.length) await tx.insert(useCaseSubmissionLinks).values(values);
      }
      return submissionId;
    });

    return NextResponse.json({ ok: true, submissionId: result });
  } catch (e) {
    console.error('Trainee use-case submit POST error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
