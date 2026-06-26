import { sql, type SQL } from 'drizzle-orm';

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

export async function mergeProfileReferences(
  executor: SqlExecutor,
  fromProfileId: string,
  toProfileId: string
) {
  if (!fromProfileId || !toProfileId || fromProfileId === toProfileId) return;

  await deleteConflictingRows(executor, fromProfileId, toProfileId);

  for (const [table, column] of [
    ...profileReferenceColumns,
    ...traineeOwnedColumns,
    ...trainerOwnedColumns,
  ]) {
    await updateReference(executor, table, column, fromProfileId, toProfileId);
  }
}
