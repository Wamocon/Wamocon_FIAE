// The report of a run of the PDF import, as Markdown. Counts, codes and names of the files
// that were not taken. No content of a file, no connection string, no key.

import type { DocumentReport } from './engine';

export interface DocumentRunInfo {
  mode: 'check' | 'dry-run' | 'apply';
  target: string;
  host: string;
  schema: string;
  role: string;
  at: string;
  overwriteFiles: boolean;
}

export function renderDocumentRunReport(
  report: DocumentReport,
  info: DocumentRunInfo
): string {
  const c = report.tables.content_documents;
  const lines = [
    '# PDF import (KfBM)',
    '',
    `- Mode: ${info.mode}`,
    `- Target: ${info.target} (host ${info.host}, schema ${info.schema}, role ${info.role})`,
    `- Time: ${info.at}`,
    `- Replace files: ${info.overwriteFiles ? 'yes' : 'no'}`,
    '',
    '| Table | New | Unchanged |',
    '| --- | --- | --- |',
    `| content_documents | ${c.insert} | ${c.unchanged} |`,
    '',
    `Files copied: ${report.uploads.put} (replaced: ${report.uploads.replaced})`,
    '',
  ];
  if (report.skipped.length > 0) {
    lines.push(
      `## Left out because the target lacks the parent (${report.skipped.length})`,
      ''
    );
    for (const s of report.skipped) {
      lines.push(`- ${s.code}: ${s.enablerCode} (${s.kind})`);
    }
    lines.push('');
  }
  if (report.conflicts.length > 0) {
    lines.push(`## Conflicts (${report.conflicts.length})`, '');
    for (const conflict of report.conflicts) {
      lines.push(`- ${conflict.table} ${conflict.key}: ${conflict.reason}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
