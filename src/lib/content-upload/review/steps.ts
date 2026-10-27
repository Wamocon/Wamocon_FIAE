// The steps of the queue that lead a verified file to its proposal (package U6 binds
// what U3 and U4 built into the slots `extract` and `rules` of staging/queue.ts):
//
//   extract  verified  -> extracted        reads the file (Word or PDF), applies the rule
//                                          stage and writes the proposal; a file that must
//                                          not be processed is rejected, one that cannot be
//                                          read fails (code), never an exception
//   rules    extracted -> proposed_rules   moves the file on to the state the rule stage
//                        | unclear         decided (proposed_rules, unclear or skipped),
//                        | skipped         read from the summary of the extract step
//
// Two states because the model allows one step per state; the second one reads no
// file. Nothing of the document is kept: the proposal holds type, codes, confidence
// and reasons (code and fixed text), the file row holds numbers and finding codes.
// The excerpt for the model is not built here, that is package U5.

import type { Decisions } from '@/lib/content-import/apply/types';
import { readDocx } from '@/lib/content-upload/read-docx';
import { readPdf } from '@/lib/content-upload/read-pdf';
import { paragraphsFromText } from '@/lib/content-upload/excerpt';
import {
  assignFile,
  toProposalRow,
} from '@/lib/content-upload/classify/assign';
import type { PositiveList } from '@/lib/content-upload/classify/positive-list';
import {
  buildPositiveList,
  positiveListFromPaths,
} from '@/lib/content-upload/classify/positive-list';
import { OBJECT_DELETED_KEY } from '@/lib/content-upload/staging/types';
import {
  buildSteps,
  pumpRun,
  type PumpOptions,
  type PumpResult,
  type QueueStep,
  type StepResult,
} from '@/lib/content-upload/staging/queue';
import type { Finding } from '@/lib/content-upload/findings';
import type { ProposalWrite } from '@/lib/content-upload/review/types';
import {
  databaseInput,
  decisionsPreset,
  type ReviewDeps,
} from '@/lib/content-upload/review/service';
import type { Paragraph } from '@/lib/content-import/types';

/** What the steps need from outside (replaced in the tests). */
export interface ReviewStepEnv {
  /** Positive list and presets of the run, loaded once and kept for the call of the pump. */
  context(): Promise<{ list: PositiveList; decisions: Decisions }>;
  writeProposal(
    fileId: string,
    claimId: string,
    write: ProposalWrite
  ): Promise<boolean>;
}

/**
 * Reader failures that say something about the machine and not about the file:
 * the PDF is then judged by its path alone (and capped at the band medium).
 */
const INFRASTRUCTURE_CODES: ReadonlySet<string> = new Set([
  'ENGINE_UNAVAILABLE',
  'TIMEOUT',
  'WORKER_MEMORY',
  'WORKER_CRASH',
]);

const RULE_STATUSES = ['proposed_rules', 'unclear', 'skipped'] as const;
type RuleStatus = (typeof RULE_STATUSES)[number];

function findingCodes(findings: readonly Finding[]): string[] {
  return [...new Set(findings.map(f => f.code))].slice(0, 20);
}

export function createExtractStep(env: ReviewStepEnv): QueueStep {
  return {
    name: 'extract_and_classify',
    from: 'verified',
    async run(context): Promise<StepResult> {
      const { file } = context;
      const reject = async (code: string): Promise<StepResult> => {
        const removed = await context.removeObject();
        return {
          kind: 'advance',
          to: 'rejected',
          code,
          patch: removed
            ? { parseSummary: { [OBJECT_DELETED_KEY]: true } }
            : {},
        };
      };

      const bytes = await context.loadBytes();
      if (bytes === null) {
        return { kind: 'advance', to: 'failed', code: 'OBJECT_MISSING' };
      }

      let paragraphs: Paragraph[] | null = null;
      let codes: string[] = [];
      let pageCount: number | null = null;
      let charCount = 0;
      let contentStatus: 'read' | 'failed' = 'read';
      if (file.ext === 'docx') {
        const read = await readDocx(bytes);
        codes = findingCodes(read.findings);
        if (read.status === 'rejected') return reject(read.code ?? 'REJECTED');
        if (read.status === 'failed') {
          return {
            kind: 'advance',
            to: 'failed',
            code: read.code ?? 'PARSE_ERROR',
            patch: { parseSummary: { findingCodes: codes } },
          };
        }
        paragraphs = read.paragraphs;
        charCount = read.stats.characters;
      } else {
        const read = await readPdf(bytes);
        codes = findingCodes(read.findings);
        pageCount = read.pageCount > 0 ? read.pageCount : null;
        if (read.status === 'rejected') return reject(read.code ?? 'REJECTED');
        if (read.status === 'failed') {
          if (read.code && INFRASTRUCTURE_CODES.has(read.code)) {
            // The machine could not read it: the path decides, the band is capped
            contentStatus = 'failed';
          } else {
            return {
              kind: 'advance',
              to: 'failed',
              code: read.code ?? 'PARSE_ERROR',
              patch: { pageCount, parseSummary: { findingCodes: codes } },
            };
          }
        } else {
          paragraphs = paragraphsFromText(read.text);
          charCount = read.text.length;
        }
      }

      const { list, decisions } = await env.context();
      const proposal = assignFile({
        relPath: file.relPath,
        format: file.ext,
        paragraphs,
        contentStatus,
        positiveList: list,
        decisions,
      });
      const row = toProposalRow(proposal);
      if (!file.claimId) return { kind: 'retry', reason: 'NO_CLAIM' };
      const written = await env.writeProposal(file.id, file.claimId, {
        source: row.source,
        docType: row.doc_type,
        componentCode: row.component_code,
        enablerCode: row.enabler_code,
        quizLevel: row.quiz_level,
        confidence: row.confidence,
        band: row.band,
        reasons: row.reasons,
        model: null,
      });
      // The claim was lost to another call: the result belongs to that call
      if (!written) return { kind: 'retry', reason: 'CLAIM_LOST' };

      return {
        kind: 'advance',
        to: 'extracted',
        patch: {
          docType: row.doc_type,
          pageCount,
          charCount,
          dupKey: proposal.dupKey,
          parseSummary: {
            paragraphs: paragraphs?.length ?? 0,
            findingCodes: codes,
            contentRead: contentStatus === 'read',
            ruleStatus: proposal.fileStatus,
            ruleCode: proposal.statusCode,
            withoutSolution: proposal.path.flags.includes('without-solution'),
          },
        },
      };
    },
  };
}

export function createRulesStep(): QueueStep {
  return {
    name: 'rules',
    from: 'extracted',
    async run({ file }): Promise<StepResult> {
      const status = file.parseSummary?.ruleStatus;
      const to: RuleStatus = (RULE_STATUSES as readonly unknown[]).includes(
        status
      )
        ? (status as RuleStatus)
        : 'unclear';
      const code = file.parseSummary?.ruleCode;
      return {
        kind: 'advance',
        to,
        ...(typeof code === 'string' && code ? { code } : {}),
      };
    },
  };
}

/** The steps with the slots of U6 filled in. */
export function reviewSteps(env: ReviewStepEnv): QueueStep[] {
  return buildSteps({
    extract: createExtractStep(env),
    rules: createRulesStep(),
  });
}

/**
 * The environment of the steps for one run on the real repositories. The
 * positive list (the components of the catalog plus the plan of the folder tree of
 * the run) is loaded on first use and kept for the call.
 */
export function reviewStepEnv(deps: ReviewDeps, runId: string): ReviewStepEnv {
  let loaded: Promise<{ list: PositiveList; decisions: Decisions }> | undefined;
  return {
    context() {
      loaded ??= (async () => {
        const run = await deps.repo.getRun(runId);
        if (!run) throw new Error('RunMissing');
        const paths: string[] = [];
        for (let offset = 0; ; offset += 500) {
          const page = await deps.repo.listFiles(runId, { offset, limit: 500 });
          paths.push(...page.map(f => f.relPath));
          if (page.length < 500) break;
        }
        const components = await deps.review.catalogComponents(
          run.trainingCatalogId
        );
        return {
          list: buildPositiveList(
            databaseInput(components),
            positiveListFromPaths(paths)
          ),
          decisions: decisionsPreset(),
        };
      })().catch(error => {
        // a short fault of the database must not fail every file of this call
        loaded = undefined;
        throw error;
      });
      return loaded;
    },
    writeProposal: (fileId, claimId, write) =>
      deps.review.writeProposal(fileId, claimId, write),
  };
}

/** One call of the pump with the steps that read and classify the files. */
export function pumpReviewRun(
  deps: ReviewDeps,
  runId: string,
  options: Omit<PumpOptions, 'steps'> = {},
  env: ReviewStepEnv = reviewStepEnv(deps, runId)
): Promise<PumpResult> {
  return pumpRun(deps, runId, { ...options, steps: reviewSteps(env) });
}
