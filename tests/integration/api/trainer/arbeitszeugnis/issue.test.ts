/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockDb = {
  select: jest.fn(),
  insert: jest.fn(),
};

const mockGenerateCertificateText = jest.fn().mockReturnValue('Generated certificate text');

async function importHandler() {
  jest.resetModules();
  jest.doMock('@/db', () => ({ __esModule: true, default: mockDb }));
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
