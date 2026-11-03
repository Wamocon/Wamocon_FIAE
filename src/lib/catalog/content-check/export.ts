/**
 * Download of the content check report (pure, runs in the browser): JSON as the
 * report is, CSV as one row per finding for a spreadsheet. The text of the
 * headers and of the names comes from the translation system, so the file
 * follows the language of the screen.
 *
 * CSV details: semicolon as separator (German spreadsheets), every field in
 * quotes, a byte order mark so Excel reads the umlauts, line breaks CRLF. A
 * field that starts with = + - @ or a control character gets a leading quote,
 * so a title from the database can never become a formula.
 */

import type {
  ContentCheckReport,
  Finding,
  FindingRefType,
  FindingSeverity,
  FindingSource,
} from '@/lib/catalog/content-check/types';

export interface CsvLabels {
  /** Headers in the order of the columns: severity, source, category, rule, summary, details, hint, objects. */
  headers: [string, string, string, string, string, string, string, string];
  severity: Record<FindingSeverity, string>;
  source: Record<FindingSource, string>;
  refType: Record<FindingRefType, string>;
  /** Name of a category (structure, quiz, ...), or the category itself. */
  category: (category: string) => string;
}

const BOM = String.fromCharCode(0xfeff);
const FORMULA_START = /^[=+\-@\t\r]/;

/** One field of a CSV row: formula guard, quotes doubled, always in quotes. */
export function csvField(value: string): string {
  const guarded = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function findingRow(finding: Finding, labels: CsvLabels): string[] {
  return [
    labels.severity[finding.severity],
    labels.source[finding.source],
    labels.category(finding.category),
    finding.rule,
    finding.summary,
    finding.details ?? '',
    finding.hint ?? '',
    finding.refs.map(r => `${labels.refType[r.type]}: ${r.label}`).join(' | '),
  ];
}

/** The report as CSV text (with the byte order mark). */
export function reportToCsv(
  report: ContentCheckReport,
  labels: CsvLabels
): string {
  const rows = [
    labels.headers as string[],
    ...report.findings.map(f => findingRow(f, labels)),
  ];
  return (
    BOM + rows.map(row => row.map(csvField).join(';')).join('\r\n') + '\r\n'
  );
}

/** The report as formatted JSON. */
export function reportToJson(report: ContentCheckReport): string {
  return JSON.stringify(report, null, 2);
}

/** A file name such as inhaltspruefung-KFBM-2026-11-03.json (letters, digits and hyphens only). */
export function reportFileName(
  report: Pick<ContentCheckReport, 'catalogCode' | 'generatedAt'>,
  extension: 'json' | 'csv'
): string {
  const code = report.catalogCode.replace(/[^A-Za-z0-9]+/g, '') || 'katalog';
  const date = /^\d{4}-\d{2}-\d{2}/.exec(report.generatedAt)?.[0] ?? 'bericht';
  return `inhaltspruefung-${code}-${date}.${extension}`;
}

/** Hands a text to the browser as a file. Browser only. */
export function downloadText(
  fileName: string,
  text: string,
  mime: string
): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the address goes
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
