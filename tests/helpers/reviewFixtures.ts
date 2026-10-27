// Shared set-up of the tests of the review list (package U6): a run with real
// (invented) Word and PDF files that goes through the real steps of the queue to
// the review state, on the in-memory repositories and storage.

import {
  announceFiles,
  completeFiles,
} from '@/lib/content-upload/staging/files';
import { pumpReviewRun } from '@/lib/content-upload/review/steps';
import type { CatalogComponentRow } from '@/lib/content-upload/review/types';
import type { RunRow } from '@/lib/content-upload/staging/types';
import { DIR, paths } from './classifyFixtures';
import {
  b,
  docxFromBlocks,
  enablerBlocks,
  globalQuizBlocks,
  pdfBytes,
  quizBlocks,
  scenarioBlocks,
  t,
  unknownBlocks,
  type Block,
} from './uploadFixtures';
import { entryFor, newRun, setup } from './uploadServiceFixtures';

export type Ctx = ReturnType<typeof setup>;

/** The components of the catalog in the database of the tests. */
export const DB_COMPONENTS: CatalogComponentRow[] = [
  {
    code: 'K1',
    title: 'Erfundenes Thema Eins',
    kind: 'pflicht',
    phase: 1,
    enablers: [
      { code: 'K1-a', title: 'Erster' },
      { code: 'K1-b', title: 'Zweiter' },
      { code: 'K1-c', title: 'Dritter' },
    ],
  },
  {
    code: 'K12',
    title: 'Erfundenes Wahlthema Zwei',
    kind: 'wahl',
    phase: null,
    enablers: [{ code: 'K12-a', title: null }],
  },
  {
    code: 'K6.1',
    title: 'Erfundenes Thema Sechs',
    kind: 'pflicht',
    phase: 1,
    enablers: [{ code: 'K6.1-a', title: null }],
  },
];

export interface SeedFile {
  path: string;
  bytes: Uint8Array;
  /** Browser time of change. */
  lastModified?: number;
}

export async function quizFile(
  id: string,
  level: 'Low' | 'Medium' | 'High' = 'Low',
  overrides: {
    dir?: string;
    code?: string;
    name?: string;
    lastModified?: number;
    /** Another number of questions makes another file (no exact copy). */
    questions?: number;
  } = {}
): Promise<SeedFile> {
  const code = overrides.code ?? id;
  const german = { Low: 'leicht', Medium: 'mittel', High: 'anspruchsvoll' }[
    level
  ];
  const blocks = quizBlocks({
    code,
    title: 'Thema',
    questions: overrides.questions ?? 3,
  }).map((block: Block) =>
    block.text.startsWith('Quiz, Schwierigkeitsgrad')
      ? t(`Quiz, Schwierigkeitsgrad: ${german}`)
      : block
  );
  const basePath = paths.quiz(overrides.dir ?? DIR.k1, id, level);
  return {
    path: overrides.name
      ? basePath.replace(/[^/]+$/, overrides.name)
      : basePath,
    bytes: await docxFromBlocks(blocks),
    lastModified: overrides.lastModified,
  };
}

export async function enablerFile(id = '1a'): Promise<SeedFile> {
  return {
    path: paths.enabler(DIR.k1, id),
    bytes: await docxFromBlocks(enablerBlocks({ code: id })),
  };
}

export async function scenarioFile(id = '1a'): Promise<SeedFile> {
  return {
    path: paths.scenario(DIR.k1, id),
    bytes: await docxFromBlocks(scenarioBlocks({ code: id })),
  };
}

export async function unknownFile(name = 'Sicherung.docx'): Promise<SeedFile> {
  return { path: `lose/${name}`, bytes: await docxFromBlocks(unknownBlocks()) };
}

export async function macroFile(name = 'Makro.docx'): Promise<SeedFile> {
  return {
    path: `lose/${name}`,
    bytes: await docxFromBlocks([t('Titel'), b('Text')], {
      parts: { 'word/vbaProject.bin': Buffer.from('macro') },
    }),
  };
}

export async function globalQuizFile(): Promise<SeedFile> {
  return {
    path: paths.globalQuiz(DIR.k6_1, '06.1'),
    bytes: await docxFromBlocks(globalQuizBlocks()),
  };
}

export function pdfFile(name = 'lose/Original.pdf'): SeedFile {
  return {
    path: name,
    bytes: pdfBytes({ pages: [['Eine erfundene Zeile.']] }),
  };
}

/** Announces, uploads and reports the files, as the browser would. */
export async function uploadFiles(
  ctx: Ctx,
  run: RunRow,
  files: SeedFile[]
): Promise<string[]> {
  const announced = await announceFiles(ctx.deps, run, {
    files: files.map(f => entryFor(f.path, f.bytes, f.lastModified)),
  });
  if (!announced.ok) throw new Error(announced.error);
  const ids = announced.data.results.map(r => r.fileId!);
  const rows = await ctx.repo.getFiles(run.id, ids);
  for (const row of rows) {
    const index = ids.indexOf(row.id);
    ctx.mem.put(row.storagePath, files[index].bytes);
  }
  const fresh = (await ctx.repo.getRun(run.id))!;
  const done = await completeFiles(ctx.deps, fresh, { fileIds: ids });
  if (!done.ok) throw new Error(done.error);
  return ids;
}

/** Works the queue with the steps of the review until it is empty. */
export async function processAll(ctx: Ctx, runId: string) {
  for (let i = 0; i < 20; i += 1) {
    const result = await pumpReviewRun(ctx.reviewDeps, runId, {
      closeUpload: true,
      retryDelaySeconds: 0,
    });
    if (result.done) return result;
  }
  throw new Error('The queue did not finish');
}

export interface ReviewRun {
  ctx: Ctx;
  run: RunRow;
  ids: string[];
}

/** A run in the state review with the given files processed. */
export async function reviewRun(files: SeedFile[]): Promise<ReviewRun> {
  const ctx = setup();
  ctx.review.components = DB_COMPONENTS;
  const run = await newRun(ctx.deps);
  const ids = await uploadFiles(ctx, run, files);
  await processAll(ctx, run.id);
  const fresh = (await ctx.repo.getRun(run.id))!;
  return { ctx, run: fresh, ids };
}
