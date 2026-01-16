import { NextResponse } from 'next/server';
import db from '@/db';
import { trainingUseCases } from '@/db/migrations/schemas/schema';

export async function GET() {
    try {
        const useCasesData = await db
            .select()
            .from(trainingUseCases)
            .orderBy(trainingUseCases.orderIndex);

        // Transform to camelCase for frontend
        const formattedUseCases = useCasesData.map(uc => ({
            id: uc.id,
            componentId: uc.componentId,
            letter: uc.letter,
            description: uc.description,
            plannedHours: uc.plannedHours,
            orderIndex: uc.orderIndex,
            createdAt: uc.createdAt,
        }));

        return NextResponse.json({ useCases: formattedUseCases });
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
