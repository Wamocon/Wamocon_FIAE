import {
  readPlanCsv,
  readPlanJson,
  readPlanXlsx,
} from '@/lib/catalog/content-plan/read-structured';
import {
  extractPlanText,
  readPlanWithKi,
  type PlanKiDeps,
  type PlanKiStats,
} from '@/lib/catalog/content-plan/read-ki';
import type { PlanDraft } from '@/lib/catalog/content-plan/types';

/**
 * Reads one uploaded plan document into a PROPOSAL (a plan draft with a quote
 * per field). Two stages:
 *   1. SCRIPT: xlsx, csv and json after the fixed template (read-structured.ts)
 *   2. AI: docx and pdf (running text, tables), only when the caller asked for
 *      it, only Sokrates, with guard and budget (read-ki.ts)
 * The type is decided here, server side, from the extension AND the first
 * bytes, never from the MIME type of the request. The file is read from memory
 * and never stored. The proposal is not saved either.
 */

export const PLAN_FILE_MAX_BYTES = 5 * 1024 * 1024;

export const PLAN_EXTENSIONS = ['docx', 'xlsx', 'csv', 'json', 'pdf'] as const;
export type PlanExtension = (typeof PLAN_EXTENSIONS)[number];

const startsWith = (bytes: Uint8Array, text: string) =>
  [...text].every((ch, i) => bytes[i] === ch.charCodeAt(0));

/** The extension of the file name and whether the first bytes fit it. */
export function planFileKind(
  fileName: string,
  bytes: Uint8Array
): PlanExtension | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (!(PLAN_EXTENSIONS as readonly string[]).includes(ext)) return null;
  const kind = ext as PlanExtension;
  if ((kind === 'docx' || kind === 'xlsx') && !startsWith(bytes, 'PK')) {
    return null;
  }
  if (kind === 'pdf' && !startsWith(bytes, '%PDF-')) return null;
  // a text file has no NUL byte in its first kilobytes
  if (
    (kind === 'csv' || kind === 'json') &&
    bytes.subarray(0, 2048).includes(0)
  ) {
    return null;
  }
  return kind;
}

export type ParseOutcome =
  | {
      ok: true;
      draft: PlanDraft;
      /** Only set for the AI stage. */
      ki?: PlanKiStats;
    }
  | {
      ok: false;
      /** Stable code for the client. */
      code: string;
      /** HTTP status the route answers with. */
      status: number;
    };

const KI_STATUS: Record<string, number> = {
  KI_UNAVAILABLE: 503,
  KI_DISABLED: 503,
  BUDGET: 429,
  BREAKER: 429,
  NO_TEXT: 422,
  GUARD: 422,
  NOTHING_FOUND: 422,
  KI_FAILED: 502,
};

export async function parsePlanDocument(
  input: { fileName: string; bytes: Uint8Array; useKi: boolean },
  ki: PlanKiDeps
): Promise<ParseOutcome> {
  const kind = planFileKind(input.fileName, input.bytes);
  if (kind === null) {
    return { ok: false, code: 'UNSUPPORTED_TYPE', status: 400 };
  }

  if (kind === 'docx' || kind === 'pdf') {
    // The AI reads only when it was asked to: the text of the document leaves
    // for Sokrates, so the person decides
    if (!input.useKi) return { ok: false, code: 'KI_REQUIRED', status: 400 };
    const text = await extractPlanText(kind, input.bytes);
    if (!text.ok) return { ok: false, code: text.code, status: 422 };
    const result = await readPlanWithKi(text.text, ki);
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        status: KI_STATUS[result.code] ?? 502,
      };
    }
    return { ok: true, draft: result.draft, ki: result.stats };
  }

  const result =
    kind === 'xlsx'
      ? await readPlanXlsx(input.bytes)
      : kind === 'csv'
        ? readPlanCsv(input.bytes)
        : readPlanJson(input.bytes);
  if (!result.ok) return { ok: false, code: result.code, status: 422 };
  return { ok: true, draft: result.draft };
}
