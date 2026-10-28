import { sql, type SQL } from 'drizzle-orm';
import { TRAINING_CATALOG_IDS } from '@/db/migrations/schemas/schema';

type SqlExecutor = {
  execute: (query: SQL) => Promise<unknown>;
};

const profileReferenceColumns = [
  ['profiles', 'assigned_trainer_id'],
  ['courses', 'created_by_id'],
  ['content_documents', 'uploaded_by_id'],
  ['quizzes', 'created_by_id'],
  ['quiz_assignments', 'assigned_by_id'],
  ['quiz_submissions', 'reviewed_by_id'],
  ['quiz_members', 'added_by_id'],
  ['use_case_submissions', 'reviewed_by_id'],
  ['activity_log', 'user_id'],
  ['notifications', 'user_id'],
  ['notifications', 'actor_id'],
  ['enabler_submissions', 'reviewed_by_id'],
  ['progress', 'user_id'],
  ['hai_chat_sessions', 'user_id'],
  ['ausbildung_blocks', 'created_by_trainer_id'],
  ['ausbildung_blocks', 'approved_by_trainer_id'],
  ['activity_reports', 'reviewer_id'],
  ['activity_report_use_case_entries', 'grade_approved_by'],
  ['activity_report_use_case_entries', 'release_grade_by'],
  ['weekly_evaluations', 'trainer_id'],
  ['weekly_evaluations', 'released_by'],
  ['annual_performance_summaries', 'discussion_conducted_by'],
  ['work_certificates', 'approved_by_trainer_id'],
  ['certificate_text_templates', 'created_by'],
  ['grade_edit_history', 'changed_by'],
  ['content_upload_runs', 'created_by_id'],
  ['content_upload_decisions', 'decided_by_id'],
  ['content_upload_applies', 'started_by_id'],
] as const;

const traineeOwnedColumns = [
  ['course_members', 'user_id'],
  ['quiz_assignments', 'trainee_id'],
  ['quiz_submissions', 'trainee_id'],
  ['use_case_submissions', 'trainee_id'],
  ['knowledge_notes', 'trainee_id'],
  ['acceptance_protocols', 'trainee_id'],
  ['trainee_achieved_skills', 'trainee_id'],
  ['enabler_completions', 'trainee_id'],
  ['trainee_enabler_overrides', 'trainee_id'],
  ['trainee_use_case_overrides', 'trainee_id'],
  ['enabler_submissions', 'trainee_id'],
  ['ausbildung_blocks', 'trainee_id'],
  ['school_exams', 'trainee_id'],
  ['school_exam_results', 'trainee_id'],
  ['activity_reports', 'trainee_id'],
  ['weekly_evaluations', 'trainee_id'],
  ['annual_performance_summaries', 'trainee_id'],
  ['work_certificates', 'trainee_id'],
] as const;

const trainerOwnedColumns = [
  ['quiz_members', 'trainer_id'],
  ['acceptance_protocols', 'trainer_id'],
  ['weekly_evaluations', 'trainer_id'],
] as const;

function ident(value: string) {
  return sql.raw(`"${value}"`);
}

async function updateReference(
  executor: SqlExecutor,
  table: string,
  column: string,
  fromProfileId: string,
  toProfileId: string
) {
  await executor.execute(sql`
    UPDATE ${ident(table)}
    SET ${ident(column)} = ${toProfileId}
    WHERE ${ident(column)} = ${fromProfileId}
  `);
}

async function deleteConflictingRows(
  executor: SqlExecutor,
  fromProfileId: string,
  toProfileId: string
) {
  await executor.execute(sql`
    DELETE FROM "course_members" old_row
    WHERE old_row."user_id" = ${fromProfileId}
      AND EXISTS (
        SELECT 1 FROM "course_members" keep_row
        WHERE keep_row."user_id" = ${toProfileId}
          AND keep_row."course_id" = old_row."course_id"
      )
  `);

  await executor.execute(sql`
    DELETE FROM "quiz_assignments" old_row
    WHERE old_row."trainee_id" = ${fromProfileId}
      AND EXISTS (
        SELECT 1 FROM "quiz_assignments" keep_row
        WHERE keep_row."trainee_id" = ${toProfileId}
          AND keep_row."quiz_id" = old_row."quiz_id"
      )
  `);

  await executor.execute(sql`
    DELETE FROM "quiz_members" old_row
    WHERE old_row."trainer_id" = ${fromProfileId}
      AND EXISTS (
        SELECT 1 FROM "quiz_members" keep_row
        WHERE keep_row."trainer_id" = ${toProfileId}
          AND keep_row."quiz_id" = old_row."quiz_id"
      )
  `);

  await executor.execute(sql`
    DELETE FROM "trainee_achieved_skills" old_row
    WHERE old_row."trainee_id" = ${fromProfileId}
      AND EXISTS (
        SELECT 1 FROM "trainee_achieved_skills" keep_row
        WHERE keep_row."trainee_id" = ${toProfileId}
          AND keep_row."skill_id" = old_row."skill_id"
      )
  `);

  await executor.execute(sql`
    DELETE FROM "enabler_completions" old_row
    WHERE old_row."trainee_id" = ${fromProfileId}
      AND EXISTS (
        SELECT 1 FROM "enabler_completions" keep_row
        WHERE keep_row."trainee_id" = ${toProfileId}
          AND keep_row."enabler_id" = old_row."enabler_id"
      )
  `);

  await executor.execute(sql`
    DELETE FROM "trainee_enabler_overrides" old_row
    WHERE old_row."trainee_id" = ${fromProfileId}
      AND EXISTS (
        SELECT 1 FROM "trainee_enabler_overrides" keep_row
        WHERE keep_row."trainee_id" = ${toProfileId}
          AND keep_row."enabler_id" = old_row."enabler_id"
      )
  `);

  await executor.execute(sql`
    DELETE FROM "trainee_use_case_overrides" old_row
    WHERE old_row."trainee_id" = ${fromProfileId}
      AND EXISTS (
        SELECT 1 FROM "trainee_use_case_overrides" keep_row
        WHERE keep_row."trainee_id" = ${toProfileId}
          AND keep_row."use_case_id" = old_row."use_case_id"
      )
  `);

  await executor.execute(sql`
    DELETE FROM "weekly_evaluations" old_row
    WHERE old_row."trainee_id" = ${fromProfileId}
      AND EXISTS (
        SELECT 1 FROM "weekly_evaluations" keep_row
        WHERE keep_row."trainee_id" = ${toProfileId}
          AND keep_row."week_number" = old_row."week_number"
          AND keep_row."year" = old_row."year"
      )
  `);

  await executor.execute(sql`
    DELETE FROM "annual_performance_summaries" old_row
    WHERE old_row."trainee_id" = ${fromProfileId}
      AND EXISTS (
        SELECT 1 FROM "annual_performance_summaries" keep_row
        WHERE keep_row."trainee_id" = ${toProfileId}
          AND keep_row."ausbildungsjahr" = old_row."ausbildungsjahr"
          AND keep_row."year" = old_row."year"
      )
  `);
}

/**
 * Hands the enrollments (the occupations) of the trainee to the new profile.
 *
 * The elective choices hang on the enrollment row (trainee_elective_choices
 * points at the enrollment id), so moving the row moves them too. Only
 * trainee_id changes, the id and the catalog stay.
 *
 * A trainee can be enrolled in several trainings, one enrollment per catalog
 * (unique on trainee_id plus training_catalog_id). The old profile (the
 * pre-created one) hands over all its enrollments; where the new profile has
 * one in the same catalog already, the row of the old profile wins and replaces
 * it as a whole, with its start date, duration and elective choices (an
 * administrator set it for this person, like the role, the organization, the
 * start date and the duration that the merge takes over from the pre-created
 * profile as well).
 *
 * FIAE is the default (a trainee without a row works in FIAE), so it is the
 * weaker statement:
 *  - A default FIAE row of the new profile gives way as soon as the old profile
 *    has an enrollment in another catalog.
 *  - An old profile that has nothing but FIAE hands it over only if the new
 *    profile has no enrollment in another catalog. Such a row of the new
 *    profile is a deliberate choice, it is kept and the old FIAE row goes with
 *    the old profile.
 * The rows that lose are deleted (their elective choices follow by cascade).
 *
 * Never part of the generic column lists below: a plain UPDATE would collide
 * with the unique constraint as soon as both profiles have a row in the same
 * catalog.
 */
async function moveEnrollment(
  executor: SqlExecutor,
  fromProfileId: string,
  toProfileId: string
) {
  // Does the old profile hand its enrollments over at all? Always, unless it
  // has nothing but the default FIAE and the new profile has a deliberate
  // other occupation. Without a decision for the whole trainee a FIAE row
  // alone could be moved next to another occupation it was never meant to join.
  const handsOver = sql`(
        EXISTS (
          SELECT 1 FROM "trainee_enrollments" old_other
          WHERE old_other."trainee_id" = ${fromProfileId}
            AND old_other."training_catalog_id" <> ${TRAINING_CATALOG_IDS.FIAE}
        )
        OR NOT EXISTS (
          SELECT 1 FROM "trainee_enrollments" new_other
          WHERE new_other."trainee_id" = ${toProfileId}
            AND new_other."training_catalog_id" <> ${TRAINING_CATALOG_IDS.FIAE}
        )
      )`;

  await executor.execute(sql`
    DELETE FROM "trainee_enrollments" new_row
    WHERE new_row."trainee_id" = ${toProfileId}
      AND ${handsOver}
      AND (
        EXISTS (
          SELECT 1 FROM "trainee_enrollments" old_row
          WHERE old_row."trainee_id" = ${fromProfileId}
            AND old_row."training_catalog_id" = new_row."training_catalog_id"
        )
        OR (
          new_row."training_catalog_id" = ${TRAINING_CATALOG_IDS.FIAE}
          AND EXISTS (
            SELECT 1 FROM "trainee_enrollments" old_other
            WHERE old_other."trainee_id" = ${fromProfileId}
              AND old_other."training_catalog_id" <> ${TRAINING_CATALOG_IDS.FIAE}
          )
        )
      )
  `);

  await executor.execute(sql`
    UPDATE "trainee_enrollments"
    SET "trainee_id" = ${toProfileId}
    WHERE "trainee_id" = ${fromProfileId}
      AND ${handsOver}
      AND NOT EXISTS (
        SELECT 1 FROM "trainee_enrollments" keep_row
        WHERE keep_row."trainee_id" = ${toProfileId}
          AND keep_row."training_catalog_id" = "trainee_enrollments"."training_catalog_id"
      )
  `);
}

export async function mergeProfileReferences(
  executor: SqlExecutor,
  fromProfileId: string,
  toProfileId: string
) {
  if (!fromProfileId || !toProfileId || fromProfileId === toProfileId) return;

  await deleteConflictingRows(executor, fromProfileId, toProfileId);
  await moveEnrollment(executor, fromProfileId, toProfileId);

  for (const [table, column] of [
    ...profileReferenceColumns,
    ...traineeOwnedColumns,
    ...trainerOwnedColumns,
  ]) {
    await updateReference(executor, table, column, fromProfileId, toProfileId);
  }
}
