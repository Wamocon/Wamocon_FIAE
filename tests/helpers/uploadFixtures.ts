// Invented inputs for the tests of the upload reading and the excerpt. They
// follow the shape of the real KfBM files (docs/kfbm-import-quellformat.md) but
// contain nothing from an original file. The canary texts mark the solution
// parts: a test fails when one of them reaches an excerpt.
import JSZip from 'jszip';

import type { Paragraph } from '@/lib/content-import/types';

export const CANARY = {
  rationale: 'Kanarienbegruendung ZEBRAKANAL weil das Protokoll so arbeitet',
  correct: 'Kanarienoption QUOKKA ist der richtige Weg im Netzwerk',
  scenarioSolution:
    'Kanarienantwort WOMBAT beschreibt den Ablauf Schritt fuer Schritt',
  knowledge:
    'Kanarienfachwissen LAMA verbindet Theorie mit der Praxis im Betrieb',
  useCaseSolution: 'Kanarienergebnis OKAPI rechnet 12 mal 7 gleich 84 Euro',
  criteria: 'Kanarienkriterium TAPIR vergibt Punkte fuer die Berechnung',
} as const;

/** Every canary word, to search for in an excerpt. */
export const CANARY_WORDS = [
  'ZEBRAKANAL',
  'QUOKKA',
  'WOMBAT',
  'LAMA',
  'OKAPI',
  'TAPIR',
] as const;

export interface Block {
  text: string;
  bold?: boolean;
  hidden?: boolean;
}

export const b = (text: string): Block => ({ text, bold: true });
export const t = (text: string): Block => ({ text });

export const blocksToParagraphs = (blocks: Block[]): Paragraph[] =>
  blocks
    .filter(block => !block.hidden)
    .map(block => ({ text: block.text, bold: Boolean(block.bold) }));

// --- Word ---------------------------------------------------------------

export const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const run = (text: string, options: Omit<Block, 'text'> = {}) =>
  `<w:r>${
    options.bold || options.hidden
      ? `<w:rPr>${options.bold ? '<w:b/>' : ''}${
          options.hidden ? '<w:vanish/>' : ''
        }</w:rPr>`
      : ''
  }<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

export const para = (text: string, options: Omit<Block, 'text'> = {}) =>
  `<w:p><w:pPr></w:pPr>${run(text, options)}</w:p>`;

export const blocksToBody = (blocks: Block[]) =>
  blocks.map(block => para(block.text, block)).join('');

export const tableXml = (rows: string[][]) =>
  `<w:tbl><w:tblPr></w:tblPr>${rows
    .map(
      row =>
        `<w:tr>${row
          .map(cell => `<w:tc><w:tcPr></w:tcPr>${para(cell)}</w:tc>`)
          .join('')}</w:tr>`
    )
    .join('')}</w:tbl>`;

export const documentXml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;

export const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';

export interface DocxOptions {
  /** More parts of the package, by path. */
  parts?: Record<string, string | Buffer>;
  compression?: 'STORE' | 'DEFLATE';
  /** Leave out [Content_Types].xml. */
  noContentTypes?: boolean;
  comment?: string;
}

export async function docxBytes(
  body: string,
  options: DocxOptions = {}
): Promise<Buffer> {
  const zip = new JSZip();
  if (!options.noContentTypes) zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('word/document.xml', documentXml(body));
  for (const [name, content] of Object.entries(options.parts ?? {})) {
    zip.file(name, content);
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: options.compression ?? 'STORE',
    ...(options.comment ? { comment: options.comment } : {}),
  });
}

export const docxFromBlocks = (blocks: Block[], options?: DocxOptions) =>
  docxBytes(blocksToBody(blocks), options);

// --- Documents in the style of the sources ---------------------------------

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

function question(number: number): Block[] {
  return [
    b(`${number}. Welche Aussage zu Thema ${number} trifft zu?`),
    t(`A) Eine erfundene falsche Aussage ${number}.`),
    t(`B) ${CANARY.correct} ${number}.`),
    t(`C) Eine zweite erfundene falsche Aussage ${number}.`),
    t(`D) Eine dritte erfundene falsche Aussage ${number}.`),
    b('Richtige Antwort: B'),
    t(`Kurzbegründung: ${CANARY.rationale} ${number}.`),
  ];
}

export function quizBlocks(
  options: { code?: string; title?: string; questions?: number } = {}
): Block[] {
  const { code = '1b', title = 'Netzwerkgrundlagen', questions = 5 } = options;
  const blocks: Block[] = [
    t(`${code}) ${title}`),
    t('Quiz, Schwierigkeitsgrad: leicht'),
  ];
  for (let i = 1; i <= questions; i += 1) blocks.push(...question(i));
  return blocks;
}

export function globalQuizBlocks(): Block[] {
  const blocks: Block[] = [
    t('06.1) Betriebliche Abläufe (§ 4 Abs. 2 Nr. 6)'),
    t('Global Quiz'),
  ];
  for (let i = 1; i <= 20; i += 1) blocks.push(...question(i));
  return blocks;
}

export function scenarioBlocks(
  options: { code?: string; title?: string } = {}
): Block[] {
  const { code = '1b', title = 'Der ausgefallene Router' } = options;
  return [
    t(`Szenario ${code}) ${title}`),
    b('Ausgangssituation'),
    t(
      'Die erfundene Firma Beispiel Technik betreibt ein kleines Netz mit einem Router und zwei Switches. Am Montag fällt die Verbindung ins Internet aus.'
    ),
    t('Die Auszubildende soll die Ursache finden und den Betrieb sichern.'),
    b('Lösungsszenario'),
    t(CANARY.scenarioSolution),
    b('Wie das Fachwissen zur Lösung beiträgt'),
    t(CANARY.knowledge),
  ];
}

export function useCaseBlocks(
  options: { code?: string; title?: string } = {}
): Block[] {
  const { code = '4a', title = 'Rechnungen prüfen' } = options;
  return [
    t(`${code}) ${title}`),
    b('Behandelte Themen'),
    t(
      'Dieses Beispiel wiederholt die Grundlagen der Rechnungsprüfung, die Umsatzsteuer und den Zahlungsweg.'
    ),
    b('Ausgangssituation'),
    t(
      'Die erfundene Firma Beispiel Handel erhält Eingangsrechnungen von drei Lieferanten.'
    ),
    b('Eckdaten'),
    t('Anzahl Rechnungen: 12'),
    b('Zielsetzung'),
    t(
      'Die Rechnungen sind zu prüfen, zu kontieren und für die Zahlung freizugeben.'
    ),
    b('Weg zum Ziel'),
    t('Schritt 1: Eingang prüfen. Schritt 2: Betrag abgleichen.'),
    b('Musterlösung'),
    t(CANARY.useCaseSolution),
  ];
}

const TEACHING_SENTENCES = [
  'Ein Router verbindet zwei Netze miteinander und entscheidet anhand der Zieladresse, über welche Schnittstelle ein Paket weitergeleitet wird.',
  'Ein Switch arbeitet auf der zweiten Schicht und lernt die Adressen der angeschlossenen Geräte in einer Tabelle.',
  'Die Adressvergabe kann statisch oder über einen Dienst erfolgen, der Geräten beim Start eine Adresse zuteilt.',
  'Für die Fehlersuche beginnt man am besten bei der Verkabelung und geht Schicht für Schicht nach oben.',
];

export function enablerBlocks(
  options: { code?: string; title?: string; paragraphs?: number } = {}
): Block[] {
  const { code = '4a', title = 'Netzwerkgeräte', paragraphs = 8 } = options;
  const blocks: Block[] = [t(`${code}) ${title}`)];
  for (let i = 0; i < paragraphs; i += 1) {
    if (i % 3 === 0) blocks.push(b(`Abschnitt ${i / 3 + 1}`));
    blocks.push(t(TEACHING_SENTENCES[i % TEACHING_SENTENCES.length]));
  }
  return blocks;
}

/** A document without any structure of the sources. */
export function unknownBlocks(): Block[] {
  return [
    t('Einführung in die Datensicherung'),
    b('Warum Sicherungen wichtig sind'),
    t(
      'Daten gehen durch Fehler, Ausfälle und Irrtümer verloren. Eine Sicherung hält den Stand zu einem Zeitpunkt fest.'
    ),
    b('Wie oft sichern'),
    t('Das hängt davon ab, wie viel Arbeit man verlieren darf.'),
  ];
}

export const OPTION_LETTER_LIST = OPTION_LETTERS;

// --- PDF ------------------------------------------------------------------

export interface PdfOptions {
  /** Lines of text, one list per page. */
  pages?: string[][];
  /** Raw text for the catalog dictionary, for example an action. */
  catalog?: string;
  /** Raw text for the trailer dictionary. */
  trailer?: string;
  /** Raw objects (full text, with number and endobj) added to the file. */
  extraObjects?: string[];
}

const pdfEscape = (text: string) =>
  text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** A small valid PDF with the text of the given pages in Helvetica. */
export function pdfBytes(options: PdfOptions = {}): Buffer {
  const pages = options.pages ?? [['Eine erfundene Zeile für den Test.']];
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1 catalog, 2 pages, 3 font, then a page and a content stream per page
  objects[1] = `<< /Type /Catalog /Pages 2 0 R ${options.catalog ?? ''} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let next = 4;
  const contentOf = (lines: string[]) => {
    let y = 780;
    const body = lines
      .map(line => {
        const text = `BT /F1 12 Tf 50 ${y} Td (${pdfEscape(line)}) Tj ET`;
        y -= 18;
        return text;
      })
      .join('\n');
    return `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  };
  for (const lines of pages) {
    const pageId = next;
    const contentId = next + 1;
    next += 2;
    pageIds.push(pageId);
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objects[contentId] = contentOf(lines);
  }
  objects[2] = `<< /Type /Pages /Kids [${pageIds
    .map(id => `${id} 0 R`)
    .join(' ')}] /Count ${pageIds.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  let size = objects.length;
  for (const extra of options.extraObjects ?? []) {
    offsets[size] = out.length;
    out += extra.replace('%ID%', String(size));
    size += 1;
  }
  const xref = out.length;
  out += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id += 1) {
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${size} /Root 1 0 R ${
    options.trailer ?? ''
  } >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
