/**
 * SQL condition on content_documents (alias cd) for the caller, shared by the
 * PageIndex (pageIndexService.ts) and the file questions (documentQuery.ts), so
 * both apply one rule: trainees get neither TRAINER_SOLUTION nor TRAINER_ONLY
 * documents, everyone gets only documents of the own organization or of the
 * platform (organization_id NULL).
 *
 * Kept free of server imports (only drizzle's sql builder) so the pure parts of
 * the HAI can import it without the database.
 *
 * @module lib/hai/documentAccessSql
 */

import { sql, type SQL } from 'drizzle-orm';
import { isPageUuid } from './pageContext/shared';

export interface DocumentAccessOptions {
  /** Only 'trainer' gets solution and trainer-only documents. */
  audience: 'trainee' | 'trainer';
  /** Own organization and platform documents (NULL) only. */
  organizationId?: string | null;
}

export function documentAccessCondition(options: DocumentAccessOptions): SQL {
  const parts: SQL[] = [];
  if (options.audience !== 'trainer') {
    parts.push(sql`cd.document_type IS DISTINCT FROM 'TRAINER_SOLUTION'`);
    parts.push(sql`cd.visibility IS DISTINCT FROM 'TRAINER_ONLY'`);
  }
  parts.push(
    isPageUuid(options.organizationId)
      ? sql`(cd.organization_id IS NULL OR cd.organization_id = ${options.organizationId}::uuid)`
      : sql`cd.organization_id IS NULL`
  );
  return sql.join(parts, sql` AND `);
}
