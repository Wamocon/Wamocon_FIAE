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
    const mod = await import('@/app/api/trainer/dashboard/route');
    return mod.GET as (req: any) => Promise<Response>;
}

describe('API: Trainer Dashboard', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('GET /api/trainer/dashboard returns summary', async () => {
        // Sequence of queries (TrainerDashboard):
        // 1. createdCourses
        // 2. memberCourses
        // 3. directlyAssigned (profiles)
        // 4. courseTrainees (courseMembers) -> if courses > 0
        // 5. extras (profiles) -> if needed (skipped if all covered)
        // 6. trainerEnablers
        // 7. completedMap (enablerCompletions)
        // 8. createdQuizRows
        // 9. memberQuizRows
        // 10. pendingQuiz
        // 11. pendingLessonQuiz
        // 12. pendingRefl
        // 13. pendingUseCases
        // 14. pendingEnablers
        // 15. recentReflections
        // 16. compRows (trend)
        // 17. subRows (trend)
        // 18. trainerCourses (chart)
        // 19. enablerCounts (chart)
        // 20. compByCourseAndTrainee (chart)

        const sequence: any[] = [
            // 1. createdCourses
            [{ id: 'c1' }],
            // 2. memberCourses
            [],
            // 3. directlyAssigned
            [{ id: 't1', fullName: 'Trainee 1', avatarUrl: null }],
            // 4. courseTrainees (courseMembers)
            [{ userId: 't2' }],
            // 5. extras (profiles for t2) - triggered because t2 is not in directlyAssigned
            [{ id: 't2', fullName: 'Trainee 2', avatarUrl: null }],

            // 6. trainerEnablers
            [{ id: 'e1' }, { id: 'e2' }],

            // 7. completedMap (enablerCompletions)
            [{ traineeId: 't1', c: 1 }, { traineeId: 't2', c: 0 }],

            // 8. createdQuizRows
            [{ id: 'q1' }],
            // 9. memberQuizRows
            [],

            // 10. pendingQuiz
            [{ c: 1 }],
            // 11. pendingLessonQuiz
            [{ c: 0 }],
            // 12. pendingRefl
            [{ c: 0 }],
            // 13. pendingUseCases
            [{ c: 0 }],
            // 14. pendingEnablers
            [{ c: 0 }],

            // 15. recentReflections
            [{ c: 1 }],

            // 16. compRows (trend)
            [{ at: new Date() }],
            // 17. subRows (trend)
            [],

            // 18. trainerCourses
            [{ id: 'c1', title: 'Course 1' }],
            // 19. enablerCounts
            [{ courseId: 'c1', c: 2 }],
            // 20. compByCourseAndTrainee
            [{ traineeId: 't1', courseId: 'c1', c: 1 }],
        ];

        let idx = 0;
        const mockDb = {
            select: jest.fn().mockImplementation(() => ({
                from: () => ({
                    where: () => {
                        const ret = sequence[idx++];
                        if (ret && (ret.groupBy || ret.orderBy)) return ret; // Mock chain handling
                        return { // Chain support
                            groupBy: () => ret,
                            orderBy: () => ret,
                            innerJoin: () => ({ where: () => ret })
                        }
                    },
                    innerJoin: () => ({
                        where: () => sequence[idx++]
                    })
                }),
            })),
        };

        // Chain mock
        const chain = {
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            and: jest.fn().mockReturnThis(),
            innerJoin: jest.fn().mockReturnThis(),
            groupBy: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            then: (resolve: any) => resolve(sequence[idx++])
        };
        mockDb.select = jest.fn().mockReturnValue(chain);

        const GET = await importHandlerWithDb(mockDb);
        const res = await GET(makeGet('http://localhost/api/trainer/dashboard?trainerAuthId=tr1'));

        expect(res.status).toBe(200);
        const body = await res.json();

        expect(body.trainees).toHaveLength(2); // t1, t2
        // t1 has 1 completion out of 2 enablers = 50%
        expect(body.trainees.find((t: any) => t.id === 't1').progress).toBe(50);
        // t2 has 0 = 0%
        expect(body.trainees.find((t: any) => t.id === 't2').progress).toBe(0);

        expect(body.counts.pendingQuiz).toBe(1);
    });
});
