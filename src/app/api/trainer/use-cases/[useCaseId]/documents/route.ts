'use strict';

import {
  requireTrainer,
  isErrorResponse,
  CURRICULUM_WRITE_FORBIDDEN,
} from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import { contentDocuments, useCases } from '@/db/migrations/schemas/schema';
import { getUserOrgIdStrict } from '@/lib/auth-helpers';
import { requireContentScope } from '@/lib/catalog/scope';
import {
  canCreateDocument,
  canDeleteDocument,
  documentVisibilityCondition,
  loadPlatformOrgIds,
} from '@/lib/auth/document-scope';
import { notFoundUnlessUuid } from '@/lib/uuid';
import { readJsonObject } from '@/lib/input-limits';
import { invalidDocumentInput } from '@/lib/document-input';
import {
  documentPublicUrl,
  documentStoragePath,
} from '@/lib/document-storage';
import { removeDocumentFile } from '@/lib/document-file-cleanup';
import { withSignedSolutionUrls } from '@/lib/solution-storage';

// GET documents for a use case
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ useCaseId: string }> }
) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const { useCaseId } = await params;
    const catalogScope = await requireContentScope(session, req, 'useCase', useCaseId);
    if (isErrorResponse(catalogScope)) return catalogScope;

    // Verify use case exists
    const [useCase] = await db
      .select()
      .from(useCases)
      .where(eq(useCases.id, useCaseId as any));
    if (!useCase) {
      return NextResponse.json(
        { error: 'Use case not found' },
        { status: 404 }
      );
    }

    // Fetch documents for this use case
    const docs = await db
      .select()
      .from(contentDocuments)
      .where(
        and(
          eq(contentDocuments.useCaseId, useCaseId as any),
          // the shared curriculum, the platform and the own organization
          documentVisibilityCondition(contentDocuments.organizationId, session)
        )
      )
      .orderBy(contentDocuments.orderIndex);

    // A model solution of the KfBM lies in a private bucket: the trainer gets a signed url that
    // works for a few minutes, never the reference of the row (src/lib/solution-storage.ts)
    return NextResponse.json({ documents: await withSignedSolutionUrls(docs) });
  } catch (e) {
    console.error('Get use case documents error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// POST - upload a new document for a use case
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ useCaseId: string }> }
) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const { useCaseId } = await params;
    const catalogScope = await requireContentScope(session, req, 'useCase', useCaseId);
    if (isErrorResponse(catalogScope)) return catalogScope;
    const { searchParams } = new URL(req.url);
    const trainerId = session.id;


    // Verify use case exists
    const [useCase] = await db
      .select()
      .from(useCases)
      .where(eq(useCases.id, useCaseId as any));
    if (!useCase) {
      return NextResponse.json(
        { error: 'Use case not found' },
        { status: 404 }
      );
    }

    // Shared curriculum: any valid trainer can upload documents

    const body = await readJsonObject(req);
    if (body instanceof NextResponse) return body;
    const {
      title,
      description,
      documentType,
      fileName,
      fileSize,
      mimeType,
      storageUrl,
      storagePath,
      triggerHaiIngestion,
    } = body as Record<string, any>;

    if (!title || !fileName || !storageUrl) {
      return NextResponse.json(
        { error: 'Missing required fields: title, fileName, storageUrl' },
        { status: 400 }
      );
    }

    // Determine visibility based on document type
    let visibility: 'ALL' | 'TRAINEE_ONLY' | 'TRAINER_ONLY' = 'ALL';
    const docType = documentType || 'THEORY';

    if (docType === 'TRAINER_SOLUTION') {
      visibility = 'TRAINER_ONLY';
    } else if (docType === 'TRAINEE_QUESTION') {
      visibility = 'ALL'; // Trainee questions visible to both
    }

    // A write never falls back to the platform organization: an account
    // without an organization stops here.
    let trainerOrgId: string;
    try {
      trainerOrgId = await getUserOrgIdStrict(trainerId);
    } catch {
      console.warn('Document create refused: the account has no organization');
      return NextResponse.json(
        { error: 'No organization for this account' },
        { status: 403 }
      );
    }

    // A document of the platform organization is curriculum: only the super
    // admin adds it. A person of a customer organization adds documents of
    // the own organization.
    if (!canCreateDocument(session, trainerOrgId, await loadPlatformOrgIds())) {
      return NextResponse.json(
        { error: CURRICULUM_WRITE_FORBIDDEN },
        { status: 403 }
      );
    }

    // Title, file name, file type and document type have to be valid values
    const invalidInput = invalidDocumentInput({
      title,
      fileName,
      mimeType,
      documentType,
    });
    if (invalidInput) return invalidInput;

    // The file has to be an own upload (own project, bucket content, folder of
    // the person). The delete removes it from the storage with the service key.
    const storedPath = documentStoragePath(storageUrl, trainerId);
    if (!storedPath) {
      return NextResponse.json({ error: 'Invalid storageUrl' }, { status: 400 });
    }
    if (
      storagePath !== undefined &&
      storagePath !== null &&
      storagePath !== '' &&
      storagePath !== storedPath
    ) {
      return NextResponse.json(
        { error: 'Invalid storagePath' },
        { status: 400 }
      );
    }

    const [doc] = await db
      .insert(contentDocuments)
      .values({
        useCaseId: useCaseId as any,
        title,
        description: description || null,
        documentType: docType as any,
        visibility: visibility as any,
        fileName,
        fileSize: fileSize || null,
        mimeType: mimeType || 'application/pdf',
        storageUrl: documentPublicUrl(storedPath),
        storagePath: storedPath,
        uploadedById: trainerId as any,
        organizationId: trainerOrgId,
      })
      .returning();

    // Trigger HAI ingestion for TRAINER_SOLUTION documents (async, non-blocking)
    if (docType === 'TRAINER_SOLUTION' && triggerHaiIngestion !== false) {
      // Import dynamically to avoid circular dependencies
      import('@/lib/hai/ingestUseCase')
        .then(({ ingestUseCaseDocument }) => {
          ingestUseCaseDocument(useCaseId, doc.id, false)
            .then(result => {
              if (result.success) {
                console.log(
                  `HAI ingested use case document: ${result.chunksIndexed} chunks`
                );
              } else {
                console.warn(`HAI ingestion failed: ${result.error}`);
              }
            })
            .catch(err => console.error('HAI ingestion error:', err));
        })
        .catch(err =>
          console.error('Failed to import HAI ingestion module:', err)
        );
    }

    return NextResponse.json({ document: doc });
  } catch (e) {
    console.error('Create use case document error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// DELETE - remove a document
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ useCaseId: string }> }
) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const { useCaseId } = await params;
    const catalogScope = await requireContentScope(session, req, 'useCase', useCaseId);
    if (isErrorResponse(catalogScope)) return catalogScope;
    const { searchParams } = new URL(req.url);
    const documentId = searchParams.get('documentId');

    if (!documentId) {
      return NextResponse.json(
        { error: 'Missing documentId' },
        { status: 400 }
      );
    }
    // An id that is no uuid is a document that cannot exist
    const documentNotFound = notFoundUnlessUuid(documentId, 'Document not found');
    if (documentNotFound) return documentNotFound;

    // Verify use case exists
    const [useCase] = await db
      .select()
      .from(useCases)
      .where(eq(useCases.id, useCaseId as any));
    if (!useCase) {
      return NextResponse.json(
        { error: 'Use case not found' },
        { status: 404 }
      );
    }

    // The document has to belong to the use case of the path
    const [doc] = await db
      .select()
      .from(contentDocuments)
      .where(
        and(
          eq(contentDocuments.id, documentId as any),
          eq(contentDocuments.useCaseId, useCaseId as any)
        )
      );
    if (!doc) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // Own organization only. The shared curriculum and the platform documents
    // are deleted by the super admin only, the platform flag of a person
    // widens nothing.
    if (!canDeleteDocument(session, doc, await loadPlatformOrgIds())) {
      return NextResponse.json(
        { error: 'You can only delete documents uploaded by your organization' },
        { status: 403 }
      );
    }

    // If this is a TRAINER_SOLUTION, delete HAI embeddings (async, non-blocking)
    if (doc.documentType === 'TRAINER_SOLUTION') {
      import('@/lib/hai/ingestUseCase')
        .then(({ deleteUseCaseEmbeddings }) => {
          deleteUseCaseEmbeddings(useCaseId)
            .then(result =>
              console.log(
                `Deleted ${result.deleted} HAI embeddings for use case`
              )
            )
            .catch(err =>
              console.error('Failed to delete HAI embeddings:', err)
            );
        })
        .catch(err => console.error('Failed to import HAI module:', err));
    }

    // Delete from database
    await db
      .delete(contentDocuments)
      .where(eq(contentDocuments.id, documentId as any));

    // Remove the file from the storage, after the row (best effort, a failure
    // never undoes the delete). Only the file that belongs to this document alone.
    try {
      await removeDocumentFile(doc);
    } catch (storageErr) {
      console.warn(
        'Failed to delete file from storage (proceeding with DB delete):',
        storageErr
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Delete use case document error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
