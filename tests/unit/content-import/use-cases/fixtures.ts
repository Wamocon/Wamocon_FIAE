// Invented use case documents for the tests of the use case import. Nothing
// here comes from an original document: the structure follows the format of the
// source (heading, sections, data tables as table rows), every text is made up.
import fs from 'fs';
import path from 'path';

import { parseDecisions } from '@/lib/content-import/apply/decisions';
import type { Decisions } from '@/lib/content-import/apply/types';
import { pathInfo } from '@/lib/content-import/path-info';
import type { Paragraph } from '@/lib/content-import/types';
import { parseUseCaseText } from '@/lib/content-import/use-cases/parser';
import type { SourceFile } from '@/lib/content-import/use-cases/plan';

export const BASE_TIME = Date.UTC(2026, 9, 1, 8, 0, 0);
export const HOUR = 3600 * 1000;

export const DIR = {
  k1: 'Komponente Teil 1 (1-15 Monate)/01 - Erfundenes Thema Eins (§ 4 Abs. 2 Nr. 1)',
  k5: 'Komponente Teil 1 (1-15 Monate)/05 - Erfundene Kunden (§ 4 Abs. 2 Nr. 5)',
  k6_1: 'Komponente Teil 1 (1-15 Monate)/06.1 - Erfundenes Thema Sechs (§ 4 Abs. 2 Nr. 6)',
  k6_2: 'Komponente Teil 2 (16-36 Monate)/06.2 - Erfundenes Thema Sechs (§ 4 Abs. 2 Nr. 6)',
  k10: 'Komponente Teil 2 (16-36 Monate)/10 - Erfundenes Wahlthema (§ 4 Abs. 3 Nr. 1)',
  k18: 'Komponente Teil 2 (16-36 Monate)/18 - Erfundene Verwaltung (§ 4 Abs. 3 Nr. 9)',
  k20: 'Komponente - während der gesamten Ausbildung/20 - Erfundenes Querthema (§ 4 Abs. 4 Nr. 1)',
  k26: 'Komponente Teil 2 (16-36 Monate)/26 - Erfundenes Neues (§ 4 Abs. 5 Nr. 1)',
};

export function loadDecisions(
  patch: (raw: any) => void = () => undefined
): Decisions {
  const raw = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'scripts', 'import', 'kfbm-decisions.json'),
      'utf8'
    )
  );
  patch(raw);
  const result = parseDecisions(raw);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.decisions;
}

export const bold = (text: string): Paragraph => ({ text, bold: true });
export const plain = (text: string): Paragraph => ({ text, bold: false });

/** A table: one list of cell texts per row. The first row is bold (header). */
export function table(rows: string[][], firstRow = 1, firstCell = 1) {
  const out: Paragraph[] = [];
  let cell = firstCell;
  rows.forEach((cells, r) => {
    for (const text of cells) {
      out.push({ text, bold: r === 0, row: firstRow + r, cell });
      cell += 1;
    }
  });
  return out;
}

export interface UseCaseOptions {
  /** Heading line, default "<code>) Erfundener Titel". */
  heading?: string;
  /** Leave out these sections. */
  omit?: string[];
  /** Replace the text of the solution (the repeated step and the table stay). */
  solution?: string;
  /** The solution section holds only this text. */
  bareSolution?: string;
  /** Add the section Bewertungskriterien at the end. */
  criteria?: string;
  /** Extra paragraphs inside the visible steps. */
  extraSteps?: Paragraph[];
  tag?: string;
}

/** The paragraphs of a complete invented use case. */
export function useCaseParagraphs(
  code: string,
  options: UseCaseOptions = {}
): Paragraph[] {
  const tag = options.tag ?? code;
  const omit = new Set(options.omit ?? []);
  const out: Paragraph[] = [
    plain(options.heading ?? `${code}) Erfundener Titel ${tag}`),
  ];
  if (!omit.has('topics')) {
    out.push(
      bold('Behandelte Themen'),
      plain(`Erfundenes Thema A: Lehrsatz ${tag}.`)
    );
  }
  if (!omit.has('situation')) {
    out.push(
      bold('Ausgangssituation'),
      plain(`Die erfundene Firma ${tag} hat ein Problem.`)
    );
    if (!omit.has('data')) {
      out.push(
        bold('Eckdaten'),
        plain('Die Daten stehen in der Tabelle.'),
        ...table([
          ['Posten', 'Menge'],
          ['Schrauben', '12'],
          ['Muttern', ''],
        ])
      );
    }
  }
  if (!omit.has('objective')) {
    out.push(
      bold('Zielsetzung'),
      plain(`Erstellen Sie einen erfundenen Vorschlag ${tag}.`)
    );
  }
  if (!omit.has('steps')) {
    out.push(
      bold('Weg zum Ziel'),
      plain('Erster Schritt: Daten erfassen.'),
      plain('Zweiter Schritt: Ergebnis begründen.'),
      ...(options.extraSteps ?? [])
    );
  }
  if (!omit.has('solution') && options.bareSolution) {
    out.push(bold('Musterlösung'), plain(options.bareSolution));
  } else if (!omit.has('solution')) {
    out.push(
      bold('Musterlösung'),
      plain('Erster Schritt: Daten erfassen.'),
      plain(
        options.solution ??
          `Die erfundene Musterlösung OMEGA-${tag} nennt zwölf Schrauben.`
      ),
      ...table([
        ['Posten', 'Ergebnis'],
        ['Schrauben', `ZETA-${tag}`],
      ])
    );
  }
  if (options.criteria) {
    out.push(bold('Bewertungskriterien'), plain(options.criteria));
  }
  return out;
}

export const useCaseContent = (
  code: string,
  options: UseCaseOptions = {}
): NonNullable<SourceFile['content']> => ({
  type: 'use-case',
  result: parseUseCaseText(useCaseParagraphs(code, options)),
});

export function file(
  rel: string,
  content?: SourceFile['content'],
  extra: Partial<
    Pick<SourceFile, 'size' | 'mtimeMs' | 'placeholder' | 'readError'>
  > = {}
): SourceFile {
  return {
    rel,
    size: 1000,
    mtimeMs: BASE_TIME,
    placeholder: false,
    info: pathInfo(rel),
    ...(content ? { content } : {}),
    ...extra,
  };
}

/** The path of a use case file, in the folder spelling K<N>_Use-Cases. */
export const ucPath = (
  dir: string,
  folderCode: string,
  fileCode: string,
  sub = ''
) =>
  `${dir}/K${folderCode}_Use-Cases/${sub ? `${sub}/` : ''}UC_${fileCode}_Titel.docx`;

/** A small tree: K1 (a, b), K6.1 (a), K6.2 (d), K10 (a), K20 (a). */
export function sampleTree(): SourceFile[] {
  return [
    file(ucPath(DIR.k1, '1', '1a'), useCaseContent('1a')),
    file(ucPath(DIR.k1, '1', '1b'), useCaseContent('1b')),
    file(ucPath(DIR.k6_1, '6.1', '6a'), useCaseContent('6.1a')),
    file(ucPath(DIR.k6_2, '6.2', '6d'), useCaseContent('6.2d')),
    file(ucPath(DIR.k10, '10', '10a'), useCaseContent('10a')),
    file(ucPath(DIR.k20, '20', '20a'), useCaseContent('20a')),
  ];
}
