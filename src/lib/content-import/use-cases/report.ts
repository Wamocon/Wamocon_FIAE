// Report of a run of the use case import as Markdown (German). Holds counts and
// keys, never the content of a source file. Pure function.

import type { UseCaseReport } from './engine';

export interface UseCaseRunInfo {
  mode: 'check' | 'dry-run' | 'apply';
  target: string;
  host: string;
  schema: string;
  role: string;
  at: string;
  updateExisting: boolean;
  solutions: boolean;
}

const TABLE_LABEL: Record<string, string> = {
  use_cases: 'Use Cases',
  content_documents: 'Dokumentzeilen (Themen und Lösungen)',
};

export function renderUseCaseRunReport(
  report: UseCaseReport,
  info: UseCaseRunInfo
): string {
  const out: string[] = [];
  const modeText = {
    check: 'Prüfung (nur lesend)',
    'dry-run': 'Probelauf (alles ausgeführt, zurückgerollt)',
    apply: 'Echter Lauf (übernommen)',
  }[info.mode];
  out.push('# Lauf des Use-Case-Imports');
  out.push('');
  out.push(
    `Modus: ${modeText}. Ziel: ${info.target}, Host ${info.host}, Schema ${info.schema}, Rolle ${info.role}.`
  );
  out.push(`Katalog: ${report.catalog}. Stand: ${info.at}.`);
  out.push('');
  out.push('| Tabelle | neu | aktualisiert | unverändert |');
  out.push('|---|---|---|---|');
  for (const [table, count] of Object.entries(report.tables)) {
    out.push(
      `| ${TABLE_LABEL[table] ?? table} | ${count.insert} | ${count.update} | ${count.unchanged} |`
    );
  }
  out.push('');
  out.push(
    info.solutions
      ? 'Musterlösungen und Bewertungskriterien wurden mitgeschrieben (--use-case-solutions, nur lokal).'
      : `Musterlösungen und Bewertungskriterien wurden nicht geschrieben (${report.withheldSolutionRows} Dokumentzeilen zurückgehalten). Sie brauchen --use-case-solutions und ein lokales Ziel.`
  );
  out.push('');
  if (report.skipped.length > 0) {
    out.push('## Nicht übernommen (Voraussetzung fehlt)');
    out.push('');
    for (const s of report.skipped.slice(0, 300)) {
      out.push(`- ${s.useCaseCode}: ${s.code}`);
    }
    if (report.skipped.length > 300) {
      out.push(`- und ${report.skipped.length - 300} weitere`);
    }
    out.push('');
  }
  if (report.differences.length > 0) {
    out.push('## Abweichungen bestehender Zeilen');
    out.push('');
    out.push(
      info.updateExisting
        ? 'Mit --update-existing aktualisiert (nur die genannten Spalten).'
        : 'Nicht geändert (dafür gibt es --update-existing).'
    );
    out.push('');
    for (const d of report.differences.slice(0, 200)) {
      out.push(`- ${d.table} ${d.key}: ${d.columns.join(', ')}`);
    }
    if (report.differences.length > 200) {
      out.push(`- und ${report.differences.length - 200} weitere`);
    }
    out.push('');
  }
  if (report.conflicts.length > 0) {
    out.push('## Konflikte');
    out.push('');
    for (const c of report.conflicts) {
      out.push(`- ${c.table} ${c.key}: ${c.reason}`);
    }
    out.push('');
  }
  return out.join('\n');
}
