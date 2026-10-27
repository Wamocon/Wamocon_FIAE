// Invented inputs for the tests of the rule based assignment (package U4). The
// folder names follow the scheme of the source tree and the texts follow the
// shape of the real files (docs/kfbm-import-quellformat.md), but nothing comes
// from an original file.
import fs from 'fs';
import path from 'path';

import { parseDecisions } from '@/lib/content-import/apply/decisions';
import type { Decisions } from '@/lib/content-import/apply/types';
import type { Paragraph } from '@/lib/content-import/types';
import {
  buildPositiveList,
  positiveListFromPaths,
  type PositiveList,
  type PositiveListInput,
} from '@/lib/content-upload/classify/positive-list';

export const T1 = 'Komponente Teil 1 (1-15 Monate)';
export const T2 = 'Komponente Teil 2 (16-36 Monate)';
export const ALL = 'Komponente - während der gesamten Ausbildung';
export const GLOBAL = '00_Global_Quizze';

export const DIR = {
  k1: `${T1}/01 - Erfundenes Thema Eins (§ 4 Abs. 2 Nr. 1)`,
  k6_1: `${T1}/06.1 - Erfundenes Thema Sechs (§ 4 Abs. 2 Nr. 6)`,
  k6_2: `${T2}/06.2 - Erfundenes Thema Sechs (§ 4 Abs. 2 Nr. 6)`,
  k10: `${T2}/10 - Erfundenes Wahlthema (§ 4 Abs. 3 Nr. 1)`,
  k12: `${T2}/12 - Erfundenes Wahlthema Zwei (§ 4 Abs. 3 Nr. 3)`,
  k18: `${T2}/18 - Erfundene Verwaltung (§ 4 Abs. 3 Nr. 9)`,
  k20: `${ALL}/20 - Erfundenes Querthema (§ 4 Abs. 4 Nr. 1)`,
  k23: `${ALL}/23 - Erfundenes Querthema Drei (§ 4 Abs. 4 Nr. 4)`,
  k26: `${T2}/26 - Erfundenes Neues (§ 4 Abs. 5 Nr. 1)`,
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

const plain = (lines: string[]): Paragraph[] =>
  lines.map(text => ({ text, bold: false }));

const boldAt = (lines: string[], bold: RegExp): Paragraph[] =>
  lines.map(text => ({ text, bold: bold.test(text) }));

/** Quiz lines of an enabler quiz, in the format of the sources. */
export function quizDoc(
  code: string,
  level: 'leicht' | 'mittel' | 'anspruchsvoll' | string = 'leicht',
  options: { count?: number; heading?: string; tag?: string } = {}
): Paragraph[] {
  const { count = 4, tag = code } = options;
  const lines = [
    options.heading ?? `${code}) Erfundenes Thema ${tag}`,
    `Quiz, Schwierigkeitsgrad: ${level}`,
  ];
  for (let n = 1; n <= count; n += 1) {
    lines.push(
      `${n}. Erfundene Frage ${tag}${n}?`,
      'A) erste Antwort',
      'B) zweite Antwort',
      'C) dritte Antwort',
      'D) vierte Antwort',
      'Richtige Antwort: B',
      `Kurzbegründung: Erfundene Begründung ${tag}${n}.`
    );
  }
  return boldAt(lines, /^(\d+\. |Richtige Antwort)/);
}

/** A global quiz of 20 questions with the heading of its component. */
export function globalQuizDoc(
  key: string,
  options: { count?: number; refLine?: boolean; tag?: string } = {}
): Paragraph[] {
  const { count = 20, tag = key } = options;
  const lines = options.refLine
    ? [`${key}) Erfundenes Globalthema ${tag}`, '(§ 4 Abs. 2 Nr. 1)']
    : [`${key}) Erfundenes Globalthema ${tag} (§ 4 Abs. 2 Nr. 1)`];
  lines.push('Global Quiz');
  for (let n = 1; n <= count; n += 1) {
    lines.push(
      `${n}. Erfundene Globalfrage ${tag}${n}?`,
      'A) erste Antwort',
      'B) zweite Antwort',
      'C) dritte Antwort',
      'D) vierte Antwort',
      'Richtige Antwort: C',
      `Kurzbegründung: Erfundene Begründung ${tag}${n}.`
    );
  }
  return plain(lines);
}

export function scenarioDoc(
  code: string,
  options: { heading?: string; tag?: string } = {}
): Paragraph[] {
  const { tag = code } = options;
  return [
    {
      text: options.heading ?? `Szenario ${code}) Erfundenes Szenario ${tag}`,
      bold: false,
    },
    { text: 'Ausgangssituation', bold: true },
    { text: `Eine erfundene Lage am Arbeitsplatz ${tag}.`, bold: false },
    { text: 'Lösungsszenario', bold: true },
    { text: `Eine erfundene Lösung ${tag}.`, bold: false },
    { text: 'Wie das Fachwissen zur Lösung beiträgt', bold: true },
    { text: `Ein erfundener Beitrag ${tag}.`, bold: false },
  ];
}

export function useCaseDoc(
  code: string,
  options: { heading?: string; tag?: string } = {}
): Paragraph[] {
  const { tag = code } = options;
  return [
    {
      text: options.heading ?? `${code}) Erfundener Use Case ${tag}`,
      bold: false,
    },
    { text: 'Behandelte Themen', bold: true },
    { text: `Erfundene Themen ${tag}.`, bold: false },
    { text: 'Ausgangssituation', bold: true },
    { text: `Eine erfundene Firma ${tag}.`, bold: false },
    { text: 'Eckdaten', bold: true },
    { text: 'Anzahl: 12', bold: false },
    { text: 'Zielsetzung', bold: true },
    { text: `Ein erfundenes Ziel ${tag}.`, bold: false },
    { text: 'Weg zum Ziel', bold: true },
    { text: `Erfundene Schritte ${tag}.`, bold: false },
    { text: 'Musterlösung', bold: true },
    { text: `Erfundene Lösung ${tag}.`, bold: false },
  ];
}

const SENTENCES = [
  'Ein erfundener Lehrtext erklärt, wie ein Router zwei Netze verbindet und Pakete weiterleitet.',
  'Ein Switch lernt die Adressen der angeschlossenen Geräte und leitet Rahmen gezielt weiter.',
  'Die Adressvergabe kann statisch oder über einen Dienst erfolgen, der beim Start eine Adresse zuteilt.',
  'Für die Fehlersuche beginnt man bei der Verkabelung und geht Schicht für Schicht nach oben.',
];

export function enablerDoc(
  code: string,
  options: { heading?: string; paragraphs?: number; tag?: string } = {}
): Paragraph[] {
  const { paragraphs = 6, tag = code } = options;
  const out: Paragraph[] = [
    {
      text: options.heading ?? `${code}) Erfundener Lehrtext ${tag}`,
      bold: false,
    },
  ];
  for (let i = 0; i < paragraphs; i += 1) {
    if (i % 3 === 0) out.push({ text: `Abschnitt ${i / 3 + 1}`, bold: true });
    out.push({
      text: `${SENTENCES[i % SENTENCES.length]} (${tag})`,
      bold: false,
    });
  }
  return out;
}

/** A document without any structure of the sources. */
export function unknownDoc(): Paragraph[] {
  return [
    { text: 'Einführung in die Datensicherung', bold: false },
    { text: 'Warum Sicherungen wichtig sind', bold: true },
    { text: 'Daten gehen durch Fehler und Ausfälle verloren.', bold: false },
  ];
}

/** Lines of a PDF text: three header lines come before the heading. */
export function withPdfHeader(doc: Paragraph[]): Paragraph[] {
  return [
    {
      text: 'Erfundener Briefkopf, Musterstraße 1, 12345 Musterstadt',
      bold: false,
    },
    { text: 'Erfundene Urheberzeile, alle Rechte vorbehalten', bold: false },
    {
      text: 'Erfundene Themenzeile mit mehreren Stichworten zum Inhalt der Datei',
      bold: false,
    },
    ...doc.map(p => ({ ...p, bold: false })),
  ];
}

/** Folder of an enabler text with its quiz and scenario folders. */
export const enablerFolder = (dir: string, id: string) =>
  `${dir}/Enablers/${id}_Thema`;

export const paths = {
  enabler: (dir: string, id: string) => `${enablerFolder(dir, id)}/${id}.docx`,
  quiz: (dir: string, id: string, level: 'Low' | 'Medium' | 'High') =>
    `${enablerFolder(dir, id)}/Quiz/${id}_Quiz_${level}.docx`,
  scenario: (dir: string, id: string) =>
    `${enablerFolder(dir, id)}/Szenario/Szenario_${id}.docx`,
  useCase: (dir: string, num: string, id: string) =>
    `${dir}/K${num}_Use-Cases/UC_${id}_Titel.docx`,
  globalQuiz: (dir: string, key: string) =>
    `${dir}/Global Quiz/${key}_Global_Quiz_Thema.docx`,
};

/** The positive list of the invented tree: the folders of the paths. */
export function listOfPaths(
  relPaths: string[],
  origin: 'database' | 'plan' = 'database'
): PositiveList {
  const input = positiveListFromPaths(relPaths);
  const withOrigin: PositiveListInput = {
    components: input.components.map(component => ({
      ...component,
      origin,
      enablers: (component.enablers ?? []).map(enabler => ({
        ...enabler,
        origin,
      })),
    })),
  };
  return buildPositiveList(withOrigin);
}

/** Components and enablers of the small tree used by most tests. */
export const SMALL_LIST: PositiveListInput = {
  components: [
    {
      code: 'K1',
      title: 'Erfundenes Thema Eins',
      group: 'teil1',
      enablers: [{ code: 'K1-a' }, { code: 'K1-b' }],
    },
    {
      code: 'K6.1',
      group: 'teil1',
      enablers: [{ code: 'K6.1-a' }, { code: 'K6.1-d' }],
    },
    {
      code: 'K6.2',
      group: 'teil2',
      enablers: [{ code: 'K6.2-d' }, { code: 'K6.2-e' }],
    },
    {
      code: 'K12',
      group: 'wahl',
      enablers: [{ code: 'K12-a' }],
    },
    {
      code: 'K20',
      group: 'ganze',
      enablers: [{ code: 'K20-a' }],
    },
    {
      code: 'K23',
      group: 'ganze',
      enablers: [{ code: 'K23-b' }, { code: 'K23-c' }],
    },
    {
      code: 'K24.1',
      group: 'teil1',
      enablers: [{ code: 'K24.1-a' }],
    },
  ],
};

export const smallList = () => buildPositiveList(SMALL_LIST);
