/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

function makePost(url: string, headers: any = {}) {
    return {
        url,
        headers: { get: (k: string) => headers[k] },
        method: 'POST'
    } as any;
}

// Mock modules BEFORE import
jest.mock('@supabase/supabase-js', () => ({
    createClient: jest.fn(),
}));

async function importHandlerWithDb(mockDb: any, mockSupa: any) {
    jest.resetModules();
    jest.doMock('@/db', () => ({ __esModule: true, default: mockDb }));
    const supa = await import('@supabase/supabase-js');
    (supa.createClient as jest.Mock).mockReturnValue(mockSupa);

    const mod = await import('@/app/api/auth/sync-profile/route');
    return mod.POST as (req: any) => Promise<Response>;
}

describe('API: Auth Sync Profile', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env.SUPABASE_URL = 'http://test';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'key';
    });

    it('401 if missing auth header', async () => {
        const mockDb = {};
        const mockSupa = {};
        const POST = await importHandlerWithDb(mockDb, mockSupa);
        const res = await POST(makePost('http://localhost/api/auth/sync-profile'));
        expect(res.status).toBe(401);
    });

    it('200 Syncs TRAINER profile', async () => {
        const mockUser = { id: 'u1', email: 'trainer@example.com', user_metadata: { role: 'TRAINER' } };
        const mockSupa = {
            auth: {
                getUser: jest.fn().mockResolvedValue({ data: { user: mockUser }, error: null })
            }
        };

        // DB Mock Sequence:
        // 1. insert(profiles) -> values -> onConflictDoNothing
        const mockDb = {
            insert: jest.fn().mockReturnValue({
                values: jest.fn().mockReturnValue({
                    onConflictDoNothing: jest.fn().mockResolvedValue({})
                })
            })
        };

        const POST = await importHandlerWithDb(mockDb, mockSupa);
        const res = await POST(makePost('http://localhost/api/auth/sync-profile', { authorization: 'Bearer token' }));
        expect(res.status).toBe(200);
        expect(mockDb.insert).toHaveBeenCalled();
    });

    it('200 Syncs TRAINEE profile with default trainer assignment', async () => {
        const mockUser = { id: 'u2', email: 'trainee@example.com' }; // No role -> Trainee
        const mockSupa = {
            auth: {
                getUser: jest.fn().mockResolvedValue({ data: { user: mockUser }, error: null })
            }
        };

        // Logic: Role=TRAINEE. No ENV vars for default trainer.
        // Queries:
        // 1. select(profiles) where role=TRAINER limit 1 -> returns [{id: 'tr1'}]
        // 2. insert(profiles) ... onConflictDoNothing
        // 3. update(profiles).set({ assignedTrainerId: 'tr1' }).where(...)

        const chain = {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([{ id: 'tr1' }]) // For trainer assignment query
        };

        const mockDb = {
            select: jest.fn().mockReturnValue(chain),
            insert: jest.fn().mockReturnValue({
                values: jest.fn().mockReturnValue({
                    onConflictDoNothing: jest.fn().mockResolvedValue({})
                })
            }),
            update: jest.fn().mockReturnValue({
                set: jest.fn().mockReturnValue({
                    where: jest.fn().mockResolvedValue({})
                })
            })
        };

        const POST = await importHandlerWithDb(mockDb, mockSupa);
        const res = await POST(makePost('http://localhost/api/auth/sync-profile', { authorization: 'Bearer token' }));
        expect(res.status).toBe(200);

        // Verify assignment details
        expect(mockDb.update).toHaveBeenCalled();
        const setCall = (mockDb.update() as any).set.mock.calls[0][0];
        expect(setCall.assignedTrainerId).toBe('tr1');
    });
});
