/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import { sokratesOnlyChain } from '@/lib/hai/providers/sokratesOnly';
import {
  TRAINER_SOLUTIONS_CHAT_ENV,
  trainerSolutionsChatSokratesOnly,
} from '@/lib/hai/trainerSolutions';

// HAI_TRAINER_SOLUTIONS_CHAT=sokrates: a turn that holds trainer knowledge is
// answered by Sokrates only. The default leaves the chat as it is.

describe('trainerSolutionsChatSokratesOnly', () => {
  it('is named HAI_TRAINER_SOLUTIONS_CHAT', () => {
    expect(TRAINER_SOLUTIONS_CHAT_ENV).toBe('HAI_TRAINER_SOLUTIONS_CHAT');
  });

  it('is off by default and for every other value', () => {
    expect(trainerSolutionsChatSokratesOnly({})).toBe(false);
    for (const value of ['', 'any', 'gemini', 'on', 'true', '1', 'sokrates!']) {
      expect(
        trainerSolutionsChatSokratesOnly({ HAI_TRAINER_SOLUTIONS_CHAT: value })
      ).toBe(false);
    }
  });

  it('is on for "sokrates", blanks and case ignored', () => {
    for (const value of ['sokrates', ' Sokrates ', 'SOKRATES']) {
      expect(
        trainerSolutionsChatSokratesOnly({ HAI_TRAINER_SOLUTIONS_CHAT: value })
      ).toBe(true);
    }
  });
});

describe('sokratesOnlyChain', () => {
  it('drops the primary provider and keeps Sokrates and the state', () => {
    const chain = {
      primary: { name: 'gemini' },
      fallback: { name: 'sokrates' },
      fallbackState: 'sokrates',
    };
    const only = sokratesOnlyChain(chain);
    expect(only).toEqual({
      primary: null,
      fallback: { name: 'sokrates' },
      fallbackState: 'sokrates',
    });
    // the original chain is not changed
    expect(chain.primary).toEqual({ name: 'gemini' });
  });

  it('leaves no provider when Sokrates is not there (no switch to another one)', () => {
    expect(
      sokratesOnlyChain({
        primary: { name: 'gemini' },
        fallback: null,
        fallbackState: 'no_key',
      })
    ).toMatchObject({ primary: null, fallback: null });
  });
});
