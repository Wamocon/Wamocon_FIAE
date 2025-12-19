'use strict';

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { contentDocuments, useCases, profiles } from '@/db/migrations/schemas/schema';

async function verifyTrainer(trainerId: string): Promise<boolean> {
    const [trainer] = await db.select({ role: profiles.role }).from(profiles).where(eq(profiles.id, trainerId as any));
    return trainer?.role === 'TRAINER';
}

// GET documents for a use case
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ useCaseId: string }> }
) {
    try {
        const { useCaseId } = await params;

        // Verify use case exists
        const [useCase] = await db.select().from(useCases).where(eq(useCases.id, useCaseId as any));
        if (!useCase) {
            return NextResponse.json({ error: 'Use case not found' }, { status: 404 });
        }

        // Fetch documents for this use case
        const docs = await db
            .select()
            .from(contentDocuments)
            .where(eq(contentDocuments.useCaseId, useCaseId as any))
            .orderBy(contentDocuments.orderIndex);

        return NextResponse.json({ documents: docs });
    } catch (e) {
        console.error('Get use case documents error', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// POST - upload a new document for a use case
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ useCaseId: string }> }
) {
    try {
        const { useCaseId } = await params;
        const { searchParams } = new URL(req.url);
        const trainerId = searchParams.get('trainerId');

        if (!trainerId) {
            return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
        }

        // Verify use case exists
        const [useCase] = await db.select().from(useCases).where(eq(useCases.id, useCaseId as any));
        if (!useCase) {
            return NextResponse.json({ error: 'Use case not found' }, { status: 404 });
        }

        // Shared curriculum: any valid trainer can upload documents
        if (!(await verifyTrainer(trainerId))) {
            return NextResponse.json({ error: 'Forbidden - not a trainer' }, { status: 403 });
        }

        const body = await req.json();
        const { title, description, documentType, fileName, fileSize, mimeType, storageUrl, storagePath } = body;

        if (!title || !fileName || !storageUrl) {
            return NextResponse.json({ error: 'Missing required fields: title, fileName, storageUrl' }, { status: 400 });
        }

        // Insert document
        const [doc] = await db
            .insert(contentDocuments)
            .values({
                useCaseId: useCaseId as any,
                title,
                description: description || null,
                documentType: documentType || 'THEORY',
                fileName,
                fileSize: fileSize || null,
                mimeType: mimeType || 'application/pdf',
                storageUrl,
                storagePath: storagePath || null,
                uploadedById: trainerId as any,
            })
            .returning();

        return NextResponse.json({ document: doc });
    } catch (e) {
        console.error('Create use case document error', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// DELETE - remove a document
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ useCaseId: string }> }
) {
    try {
        const { useCaseId } = await params;
        const { searchParams } = new URL(req.url);
        const trainerId = searchParams.get('trainerId');
        const documentId = searchParams.get('documentId');

        if (!trainerId) {
            return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
        }
        if (!documentId) {
            return NextResponse.json({ error: 'Missing documentId' }, { status: 400 });
        }

        // Verify use case exists
        const [useCase] = await db.select().from(useCases).where(eq(useCases.id, useCaseId as any));
        if (!useCase) {
            return NextResponse.json({ error: 'Use case not found' }, { status: 404 });
        }

        // Shared curriculum: any valid trainer can delete documents
        if (!(await verifyTrainer(trainerId))) {
            return NextResponse.json({ error: 'Forbidden - not a trainer' }, { status: 403 });
        }

        // Get document first to extract storage path for cleanup
        const [doc] = await db.select().from(contentDocuments).where(eq(contentDocuments.id, documentId as any));
        if (!doc) {
            return NextResponse.json({ error: 'Document not found' }, { status: 404 });
        }

        // Delete from Supabase Storage (best effort - don't fail if storage delete fails)
        try {
            const { createClient } = await import('@supabase/supabase-js');
            const supabaseUrl = process.env.SUPABASE_URL_INTERNAL || process.env.NEXT_PUBLIC_SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

            if (supabaseUrl && supabaseKey && doc.storageUrl) {
                const supabase = createClient(supabaseUrl, supabaseKey);
                // Extract path from URL: https://xxx.supabase.co/storage/v1/object/public/content/userId/file.pdf
                const urlParts = doc.storageUrl.split('/storage/v1/object/public/content/');
                if (urlParts.length === 2) {
                    const filePath = urlParts[1];
                    await supabase.storage.from('content').remove([filePath]);
                }
            }
        } catch (storageErr) {
            console.warn('Failed to delete file from storage (proceeding with DB delete):', storageErr);
        }

        // Delete from database
        await db.delete(contentDocuments).where(eq(contentDocuments.id, documentId as any));

        return NextResponse.json({ ok: true });
    } catch (e) {
        console.error('Delete use case document error', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

