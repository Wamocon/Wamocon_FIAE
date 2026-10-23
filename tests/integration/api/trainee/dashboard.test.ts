/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';

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

    it('400 if userId is missing', async () => {
        const { db } = createTableDb();
        const GET = await importHandlerWithDb(db);
        const res = await GET(makeGet('http://localhost/api/trainee/dashboard'));
        expect(res.status).toBe(400);
    });

    it('GET /api/trainee/dashboard returns summary', async () => {
        const { db } = createTableDb({
            // Membership joined with courses
            courseMembers: [{ id: 'c1', title: 'Course 1', year: 2024 }],
            enablers: [
                { id: 'e1', title: 'E1', orderIndex: 1, durationValue: 10, durationUnit: 'Min', courseId: 'c1', courseTitle: 'Course 1', courseYear: 2024, scenarioPdfUrl: null, isActive: true },
                { id: 'e2', title: 'E2', orderIndex: 2, durationValue: 20, durationUnit: 'Min', courseId: 'c1', courseTitle: 'Course 1', courseYear: 2024, scenarioPdfUrl: null, isActive: true },
            ],
            // e2 requires a quiz that was never passed, e1 has no requirements
            enablerQuizLinks: [{ enablerId: 'e2', quizId: 'q1' }],
            quizSubmissions: [],
            enablerCompletions: [{ enablerId: 'e1', completedAt: new Date() }],
            courseSkills: [{ skillId: 's1', name: 'Skill 1' }],
            traineeAchievedSkills: [{ skillId: 's1' }],
        });

        const GET = await importHandlerWithDb(db);
        const res = await GET(makeGet('http://localhost/api/trainee/dashboard?userId=t1'));

        expect(res.status).toBe(200);
        const body = await res.json();

        expect(body.modules).toHaveLength(1);
        expect(body.modules[0].title).toBe('Course 1');
        expect(body.modules[0].progress).toBe(50); // 1 of 2 enablers complete

        expect(body.nextItem).not.toBeNull();
        expect(body.nextItem.lessonTitle).toBe('E2');

        expect(body.skillRadar).toContainEqual({ skill: 'Skill 1', value: 100 });
    });
});
