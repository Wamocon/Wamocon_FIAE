import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { contentDocuments, enablers } from '@/db/migrations/schemas/schema';
import { verifyTrainer, getUserOrgId, verifyPlatformOwner } from '@/lib/auth-helpers';

// GET documents for an enabler
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ enablerId: string }> }
) {
  try {
    const { enablerId } = await params;

    // Verify enabler exists
    const [enabler] = await db
      .select({ id: enablers.id })
      .from(enablers)
      .where(eq(enablers.id, enablerId as any));
    if (!enabler) {
      return NextResponse.json({ error: 'Enabler not found' }, { status: 404 });
    }

    // Fetch documents for this enabler
    const docs = await db
      .select()
      .from(contentDocuments)
      .where(eq(contentDocuments.enablerId, enablerId as any))
      .orderBy(contentDocuments.orderIndex);

    return NextResponse.json({ documents: docs });
  } catch (e) {
    console.error('Get enabler documents error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// POST - upload a new document for an enabler
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ enablerId: string }> }
) {
  try {
    const { enablerId } = await params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');

    if (!trainerId) {
      return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    }

    // Verify enabler exists
    const [enabler] = await db
      .select({ id: enablers.id })
      .from(enablers)
      .where(eq(enablers.id, enablerId as any));
    if (!enabler) {
      return NextResponse.json({ error: 'Enabler not found' }, { status: 404 });
    }

    // Shared curriculum: any valid trainer can upload documents
    if (!(await verifyTrainer(trainerId))) {
      return NextResponse.json(
        { error: 'Forbidden - not a trainer' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const {
      title,
      description,
      documentType,
      fileName,
      fileSize,
      mimeType,
      storageUrl,
      storagePath,
    } = body;

    if (!title || !fileName || !storageUrl) {
      return NextResponse.json(
        { error: 'Missing required fields: title, fileName, storageUrl' },
        { status: 400 }
      );
    }

    const trainerOrgId = await getUserOrgId(trainerId);

    const [doc] = await db
      .insert(contentDocuments)
      .values({
        enablerId: enablerId as any,
        title,
        description: description || null,
        documentType: documentType || 'THEORY',
        fileName,
        fileSize: fileSize || null,
        mimeType: mimeType || 'application/pdf',
        storageUrl,
        storagePath: storagePath || null,
        uploadedById: trainerId as any,
        organizationId: trainerOrgId,
      })
      .returning();

    return NextResponse.json({ document: doc });
  } catch (e) {
    console.error('Create enabler document error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// DELETE - remove a document
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ enablerId: string }> }
) {
  try {
    const { enablerId } = await params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');
    const documentId = searchParams.get('documentId');

    if (!trainerId) {
      return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    }
    if (!documentId) {
      return NextResponse.json(
        { error: 'Missing documentId' },
        { status: 400 }
      );
    }

    // Verify enabler exists
    const [enabler] = await db
      .select({ id: enablers.id })
      .from(enablers)
      .where(eq(enablers.id, enablerId as any));
    if (!enabler) {
      return NextResponse.json({ error: 'Enabler not found' }, { status: 404 });
    }

    // Shared curriculum: any valid trainer can delete documents
    if (!(await verifyTrainer(trainerId))) {
      return NextResponse.json(
        { error: 'Forbidden - not a trainer' },
        { status: 403 }
      );
    }

    const [doc] = await db
      .select()
      .from(contentDocuments)
      .where(eq(contentDocuments.id, documentId as any));
    if (!doc) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // Org-scoped delete: trainers can only delete their own org's docs
    const trainerOrgId = await getUserOrgId(trainerId);
    const isPlatform = await verifyPlatformOwner(trainerId);
    if (!isPlatform && doc.organizationId !== trainerOrgId) {
      return NextResponse.json(
        { error: 'You can only delete documents uploaded by your organization' },
        { status: 403 }
      );
    }

    // Delete from Supabase Storage (best effort - don't fail if storage delete fails)
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl =
        process.env.SUPABASE_URL_INTERNAL ||
        process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (supabaseUrl && supabaseKey && doc.storageUrl) {
        const supabase = createClient(supabaseUrl, supabaseKey);
        // Extract path from URL: https://xxx.supabase.co/storage/v1/object/public/content/userId/file.pdf
        const urlParts = doc.storageUrl.split(
          '/storage/v1/object/public/content/'
        );
        if (urlParts.length === 2) {
          const filePath = urlParts[1];
          await supabase.storage.from('content').remove([filePath]);
        }
      }
    } catch (storageErr) {
      console.warn(
        'Failed to delete file from storage (proceeding with DB delete):',
        storageErr
      );
    }

    // Delete from database
    await db
      .delete(contentDocuments)
      .where(eq(contentDocuments.id, documentId as any));

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Delete enabler document error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
