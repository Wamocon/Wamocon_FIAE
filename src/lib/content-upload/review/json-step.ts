// The extract step for a quiz JSON file (package UP2): the JSON counterpart of the Word
// and PDF branch in steps.ts. It reads the file strictly (read-json.ts), applies the
// rule stage (classify/json-rule.ts) and writes the proposal.
//
// What it never does: it makes no excerpt and sends nothing anywhere. A quiz file holds
// the correct answers and explanations of its questions, so no part of it may reach the
// model (decision O13). The file also never becomes `unclear`: a file the rules cannot
// read is refused here with a code, a file they can read gets a band, so the stage of
// the model (which takes `unclear` files) never sees a JSON file. ki/steps.ts refuses a
// file that is not a Word file on its own as well, a second lock.
//
// What it keeps: counts, component codes and finding codes in parse_summary (the review
// list shows them), the proposal (type, band, reasons with fixed texts). Not one
// question, one answer or one title of the file.

import type { Decisions } from '@/lib/content-import/apply/types';
import { classifyQuizJson } from '@/lib/content-upload/classify/json-rule';
import { hasUsableSet, readQuizJson } from '@/lib/content-upload/read-json';
import type { ProposalWrite } from '@/lib/content-upload/review/types';
import type { StepResult } from '@/lib/content-upload/staging/queue';
import type { FilePatch, FileRow } from '@/lib/content-upload/staging/types';

export interface JsonStepEnv {
  context(): Promise<{ decisions: Decisions }>;
  writeProposal(
    fileId: string,
    claimId: string,
    write: ProposalWrite
  ): Promise<boolean>;
}

/** Refuses the file (object removed) with a code and the numbers that explain it. */
export type RejectFile = (
  code: string,
  patch?: FilePatch['parseSummary']
) => Promise<StepResult>;

export async function extractQuizJson(
  file: FileRow,
  bytes: Uint8Array,
  env: JsonStepEnv,
  reject: RejectFile
): Promise<StepResult> {
  const { decisions } = await env.context();
  const read = readQuizJson(bytes, {
    expectedGlobalQuestions: decisions.content.globalQuizQuestions,
  });
  if (read.status === 'rejected') {
    return reject(read.code, { findingCodes: read.findingCodes });
  }
  const { summary } = read;
  if (!hasUsableSet(summary)) {
    return reject('NO_USABLE_SET', {
      findingCodes: summary.findingCodes,
      jsonKind: summary.kind,
      quizzes: summary.quizzes,
      sets: summary.sets,
      setsWithErrors: summary.setsWithErrors,
    });
  }

  const proposal = classifyQuizJson({ relPath: file.relPath, summary });
  if (!file.claimId) return { kind: 'retry', reason: 'NO_CLAIM' };
  const written = await env.writeProposal(file.id, file.claimId, {
    source: proposal.source,
    docType: proposal.docType,
    componentCode: null,
    enablerCode: null,
    quizLevel: null,
    confidence: proposal.confidence,
    band: proposal.band,
    reasons: proposal.reasons,
    model: null,
  });
  // The claim was lost to another call: the result belongs to that call
  if (!written) return { kind: 'retry', reason: 'CLAIM_LOST' };

  return {
    kind: 'advance',
    to: 'extracted',
    patch: {
      docType: proposal.docType,
      pageCount: null,
      dupKey: null,
      parseSummary: {
        contents: 'quiz_json',
        jsonKind: summary.kind,
        quizzes: summary.quizzes,
        sets: summary.sets,
        questions: summary.questions,
        setsWithErrors: summary.setsWithErrors,
        errors: summary.errors,
        warnings: summary.warnings,
        unmapped: summary.unmapped,
        components: summary.components,
        findingCodes: summary.findingCodes,
        contentRead: true,
        ruleStatus: 'proposed_rules',
        ruleCode: null,
        withoutSolution: false,
      },
    },
  };
}
