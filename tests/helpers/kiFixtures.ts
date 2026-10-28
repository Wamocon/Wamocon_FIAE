// Shared set-up of the tests of the Sokrates stage (package U5): runs with files the
// rules leave unclear but that have a structure the excerpt accepts, a pump that
// works the queue with the model step against a stand-in server on localhost, and
// the answers the stand-in gives. No real model, no other host.

import { createHash } from 'crypto';
import { resetCorpusCache } from '@/lib/content-upload/ki/corpus';
import { KI_ENV, type KiConfig } from '@/lib/content-upload/ki/config';
import {
  pumpReviewRun,
  reviewStepEnv,
  type ReviewStepEnv,
} from '@/lib/content-upload/review/steps';
import { createRun } from '@/lib/content-upload/staging/runs';
import type { RunRow } from '@/lib/content-upload/staging/types';
import { localConfig, type FakeSokrates } from './fakeSokrates';
import type { CatalogComponentRow } from '@/lib/content-upload/review/types';
import {
  DB_COMPONENTS,
  uploadFiles,
  type Ctx,
  type SeedFile,
} from './reviewFixtures';
import {
  b,
  docxFromBlocks,
  enablerBlocks,
  pdfBytes,
  quizBlocks,
  scenarioBlocks,
  t,
  useCaseBlocks,
  type Block,
} from './uploadFixtures';
import { SUPER, setup } from './uploadServiceFixtures';

export { resetCorpusCache };

export const sha256 = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('hex');

/** A second component K6.2 next to K6.1: the heading code "6a" fits both. */
export const AMBIGUOUS_COMPONENTS: CatalogComponentRow[] = [
  ...DB_COMPONENTS,
  {
    code: 'K6.2',
    title: 'Erfundenes Thema Sechs Zwei',
    kind: 'pflicht',
    phase: 1,
    enablers: [{ code: 'K6.2-a', title: null }],
  },
];

/**
 * A quiz whose heading code "6a" fits two components: the rules cannot choose
 * (unclear, no codes named), the excerpt is sendable. The case of the model stage.
 */
export async function ambiguousQuiz(
  name = 'Quiz-A.docx',
  options: { questions?: number; blocks?: Block[] } = {}
): Promise<SeedFile> {
  return unclearQuiz(name, { code: '6a', ...options });
}

/** A quiz whose heading code is not in the catalog: unclear for the rules, sendable. */
export async function unclearQuiz(
  name = 'Quiz-A.docx',
  options: { code?: string; questions?: number; blocks?: Block[] } = {}
): Promise<SeedFile> {
  return {
    path: `lose/${name}`,
    bytes: await docxFromBlocks(
      options.blocks ??
        quizBlocks({
          code: options.code ?? '77z',
          title: 'Thema',
          questions: options.questions ?? 3,
        })
    ),
  };
}

export async function unclearScenario(name = 'Szenario-A.docx', code = '77z') {
  return {
    path: `lose/${name}`,
    bytes: await docxFromBlocks(scenarioBlocks({ code })),
  } satisfies SeedFile;
}

export async function unclearUseCase(name = 'UC-A.docx', code = '77z') {
  return {
    path: `lose/${name}`,
    bytes: await docxFromBlocks(useCaseBlocks({ code })),
  } satisfies SeedFile;
}

export async function unclearEnabler(name = 'Lehrtext-A.docx', code = '77z') {
  return {
    path: `lose/${name}`,
    bytes: await docxFromBlocks(enablerBlocks({ code })),
  } satisfies SeedFile;
}

/** A Word file without any structure of the sources: never sent. */
export async function structureless(name = 'Notizen.docx'): Promise<SeedFile> {
  return {
    path: `lose/${name}`,
    bytes: await docxFromBlocks([
      t('Netzwerkgeräte'),
      b('Abschnitt'),
      t('Ein erfundener Text ohne die Merkmale der Quellen, lang genug.'),
    ]),
  };
}

export function loosePdf(name = 'Original.pdf'): SeedFile {
  return {
    path: `lose/${name}`,
    bytes: pdfBytes({
      pages: [
        Array.from(
          { length: 6 },
          (_, i) => `Erfundene Zeile Nummer ${i} mit genug Text für den Test.`
        ),
      ],
    }),
  };
}

export const GOOD_ANSWER = {
  typ: 'quiz',
  komponente: 'K6.2',
  enabler: 'K6.2-a',
  stufe: 'low',
  konfidenz: 0.9,
  begruendung: 'Die Überschrift nennt ein Quiz zu Thema Eins.',
};

export interface KiHarness {
  ctx: Ctx;
  run: RunRow;
  ids: string[];
  config: KiConfig;
  /** A fresh environment of the steps (as a new call of the pump gets one). */
  env(): ReviewStepEnv;
  /** Works the queue with the model stage off: the rules decide, nothing is sent. */
  rules(): Promise<void>;
  /** Works the queue until it is empty, moving the clock between the calls. */
  pump(options?: { rounds?: number; concurrency?: number }): Promise<void>;
}

export interface HarnessOptions {
  kiEnabled?: boolean;
  limits?: Parameters<typeof localConfig>[1];
  available?: boolean;
  /** Replaces the configuration (for the switches of the environment). */
  config?: ReviewStepEnvOptions['config'];
  existingSolutions?: string[];
  fetchImpl?: typeof fetch;
}

type ReviewStepEnvOptions = NonNullable<Parameters<typeof reviewStepEnv>[2]>;

/** A run with the files uploaded and verified, processed up to the point before the model. */
export async function kiHarness(
  fake: Pick<FakeSokrates, 'url'>,
  files: SeedFile[],
  options: HarnessOptions = {}
): Promise<KiHarness> {
  resetCorpusCache();
  const ctx = setup();
  ctx.review.components = AMBIGUOUS_COMPONENTS;
  ctx.review.existingSolutions = options.existingSolutions ?? [];
  const created = await createRun(ctx.deps, SUPER, {
    label: 'A run',
    declarationAccepted: true,
    kiEnabled: options.kiEnabled ?? true,
  });
  if (!created.ok) throw new Error(created.error);
  const ids = await uploadFiles(ctx, created.data, files);
  const config = localConfig(fake, options.limits);
  const env = (): ReviewStepEnv =>
    reviewStepEnv(ctx.reviewDeps, created.data.id, {
      config: options.config ?? (() => ({ ok: true as const, config })),
      available: () => options.available ?? true,
      env: () => ({}),
      fetchImpl: options.fetchImpl,
    });
  const harness: KiHarness = {
    ctx,
    run: created.data,
    ids,
    config,
    env,
    async rules() {
      await pumpReviewRun(
        ctx.reviewDeps,
        created.data.id,
        { closeUpload: true, retryDelaySeconds: 0 },
        reviewStepEnv(ctx.reviewDeps, created.data.id, {
          config: () => ({ ok: false as const, code: 'DISABLED' as const }),
          available: () => true,
          env: () => ({}),
        })
      );
    },
    async pump({ rounds = 12, concurrency } = {}) {
      for (let i = 0; i < rounds; i += 1) {
        const result = await pumpReviewRun(
          ctx.reviewDeps,
          created.data.id,
          { closeUpload: true, retryDelaySeconds: 0, concurrency },
          env()
        );
        if (result.done) return;
        // a file waits before its next try: let the clock of the repository pass it
        ctx.repo.advance(60_000);
      }
      throw new Error('The queue did not finish');
    },
  };
  return harness;
}

/** The name of the variable for the key of Sokrates, for the switch tests. */
export const ENV = KI_ENV;
