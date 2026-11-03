/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {
  collectTables,
  normalizeKey,
  parseDelimited,
  readPlanCsv,
  readPlanJson,
  readPlanXlsx,
} from '@/lib/catalog/content-plan/read-structured';
import {
  EXAMPLE_PLAN,
  buildTemplateJson,
  buildTemplateXlsx,
} from '@/lib/catalog/content-plan/template';
import { RowCollector, rowsToPlan } from '@/lib/catalog/content-plan/rows';
import { contentPlanSchema } from '@/lib/catalog/content-plan/types';
import { editText, withEntry } from '../../../../helpers/xlsxHostile';

const enc = (text: string) => new TextEncoder().encode(text);

async function xlsxOf(sheets: Record<string, (string | number)[][]>) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  const zip = await JSZip.loadAsync(
    XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  );
  zip.file(
    '[Content_Types].xml',
    (await zip.file('[Content_Types].xml')!.async('string')).replace(
      /<Default Extension="bin"[^>]*\/>/g,
      ''
    )
  );
  return new Uint8Array(await zip.generateAsync({ type: 'nodebuffer' }));
}

describe('template round trip: template, read, same plan', () => {
  it('xlsx', async () => {
    const result = await readPlanXlsx(await buildTemplateXlsx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.issues).toEqual([]);
    expect(result.draft.method).toBe('script');
    const plan = rowsToPlan(result.draft.rows);
    expect(plan).toEqual(EXAMPLE_PLAN);
    expect(contentPlanSchema.safeParse(plan).success).toBe(true);
    // the unchanged template is recognised
    expect(result.draft.warnings).toContain('EXAMPLE_TEMPLATE');
  });

  it('json', () => {
    const result = readPlanJson(enc(buildTemplateJson()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.issues).toEqual([]);
    expect(rowsToPlan(result.draft.rows)).toEqual(EXAMPLE_PLAN);
    expect(result.draft.warnings).toContain('EXAMPLE_TEMPLATE');
  });

  it('csv with sections', () => {
    const csv = [
      '# Gesamt',
      'Kennzahl;Wert',
      'Komponenten;2',
      'Stunden gesamt;160',
      '# Komponenten',
      'Code;Titel;Phase;Art;Stunden;Wochen;Enabler;Szenarien;Use Cases;Quizze;Global-Quiz;Reihenfolge;Lernfelder',
      'BSP-1;"Beispielkomponente Grundlagen";1;pflicht;80;2;5;5;5;15;ja;1;LF-A',
      '# Lernfelder',
      'Code;Titel;Stunden',
      'LF-A;Beispiel-Lernfeld A;60',
      '# Beziehungen',
      'Art;Von;Nach',
      'Enabler-Lernfeld;BSP-1-a;LF-A',
      '# Hinweise',
      'Hinweis',
      'Ein freier Hinweis',
    ].join('\n');
    const result = readPlanCsv(enc(csv));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.issues).toEqual([]);
    expect(rowsToPlan(result.draft.rows)).toEqual({
      totals: { components: 2, hours: 160 },
      components: [
        {
          code: 'BSP-1',
          title: 'Beispielkomponente Grundlagen',
          phase: 1,
          kind: 'pflicht',
          hours: 80,
          weeks: 2,
          enablers: 5,
          scenarios: 5,
          useCases: 5,
          quizzes: 15,
          globalQuiz: true,
          order: 1,
          learningFields: ['LF-A'],
        },
      ],
      learningFields: [
        { code: 'LF-A', title: 'Beispiel-Lernfeld A', hours: 60 },
      ],
      relations: [
        { type: 'enabler_learning_field', from: 'BSP-1-a', to: 'LF-A' },
      ],
      notes: ['Ein freier Hinweis'],
    });
    expect(result.draft.rows.some(r => /Zeile \d+/.test(r.quote))).toBe(true);
  });
});

describe('xlsx', () => {
  it('reads one table of a workbook, the other parts are "not stated"', async () => {
    const bytes = await xlsxOf({
      Komponenten: [
        ['Code', 'Titel', 'Stunden'],
        ['K1', 'Grundlagen', 40],
        ['K2', 'Vertiefung', ''],
      ],
    });
    const result = await readPlanXlsx(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(rowsToPlan(result.draft.rows)).toEqual({
      components: [
        { code: 'K1', title: 'Grundlagen', hours: 40 },
        { code: 'K2', title: 'Vertiefung' },
      ],
    });
    // an empty cell is never a zero
    expect(result.draft.rows.some(r => r.value === 0)).toBe(false);
  });

  it('finds the sheets by name, with other casing, aliases and accents', async () => {
    const bytes = await xlsxOf({
      Hinweise: [['Wichtig: Wahlpflicht']],
      GESAMT: [
        ['Kennzahl', 'Wert'],
        ['Use Cases', 12],
        ['Fragen je Quiz', 10],
      ],
    });
    const result = await readPlanXlsx(bytes);
    if (!result.ok) throw new Error(result.code);
    expect(rowsToPlan(result.draft.rows)).toEqual({
      totals: { useCases: 12, questionsPerQuiz: 10 },
      notes: ['Wichtig: Wahlpflicht'],
    });
  });

  it('drops a bad cell with its place and keeps the rest', async () => {
    const bytes = await xlsxOf({
      Gesamt: [
        ['Kennzahl', 'Wert'],
        ['Enabler', 'viele'],
        ['Szenarien', -4],
        ['Komponenten', 27],
        ['Erfundenes', 3],
      ],
    });
    const result = await readPlanXlsx(bytes);
    if (!result.ok) throw new Error(result.code);
    expect(rowsToPlan(result.draft.rows)).toEqual({
      totals: { components: 27 },
    });
    expect(result.draft.issues).toEqual([
      { where: 'Blatt Gesamt, Zeile 2', message: 'invalid_value' },
      { where: 'Blatt Gesamt, Zeile 3', message: 'invalid_value' },
      { where: 'Blatt Gesamt, Zeile 5', message: 'unknown_field' },
    ]);
  });

  it('ignores comment rows that start with #', async () => {
    const bytes = await xlsxOf({
      Lernfelder: [
        ['Code', 'Titel', 'Stunden'],
        ['#LF-X', 'nicht lesen', 5],
        ['LF-1', 'Gelesen', 20],
      ],
    });
    const result = await readPlanXlsx(bytes);
    if (!result.ok) throw new Error(result.code);
    expect(rowsToPlan(result.draft.rows).learningFields).toEqual([
      { code: 'LF-1', title: 'Gelesen', hours: 20 },
    ]);
  });

  it('refuses a workbook without any table of the template', async () => {
    const bytes = await xlsxOf({
      Tabelle1: [
        ['a', 'b'],
        [1, 2],
      ],
    });
    expect(await readPlanXlsx(bytes)).toEqual({
      ok: false,
      code: 'NO_PLAN_TABLE',
    });
  });

  it('refuses what the safe reader refuses: macro, links, no zip', async () => {
    const good = Buffer.from(await buildTemplateXlsx());
    const macro = await withEntry(good, 'xl/vbaProject.bin', 'x');
    expect(await readPlanXlsx(macro)).toEqual({
      ok: false,
      code: 'MACRO_ENABLED',
    });
    const typed = await editText(good, '[Content_Types].xml', x =>
      x.replace('sheet.main+xml', 'sheet.macroEnabled.main+xml')
    );
    expect((await readPlanXlsx(typed)).ok).toBe(false);
    const result = await readPlanXlsx(new Uint8Array(Buffer.from('not a zip')));
    expect(result.ok).toBe(false);
  });
});

describe('csv', () => {
  it('parses quotes, doubled quotes, line breaks and a byte order mark', () => {
    expect(parseDelimited('a;"b;c";"d""e"\n1;2;3\r\n', ';')).toEqual([
      ['a', 'b;c', 'd"e'],
      ['1', '2', '3'],
    ]);
    const result = readPlanCsv(enc('﻿Kennzahl,Wert\nEnabler,12\n'));
    expect(result.ok && rowsToPlan(result.draft.rows)).toEqual({
      totals: { enablers: 12 },
    });
  });

  it('recognises a single table by its header, comma or tab as delimiter', () => {
    const lf = readPlanCsv(enc('Code\tTitel\tStunden\nLF1\tNetz\t60\n'));
    expect(lf.ok && rowsToPlan(lf.draft.rows)).toEqual({
      learningFields: [{ code: 'LF1', title: 'Netz', hours: 60 }],
    });
    const rel = readPlanCsv(enc('Art,Von,Nach\nUseCase-Enabler,UC1,K1-a\n'));
    expect(rel.ok && rowsToPlan(rel.draft.rows)).toEqual({
      relations: [{ type: 'use_case_enabler', from: 'UC1', to: 'K1-a' }],
    });
  });

  it('reads a German thousand separator in a csv', () => {
    const result = readPlanCsv(enc('Kennzahl;Wert\nStunden gesamt;"1.200"\n'));
    expect(result.ok && rowsToPlan(result.draft.rows)).toEqual({
      totals: { hours: 1200 },
    });
  });

  it('refuses a file without a table, and a file that is no UTF-8 text', () => {
    expect(readPlanCsv(enc('nur ein Satz'))).toEqual({
      ok: false,
      code: 'NO_PLAN_TABLE',
    });
    expect(readPlanCsv(new Uint8Array([0xff, 0xfe, 0xfa]))).toEqual({
      ok: false,
      code: 'NOT_TEXT',
    });
  });

  it('reports an unknown kind of relation', () => {
    const result = readPlanCsv(enc('Art;Von;Nach\nIrgendwas;A;B\n'));
    expect(result.ok && result.draft.issues).toEqual([
      { where: 'Zeile 2', message: 'unknown_relation' },
    ]);
  });
});

describe('json', () => {
  it('reads only the plan model, keys with an underscore are explanations', () => {
    const result = readPlanJson(
      enc(
        JSON.stringify({
          _anleitung: 'egal',
          totals: { enablers: 10, hours: 'viel' },
          components: [{ code: 'K1', title: 'T', phase: 2, bogus: 1 }],
          relations: [
            { type: 'component_learning_field', from: 'K1', to: 'LF1' },
          ],
          notes: ['Ein Hinweis', 5],
          surprise: true,
        })
      )
    );
    if (!result.ok) throw new Error(result.code);
    expect(rowsToPlan(result.draft.rows)).toEqual({
      totals: { enablers: 10 },
      components: [{ code: 'K1', title: 'T', phase: 2 }],
      relations: [{ type: 'component_learning_field', from: 'K1', to: 'LF1' }],
      notes: ['Ein Hinweis'],
    });
    expect(result.draft.issues.map(i => i.where).sort()).toEqual([
      'JSON components[0].bogus',
      'JSON notes[1]',
      'JSON surprise',
      'JSON totals.hours',
    ]);
  });

  it('refuses text that is no JSON, an array, and an empty object', () => {
    expect(readPlanJson(enc('{nope'))).toEqual({ ok: false, code: 'NOT_JSON' });
    expect(readPlanJson(enc('[1,2]'))).toEqual({
      ok: false,
      code: 'NOT_AN_OBJECT',
    });
    expect(readPlanJson(enc('{"_x":1}'))).toEqual({
      ok: false,
      code: 'NO_PLAN_TABLE',
    });
  });

  it('never fills "not stated" with null or zero', () => {
    const result = readPlanJson(
      enc(JSON.stringify({ totals: { enablers: null, scenarios: '' } }))
    );
    // nothing was stated, so there is nothing to propose (and no zero)
    expect(result).toEqual({ ok: false, code: 'NO_PLAN_TABLE' });
  });
});

describe('table helpers', () => {
  it('normalises header names', () => {
    expect(normalizeKey('Use Cases')).toBe('usecases');
    expect(normalizeKey('Global-Quiz')).toBe('globalquiz');
    expect(normalizeKey('Zeitrichtwert (Stunden)')).toBe(
      'zeitrichtwertstunden'
    );
    expect(normalizeKey('Größe')).toBe('grosse');
  });

  it('a component row without code and title is reported', () => {
    const c = new RowCollector();
    collectTables(
      {
        components: [
          { row: 1, cells: ['Code', 'Titel', 'Stunden'] },
          { row: 2, cells: ['', '', '5'] },
        ],
      },
      c
    );
    expect(c.issues).toEqual([
      { where: 'Komponenten, Zeile 2', message: 'missing_name' },
    ]);
  });

  it('a table without a header is reported', () => {
    const c = new RowCollector();
    collectTables({ components: [{ row: 1, cells: ['x', 'y'] }] }, c);
    expect(c.issues).toEqual([{ where: 'Komponenten', message: 'no_header' }]);
  });
});
