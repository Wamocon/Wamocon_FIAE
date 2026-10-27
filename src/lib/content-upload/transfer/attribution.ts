// Which file of the run a written row belongs to (content_upload_applied_rows.file_id).
//
// Taken from the plan alone: every quiz, enabler, use case and scenario of the
// plan names its source path, and the path maps to the file. Questions, options and
// links are found through the ids of the rows the same run has just written. Rows
// that many files share (components, courses) get no file. The id is only
// information for the review list: the rollback works on table and row id.

import type { Row } from '@/lib/content-import/apply/db';
import type { TableName } from '@/lib/content-import/apply/tables';
import type { ImportPlan } from '@/lib/content-import/apply/types';
import type { UseCasePlan } from '@/lib/content-import/use-cases/types';
import type { Attribution } from '@/lib/content-upload/transfer/record';

export interface AttributionInput {
  importPlan: ImportPlan;
  useCasePlan: UseCasePlan;
  /** Source path of a plan item to the id of its file. */
  fileOfSource: ReadonlyMap<string, string>;
  /** Title of the document row of an original to the id of its file. */
  fileOfOriginalTitle?: ReadonlyMap<string, string>;
  /**
   * Quizzes and questions that exist already (read before the engines run): the
   * questions an extension adds, and the positions it moves, belong to the file of
   * the quiz although the quiz row itself is not written.
   */
  existing?: {
    quizzes: ReadonlyArray<{ id: string; code: string }>;
    questions: ReadonlyArray<{ id: string; quizId: string }>;
  };
}

export function planAttribution(input: AttributionInput): Attribution {
  const file = (source: string | undefined) =>
    source ? (input.fileOfSource.get(source) ?? null) : null;
  const quizByCode = new Map(
    input.importPlan.quizzes.map(q => [q.code, file(q.source)])
  );
  const enablerByCode = new Map(
    input.importPlan.enablers.map(e => [e.code, file(e.source)])
  );
  const scenarioByCode = new Map(
    input.importPlan.scenarios.map(s => [s.enablerCode, file(s.source)])
  );
  const useCaseByCode = new Map(
    input.useCasePlan.useCases.map(u => [u.code, file(u.source)])
  );
  // Ids of the rows written so far
  const quizOfId = new Map<string, string | null>();
  const questionOfId = new Map<string, string | null>();
  const enablerOfId = new Map<string, string | null>();
  const useCaseOfId = new Map<string, string | null>();
  for (const q of input.existing?.quizzes ?? []) {
    if (quizByCode.has(q.code)) quizOfId.set(q.id, quizByCode.get(q.code) ?? null);
  }
  for (const q of input.existing?.questions ?? []) {
    if (quizOfId.has(q.quizId)) {
      questionOfId.set(q.id, quizOfId.get(q.quizId) ?? null);
    }
  }

  const scenarioCodeOfTitle = (title: unknown) => {
    const match = /^Szenario (\S+):/.exec(String(title ?? ''));
    return match ? match[1] : null;
  };

  const of = (table: TableName, row: Row): string | null => {
    switch (table) {
      case 'quizzes': {
        const id = quizByCode.get(String(row.code)) ?? null;
        quizOfId.set(String(row.id), id);
        return id;
      }
      case 'questions': {
        const id = quizOfId.get(String(row.quiz_id)) ?? null;
        questionOfId.set(String(row.id), id);
        return id;
      }
      case 'options':
        return questionOfId.get(String(row.question_id)) ?? null;
      case 'enabler_quiz_links':
        return quizOfId.get(String(row.quiz_id)) ?? null;
      case 'enablers': {
        const id = enablerByCode.get(String(row.code)) ?? null;
        enablerOfId.set(String(row.id), id);
        return id;
      }
      case 'use_cases': {
        const id = useCaseByCode.get(String(row.code)) ?? null;
        useCaseOfId.set(String(row.id), id);
        return id;
      }
      case 'content_documents': {
        if (row.use_case_id) {
          return useCaseOfId.get(String(row.use_case_id)) ?? null;
        }
        const original = input.fileOfOriginalTitle?.get(String(row.title));
        if (original) return original;
        const code = scenarioCodeOfTitle(row.title);
        return code ? (scenarioByCode.get(code) ?? null) : null;
      }
      default:
        return null;
    }
  };
  return {
    inserted: (table, row) => of(table, row),
    updated: (table, row) => of(table, row),
  };
}
