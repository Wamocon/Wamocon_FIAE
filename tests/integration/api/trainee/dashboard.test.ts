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
    const mod = await import('@/app/api/trainee/dashboard/route');
    return mod.GET as (req: any) => Promise<Response>;
}

describe('API: Trainee Dashboard', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('GET /api/trainee/dashboard returns summary', async () => {
        // Sequence of queries:
        // 1. memberCourses (join courses)
        // 2. Loop courses (c1): Enablers
        // 3. Loop courses (c1): EnablerCompletions count
        // 4. allEns (next item search)
        // 5. Loop allEns (e1): EnablerCompletions (check done)
        // 6. Loop allEns (e2): EnablerCompletions (check done) -> not done, break
        // 7. compRows (weekly progress)
        // 8. courseSkills
        // 9. achievedSkills
        // 10. recentSub (quiz)
        // 11. recentEn (enabler) => if found, query title

        const sequence: any[] = [
            // 1. memberCourses
            [{ id: 'c1', title: 'Course 1', year: 2024 }],
            // 2. enablers for c1
            [{ id: 'e1' }, { id: 'e2' }],
            // 3. completions count for c1
            [{ cnt: 1 }],

            // 4. allEns
            [
                { id: 'e1', title: 'E1', orderIndex: 1, durationValue: 10, durationUnit: 'Min', courseId: 'c1', courseTitle: 'C1', courseYear: 2024 },
                { id: 'e2', title: 'E2', orderIndex: 2, durationValue: 20, durationUnit: 'Min', courseId: 'c1', courseTitle: 'C1', courseYear: 2024 },
            ],
            // 5. check e1 done
            [{ traineeId: 't1' }], // found
            // 6. check e2 done
            [], // not found -> Next Item is e2

            // 7. weekly progress (compRows)
            [{ completedAt: new Date() }],

            // 8. courseSkills
            [{ skillId: 's1', name: 'Skill 1' }],
            // 9. achievedSkills
            [{ skillId: 's1' }],

            // 10. recentSub (quiz)
            [], // no recent quiz

            // 11. recentEn (enabler)
            [], // no recent enabler
        ];

        let idx = 0;
        const mockDb = {
            select: jest.fn().mockImplementation(() => ({
                from: () => ({
                    innerJoin: () => ({
                        where: () => sequence[idx++]
                    }),
                    where: () => {
                        const ret = sequence[idx++];
                        if (ret && ret.orderBy) return ret; // handle checks if needed
                        return {
                            orderBy: () => ret,
                            limit: () => ret,
                            groupBy: () => ret
                        };
                    },
                    orderBy: () => ({ limit: () => sequence[idx++] })
                }),
            })),
        };

        // The structure of route.ts uses various chains.
        // simpler mock strategy: just return the NEXT item in sequence for ANY final execution call.
        // The chains are select().from()... .where() OR .innerJoin().where() OR .orderBy() etc.
        // We need a recursive mock that consumes sequence on the "leaf" calls (then, iterator, or specific methods).
        // But since we can't easily predict "leaf", we'll use a simplified approach matching expected call counts.

        // Let's rely on the fact that `await` triggers `then`.
        const chain = {
            from: jest.fn().mockReturnThis(),
            innerJoin: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            groupBy: jest.fn().mockReturnThis(),
            then: (resolve: any) => resolve(sequence[idx++])
        };

        // We need a fresh chain for each query start
        mockDb.select = jest.fn().mockReturnValue(chain);

        const GET = await importHandlerWithDb(mockDb);
        const res = await GET(makeGet('http://localhost/api/trainee/dashboard?userId=t1'));

        expect(res.status).toBe(200);
        const body = await res.json();

        expect(body.modules).toHaveLength(1);
        expect(body.modules[0].title).toBe('Course 1');
        expect(body.modules[0].progress).toBe(50); // 1/2 enablers

        expect(body.nextItem).not.toBeNull();
        expect(body.nextItem.lessonTitle).toBe('E2');

        expect(body.skillRadar).toContainEqual({ skill: 'Skill 1', value: 100 });
    });
});
