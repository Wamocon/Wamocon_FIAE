/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

import {
  fakeSession,
  mockSession,
  mockTraineeAccess,
} from '../../../../helpers/mockNext';

const mockDb = {
  select: jest.fn(),
  insert: jest.fn(),
};

const mockGenerateCertificateText = jest.fn().mockReturnValue('Generated certificate text');

async function importHandler(
  session: ReturnType<typeof fakeSession> | null = fakeSession(),
  access: 'ok' | 'forbidden' | 'missing' = 'ok'
) {
  jest.resetModules();
  jest.doMock('@/db', () => ({ __esModule: true, default: mockDb }));
  mockSession(session);
  mockTraineeAccess(access);
  jest.doMock('@/lib/arbeitszeugnis/textGenerator', () => ({
    generateCertificateText: mockGenerateCertificateText,
  }));
  const mod = await import('../../../../../src/app/api/trainer/arbeitszeugnis/issue/[traineeId]/route');
  return mod.POST as (req: Request, ctx: { params: Promise<{ traineeId: string }> }) => Promise<Response>;
}

describe('API: POST /api/trainer/arbeitszeugnis/issue/[traineeId]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const issueRequest = () =>
    new Request('http://localhost/api/trainer/arbeitszeugnis/issue/trainee-123', {
      method: 'POST',
      body: JSON.stringify({
        ausbildungsjahr: 1,
        certificateType: 'FINAL',
        overallAssessment: 'Gut gemacht.',
        manualOverallGrade: 2,
        // A client-sent trainer id must never be used
        trainerId: 'someone-else',
      }),
    });
  const ctx = { params: Promise.resolve({ traineeId: 'trainee-123' }) };

  it('401 without a session', async () => {
    const POST = await importHandler(null);
    const res = await POST(issueRequest(), ctx);
    expect(res.status).toBe(401);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('403 for a trainee session', async () => {
    const POST = await importHandler(
      fakeSession({ role: 'TRAINEE', isTrainerLevel: false })
    );
    const res = await POST(issueRequest(), ctx);
    expect(res.status).toBe(403);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('403 when the trainee belongs to another organization', async () => {
    const POST = await importHandler(fakeSession(), 'forbidden');
    const res = await POST(issueRequest(), ctx);
    expect(res.status).toBe(403);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return 400 when overallAssessment is missing', async () => {
    const POST = await importHandler();
    const res = await POST(
      new Request('http://localhost/api/trainer/arbeitszeugnis/issue/trainee-123', {
        method: 'POST',
        body: JSON.stringify({
          ausbildungsjahr: 1,
          certificateType: 'FINAL',
          customSummary: '',
          overallAssessment: '',
          manualOverallGrade: 2,
          gender: 'male',
        }),
      }),
      { params: Promise.resolve({ traineeId: 'trainee-123' }) }
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Gesamturteil fehlt');
  });

  it('should return 400 when manualOverallGrade is invalid', async () => {
    const POST = await importHandler();
    const res = await POST(
      new Request('http://localhost/api/trainer/arbeitszeugnis/issue/trainee-123', {
        method: 'POST',
        body: JSON.stringify({
          ausbildungsjahr: 1,
          certificateType: 'FINAL',
          customSummary: '',
          overallAssessment: 'Gut gemacht.',
          manualOverallGrade: 7,
          gender: 'male',
        }),
      }),
      { params: Promise.resolve({ traineeId: 'trainee-123' }) }
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Gesamtnote');
  });

  it('should return 404 when trainee is not found', async () => {
    mockDb.select.mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([]),
        }),
      }),
    });

    const POST = await importHandler();
    const res = await POST(
      new Request('http://localhost/api/trainer/arbeitszeugnis/issue/unknown-trainee', {
        method: 'POST',
        body: JSON.stringify({
          ausbildungsjahr: 1,
          certificateType: 'FINAL',
          customSummary: '',
          overallAssessment: 'Gut gemacht.',
          manualOverallGrade: 2,
          gender: 'male',
        }),
      }),
      { params: Promise.resolve({ traineeId: 'unknown-trainee' }) }
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('Trainee not found');
  });
});
