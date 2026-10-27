// The Sokrates stage as two steps of the queue (package U5 of
// docs/ki-upload-konzept.md, 6.3 and 6.4). They fill the slots `ki` and `kiCall`
// of staging/queue.ts.
//
//   ki      unclear    -> ki_pending      reserves a file for the model. Takes only
//                                         files the rules left `unclear` and that
//                                         are not marked as done with the stage
//   kiCall  ki_pending -> proposed_ki     the work: one file, one excerpt, one or
//                       | unclear         two calls, the check of the answer, the
//                                         proposal, the log
//
// When the stage may work at all is decided BEFORE a file is taken (`ready`):
//   - the deployment is not Production, the owner switched the stage on
//     (CONTENT_UPLOAD_KI_ENABLED), the key and the address pass the checks
//   - the run has the opt-in (the person chose it when the run was made)
//   - every file of the run is read: an excerpt is checked against the solutions
//     of ALL files, so nothing is sent while a file is still being read
//   - the brake is open: no failure streak of the breaker, the calls of the run and
//     of the day are not used up
//   - the list of solution texts of the run is complete
//
// What happens to a file, in short: no excerpt that the guard refuses is ever
// sent; the answer of the model is only a proposal, never overwrites a rule
// (a contradiction becomes a conflict), and every call is logged with the hash and
// the length of the excerpt, never its text. A file the stage could not help stays
// `unclear` with the marker `kiState` in its summary, so it is not taken again.

import { createHash } from 'crypto';
import { buildExcerpt } from '../excerpt';
import { readDocx } from '../read-docx';
import { checkAnswer, type KiAnswer } from '@/lib/content-upload/ki/answer';
import { fileBlock, runBlock } from '@/lib/content-upload/ki/budget';
import type { KiConfig, KiConfigResult } from '@/lib/content-upload/ki/config';
import {
  KiPolicyError,
  type KiCallResult,
  type KiClient,
} from '@/lib/content-upload/ki/client';
import type { SolutionCorpus } from '@/lib/content-upload/ki/corpus';
import { checkRequest } from '@/lib/content-upload/ki/guard';
import {
  buildPrompt,
  type KiCatalog,
  type KiStage,
} from '@/lib/content-upload/ki/prompt';
import { deriveProposal } from '@/lib/content-upload/ki/proposal';
import type {
  KiCallStatus,
  KiCallWrite,
  KiRepo,
} from '@/lib/content-upload/ki/repo';
import type { ReviewRepo } from '@/lib/content-upload/review/repo';
import type {
  QueueStep,
  StepContext,
  StepReadyContext,
  StepResult,
} from '@/lib/content-upload/staging/queue';
import { MAX_ATTEMPTS } from '@/lib/content-upload/staging/queue';
import type { RunRow } from '@/lib/content-upload/staging/types';

/** The key of parse_summary that marks a file as done with the stage. */
export const KI_STATE_KEY = 'kiState';
export const KI_CODE_KEY = 'kiCode';

/** How the stage ended for a file. */
export type KiState =
  | 'proposed'
  | 'conflict'
  | 'not_sent'
  | 'failed'
  | 'invalid'
  | 'no_result';

/** Time for the two calls of one step: the step timeout of the queue is 30 s. */
export const STEP_BUDGET_MS = 26_000;
/** A second call needs at least this much of the step budget. */
const MIN_SECOND_CALL_MS = 3000;
/** Time one call of the pump spends on building the list of solution texts. */
export const CORPUS_BUDGET_MS = 6000;

const NEEDS_ENABLER = new Set(['enabler', 'quiz', 'scenario', 'use_case']);
const EARLY_STATES = ['uploaded', 'verified', 'extracted'] as const;

/** What the steps need from outside (replaced in the tests). */
export interface KiStepEnv {
  config(): KiConfigResult;
  /** False in Production and wherever the content upload is switched off. */
  available(): boolean;
  /** A client for these limits and this timeout. */
  client(config: KiConfig, timeoutMs: number): KiClient;
  ki: KiRepo;
  review: Pick<ReviewRepo, 'latestRuleProposal' | 'writeProposal'>;
  getRun(): Promise<RunRow | null>;
  catalog(): Promise<KiCatalog>;
  corpus(): Promise<SolutionCorpus>;
  /**
   * Works on the list of solution texts and says whether it is complete. One call of
   * the pump has ONE budget of time for it, however often the pump asks.
   */
  advanceCorpus(): Promise<boolean>;
  clock(): number;
}

const sha256 = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('hex');
const EMPTY_HASH = sha256('');

/** Seconds a file waits for the next try: 10, 20, 40 ... */
export const backoffSeconds = (attempt: number) =>
  10 * 2 ** Math.max(0, Math.min(attempt, 6) - 1);

// ---------------------------------------------------------------------------
// ready: may the stage take files of this run now?
// ---------------------------------------------------------------------------

export async function kiReady(
  env: KiStepEnv,
  { runId, deps }: StepReadyContext
): Promise<boolean> {
  const config = env.config();
  if (!config.ok || !env.available()) return false;
  const run = await deps.repo.getRun(runId);
  if (!run || !run.kiEnabled) return false;
  if (run.status !== 'processing' && run.status !== 'review') return false;
  // every file is read: no excerpt before the solutions of all files are known
  const early = await deps.repo.queueState(runId, EARLY_STATES, MAX_ATTEMPTS);
  if (early.announced + early.claimable + early.locked > 0) return false;
  const usage = await env.ki.usage(
    runId,
    null,
    config.config.limits.breakerFailures
  );
  if (runBlock(config.config.limits, usage)) return false;
  return env.advanceCorpus();
}

// ---------------------------------------------------------------------------
// Step 1: reserve
// ---------------------------------------------------------------------------

export function createKiReserveStep(env: KiStepEnv): QueueStep {
  return {
    name: 'ki_reserve',
    from: 'unclear',
    unlessMarked: KI_STATE_KEY,
    ready: context => kiReady(env, context),
    async run({ file }): Promise<StepResult> {
      return {
        kind: 'advance',
        to: 'ki_pending',
        ...(file.statusCode ? { code: file.statusCode } : {}),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Step 2: the call
// ---------------------------------------------------------------------------

interface CallOutcome {
  answer: KiAnswer | null;
  /** The file may try again later (a failure of the server, an unusable answer). */
  retryable: boolean;
  /** The state to settle with when there is no answer. */
  failure: { state: KiState; code: string } | null;
  /** Calls made, for the second stage's decision. */
  calls: number;
  /** The server refused the key or the address: a problem of the run, not of the file. */
  runBlocked?: boolean;
}

function statusOf(result: KiCallResult): KiCallStatus {
  if (result.ok) return 'ok';
  return result.kind === 'timeout' ? 'timeout' : 'http_error';
}

/** The code a file is settled with for a failed call, by what went wrong. */
const FAILURE_CODES = {
  timeout: 'KI_TIMEOUT',
  http_error: 'KI_HTTP',
  network: 'KI_NETWORK',
  too_large: 'KI_TOO_LARGE',
  bad_response: 'KI_BAD_RESPONSE',
} as const;

/** The key or the address is wrong (401, 403, 404): every file would meet the same answer. */
const RUN_BLOCKING_STATUSES: ReadonlySet<number> = new Set([401, 403, 404]);

/** The checked answer as JSON for the log: no reason text, no excerpt. */
const answerJson = (a: KiAnswer) =>
  JSON.stringify({
    docType: a.docType,
    componentCode: a.componentCode,
    enablerCode: a.enablerCode,
    quizLevel: a.quizLevel,
    confidence: a.confidence,
  });

export function createKiCallStep(env: KiStepEnv): QueueStep {
  return {
    name: 'ki_call',
    from: 'ki_pending',
    async run(context: StepContext): Promise<StepResult> {
      const { file } = context;
      const started = env.clock();
      const keepCode = file.statusCode ? { code: file.statusCode } : {};

      /** Back to `unclear` without a marker: nothing was decided, a later pass may try. */
      const back = (): StepResult => ({
        kind: 'advance',
        to: 'unclear',
        ...keepCode,
      });
      /** Back to `unclear` with the marker: the stage is done with this file. */
      const settle = (state: KiState, code: string): StepResult => ({
        kind: 'advance',
        to: 'unclear',
        ...keepCode,
        patch: { parseSummary: { [KI_STATE_KEY]: state, [KI_CODE_KEY]: code } },
      });

      const configResult = env.config();
      const run = await env.getRun();
      if (!configResult.ok || !env.available() || !run || !run.kiEnabled) {
        return back();
      }
      const config = configResult.config;
      const { limits } = config;

      const log = async (
        status: KiCallStatus,
        stage: KiStage,
        fields: Partial<KiCallWrite> = {}
      ) => {
        const row: KiCallWrite = {
          runId: run.id,
          fileId: file.id,
          stage,
          model: null,
          endpointHost: null,
          excerptChars: 0,
          excerptSha256: EMPTY_HASH,
          redactions: 0,
          status,
          httpStatus: null,
          latencyMs: null,
          promptTokens: null,
          completionTokens: null,
          attempt: Math.max(1, file.attempts),
          answer: null,
          ...fields,
        };
        try {
          await env.ki.recordCall(row);
        } catch (error) {
          // Nothing was sent: a failing log stops the step, it is tried again.
          if (row.model === null) throw error;
          // A call was made: its answer must not be lost to a failing log. One more try,
          // and then the step goes on (the write of the proposal fails with the same
          // database, so a real outage still ends in a retry of the step).
          try {
            await env.ki.recordCall(row);
          } catch {
            // the answer stands, the row is missing: the caps count one call less
          }
        }
      };

      // Not a file for the model: a PDF is only ever an original of a Word file
      if (file.ext !== 'docx') {
        await log('skipped', 'type_component');
        return settle('not_sent', 'PDF_NOT_SENT');
      }
      if (file.attempts > limits.maxAttempts) {
        return settle('failed', 'KI_ATTEMPTS');
      }

      const usage = await env.ki.usage(run.id, file.id, limits.breakerFailures);
      const block = fileBlock(limits, usage);
      if (block === 'FILE_CAP') return settle('failed', 'KI_FILE_CAP');
      // The run is blocked (breaker, caps): nothing was decided, and `ready` keeps
      // the stage from taking the file again until the block is gone
      if (block) return back();

      const bytes = await context.loadBytes();
      if (bytes === null) return settle('not_sent', 'OBJECT_MISSING');
      const read = await readDocx(bytes);
      if (read.status !== 'ok') return settle('not_sent', 'UNREADABLE');

      const corpus = await env.corpus();
      // `ready` checked it, a change of the files since then sends us back
      if (!(await corpus.advance(0))) return back();

      const excerpt = buildExcerpt({
        paragraphs: read.paragraphs,
        knownSolutions: corpus.texts,
        optIn: false,
      });
      if (!excerpt.sendable) {
        await log('refused_by_guard', 'type_component');
        return settle('not_sent', excerpt.reason);
      }

      const [rule, catalog] = await Promise.all([
        // the proposal of the RULES: an earlier proposal of the model (a step that died
        // after writing it) must not count as a rule
        env.review.latestRuleProposal(file.id),
        env.catalog(),
      ]);

      /** One call for one stage: the guard, the call, the log, the check of the answer. */
      const askOnce = async (
        stage: KiStage,
        timeoutMs: number,
        componentCode?: string
      ): Promise<CallOutcome> => {
        const prompt = buildPrompt({
          stage,
          excerpt: excerpt.excerpt,
          catalog,
          componentCode,
          onlyJsonHint: file.attempts > 1,
        });
        const refusal = checkRequest({
          user: prompt.user,
          excerpt: excerpt.excerpt,
          known: corpus.texts,
          nonce: prompt.nonce,
        });
        if (refusal) {
          await log('refused_by_guard', stage);
          return {
            answer: null,
            retryable: false,
            failure: { state: 'not_sent', code: `REQUEST_${refusal}` },
            calls: 0,
          };
        }
        const client = env.client(config, timeoutMs);
        let result: KiCallResult;
        try {
          result = await client.call({
            system: prompt.system,
            user: prompt.user,
          });
        } catch (error) {
          // The client refused the target (a configuration bug): nothing was sent
          if (!(error instanceof KiPolicyError)) throw error;
          await log('refused_by_guard', stage);
          return {
            answer: null,
            retryable: false,
            failure: { state: 'not_sent', code: 'KI_POLICY' },
            calls: 0,
          };
        }
        const base: Partial<KiCallWrite> = {
          model: client.model,
          endpointHost: client.host,
          excerptChars: excerpt.excerpt.length,
          excerptSha256: sha256(excerpt.excerpt),
          redactions: excerpt.redactions,
          httpStatus: result.httpStatus,
          latencyMs: result.latencyMs,
        };
        if (!result.ok) {
          await log(statusOf(result), stage, base);
          return {
            answer: null,
            retryable: result.retryable,
            failure: { state: 'failed', code: FAILURE_CODES[result.kind] },
            calls: 1,
            runBlocked:
              result.kind === 'http_error' &&
              result.httpStatus !== null &&
              RUN_BLOCKING_STATUSES.has(result.httpStatus),
          };
        }
        const checked = checkAnswer(result.text, {
          catalog,
          expectedComponent: componentCode,
        });
        const tokens = {
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        };
        if (!checked.ok) {
          await log(checked.status, stage, { ...base, ...tokens });
          return {
            answer: null,
            retryable: checked.status === 'invalid_json',
            failure: {
              state: 'invalid',
              code:
                checked.status === 'invalid_json'
                  ? 'KI_INVALID_JSON'
                  : 'KI_NOT_IN_LIST',
            },
            calls: 1,
          };
        }
        await log('ok', stage, {
          ...base,
          ...tokens,
          answer: answerJson(checked.answer),
        });
        return {
          answer: checked.answer,
          retryable: false,
          failure: null,
          calls: 1,
        };
      };

      // Stage one: type and component (and the enabler, if the model names it)
      const first = await askOnce('type_component', limits.timeoutMs);
      if (!first.answer) {
        // A refused key or a wrong address is the same for every file: the file is not
        // settled, it waits (the breaker stops the stage of the run after a few calls)
        if (first.runBlocked) return back();
        if (first.retryable && file.attempts < limits.maxAttempts) {
          return {
            kind: 'retry',
            reason: first.failure?.code ?? 'KI_FAILED',
            delaySeconds: backoffSeconds(file.attempts),
          };
        }
        const failure = first.failure ?? { state: 'failed', code: 'KI_FAILED' };
        return settle(failure.state, failure.code);
      }

      // Stage two: the enabler, only when it is missing and its component is known
      let answer = first.answer;
      const left = STEP_BUDGET_MS - (env.clock() - started);
      const component = catalog.components.find(
        c => c.code === answer.componentCode
      );
      if (
        answer.docType !== null &&
        NEEDS_ENABLER.has(answer.docType) &&
        answer.enablerCode === null &&
        !rule?.enablerCode &&
        component &&
        component.enablers.length > 0 &&
        usage.file + first.calls < limits.maxCallsPerFile &&
        left >= MIN_SECOND_CALL_MS &&
        // the caps and the breaker are looked at again: the first call changed them
        !fileBlock(
          limits,
          await env.ki.usage(run.id, file.id, limits.breakerFailures)
        )
      ) {
        const second = await askOnce(
          'enabler',
          Math.min(limits.timeoutMs, left),
          component.code
        );
        // A failing second call only costs the enabler: the first answer stands
        if (
          second.answer &&
          second.answer.docType === answer.docType &&
          second.answer.componentCode === component.code
        ) {
          answer = {
            ...answer,
            enablerCode: second.answer.enablerCode,
            quizLevel: answer.quizLevel ?? second.answer.quizLevel,
          };
        }
      }

      const outcome = deriveProposal(answer, rule, config.model);
      if (outcome.kind === 'no_result')
        return settle('no_result', 'KI_NO_RESULT');
      if (!file.claimId) return { kind: 'retry', reason: 'NO_CLAIM' };
      const written = await env.review.writeProposal(
        file.id,
        file.claimId,
        outcome.write
      );
      // The claim was lost to another call: the result belongs to that call
      if (!written) return { kind: 'retry', reason: 'CLAIM_LOST' };
      if (outcome.kind === 'conflict') {
        return settle('conflict', 'KI_CONTRADICTS');
      }
      return {
        kind: 'advance',
        to: 'proposed_ki',
        ...keepCode,
        patch: {
          parseSummary: { [KI_STATE_KEY]: 'proposed' satisfies KiState },
        },
      };
    },
  };
}
