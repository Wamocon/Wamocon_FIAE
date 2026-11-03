/**
 * @jest-environment node
 */
// The detail query of a trainer for one trainee (fetchTraineeDetailForTrainer in
// dataContext.ts) ran against columns that do not exist: enabler_submissions and
// use_case_submissions have submitted_at (no created_at), school_exam_results has
// exam_id (no school_exam_id). Found on a real Postgres in the browser test of
// 03.11.2026, the unit tests with a stand-in database could not see it. This test
// pins the column names in the SQL text against the Drizzle schema.

import { readFileSync } from 'fs';
import { join } from 'path';
import { getTableColumns } from 'drizzle-orm';
import {
  enablerSubmissions,
  schoolExamResults,
  useCaseSubmissions,
} from '@/db/migrations/schemas/schema';

const source = readFileSync(
  join(process.cwd(), 'src/lib/hai/dataContext.ts'),
  'utf8'
);

function sqlOf(from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('trainer detail query uses columns that exist', () => {
  it('the schema has submitted_at on both submission tables and exam_id on the results', () => {
    expect(Object.keys(getTableColumns(enablerSubmissions))).toContain(
      'submittedAt'
    );
    expect(Object.keys(getTableColumns(useCaseSubmissions))).toContain(
      'submittedAt'
    );
    expect(Object.keys(getTableColumns(schoolExamResults))).toContain(
      'examId'
    );
  });

  it('reads and sorts the submissions by submitted_at, never by created_at', () => {
    const text = sqlOf('// 2. Recent submissions', '// 3.');
    expect(text).toContain('es.submitted_at');
    expect(text).toContain('ucs.submitted_at');
    expect(text).not.toMatch(/created_at/);
  });

  it('joins the exam results on exam_id', () => {
    const text = sqlOf('FROM school_exam_results ser', 'LIMIT 5');
    expect(text).toContain('se.id = ser.exam_id');
    expect(text).not.toContain('school_exam_id');
  });
});
