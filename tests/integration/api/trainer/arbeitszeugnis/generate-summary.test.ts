/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

import { fakeSession, mockSession } from '../../../../helpers/mockNext';

const mockChatWithFallback = jest.fn();

async function importHandler(
  session: ReturnType<typeof fakeSession> | null = fakeSession()
) {
  jest.resetModules();
  jest.doMock('@/lib/hai/providers', () => ({
    chatWithFallback: mockChatWithFallback,
  }));
  mockSession(session);
  const mod = await import('../../../../../src/app/api/trainer/arbeitszeugnis/generate-summary/route');
  return mod.POST as (req: Request) => Promise<Response>;
}

describe('API: /api/trainer/arbeitszeugnis/generate-summary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const request = () =>
    new Request('http://localhost/api/trainer/arbeitszeugnis/generate-summary', {
      method: 'POST',
      body: JSON.stringify({ traineeName: 'Max', manualOverallGrade: 2 }),
    });

  it('401 without a session', async () => {
    const POST = await importHandler(null);
    const res = await POST(request());
    expect(res.status).toBe(401);
    expect(mockChatWithFallback).not.toHaveBeenCalled();
  });

  it('403 for a trainee session', async () => {
    const POST = await importHandler(
      fakeSession({ role: 'TRAINEE', isTrainerLevel: false })
    );
    const res = await POST(request());
    expect(res.status).toBe(403);
    expect(mockChatWithFallback).not.toHaveBeenCalled();
  });

  it('should generate an AI overall assessment', async () => {
    mockChatWithFallback.mockResolvedValue({
      text: 'Ausgezeichnete Leistung, Note 2 — gut. Weiter so!',
      provider: 'openai-compatible',
      finishReason: 'stop',
    });

    const POST = await importHandler();
    const res = await POST(
      new Request('http://localhost/api/trainer/arbeitszeugnis/generate-summary', {
        method: 'POST',
        body: JSON.stringify({
          traineeName: 'Max Mustermann',
          gender: 'male',
          certificateType: 'FINAL',
          overallAverage: 2.1,
          manualOverallGrade: 2,
          components: [
            { title: 'Entwickeln', finalGrade: 2, averageGrade: 2, totalHours: 120 },
          ],
          softSkills: null,
          summaryContext: '',
          shorteningEligible: false,
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toBe('Ausgezeichnete Leistung, Note 2 — gut. Weiter so!');
    expect(body.provider).toBe('openai-compatible');

    expect(mockChatWithFallback).toHaveBeenCalledTimes(1);
    const [, , userPrompt, , options] = mockChatWithFallback.mock.calls[0];
    expect(userPrompt).toContain('Max Mustermann');
    expect(userPrompt).toContain('Gesamtnote: 2');
    expect(options.temperature).toBe(0.6);
  });

  it('should return 400 when overall grade is missing', async () => {
    const POST = await importHandler();
    const res = await POST(
      new Request('http://localhost/api/trainer/arbeitszeugnis/generate-summary', {
        method: 'POST',
        body: JSON.stringify({
          traineeName: 'Max Mustermann',
          gender: 'male',
          certificateType: 'FINAL',
          overallAverage: null,
          manualOverallGrade: null,
          components: [],
        }),
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('No overall grade');
  });

  it('should return 400 when traineeName is missing', async () => {
    const POST = await importHandler();
    const res = await POST(
      new Request('http://localhost/api/trainer/arbeitszeugnis/generate-summary', {
        method: 'POST',
        body: JSON.stringify({
          traineeName: '',
          gender: 'male',
          certificateType: 'FINAL',
          overallAverage: 2.1,
          manualOverallGrade: 2,
          components: [],
        }),
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Missing traineeName');
  });

  it('should return 500 when AI returns empty text', async () => {
    mockChatWithFallback.mockResolvedValue({
      text: '   ',
      provider: 'openai-compatible',
    });

    const POST = await importHandler();
    const res = await POST(
      new Request('http://localhost/api/trainer/arbeitszeugnis/generate-summary', {
        method: 'POST',
        body: JSON.stringify({
          traineeName: 'Max Mustermann',
          gender: 'male',
          certificateType: 'FINAL',
          overallAverage: 2.1,
          manualOverallGrade: 2,
          components: [],
        }),
      })
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('keinen Text generiert');
  });
});
