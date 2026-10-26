// Invented source files for the tests of the apply step. Nothing here comes
// from an original document: the folder names follow the scheme of the source
// tree, every text is made up.
import fs from 'fs';
import path from 'path';

import { parseDecisions } from '@/lib/content-import/apply/decisions';
import type { SourceFile } from '@/lib/content-import/apply/plan';
import type { Decisions } from '@/lib/content-import/apply/types';
import { pathInfo } from '@/lib/content-import/path-info';
import {
  parseQuizText,
  parseScenarioText,
} from '@/lib/content-import/source-parsers';

export const BASE_TIME = Date.UTC(2026, 9, 1, 8, 0, 0);
export const HOUR = 3600 * 1000;

export const DIR = {
  k1: 'Komponente Teil 1 (1-15 Monate)/01 - Erfundenes Thema Eins (§ 4 Abs. 2 Nr. 1)',
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

export function quizLines({
  heading,
  level = 'leicht',
  count = 10,
  correct = 'B',
  tag = 'q',
  skipAnswerOf = 0,
}: {
  heading: string;
  level?: string | null;
  count?: number;
  correct?: string;
  tag?: string;
  skipAnswerOf?: number;
}): string[] {
  const lines = [heading];
  if (level) lines.push(`Quiz, Schwierigkeitsgrad: ${level}`);
  for (let n = 1; n <= count; n += 1) {
    lines.push(
      `${n}. Erfundene Frage ${tag}${n}?`,
      'A) erste Antwort',
      'B) zweite Antwort',
      'C) dritte Antwort',
      'D) vierte Antwort'
    );
    if (n !== skipAnswerOf) lines.push(`Richtige Antwort: ${correct}`);
    lines.push(`Kurzbegründung: Erfundene Begründung ZETA-${tag}${n}.`);
  }
  return lines;
}

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

export const enablerContent = (
  heading: string | null,
  body: string[] = ['Erfundener Lehrtext, erster Absatz.', 'Zweiter Absatz.']
): SourceFile['content'] => ({
  type: 'enabler',
  paragraphs: [
    ...(heading === null ? [] : [{ text: heading, bold: true }]),
    ...body.map(text => ({ text, bold: false })),
  ],
});

export const quizContent = (
  options: Parameters<typeof quizLines>[0]
): SourceFile['content'] => ({
  type: 'quiz',
  result: parseQuizText(quizLines(options)),
});

export const globalQuizContent = (
  key: string,
  count = 20,
  tag = 'g'
): SourceFile['content'] => ({
  type: 'global-quiz',
  result: parseQuizText(
    quizLines({
      heading: `${key}) Erfundenes Globalthema (§ 4 Abs. 2 Nr. 1)`,
      level: null,
      count,
      tag,
    }).flatMap((line, index) => (index === 0 ? [line, 'Global Quiz'] : [line]))
  ),
});

export const scenarioContent = (
  code: string,
  options: { solutionHeading?: string } = {}
): SourceFile['content'] => ({
  type: 'scenario',
  result: parseScenarioText([
    `Szenario ${code}) Erfundenes Szenario`,
    'Ausgangssituation',
    'Eine erfundene Lage am Arbeitsplatz.',
    options.solutionHeading ?? 'Lösungsszenario',
    'Eine erfundene Lösung OMEGA.',
    'Wie das Fachwissen zur Lösung beiträgt',
    'Ein erfundener Beitrag SIGMA.',
  ]),
});

/** Enabler text, three quizzes and a scenario of one enabler. */
export function completeEnabler(
  dir: string,
  number: string,
  letter: string,
  title = 'Erfundenes Enabler-Thema'
): SourceFile[] {
  const id = `${number}${letter}`;
  const folder = `${dir}/Enablers/${id}_Thema`;
  const quiz = (level: string, word: string) =>
    file(
      `${folder}/Quiz/${id}_Quiz_${level}.docx`,
      quizContent({
        heading: `${id}) ${title}`,
        level: word,
        tag: `${id}${level}`,
      })
    );
  return [
    file(`${folder}/${id}.docx`, enablerContent(`${id}) ${title}`)),
    quiz('Low', 'leicht'),
    quiz('Medium', 'mittel'),
    quiz('High', 'anspruchsvoll'),
    file(`${folder}/Szenario/Szenario_${id}.docx`, scenarioContent(id)),
  ];
}

/** A small tree: K1 (a, b), K6.1 (a), K6.2 (d), K10 (a), K20 (a), all with a global quiz. */
export function sampleTree(): SourceFile[] {
  return [
    ...completeEnabler(DIR.k1, '1', 'a'),
    ...completeEnabler(DIR.k1, '1', 'b', 'Zweites Thema'),
    file(
      `${DIR.k1}/Global Quiz/01_Global_Quiz_Thema.docx`,
      globalQuizContent('01')
    ),
    ...completeEnabler(DIR.k6_1, '6', 'a'),
    file(
      `${DIR.k6_1}/Global Quiz/06.1_Global_Quiz_Thema.docx`,
      globalQuizContent('06.1')
    ),
    ...completeEnabler(DIR.k6_2, '6', 'd'),
    file(
      `${DIR.k6_2}/Global Quiz/06.2_Global_Quiz_Thema.docx`,
      globalQuizContent('06.2')
    ),
    ...completeEnabler(DIR.k10, '10', 'a'),
    file(
      `${DIR.k10}/Global Quiz/10_Global_Quiz_Thema.docx`,
      globalQuizContent('10')
    ),
    ...completeEnabler(DIR.k20, '20', 'a'),
    file(
      `${DIR.k20}/Global Quiz/20_Global_Quiz_Thema.docx`,
      globalQuizContent('20')
    ),
  ];
}
