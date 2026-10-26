/**
 * Server side check of the enabler and course id that the chat client sends
 * as its current context.
 *
 * The ids end up in the prompt (titles), in the search (sourceIds, course
 * filter) and in the stored session, so a client must not be able to name the
 * enabler or course of another occupation. Both ids are checked against the
 * catalog scope of the person (derived from the session, never from the
 * request): an id that is not a uuid, does not exist or lies outside the scope
 * is dropped (the chat then runs without that context). Fail closed: if the
 * scope cannot be determined, no id is kept.
 *
 * @module lib/hai/chatContext
 */

import { eq } from 'drizzle-orm';
import db from '@/db';
import { courses, enablers } from '@/db/migrations/schemas/schema';
import {
  getCatalogScopeForUserId,
  isCatalogAllowed,
} from '@/lib/catalog/scope';

export interface ChatContextIds {
  enablerId?: string;
  courseId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asUuid(value: unknown): string | undefined {
  return typeof value === 'string' && UUID.test(value) ? value : undefined;
}

export async function verifyChatContextIds(
  userId: string,
  requested: { enablerId?: unknown; courseId?: unknown } | null | undefined
): Promise<ChatContextIds> {
  const enablerId = asUuid(requested?.enablerId);
  const courseId = asUuid(requested?.courseId);
  if (!enablerId && !courseId) return {};

  try {
    const scope = await getCatalogScopeForUserId(userId);
    if (!scope) return {};

    const verified: ChatContextIds = {};

    if (enablerId) {
      const [row] = await db
        .select({ trainingCatalogId: enablers.trainingCatalogId })
        .from(enablers)
        .where(eq(enablers.id, enablerId))
        .limit(1);
      if (row && isCatalogAllowed(scope, row.trainingCatalogId)) {
        verified.enablerId = enablerId;
      }
    }

    if (courseId) {
      const [row] = await db
        .select({ trainingCatalogId: courses.trainingCatalogId })
        .from(courses)
        .where(eq(courses.id, courseId))
        .limit(1);
      if (row && isCatalogAllowed(scope, row.trainingCatalogId)) {
        verified.courseId = courseId;
      }
    }

    return verified;
  } catch (error) {
    console.error(
      'HAI.ai: chat context check failed (fail closed, context ignored):',
      error
    );
    return {};
  }
}
