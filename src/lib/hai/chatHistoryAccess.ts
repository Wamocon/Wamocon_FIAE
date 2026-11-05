/**
 * Who gets chat history, summaries and memory back that were built with trainer
 * knowledge (text of the model solutions of the private bucket).
 *
 * The chats of the HAI belong to one person (hai_chat_sessions.user_id, every
 * query filters on it), so a trainer's chat never reaches a trainee as long as
 * the person stays the same. The one gap is a role change: a person who was a
 * trainer and is a trainee now still owns the old sessions. A session whose
 * answers used trainer solutions is therefore marked (metadata.trainerKnowledge),
 * and then:
 *
 *  - display (session list, search, single session): hidden unless the person
 *    is trainer level now
 *  - context for the model (previous messages, stored summary, memory of other
 *    sessions): used only when the person is trainer level AND the switch
 *    HAI_TRAINER_SOLUTIONS is on. With the switch off the model provider
 *    receives none of it again.
 *
 * The summaries are built locally from the questions of the person, never from
 * the answers, so they hold no solution text unless the trainer typed it.
 *
 * @module lib/hai/chatHistoryAccess
 */

import { sql, type SQL } from 'drizzle-orm';
import { haiChatSessions } from '@/db/migrations/schemas/schema';
import { isTrainerLevelRole } from '@/lib/auth/roles';
import {
  TRAINER_KNOWLEDGE_KEY,
  isTrainerSolutionsEnabled,
} from './trainerSolutions';

/** Whether a person may see old chats that hold trainer knowledge (the role of the database). */
export function mayReadTrainerKnowledgeHistory(
  role: string | null | undefined
): boolean {
  return isTrainerLevelRole(role);
}

/** Whether chats that hold trainer knowledge may be used as context for the model. */
export function mayUseTrainerKnowledgeInPrompt(
  role: string | null | undefined,
  env: Record<string, string | undefined> = process.env
): boolean {
  return isTrainerLevelRole(role) && isTrainerSolutionsEnabled(env);
}

/**
 * SQL condition on hai_chat_sessions that leaves out the sessions with trainer
 * knowledge, or undefined when the viewer may have them.
 */
export function sessionVisibilityCondition(
  mayHaveTrainerKnowledge: boolean
): SQL | undefined {
  if (mayHaveTrainerKnowledge) return undefined;
  return sql`COALESCE(${haiChatSessions.metadata}->>${sql.raw(`'${TRAINER_KNOWLEDGE_KEY}'`)}, '') <> 'true'`;
}

/**
 * New value of hai_chat_sessions.metadata: the stored object merged with
 * `patch` in ONE statement (jsonb concatenation). Two overlapping requests of a
 * session (a summary write and the marker of trainer knowledge) can not
 * overwrite each other's keys, as a read and write back of the whole object
 * could. Only the keys of the patch travel.
 */
export function mergeSessionMetadata(patch: Record<string, unknown>): SQL {
  return sql`COALESCE(${haiChatSessions.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`;
}

/** The patch that marks a session as one that holds trainer knowledge. */
export const TRAINER_KNOWLEDGE_PATCH: Record<string, unknown> = {
  [TRAINER_KNOWLEDGE_KEY]: true,
};
