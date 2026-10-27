// The extract step for an Excel file (package UP2): the Excel counterpart of the Word and
// PDF branch in steps.ts and of json-step.ts. It reads the workbook with the hardened
// reader (read-xlsx.ts), looks for the mapping table by the form of a sheet
// (classify/mapping-rule.ts) and writes the proposal.
//
// Like a JSON file, an Excel file never gets an excerpt and never becomes `unclear`: a
// workbook that is not the mapping table is refused here with a code, one that is gets a
// band. Nothing of a cell is kept: the file row holds counts and finding codes, the
// proposal holds a type, a band and reasons with fixed texts.

import {
  classifyMappingSheet,
  summarizeMappingSheet,
} from '@/lib/content-upload/classify/mapping-rule';
import { parseMappingSheet } from '@/lib/content-import/learning-fields/mapping-sheet';
import { readXlsx } from '@/lib/content-upload/read-xlsx';
import type { RejectFile } from '@/lib/content-upload/review/json-step';
import type { ProposalWrite } from '@/lib/content-upload/review/types';
import type { StepResult } from '@/lib/content-upload/staging/queue';
import type { FileRow } from '@/lib/content-upload/staging/types';

export interface XlsxStepEnv {
  writeProposal(
    fileId: string,
    claimId: string,
    write: ProposalWrite
  ): Promise<boolean>;
}

const findingCodesOf = (findings: ReadonlyArray<{ code: string }>) =>
  [...new Set(findings.map(f => f.code))].sort().slice(0, 20);

export async function extractMappingXlsx(
  file: FileRow,
  bytes: Uint8Array,
  env: XlsxStepEnv,
  reject: RejectFile
): Promise<StepResult> {
  const read = await readXlsx(bytes, {
    pick: rows => parseMappingSheet(rows).ok,
  });
  const findingCodes = findingCodesOf(read.findings);
  if (read.status === 'rejected') {
    return reject(read.code ?? 'REJECTED', { findingCodes });
  }
  if (read.status === 'failed') {
    return {
      kind: 'advance',
      to: 'failed',
      code: read.code ?? 'PARSE_ERROR',
      patch: { parseSummary: { findingCodes } },
    };
  }
  const parsed = read.picked ? parseMappingSheet(read.rows) : null;
  if (!parsed || !parsed.ok || parsed.sheet.positions.length === 0) {
    return reject('NOT_A_MAPPING', { findingCodes });
  }
  const summary = summarizeMappingSheet(parsed.sheet);
  const proposal = classifyMappingSheet(summary);
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
        contents: 'mapping_xlsx',
        positions: summary.positions,
        blocks: summary.blocks,
        blocksWithIssues: summary.blocksWithIssues,
        orphanRows: summary.orphanRows,
        findingCodes,
        contentRead: true,
        ruleStatus: 'proposed_rules',
        ruleCode: null,
        withoutSolution: false,
      },
    },
  };
}
