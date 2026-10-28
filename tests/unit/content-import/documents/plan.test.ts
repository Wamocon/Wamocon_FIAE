import { describe, expect, it } from '@jest/globals';

import {
  classifyPdfPath,
  headingId,
} from '@/lib/content-import/documents/classify';
import {
  MAX_PDF_BYTES,
  buildDocumentPlan,
  countPlan,
  renderPlanSummary,
  validateDocumentPlan,
} from '@/lib/content-import/documents/plan';
import type { ScannedPdf } from '@/lib/content-import/documents/types';

const K62 = '06.2 - Auftragsbearbeitung durchführen (§ 4 Abs. 2 Nr. 6)';
const K242 =
  '24.2 - Arbeitsorganisation und Informationsmanagement (§ 4 Abs. 4 Nr. 5)';
const K23 = '23 - digitalisierte Arbeitswelt (§ 4 Abs. 4 Nr. 4)';
const K14 =
  '14 - Marketing und Vertriebsaktivitäten mitgestalten (§ 4 Abs. 3 Nr. 5)';
const K1 = '01 - Informationsmanagement anwenden (§ 4 Abs. 2 Nr. 1)';

describe('classifyPdfPath', () => {
  it('reads the component, the kind and the enabler of the four folders', () => {
    expect(
      classifyPdfPath(
        `${K62}/Enabler/6d_Auftragsabwicklung_mit_Kunden_festlegen.pdf`
      )
    ).toMatchObject({
      kind: 'enabler',
      componentCode: 'K6.2',
      enablerKey: '6.2d',
      enablerCode: 'K6.2-d',
      status: 'ok',
    });
    expect(
      classifyPdfPath(`${K62}/Szenarien/Szenario_6e_Begleitdokumente.pdf`)
    ).toMatchObject({ kind: 'scenario', enablerCode: 'K6.2-e', status: 'ok' });
    expect(
      classifyPdfPath(`${K62}/Use-Cases/UC_6f_Vor_und_Nachkalkulationen.pdf`)
    ).toMatchObject({
      kind: 'usecase_task',
      enablerCode: 'K6.2-f',
      status: 'ok',
    });
    expect(
      classifyPdfPath(
        `${K62}/Use-Cases_Musterlösung/UC_6g_Beschwerden_Reklamationen_bearbeiten_Musterlösung.pdf`
      )
    ).toMatchObject({
      kind: 'usecase_solution',
      enablerCode: 'K6.2-g',
      status: 'ok',
    });
  });

  it('reads a component without a split', () => {
    expect(classifyPdfPath(`${K1}/Enabler/1a.pdf`)).toMatchObject({
      componentCode: 'K1',
      enablerKey: '1a',
      enablerCode: 'K1-a',
      status: 'ok',
    });
  });

  it('reads the ids with a split and a bracket (24_2e).pdf, 23a).pdf, 14c.pdf)', () => {
    expect(classifyPdfPath(`${K242}/Enabler/24_2e).pdf`)).toMatchObject({
      enablerCode: 'K24.2-e',
      status: 'ok',
      nameId: { number: 24, split: 2, letter: 'e' },
    });
    expect(
      classifyPdfPath(`${K242}/Szenarien/Szenario_24_2e.pdf`)
    ).toMatchObject({
      enablerCode: 'K24.2-e',
      status: 'ok',
    });
    expect(
      classifyPdfPath(`${K242}/Use-Cases/UC_24_2e_eigene_Arbeitsweise.pdf`)
    ).toMatchObject({ enablerCode: 'K24.2-e', status: 'ok' });
    expect(classifyPdfPath(`${K23}/Enabler/23a).pdf`)).toMatchObject({
      enablerCode: 'K23-a',
      status: 'ok',
    });
    expect(classifyPdfPath(`${K14}/Enabler/14c.pdf`)).toMatchObject({
      enablerCode: 'K14-c',
      status: 'ok',
    });
  });

  it('takes the folder names in any Unicode form and with backslashes', () => {
    const nfd = 'Use-Cases_Musterlösung'.normalize('NFD');
    expect(
      classifyPdfPath(
        `${K62.normalize('NFD')}\\${nfd}\\UC_6d_Titel_Musterlösung.pdf`
      )
    ).toMatchObject({ kind: 'usecase_solution', enablerCode: 'K6.2-d' });
  });

  it('does not guess a file that is named wrongly: 14i.pdf in Szenarien', () => {
    const c = classifyPdfPath(`${K14}/Szenarien/14i.pdf`);
    expect(c.status).toBe('misnamed');
    expect(c.kind).toBe('scenario');
    expect(c.reason).toMatch(/does not follow/);
  });

  it('does not take a file with a note: Szenario_23c (aus 23b).pdf', () => {
    const c = classifyPdfPath(`${K23}/Szenarien/Szenario_23c (aus 23b).pdf`);
    expect(c.status).toBe('annotated');
    expect(c.reason).toMatch(/note/);
    // the plain file of the same slot is fine
    expect(classifyPdfPath(`${K23}/Szenarien/Szenario_23c.pdf`).status).toBe(
      'ok'
    );
  });

  it('refuses a solution file in the task folder and a task file in the solution folder', () => {
    expect(
      classifyPdfPath(`${K62}/Use-Cases/UC_6d_Titel_Musterlösung.pdf`).status
    ).toBe('misnamed');
    expect(
      classifyPdfPath(`${K62}/Use-Cases_Musterlösung/UC_6d_Titel.pdf`).status
    ).toBe('misnamed');
  });

  it('refuses an id that does not fit the component folder', () => {
    expect(classifyPdfPath(`${K62}/Enabler/7a_Titel.pdf`).status).toBe(
      'misnamed'
    );
    expect(classifyPdfPath(`${K62}/Enabler/6.1d_Titel.pdf`).status).toBe(
      'misnamed'
    );
    // the split may be missing in the name
    expect(classifyPdfPath(`${K62}/Enabler/6d_Titel.pdf`).status).toBe('ok');
  });

  it('ignores the folder Quizze, other folders and other file types', () => {
    expect(classifyPdfPath(`${K1}/Quizze/1a_Quiz_Low.pdf`)).toMatchObject({
      kind: null,
      status: 'ignored',
    });
    expect(classifyPdfPath(`${K1}/Sonstiges/1a.pdf`).status).toBe('ignored');
    expect(classifyPdfPath(`${K1}/Enabler/1a.docx`).status).toBe('ignored');
    expect(classifyPdfPath('1a.pdf').status).toBe('ignored');
    // a file deeper in the tree is no file of the folder
    expect(classifyPdfPath(`${K1}/Enabler/Unter/1a.pdf`).status).toBe(
      'ignored'
    );
    expect(classifyPdfPath('Ordner ohne Nummer/Enabler/1a.pdf').status).toBe(
      'ignored'
    );
  });
});

describe('headingId', () => {
  it('finds the id in the heading of the first page', () => {
    const head = [
      'WAMOCON GmbH, Mergenthalerallee 79-81, 65760 Eschborn',
      'Copyright © 2026 WAMOCON GmbH. Alle Rechte vorbehalten. 1',
      '6d) Auftragsabwicklung mit Kunden festlegen',
      'Inhaltsverzeichnis',
    ].join('\n');
    expect(headingId(head)).toEqual({
      number: 6,
      split: null,
      letter: 'd',
      scenario: false,
    });
  });

  it('knows the scenario heading and a heading with a split', () => {
    expect(headingId('Szenario 6d) Auftragsabwicklung')).toMatchObject({
      number: 6,
      letter: 'd',
      scenario: true,
    });
    expect(headingId('1\nSzenario 24e) Arbeitsweise')).toMatchObject({
      number: 24,
      scenario: true,
    });
    expect(headingId('24.2e) Die eigene Arbeitsweise')).toMatchObject({
      number: 24,
      split: 2,
      letter: 'e',
    });
  });

  it('knows the other forms of the headings: Szenario_14j), 25/1a), 25/1b - Titel', () => {
    expect(headingId('Szenario_14j) Verträge')).toMatchObject({
      number: 14,
      letter: 'j',
      scenario: true,
    });
    expect(headingId('Szenario 25/1a) Interne und externe')).toMatchObject({
      number: 25,
      split: 1,
      letter: 'a',
      scenario: true,
    });
    expect(headingId('25/1b - Aufgaben im Team')).toMatchObject({
      number: 25,
      split: 1,
      letter: 'b',
      scenario: false,
    });
    // a typo in the heading is no heading (F12l)
    expect(headingId('F12l) Angebote')).toBeNull();
  });

  it('takes no id from the middle of a line, a later page or an empty text', () => {
    expect(headingId('Siehe auch 6d) im Text')).toBeNull();
    expect(headingId('')).toBeNull();
    expect(headingId(null)).toBeNull();
    const far = [...Array(40).fill('Zeile'), '6d) zu spät'].join('\n');
    expect(headingId(far)).toBeNull();
  });
});

const scanned = (
  rel: string,
  over: Partial<ScannedPdf> = {},
  heading?: string
): ScannedPdf => ({
  rel,
  size: 1000,
  magicOk: true,
  sha256: 'a'.repeat(64),
  pageCount: 3,
  headText: heading ?? null,
  ...over,
});

describe('buildDocumentPlan', () => {
  const enabler = (
    name: string,
    heading: string,
    over: Partial<ScannedPdf> = {}
  ) => scanned(`${K62}/Enabler/${name}`, over, heading);

  it('accepts a file whose name and heading name the same enabler', () => {
    const plan = buildDocumentPlan([
      enabler('6d_Titel.pdf', '6d) Titel'),
      scanned(`${K242}/Enabler/24_2e).pdf`, {}, '24e) Die eigene Arbeitsweise'),
      scanned(
        `${K62}/Szenarien/Szenario_6d_Titel.pdf`,
        {},
        'Szenario 6d) Titel'
      ),
    ]);
    expect(
      plan.items
        .map(i => [i.enablerCode, i.kind, i.status])
        .sort((a, b) => String(a).localeCompare(String(b)))
    ).toEqual([
      ['K24.2-e', 'enabler', 'ok'],
      ['K6.2-d', 'enabler', 'ok'],
      ['K6.2-d', 'scenario', 'ok'],
    ]);
  });

  it('reports a heading of another enabler and a missing heading, and imports neither', () => {
    const plan = buildDocumentPlan([
      enabler('6d_Titel.pdf', '6e) Anderes Thema'),
      enabler('6e_Titel.pdf', 'Kein Kennzeichen hier'),
      // a split in the heading that differs from the folder
      enabler('6f_Titel.pdf', '6.1f) Titel'),
      // a scenario heading in an enabler file
      enabler('6g_Titel.pdf', 'Szenario 6g) Titel'),
    ]);
    expect(plan.items.map(i => i.status)).toEqual([
      'heading-mismatch',
      'heading-missing',
      'heading-mismatch',
      'heading-mismatch',
    ]);
    // a scenario whose heading leaves out the word is a scenario by its folder
    const scenario = buildDocumentPlan([
      scanned(`${K62}/Szenarien/Szenario_6d_Titel.pdf`, {}, '6d) Titel'),
    ]);
    expect(scenario.items[0].status).toBe('ok');
    expect(plan.items[0].headingKey).toBe('6e');
    expect(plan.items.every(i => i.reason)).toBe(true);
  });

  it('reports unreadable files: no PDF, empty, too large, not read', () => {
    const plan = buildDocumentPlan([
      enabler('6d_A.pdf', '6d) A', { magicOk: false }),
      enabler('6e_B.pdf', '6e) B', { size: 0 }),
      enabler('6f_C.pdf', '6f) C', { size: MAX_PDF_BYTES + 1 }),
      enabler('6g_D.pdf', '', { readError: 'placeholder', magicOk: undefined }),
    ]);
    expect(plan.items.map(i => i.status)).toEqual([
      'unreadable',
      'unreadable',
      'unreadable',
      'unreadable',
    ]);
  });

  it('keeps misnamed and annotated files out and names two files of one slot', () => {
    const plan = buildDocumentPlan([
      scanned(`${K14}/Szenarien/14i.pdf`, {}, 'Szenario 14i) Kundensituation'),
      scanned(
        `${K23}/Szenarien/Szenario_23c (aus 23b).pdf`,
        {},
        'Szenario 23c) X'
      ),
      scanned(`${K23}/Szenarien/Szenario_23c.pdf`, {}, 'Szenario 23c) X'),
      scanned(`${K23}/Enabler/23a).pdf`, {}, '23a) A'),
      scanned(`${K23}/Enabler/23a_Titel.pdf`, {}, '23a) A'),
    ]);
    const byName = (name: string) =>
      plan.items.find(i => i.rel.endsWith(name))?.status;
    expect(byName('/14i.pdf')).toBe('misnamed');
    expect(byName('Szenario_23c (aus 23b).pdf')).toBe('annotated');
    expect(byName('Szenario_23c.pdf')).toBe('ok');
    expect(byName('/23a).pdf')).toBe('duplicate');
    expect(byName('23a_Titel.pdf')).toBe('duplicate');
  });

  it('counts by kind and status and the plan is valid', () => {
    const plan = buildDocumentPlan([
      enabler('6d_A.pdf', '6d) A'),
      scanned(`${K62}/Use-Cases/UC_6d_A.pdf`, {}, '6d) A'),
      scanned(
        `${K62}/Use-Cases_Musterlösung/UC_6d_A_Musterlösung.pdf`,
        {},
        '6d) A'
      ),
      scanned(`${K1}/Quizze/1a_Quiz_Low.pdf`),
    ]);
    const counts = countPlan(plan);
    expect(counts.total).toBe(4);
    expect(counts.byKind).toEqual({
      enabler: 1,
      scenario: 0,
      usecase_task: 1,
      usecase_solution: 1,
    });
    expect(counts.byStatus).toEqual({ ok: 3, ignored: 1 });
    expect(validateDocumentPlan(plan)).toEqual([]);
  });

  it('is the same for the same files in another order', () => {
    const files = [enabler('6e_B.pdf', '6e) B'), enabler('6d_A.pdf', '6d) A')];
    expect(buildDocumentPlan(files)).toEqual(
      buildDocumentPlan([...files].reverse())
    );
  });

  it('the summary names counts and files with a problem, no content', () => {
    const plan = buildDocumentPlan([
      enabler('6d_A.pdf', '6d) A'),
      scanned(
        `${K14}/Szenarien/14i.pdf`,
        {},
        'Szenario 14i) Geheimer Titel im Text'
      ),
    ]);
    const text = renderPlanSummary(plan);
    expect(text).toContain('misnamed');
    expect(text).toContain('14i.pdf');
    expect(text).not.toContain('Geheimer Titel');
  });

  it('validateDocumentPlan names a broken plan', () => {
    expect(validateDocumentPlan({ version: 2, items: [] } as any)).not.toEqual(
      []
    );
    expect(validateDocumentPlan({ version: 1, items: 'x' } as any)).not.toEqual(
      []
    );
    expect(
      validateDocumentPlan({
        version: 1,
        items: [{ rel: 'a', status: 'ok', kind: null, enablerCode: null }],
      } as any)
    ).not.toEqual([]);
  });
});
