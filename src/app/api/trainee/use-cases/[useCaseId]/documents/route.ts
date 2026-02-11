'use strict';

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, and, or, ne, sql } from 'drizzle-orm';
import { contentDocuments, useCases, courseMembers, profiles } from '@/db/migrations/schemas/schema';

/**
 * GET documents for a use case - TRAINEE view
 * 
 * Filters documents by visibility:
 * - Returns: ALL, TRAINEE_ONLY documents
 * - Excludes: TRAINER_ONLY documents (solutions)
 * 
 * This ensures trainees only see questions, not answers.
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ useCaseId: string }> }
) {
    try {
        const { useCaseId } = await params;
        const { searchParams } = new URL(req.url);
        const traineeId = searchParams.get('traineeId');

        if (!traineeId) {
            return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });
        }

        // Verify trainee role
        const [trainee] = await db
            .select({ role: profiles.role })
            .from(profiles)
            .where(eq(profiles.id, traineeId as any));

        if (!trainee || trainee.role !== 'TRAINEE') {
            return NextResponse.json({ error: 'Forbidden - not a trainee' }, { status: 403 });
        }

        // Verify use case exists and trainee has access
        const [useCase] = await db
            .select()
            .from(useCases)
            .where(eq(useCases.id, useCaseId as any));

        if (!useCase) {
            return NextResponse.json({ error: 'Use case not found' }, { status: 404 });
        }

        // Check trainee is member of the course
        const [member] = await db
            .select()
            .from(courseMembers)
            .where(
                and(
                    eq(courseMembers.courseId, useCase.courseId as any),
                    eq(courseMembers.userId, traineeId as any)
                )
            );

        if (!member) {
            return NextResponse.json({ error: 'Forbidden - not enrolled in course' }, { status: 403 });
        }

        // Fetch documents with visibility filter for trainees
        // Exclude: TRAINER_ONLY and TRAINER_SOLUTION documents
        const docs = await db
            .select({
                id: contentDocuments.id,
                title: contentDocuments.title,
                description: contentDocuments.description,
                documentType: contentDocuments.documentType,
                fileName: contentDocuments.fileName,
                fileSize: contentDocuments.fileSize,
                storageUrl: contentDocuments.storageUrl,
                orderIndex: contentDocuments.orderIndex,
                pageCount: contentDocuments.pageCount,
            })
            .from(contentDocuments)
            .where(
                and(
                    eq(contentDocuments.useCaseId, useCaseId as any),
                    // Exclude trainer-only content
                    or(
                        eq(contentDocuments.visibility as any, 'ALL'),
                        eq(contentDocuments.visibility as any, 'TRAINEE_ONLY'),
                        sql`${contentDocuments.visibility} IS NULL`
                    ),
                    // Also exclude TRAINER_SOLUTION document type
                    ne(contentDocuments.documentType as any, 'TRAINER_SOLUTION')
                )
            )
            .orderBy(contentDocuments.orderIndex);

        return NextResponse.json({ 
            documents: docs,
            useCaseTitle: useCase.title 
        });
    } catch (e) {
        console.error('Trainee use case documents GET error', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
