import { NextResponse } from 'next/server';
import db from '@/db';
import { trainingComponents } from '@/db/migrations/schemas/schema';

export async function GET() {
    try {
        const components = await db
            .select()
            .from(trainingComponents)
            .orderBy(trainingComponents.orderIndex);

        // Transform to camelCase for frontend
        const formattedComponents = components.map(c => ({
            id: c.id,
            code: c.code,
            title: c.title,
            description: c.description,
            totalWeeks: c.totalWeeks,
            totalHours: c.totalHours,
            trainingYear: c.trainingYear,
            orderIndex: c.orderIndex,
            createdAt: c.createdAt,
        }));

        return NextResponse.json({ components: formattedComponents }, {
            headers: {
                'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=59',
            },
        });
    } catch (error: any) {
        // If table doesn't exist yet, return empty components
        if (error?.cause?.code === '42P01') {
            console.warn('Table training_components does not exist yet - returning empty components');
            return NextResponse.json({ components: [] });
        }
        console.error('Error in training-components API:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
