/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  markTrainerKnowledge,
  mayReadTrainerKnowledgeHistory,
  mayUseTrainerKnowledgeInPrompt,
  sessionVisibilityCondition,
} from '@/lib/hai/chatHistoryAccess';

// Chat history, summary and memory (cross-session memory) of the HAI: what was
// answered with a model solution of the private bucket is trainer knowledge.
// It stays with trainer level roles; a person who is no longer (or never was)
// trainer level gets neither the session nor its summary nor its messages back.

describe('mayReadTrainerKnowledgeHistory (display of old chats)', () => {
  it.each(['TRAINER', 'TEMP_ADMIN', 'ADMIN', 'SUPER_ADMIN', 'trainer'])(
    'is true for %s',
    role => {
      expect(mayReadTrainerKnowledgeHistory(role)).toBe(true);
    }
  );

  it.each(['TRAINEE', '', null, undefined, 'UNKNOWN', 'trainee '])(
    'is false for %p',
    role => {
      expect(mayReadTrainerKnowledgeHistory(role as never)).toBe(false);
    }
  );
});

describe('mayUseTrainerKnowledgeInPrompt (context for the model)', () => {
  const on = { HAI_TRAINER_SOLUTIONS: 'on' };

  it('needs a trainer level role AND the switch', () => {
    expect(mayUseTrainerKnowledgeInPrompt('TRAINER', on)).toBe(true);
    expect(mayUseTrainerKnowledgeInPrompt('ADMIN', on)).toBe(true);
    expect(mayUseTrainerKnowledgeInPrompt('TRAINER', {})).toBe(false);
    expect(
      mayUseTrainerKnowledgeInPrompt('TRAINER', {
        HAI_TRAINER_SOLUTIONS: 'true',
      })
    ).toBe(false);
  });

  it('is never true for a trainee, with the switch on', () => {
    for (const role of ['TRAINEE', null, undefined, '', 'UNKNOWN']) {
      expect(mayUseTrainerKnowledgeInPrompt(role as never, on)).toBe(false);
    }
  });
});

describe('sessionVisibilityCondition', () => {
  const dialect = new PgDialect();
  const text = (condition: unknown) =>
    dialect.sqlToQuery(condition as never).sql.replace(/\s+/g, ' ');

  it('adds no condition for a trainer level role (its own chats are all there)', () => {
    expect(sessionVisibilityCondition(true)).toBeUndefined();
  });

  it('hides the sessions with trainer knowledge from everyone else', () => {
    const condition = sessionVisibilityCondition(false);
    expect(condition).toBeDefined();
    const rendered = text(condition);
    expect(rendered).toContain('metadata');
    expect(rendered).toContain("'trainerKnowledge'");
    expect(rendered).toContain("<> 'true'");
  });
});

describe('markTrainerKnowledge', () => {
  it('adds the marker and keeps the rest of the metadata', () => {
    expect(markTrainerKnowledge({ conversationSummary: 's', a: 1 })).toEqual({
      conversationSummary: 's',
      a: 1,
      trainerKnowledge: true,
    });
  });

  it('starts from an empty object for missing or odd metadata', () => {
    for (const metadata of [null, undefined, 'x', 5, []]) {
      expect(markTrainerKnowledge(metadata)).toEqual({
        trainerKnowledge: true,
      });
    }
  });
});
