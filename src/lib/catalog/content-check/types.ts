/**
 * Shared types of the content check (Inhaltsprüfung) on the page Inhaltsstatistik.
 *
 * Three sources write findings in the same shape: the script checks (internal
 * consistency of the content, `source: 'script'`), the AI review (anomalies and
 * errors a rule cannot see, `source: 'ki'`) and the comparison with the plan
 * (targets and the uploaded plan document, `source: 'plan'`).
 */

export type FindingSeverity = 'error' | 'warning' | 'info';
export type FindingSource = 'script' | 'ki' | 'plan';

export type FindingRefType =
  | 'catalog'
  | 'course'
  | 'enabler'
  | 'useCase'
  | 'quiz'
  | 'question'
  | 'document'
  | 'learningField';

export interface FindingRef {
  type: FindingRefType;
  id: string;
  /** Human readable name (title or code), never a secret or personal data. */
  label: string;
}

export interface Finding {
  /** Stable id of the rule, for example `enabler.quiz.missing`, with the object in `refs`. */
  rule: string;
  severity: FindingSeverity;
  source: FindingSource;
  /** Short category for grouping, for example `structure`, `quiz`, `document`, `plan`, `text`. */
  category: string;
  /** One sentence in German, what is wrong. */
  summary: string;
  /** Optional detail (numbers, expected and found). */
  details?: string;
  /** The objects concerned (limited to a sensible number by the check). */
  refs: FindingRef[];
  /** What to do about it, one sentence in German. */
  hint?: string;
}

export interface ContentCheckReport {
  catalogId: string;
  catalogCode: string;
  /** ISO time of the run. */
  generatedAt: string;
  findings: Finding[];
  /** Counts by severity, derived from `findings`. */
  counts: Record<FindingSeverity, number>;
  /** Which parts ran (the AI review is optional, the plan check needs a plan). */
  ran: { script: boolean; ki: boolean; plan: boolean };
  /** Notes such as "AI review skipped: budget" (German, short). */
  notes: string[];
}
