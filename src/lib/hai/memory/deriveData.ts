/**
 * HAI memory: the database side of the derivation (memoryDerive.ts).
 *
 * Reads the quiz attempts and the progress of ONE trainee in ONE occupation,
 * keyed by the user id of the session. Nothing is written. A failure returns
 * empty inputs (no proposal), never an error into the chat.
 *
 * @module lib/hai/memory/deriveData
 */

import { sql } from 'drizzle-orm';
import db from '@/db';
import { loadNextStepEntries } from '../navigation/data';
import type { ProgressStat, TopicStat } from './memoryDerive';

export interface DeriveInputs {
  topics: TopicStat[];
  progress: ProgressStat | null;
}

/** Graded quiz attempts of the trainee per topic (enabler) of the occupation. */
async function loadTopicStats(
  userId: string,
  catalogId: string
): Promise<TopicStat[]> {
  const rows = (await db.execute(sql`
    SELECT e.id AS enabler_id,
           e.title AS title,
           COUNT(*)::int AS attempts,
           AVG(qs.score)::float AS avg_score
    FROM quiz_submissions qs
    JOIN enabler_quiz_links eql ON eql.quiz_id = qs.quiz_id
    JOIN enablers e ON e.id = eql.enabler_id
    WHERE qs.trainee_id = ${userId}
      AND e.training_catalog_id = ${catalogId}
      AND e.is_active = true
      AND qs.score IS NOT NULL
    GROUP BY e.id, e.title
  `)) as unknown as Array<{
    enabler_id: string;
    title: string;
    attempts: number;
    avg_score: number;
  }>;
  return rows.map(row => ({
    enablerId: String(row.enabler_id),
    title: String(row.title ?? ''),
    attempts: Number(row.attempts),
    avgScore: Number(row.avg_score),
  }));
}

export async function loadDeriveInputs(
  userId: string,
  catalogId: string
): Promise<DeriveInputs> {
  const empty: DeriveInputs = { topics: [], progress: null };
  if (!userId || !catalogId) return empty;
  try {
    const [topics, entries] = await Promise.all([
      loadTopicStats(userId, catalogId),
      loadNextStepEntries(userId, [catalogId]),
    ]);
    const progress =
      entries.length > 0
        ? {
            completed: entries.filter(entry => entry.completed).length,
            total: entries.length,
          }
        : null;
    return { topics, progress };
  } catch (error) {
    console.warn(
      'HAI.ai memory: derivation inputs could not be loaded:',
      error instanceof Error ? error.message : 'unknown error'
    );
    return empty;
  }
}
