/**
 * @jest-environment node
 */

// Package H4: the pipeline never executes a write. A detected action becomes a
// proposal (pendingAction) for the confirmation card, in the blocking and in
// the streaming path, even with the highest confidence. Executing is only
// possible through the confirmed call of /api/hai/action.

const mockDetect = jest.fn();
const mockExecute = jest.fn();
const mockChat = jest.fn();

jest.mock('@/lib/hai/actions', () => ({
  detectActionIntent: (...args: unknown[]) => mockDetect(...args),
  executeAction: (...args: unknown[]) => mockExecute(...args),
}));
jest.mock('@/lib/hai/providers', () => ({
  chatWithFallback: (...args: unknown[]) => mockChat(...args),
  getChatProvider: () => ({ isInitialized: () => true }),
  getEmbeddingProvider: () => ({ isInitialized: () => false }),
}));
jest.mock('@/lib/hai/retrievalAccess', () => ({
  resolveRetrievalAccess: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/hai/vectorSearch', () => ({ searchWithContext: jest.fn() }));
jest.mock('@/lib/hai/pageIndexService', () => ({
  fetchPageIndexContext: jest.fn(),
}));
jest.mock('@/lib/hai/dataContext', () => ({
  fetchDataContext: jest.fn().mockResolvedValue(null),
}));

import {
  processMessage,
  processMessageStream,
  type PipelineContext,
} from '@/lib/hai/ragPipeline';

const ENABLER = '20000000-0000-4000-8000-000000000001';
const USER = '10000000-0000-4000-8000-000000000001';

function ctx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    userId: USER,
    userRole: 'TRAINEE',
    currentEnablerId: ENABLER,
    enablerTitle: 'SQL Grundlagen',
    ...overrides,
  };
}

function intent(type: string, confidence: number, parameters = {}) {
  return { type, confidence, parameters, requiresConfirmation: false };
}

describe('HAI pipeline: actions are proposals, never writes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockExecute.mockResolvedValue({ success: true, message: 'executed' });
  });

  it.each([0.7, 0.85, 1.0])(
    'blocking path: complete_enabler at confidence %s is only proposed',
    async confidence => {
      mockDetect.mockReturnValue(
        intent('complete_enabler', confidence, { enablerId: ENABLER })
      );
      const result = await processMessage('Enabler fertig', ctx());

      expect(mockExecute).not.toHaveBeenCalled();
      expect(mockChat).not.toHaveBeenCalled();
      expect(result.intent).toBe('action');
      expect(result.actionResult).toBeUndefined();
      expect(result.pendingAction).toEqual({
        type: 'complete_enabler',
        parameters: { enablerId: ENABLER },
        description: 'Den aktuellen Enabler als abgeschlossen markieren',
      });
      // The title of the client supplied context is never echoed (the enabler
      // id of the request is not checked before the confirmed call)
      expect(result.response).not.toContain('SQL Grundlagen');
      expect(JSON.stringify(result.pendingAction)).not.toContain('SQL Grundlagen');
    }
  );

  it('streaming path: the proposal is streamed, nothing is executed', async () => {
    mockDetect.mockReturnValue(
      intent('complete_enabler', 1.0, { enablerId: ENABLER })
    );
    const chunks: string[] = [];
    const result = await processMessageStream('Enabler fertig', ctx(), c =>
      chunks.push(c)
    );

    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
    expect(result.pendingAction?.type).toBe('complete_enabler');
    expect(chunks.join('')).toBe(result.response);
  });

  it.each([
    ['create_activity_report', { weekNumber: 12, year: 2026 }],
    ['mark_notification_read', { markAll: true }],
  ])('%s (formerly without confirmation) is only proposed', async (type, p) => {
    mockDetect.mockReturnValue(intent(type, 1.0, p));
    const blocking = await processMessage('x', ctx());
    const streaming = await processMessageStream('x', ctx(), () => undefined);

    expect(mockExecute).not.toHaveBeenCalled();
    expect(blocking.pendingAction?.type).toBe(type);
    expect(streaming.pendingAction?.type).toBe(type);
  });

  it('a trainer action is proposed for a trainer, with clean parameters', async () => {
    const SUB = '30000000-0000-4000-8000-000000000001';
    mockDetect.mockReturnValue(
      intent('approve_submission', 0.85, {
        submissionId: SUB,
        injected: 'DROP TABLE',
      })
    );
    const result = await processMessage('x', ctx({ userRole: 'TRAINER' }));

    expect(mockExecute).not.toHaveBeenCalled();
    expect(result.pendingAction?.parameters).toEqual({ submissionId: SUB });
  });

  it('refuses a trainee action for a trainer without a proposal', async () => {
    mockDetect.mockReturnValue(
      intent('complete_enabler', 0.9, { enablerId: ENABLER })
    );
    const result = await processMessage('x', ctx({ userRole: 'TRAINER' }));

    expect(mockExecute).not.toHaveBeenCalled();
    expect(result.pendingAction).toBeUndefined();
    expect(result.actionResult).toEqual({
      success: false,
      actionType: 'complete_enabler',
    });
  });

  it('explains what is missing instead of proposing an incomplete action', async () => {
    mockDetect.mockReturnValue(
      intent('complete_enabler', 0.8, { enablerId: undefined })
    );
    const result = await processMessage('Enabler fertig', ctx());

    expect(mockExecute).not.toHaveBeenCalled();
    expect(result.pendingAction).toBeUndefined();
    expect(result.response).toContain('Enabler');
  });

  it('a foreign value in the context is not proposed', async () => {
    mockDetect.mockReturnValue(
      intent('complete_enabler', 0.8, { enablerId: "1'; DROP TABLE x;--" })
    );
    const result = await processMessage('Enabler fertig', ctx());

    expect(mockExecute).not.toHaveBeenCalled();
    expect(result.pendingAction).toBeUndefined();
  });

  it('a low confidence intent is no action at all', async () => {
    mockDetect.mockReturnValue(
      intent('complete_enabler', 0.5, { enablerId: ENABLER })
    );
    mockChat.mockResolvedValue({ text: 'Normale Antwort', provider: 't' });
    const result = await processMessage('Erkläre Enabler', ctx());

    expect(mockExecute).not.toHaveBeenCalled();
    expect(result.pendingAction).toBeUndefined();
    expect(result.intent).not.toBe('action');
  });

  it('a reading action is not executed by the pipeline either', async () => {
    mockDetect.mockReturnValue(intent('show_progress', 1.0));
    mockChat.mockResolvedValue({ text: 'Antwort', provider: 't' });
    const result = await processMessage('Zeig Fortschritt', ctx());

    expect(mockExecute).not.toHaveBeenCalled();
    expect(result.pendingAction).toBeUndefined();
  });
});
