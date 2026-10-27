// Report of a run of the learning field import as Markdown (German). It holds
// counts and codes, no content of the source table.

import type { JobMode } from '../apply/job';
import type { LearningFieldReport } from './engine';

export interface RunReportInfo {
  mode: JobMode;
  target: string;
  host: string;
  schema: string;
  role: string;
  at: string;
  updateExisting: boolean;
}

const TABLE_LABEL: Record<string, string> = {
  training_catalog_learning_fields: 'Lernfelder',
  training_catalog_content_mappings: 'Zuordnungen (Enabler zu Lernfeld)',
};
const USE_CASE_MAPPING_LABEL = 'Zuordnungen (Use Case zu Lernfeld)';
const USE_CASE_CODES_LABEL =
  'Use Cases (Lernfeld-Codes in der Spalte lernfelder)';

const MODE_TEXT: Record<JobMode, string> = {
  check: 'Prüfung (nur lesend)',
  'dry-run': 'Probelauf (alles ausgeführt, zurückgerollt)',
  apply: 'Echter Lauf (übernommen)',
};

const MAX_LISTED = 200;

export function renderLearningFieldRunReport(
  report: LearningFieldReport,
  info: RunReportInfo
): string {
  const out: string[] = [];
  out.push('# Lauf des Lernfeld-Imports');
  out.push('');
  out.push(
    `Modus: ${MODE_TEXT[info.mode]}. Ziel: ${info.target}, Host ${info.host}, Schema ${info.schema}, Rolle ${info.role}.`
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
  out.push(
    `| ${USE_CASE_MAPPING_LABEL} | ${report.useCaseMappings.insert} | ${report.useCaseMappings.update} | ${report.useCaseMappings.unchanged} |`
  );
  out.push(
    `| ${USE_CASE_CODES_LABEL} | ${report.useCaseCodes.insert} | ${report.useCaseCodes.update} | ${report.useCaseCodes.unchanged} |`
  );
  out.push('');
  const listCodes = (heading: string, text: string, codes: string[]) => {
    if (codes.length === 0) return;
    out.push(heading);
    out.push('');
    out.push(text);
    out.push('');
    out.push(
      codes.slice(0, MAX_LISTED).join(', ') +
        (codes.length > MAX_LISTED
          ? ` und ${codes.length - MAX_LISTED} weitere`
          : '')
    );
    out.push('');
  };
  listCodes(
    '## Enabler ohne Use Case',
    `Enabler mit Lernfeld, aber ohne Use Case: ${report.enablersWithoutUseCase.length}. Für sie gibt es keine Use-Case-Zuordnung (kommt der Use-Case-Import später, den Lauf wiederholen).`,
    report.enablersWithoutUseCase
  );
  listCodes(
    '## Use Cases ohne Enabler',
    `Use Cases des Katalogs ohne Enabler: ${report.useCasesWithoutEnabler.length}. Sie bekommen kein Lernfeld.`,
    report.useCasesWithoutEnabler
  );
  if (report.skipped.length > 0) {
    out.push('## Übersprungen: Enabler fehlt in der Zieldatenbank');
    out.push('');
    out.push(
      `${report.skipped.length} Enabler des Plans fehlen in der Zieldatenbank, ${report.skipped.reduce((sum, s) => sum + s.pairs, 0)} Zuordnungen sind deshalb nicht geschrieben (der Inhaltsimport kommt zuerst, danach diesen Lauf wiederholen).`
    );
    out.push('');
    out.push('| Enabler | Komponente | Zuordnungen |');
    out.push('|---|---|---|');
    for (const skip of report.skipped.slice(0, MAX_LISTED)) {
      out.push(
        `| ${skip.enablerCode ?? ''} | ${skip.componentCode ?? ''} | ${skip.pairs} |`
      );
    }
    if (report.skipped.length > MAX_LISTED) {
      out.push('');
      out.push(`und ${report.skipped.length - MAX_LISTED} weitere`);
    }
    out.push('');
  }
  if (report.keptMappings > 0) {
    out.push(
      `${report.keptMappings} bestehende Zuordnungen des Katalogs nennt der Plan nicht, sie bleiben unverändert.`
    );
    out.push('');
  }
  if (report.differences.length > 0) {
    out.push('## Abweichungen bestehender Zeilen');
    out.push('');
    out.push(
      info.updateExisting
        ? 'Mit --update-existing nur Titel, Beschreibung und Stunden aktualisiert, der Titel nur durch den amtlichen Titel, einen Titel des Eigentümers oder wenn noch der Platzhalter steht. Abweichungen der Reihenfolge bleiben unverändert.'
        : 'Nicht geändert (dafür gibt es --update-existing), außer einer leeren Beschreibung: sie wird mit der amtlichen Zielformulierung gefüllt.'
    );
    out.push('');
    for (const d of report.differences.slice(0, MAX_LISTED)) {
      out.push(`- ${d.table} ${d.key}: ${d.columns.join(', ')}`);
    }
    if (report.differences.length > MAX_LISTED) {
      out.push(`- und ${report.differences.length - MAX_LISTED} weitere`);
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
