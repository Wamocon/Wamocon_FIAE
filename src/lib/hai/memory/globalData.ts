/**
 * HAI memory: the counters for the shared proposals, read from the database.
 *
 * Only AGGREGATES leave the database: a count of different users per occupation
 * and key (or topic) with HAVING count >= k. No user id, no name, no entry text of
 * a person and no count below k is ever returned, so the admin who triggers the
 * calculation cannot learn anything about one person. Users who switched their
 * memory off do not count (no row counts as on).
 *
 * @module lib/hai/memory/globalData
 */

import { sql } from 'drizzle-orm';
import db from '@/db';
import {
  GLOBAL_MIN_SUPPORT_K,
  WEAKNESS_BELOW_SCORE,
  WEAKNESS_MIN_ATTEMPTS,
} from './config';
import type { PreferenceCounter, WeaknessCounter } from './repo';

type PrefRow = {
  training_catalog_id: string;
  proposal_key: string;
  support: number;
};

type WeakRow = {
  catalog_id: string;
  enabler_id: string;
  title: string;
  support: number;
};

/** Preferences confirmed by at least k different users (active, stated). */
export async function loadPreferenceCounters(
  k: number = GLOBAL_MIN_SUPPORT_K
): Promise<PreferenceCounter[]> {
  const rows = (await db.execute(sql`
    SELECT m.training_catalog_id AS training_catalog_id,
           m.proposal_key AS proposal_key,
           COUNT(DISTINCT m.user_id)::int AS support
    FROM hai_user_memories m
    LEFT JOIN hai_user_memory_settings s ON s.user_id = m.user_id
    WHERE m.status = 'active'
      AND m.source = 'stated'
      AND m.kind IN ('preference', 'learning_style')
      AND COALESCE(s.enabled, true) = true
    GROUP BY m.training_catalog_id, m.proposal_key
    HAVING COUNT(DISTINCT m.user_id) >= ${k}
  `)) as unknown as PrefRow[];
  return rows.map(row => ({
    catalogId: String(row.training_catalog_id),
    proposalKey: String(row.proposal_key),
    support: Number(row.support),
  }));
}

/** Topics in which at least k different trainees struggle in the quizzes. */
export async function loadWeaknessCounters(
  k: number = GLOBAL_MIN_SUPPORT_K
): Promise<WeaknessCounter[]> {
  const rows = (await db.execute(sql`
    SELECT t.catalog_id AS catalog_id,
           t.enabler_id AS enabler_id,
           t.title AS title,
           COUNT(*)::int AS support
    FROM (
      SELECT e.training_catalog_id AS catalog_id,
             e.id AS enabler_id,
             e.title AS title,
             qs.trainee_id AS trainee_id,
             COUNT(*) AS attempts,
             AVG(qs.score) AS avg_score
      FROM quiz_submissions qs
      JOIN enabler_quiz_links eql ON eql.quiz_id = qs.quiz_id
      JOIN enablers e ON e.id = eql.enabler_id
      LEFT JOIN hai_user_memory_settings s ON s.user_id = qs.trainee_id
      WHERE qs.score IS NOT NULL
        AND e.is_active = true
        AND COALESCE(s.enabled, true) = true
      GROUP BY e.training_catalog_id, e.id, e.title, qs.trainee_id
    ) t
    WHERE t.attempts >= ${WEAKNESS_MIN_ATTEMPTS}
      AND t.avg_score < ${WEAKNESS_BELOW_SCORE}
    GROUP BY t.catalog_id, t.enabler_id, t.title
    HAVING COUNT(*) >= ${k}
  `)) as unknown as WeakRow[];
  return rows.map(row => ({
    catalogId: String(row.catalog_id),
    enablerId: String(row.enabler_id),
    title: String(row.title ?? ''),
    support: Number(row.support),
  }));
}
