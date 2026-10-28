import { renderLearningFieldRunReport } from '@/lib/content-import/learning-fields/report';
import type { LearningFieldReport } from '@/lib/content-import/learning-fields/engine';

const info = {
  mode: 'dry-run' as const,
  target: 'local',
  host: '127.0.0.1',
  schema: 'public',
  role: 'postgres',
  at: '2026-10-27T12:00:00.000Z',
  updateExisting: false,
};

const report = (
  over: Partial<LearningFieldReport> = {}
): LearningFieldReport => ({
  catalog: 'KFBM',
  tables: {
    training_catalog_learning_fields: { insert: 13, update: 0, unchanged: 0 },
    training_catalog_content_mappings: { insert: 22, update: 0, unchanged: 3 },
  },
  skipped: [],
  conflicts: [],
  differences: [],
  keptMappings: 0,
  useCaseMappings: { insert: 30, update: 0, unchanged: 4 },
  useCaseCodes: { insert: 0, update: 20, unchanged: 5 },
  enablersWithoutUseCase: [],
  useCasesWithoutEnabler: [],
  wrote: true,
  ...over,
});

describe('renderLearningFieldRunReport', () => {
  it('names the mode, the target and the counts per table', () => {
    const text = renderLearningFieldRunReport(report(), info);
    expect(text).toContain('# Lauf des Lernfeld-Imports');
    expect(text).toContain('Probelauf (alles ausgeführt, zurückgerollt)');
    expect(text).toContain(
      'Ziel: local, Host 127.0.0.1, Schema public, Rolle postgres.'
    );
    expect(text).toContain('| Lernfelder | 13 | 0 | 0 |');
    expect(text).toContain(
      '| Zuordnungen (Enabler zu Lernfeld) | 22 | 0 | 3 |'
    );
    expect(text).toContain(
      '| Zuordnungen (Use Case zu Lernfeld) | 30 | 0 | 4 |'
    );
    expect(text).toContain(
      '| Use Cases (Lernfeld-Codes in der Spalte lernfelder) | 0 | 20 | 5 |'
    );
    expect(text).not.toContain('## Enabler ohne Use Case');
    expect(text).not.toContain('## Use Cases ohne Enabler');
    expect(text).not.toContain('## Konflikte');
    expect(text).not.toMatch(/[–—]/);
  });

  it('names the other modes', () => {
    expect(
      renderLearningFieldRunReport(report(), { ...info, mode: 'check' })
    ).toContain('Prüfung (nur lesend)');
    expect(
      renderLearningFieldRunReport(report(), { ...info, mode: 'apply' })
    ).toContain('Echter Lauf (übernommen)');
  });

  it('lists skipped enablers, differences, conflicts and kept mappings', () => {
    const text = renderLearningFieldRunReport(
      report({
        skipped: [
          {
            row: 8,
            column: null,
            code: 'ENABLER_NOT_IN_DATABASE',
            enablerCode: 'K6.2-d',
            componentCode: 'K6.2',
            learningField: null,
            pairs: 2,
            reason: 'x',
          },
        ],
        differences: [
          {
            table: 'training_catalog_learning_fields',
            key: 'LF1',
            columns: ['title'],
          },
        ],
        conflicts: [
          {
            table: 'training_catalog_learning_fields',
            key: 'LF3',
            reason: 'Die Stelle ist belegt.',
          },
        ],
        keptMappings: 4,
      }),
      { ...info, updateExisting: true }
    );
    expect(text).toContain(
      '## Übersprungen: Enabler fehlt in der Zieldatenbank'
    );
    expect(text).toContain('| K6.2-d | K6.2 | 2 |');
    expect(text).toContain(
      '1 Enabler des Plans fehlen in der Zieldatenbank, 2 Zuordnungen sind deshalb nicht geschrieben'
    );
    expect(text).toContain(
      'Mit --update-existing nur Titel, Beschreibung und Stunden aktualisiert'
    );
    expect(text).toContain('- training_catalog_learning_fields LF1: title');
    expect(text).toContain('## Konflikte');
    expect(text).toContain(
      '- training_catalog_learning_fields LF3: Die Stelle ist belegt.'
    );
    expect(text).toContain('4 bestehende Zuordnungen');
  });

  it('says that differences are not changed without --update-existing and cuts long lists', () => {
    const many = Array.from({ length: 205 }, (_v, i) => ({
      table: 'training_catalog_learning_fields',
      key: `LF${i}`,
      columns: ['order_index'],
    }));
    const text = renderLearningFieldRunReport(
      report({ differences: many }),
      info
    );
    expect(text).toContain('Nicht geändert (dafür gibt es --update-existing)');
    expect(text).toContain('einer leeren Beschreibung');
    expect(text).toContain('und 5 weitere');
  });

  it('lists the enablers without a use case and the use cases without an enabler', () => {
    const text = renderLearningFieldRunReport(
      report({
        enablersWithoutUseCase: ['K23.2-b'],
        useCasesWithoutEnabler: ['5b', '9z'],
      }),
      info
    );
    expect(text).toContain('## Enabler ohne Use Case');
    expect(text).toContain('Enabler mit Lernfeld, aber ohne Use Case: 1.');
    expect(text).toContain('K23.2-b');
    expect(text).toContain('## Use Cases ohne Enabler');
    expect(text).toContain('Use Cases des Katalogs ohne Enabler: 2.');
    expect(text).toContain('5b, 9z');
    expect(text).not.toMatch(/[–—]/);
  });

  it('cuts a long list of codes', () => {
    const codes = Array.from({ length: 203 }, (_v, i) => `c${i}`);
    const text = renderLearningFieldRunReport(
      report({ useCasesWithoutEnabler: codes }),
      info
    );
    expect(text).toContain('und 3 weitere');
    expect(text).not.toContain('c202');
  });
});
