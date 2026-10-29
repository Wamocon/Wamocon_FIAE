/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  mergeSessionMetadata,
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

describe('mergeSessionMetadata (atomic, never a read and write back)', () => {
  const dialect = new PgDialect();
  const render = (patch: Record<string, unknown>) => {
    const q = dialect.sqlToQuery(mergeSessionMetadata(patch));
    return { text: q.sql.replace(/\s+/g, ' '), params: q.params };
  };

  it('merges the patch into the stored metadata in one statement', () => {
    const out = render({ trainerKnowledge: true });
    expect(out.text).toContain('COALESCE(');
    expect(out.text).toContain("'{}'::jsonb");
    expect(out.text).toContain('|| $1::jsonb');
    expect(JSON.parse(out.params[0] as string)).toEqual({
      trainerKnowledge: true,
    });
  });

  it('carries only the keys of the patch (the rest stays in the database)', () => {
    const out = render({ conversationSummary: 's', keyFacts: ['a'] });
    expect(JSON.parse(out.params[0] as string)).toEqual({
      conversationSummary: 's',
      keyFacts: ['a'],
    });
  });
});
