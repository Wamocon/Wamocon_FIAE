// Seed files for the tests of the JSON and Excel kinds of the content upload (package UP2):
// invented quiz JSON files and mapping tables as files of a run in the review tests.
import type { SeedFile } from './reviewFixtures';
import { makeXlsx } from './xlsxFixture';
import { sampleRows } from '../unit/content-import/learning-fields/fixtures';
import {
  jsonGlobalQuiz,
  jsonQuiz,
  globalFile,
  lessonFile,
  SAMPLE_GLOBALS,
  SAMPLE_SPECS,
} from '../unit/content-import/quiz-json/fixtures';

const encode = (value: unknown) =>
  new TextEncoder().encode(
    typeof value === 'string' ? value : JSON.stringify(value)
  );

export const lessonJsonSeed = (
  name = 'enabler-quizze.json',
  content: unknown = lessonFile(SAMPLE_SPECS.map(jsonQuiz))
): SeedFile => ({ path: `quizze/${name}`, bytes: encode(content) });

export const globalJsonSeed = (
  name = 'global-quizze.json',
  content: unknown = globalFile(SAMPLE_GLOBALS.map(id => jsonGlobalQuiz(id)))
): SeedFile => ({ path: `quizze/${name}`, bytes: encode(content) });

export const rawSeed = (
  path: string,
  bytes: Uint8Array | string
): SeedFile => ({
  path,
  bytes: typeof bytes === 'string' ? encode(bytes) : bytes,
});

export async function mappingSeed(name = 'Zuordnung.xlsx'): Promise<SeedFile> {
  return {
    path: `tabellen/${name}`,
    bytes: new Uint8Array(
      await makeXlsx([
        {
          name: 'Zuordnung',
          rows: sampleRows().map(r => ({ row: r.row, cells: r.cells })),
        },
      ])
    ),
  };
}
