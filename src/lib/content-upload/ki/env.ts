// What the Sokrates steps run on, for one run and one call of the pump: the
// configuration from the environment, a client, the log, the proposals, the
// positive list of the run and the list of solution texts. Everything that costs a
// query or a read is loaded on first use and kept for the call.
//
// This module reads the environment only through the function it is given, and
// holds no network code: the client is made from the checked configuration.

import { readDocx } from '../read-docx';
import { quizJsonSolutionTexts, readQuizJson } from '../read-json';
import { solutionTextsOf } from '../excerpt';
import { positiveListFromPaths } from '@/lib/content-upload/classify/positive-list';
import { createKiClient } from '@/lib/content-upload/ki/client';
import {
  loadKiConfig,
  type Env,
  type KiConfigResult,
} from '@/lib/content-upload/ki/config';
import { corpusFor, type SolutionCorpus } from '@/lib/content-upload/ki/corpus';
import { safeTitle, type KiCatalog } from '@/lib/content-upload/ki/prompt';
import type { KiRepo } from '@/lib/content-upload/ki/repo';
import {
  CORPUS_BUDGET_MS,
  type KiStepEnv,
} from '@/lib/content-upload/ki/steps';
import {
  optionsOf,
  type ReviewDeps,
} from '@/lib/content-upload/review/service';
import { maxFileBytesFor } from '@/lib/content-upload/staging/config';
import type { FileRow } from '@/lib/content-upload/staging/types';

const COMPONENT_CODE = /^K\d{1,2}(?:\.\d)?$/;
const ENABLER_CODE = /^K\d{1,2}(?:\.\d)?-[a-z]$/;

export interface KiEnvOptions {
  deps: ReviewDeps;
  ki: KiRepo;
  runId: string;
  /** The environment variables (process.env in the app). */
  env: () => Env;
  /** False in Production and wherever the content upload is switched off. */
  available: () => boolean;
  fetchImpl?: typeof fetch;
  /**
   * Replaces the configuration from the environment. Only the tests pass it (a
   * local server cannot be https and is not on the positive list of hosts): the
   * app never does, and no variable can reach it.
   */
  config?: () => KiConfigResult;
}

async function allFiles(deps: ReviewDeps, runId: string): Promise<FileRow[]> {
  const files: FileRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await deps.repo.listFiles(runId, { offset, limit: 500 });
    files.push(...page);
    if (page.length < 500) break;
  }
  return files;
}

export function createKiStepEnv(options: KiEnvOptions): KiStepEnv {
  const { deps, runId } = options;
  const clock = deps.clock ?? Date.now;
  let config: KiConfigResult | undefined;
  let run: ReturnType<ReviewDeps['repo']['getRun']> | undefined;
  let catalog: Promise<KiCatalog> | undefined;
  let corpus: Promise<SolutionCorpus> | undefined;

  const getRun = () => (run ??= deps.repo.getRun(runId));
  // time that this call of the pump spent on the list of solution texts
  let corpusSpentMs = 0;

  const env: KiStepEnv = {
    config() {
      config ??= options.config
        ? options.config()
        : loadKiConfig(options.env());
      return config;
    },
    available: options.available,
    client(cfg, timeoutMs) {
      return createKiClient({
        target: cfg.target,
        policy: cfg.policy,
        apiKey: cfg.apiKey,
        model: cfg.model,
        timeoutMs,
        maxResponseBytes: cfg.limits.maxResponseBytes,
        maxTokens: cfg.limits.maxTokens,
        fetchImpl: options.fetchImpl,
      });
    },
    ki: options.ki,
    review: deps.review,
    getRun,
    catalog() {
      catalog ??= (async () => {
        const current = await getRun();
        if (!current) throw new Error('RunMissing');
        const files = await allFiles(deps, runId);
        const database = await deps.review.catalogComponents(
          current.trainingCatalogId
        );
        const merged = optionsOf(
          database,
          // only the paths of Word and PDF files describe the folder tree
          positiveListFromPaths(
            files
              .filter(f => f.ext === 'docx' || f.ext === 'pdf')
              .map(f => f.relPath)
          )
        );
        // A title only for what the database knows: a title of the plan comes from
        // a folder name of the upload, which must never reach the model
        // Only codes of the known shape go into the prompt and the list of answers
        return {
          components: merged.components
            .filter(c => COMPONENT_CODE.test(c.code))
            .map(c => ({
              code: c.code,
              title: c.isNew ? null : safeTitle(c.title),
              enablers: c.enablers
                .filter(e => ENABLER_CODE.test(e.code))
                .map(e => ({
                  code: e.code,
                  title: e.isNew ? null : safeTitle(e.title),
                })),
            })),
        };
      })().catch(error => {
        catalog = undefined;
        throw error;
      });
      return catalog;
    },
    corpus() {
      corpus ??= corpusFor(runId, {
        listFiles: () => allFiles(deps, runId),
        loadBytes: file =>
          deps.storage().download(file.storagePath, maxFileBytesFor(file.ext)),
        readParagraphs: async bytes => {
          const read = await readDocx(bytes);
          return read.status === 'ok' ? read.paragraphs : null;
        },
        solutionsOf: solutionTextsOf,
        jsonSolutions: bytes => {
          const read = readQuizJson(bytes);
          return read.status === 'ok' ? quizJsonSolutionTexts(read.read) : null;
        },
        existing: limit => deps.review.existingSolutionTexts(limit),
        clock,
      }).catch(error => {
        corpus = undefined;
        throw error;
      });
      return corpus;
    },
    async advanceCorpus() {
      const list = await env.corpus();
      const left = Math.max(0, CORPUS_BUDGET_MS - corpusSpentMs);
      const started = clock();
      const complete = await list.advance(left);
      corpusSpentMs += Math.max(0, clock() - started);
      return complete;
    },
    clock,
  };
  return env;
}
