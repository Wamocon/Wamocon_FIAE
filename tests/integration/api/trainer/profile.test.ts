/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

function makeGet(url: string) {
    return { url } as any;
}

async function importHandlerWithDb(mockDb: any) {
    jest.resetModules();
    jest.doMock('@/db', () => ({ __esModule: true, default: mockDb }));
    const mod = await import('@/app/api/trainer/profile/route');
    return mod.GET as (req: any) => Promise<Response>;
}

describe('API: Trainer Profile', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('GET /api/trainer/profile returns stats', async () => {
        // Sequence:
        // 1. traineeRows (profiles)
        // 2. activeCourses (courses count)
        // 3. pendingQuiz (quizSubmissions count)
        // 4. pendingUses (useCaseSubmissions count)
        // 5. recentActivities (activityLog limit 5)
        // 6. recentCount (activityLog count)

        const sequence: any[] = [
            // 1. traineeRows
            [{ id: 't1' }, { id: 't2' }],
            // 2. activeCourses
            [{ c: 5 }],
            // 3. pendingQuiz
            [{ c: 2 }],
            // 4. pendingUses
            [{ c: 0 }],
            // 5. recentActivities
            [{ id: 'a1', activityType: 'LOGIN', createdAt: new Date() }],
            // 7. recentCount
            [{ c: 10 }]
        ];

        let idx = 0;
        const mockDb = {
            select: jest.fn().mockImplementation(() => ({
                from: () => ({
                    where: () => {
                        const ret = sequence[idx++];
                        if (ret && (ret.orderBy || ret.limit)) return ret;
                        return {
                            orderBy: () => ({ limit: () => ret })
                        };
                    }
                }),
            })),
        };

        // Chain mock
        const chain = {
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            and: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            inArray: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            then: (resolve: any) => resolve(sequence[idx++])
        };
        mockDb.select = jest.fn().mockReturnValue(chain);

        const GET = await importHandlerWithDb(mockDb);
        const res = await GET(makeGet('http://localhost/api/trainer/profile?trainerId=tr1'));

        expect(res.status).toBe(200);
        const body = await res.json();

        expect(body.counts.trainees).toBe(2);
        expect(body.counts.activeCourses).toBe(5);
        expect(body.counts.pendingReviews).toBe(2); // 2 + 0
        expect(body.counts.recentActivity7d).toBe(10);
        expect(body.recentActivities).toHaveLength(1);
    });
});
