// Findings of the reading and of the excerpt. A finding has a stable code and a
// short English message that never holds text of the document, so a list of
// findings can be stored, logged and shown without leaking content.

export type FindingSeverity = 'info' | 'warning' | 'blocking';

export interface Finding {
  /** Stable code, for example MACRO_ENABLED or PII_THRESHOLD. */
  code: string;
  /**
   * info: a note for the review list. warning: something to look at.
   * blocking: the file is rejected (reading) or is not sent (excerpt).
   */
  severity: FindingSeverity;
  /** Fixed text, never a part of the document. */
  message: string;
  /** How often it was found, when that is of interest. */
  count?: number;
}

export function finding(
  code: string,
  severity: FindingSeverity,
  message: string,
  count?: number
): Finding {
  return count === undefined
    ? { code, severity, message }
    : { code, severity, message, count };
}

/** The code of the first finding that blocks, or null. */
export function firstBlocking(findings: readonly Finding[]): string | null {
  return findings.find(f => f.severity === 'blocking')?.code ?? null;
}

/** Outcome of a reader: read, refused for a reason of safety or format, or failed. */
export type ReadStatus = 'ok' | 'rejected' | 'failed';
