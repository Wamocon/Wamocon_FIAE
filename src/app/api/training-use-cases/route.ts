import { NextResponse } from 'next/server';
import db from '@/db';
import { trainingUseCases, trainingComponents } from '@/db/migrations/schemas/schema';
import { eq } from 'drizzle-orm';
import { normalizePlannedHours } from '@/lib/ausbildung/planned-hours';

export async function GET() {
    try {
        // Fetch use cases with their component info
        const useCasesData = await db
            .select({
                id: trainingUseCases.id,
                componentId: trainingUseCases.componentId,
                letter: trainingUseCases.letter,
                description: trainingUseCases.description,
                plannedHours: trainingUseCases.plannedHours,
                orderIndex: trainingUseCases.orderIndex,
                createdAt: trainingUseCases.createdAt,
                componentCode: trainingComponents.code,
                componentTitle: trainingComponents.title,
            })
            .from(trainingUseCases)
            .leftJoin(trainingComponents, eq(trainingUseCases.componentId, trainingComponents.id))
            .orderBy(trainingComponents.code, trainingUseCases.orderIndex);

        // Transform to camelCase for frontend
        const formattedUseCases = useCasesData.map(uc => ({
            id: uc.id,
            componentId: uc.componentId,
            letter: uc.letter,
            description: uc.description,
            plannedHours: normalizePlannedHours(uc),
            orderIndex: uc.orderIndex,
            createdAt: uc.createdAt,
            component: {
                code: uc.componentCode,
                title: uc.componentTitle,
            },
        }));

        return NextResponse.json({ useCases: formattedUseCases }, {
            headers: {
                'Cache-Control': 'no-store',
            },
        });
    } catch (error: any) {
        // If table doesn't exist yet, return empty use cases
        if (error?.cause?.code === '42P01') {
            console.warn('Table training_use_cases does not exist yet - returning empty use cases');
            return NextResponse.json({ useCases: [] });
        }
        console.error('Error in training-use-cases API:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
