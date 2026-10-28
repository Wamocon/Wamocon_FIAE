// The short description of an enabler (enablers.description_text), derived from
// the paragraphs of its Word document. Pure functions: no file access, no
// database, no model. The same paragraphs always give the same text.
//
// Why: the FIAE enablers carry only the topics that the enabler treats: one intro
// line and a short list, one catchword or short phrase per line (about 265
// characters, five lines). The teaching text itself is the PDF document of the
// enabler. The Word document of a KfBM enabler is the whole teaching text (on
// average 20000 characters). It stays in the PDF document and is no description,
// so the description is built like the one of FIAE.
//
// Intro: the most frequent FIAE form (120 of 185 FIAE enablers with a
// description, measured in pdf_mapping_enriched.json; 5 of the 6 samples of the
// preview copy): In diesem Modul "<Titel>" werden folgende Inhalte behandelt:
// A title of more than MAX_TITLE characters would crowd out the list, then the
// shorter FIAE form is used: In dieser Datei werden folgende Themen behandelt:
//
// Topics, in the order of the text:
//  - the headings of the table of contents ("Inhaltsverzeichnis", the main
//    headings of the teaching text, set as plain lines) and
//  - the bold short lines outside tables (the subheadings)
// without filler headings (Überblick, Einleitung, Zusammenfassung, Quellen,
// Übungen, Aufgaben, Merke, Fazit, Beispiele), without source notes ("Quelle:
// ..."), table captions, page numbers and the cells of tables, each topic once.
// More than MAX_TOPICS topics are cut down: the main headings stay as far as
// they fit (spread evenly if there are more than MAX_TOPICS of them), the places
// that are left go to subheadings spread evenly over the text. Topics that carry
// a solution marker are never taken.
//
// A document without any heading gets the first sentences of its first paragraph
// of running text instead, a short document its own paragraphs.

import { SOLUTION_MARKERS } from './apply/guard';
import { shortenText, splitSentences } from './short-text';
import type { Paragraph } from './types';

/** The description has at most this many characters. */
export const ENABLER_SUMMARY_MAX = 600;
/** A text without headings gets sentences of the text up to this length. */
export const ENABLER_SUMMARY_MIN = 150;
/** At most this many topics (FIAE: about 4 to 12). */
export const ENABLER_SUMMARY_MAX_TOPICS = 12;
/** A title longer than this is not repeated in the intro line. */
export const ENABLER_SUMMARY_MAX_TITLE = 120;
/** The FIAE intro without a title. */
export const ENABLER_SUMMARY_INTRO =
  'In dieser Datei werden folgende Themen behandelt:';

/** The intro line of the list, the most frequent FIAE form. */
export function enablerSummaryIntro(title: string | null | undefined): string {
  const t = (title ?? '').replace(/\s+/g, ' ').replace(/"/g, "'").trim();
  if (t.length === 0 || t.length > ENABLER_SUMMARY_MAX_TITLE) {
    return ENABLER_SUMMARY_INTRO;
  }
  return `In diesem Modul "${t}" werden folgende Inhalte behandelt:`;
}

/** A longest single topic (a heading that long is shortened). */
const MAX_ENTRY = 110;
/** The longest line that can be a subheading. */
const MAX_HEADING = 90;
/** A paragraph that is a sentence of running text is at least this long. */
const MIN_PARAGRAPH = 80;

const TOC_HEADING = /^(?:Inhaltsverzeichnis|Inhalt)\s*:?$/i;
// "Title<tab>3" or "Title ...... 3"
const TOC_ENTRY = /^(.*?\S)\s*(?:\t+|\.{3,}|\s{3,})\s*\d{1,3}$/;
// A heading line is short. A longer line is never tested, the pattern
// backtracks on a long run of white space.
const MAX_TOC_LINE = 300;
const tocMatch = (text: string) =>
  text.length <= MAX_TOC_LINE ? TOC_ENTRY.exec(text) : null;
// Filler headings and the labels that the texts set in bold again and again
// (column and row labels of tables that are written as plain lines as well).
const GENERIC_PART = new RegExp(
  '^(?:' +
    [
      'Überblick',
      'Einleitung',
      'Zusammenfassung',
      'Fazit',
      'Quellen(?:verzeichnis)?',
      'Literatur(?:verzeichnis)?',
      'Übung(?:en)?',
      'Aufgaben?',
      'Merke',
      'Inhalt(?:sverzeichnis)?',
      'Beispiele?',
      'Erläuterung(?:en)?',
      'Erklärung(?:en)?',
      'Bedeutung',
      'Beschreibung',
      'Definition',
      'Merkmale?',
      'Vorteile?',
      'Nachteile?',
      'Wirkung',
      'Leitfragen?',
      'Hinweise?',
      'Thema',
      'Teil\\s+\\d+',
    ].join('|') +
    ')$',
  'i'
);
// "1. Titel", "2.1 Titel", but not "3 Gründe"
const NUMBERING = /^(?:\d+\.\d+(?:\.\d+)*\.?|\d+\.)\s+/;
const SOURCE_NOTE = /^(?:Gesamt)?quellen?\b/i;
const NOT_A_TOPIC = /^(?:Tabelle|Abbildung|Seite)\s+\d|^\d+$/i;

const hasMarker = (text: string) => SOLUTION_MARKERS.some(m => m.test(text));

interface Line {
  text: string;
  bold: boolean;
  inTable: boolean;
}

function toLines(input: ReadonlyArray<string | Paragraph>): Line[] {
  const lines: Line[] = [];
  for (const item of input) {
    const paragraph: Paragraph =
      typeof item === 'string' ? { text: item, bold: false } : item;
    // a tab or a run of spaces is kept for the table of contents, the rest of
    // the white space is one space
    const text = paragraph.text.trim();
    if (text.length === 0) continue;
    lines.push({
      text,
      bold: paragraph.bold,
      inTable: paragraph.row !== undefined || paragraph.cell !== undefined,
    });
  }
  return lines;
}

/** The headings of the table of contents and the index of the first line after it. */
function tocEntries(lines: readonly Line[]): {
  entries: string[];
  after: number;
} {
  const start = lines.findIndex(line => TOC_HEADING.test(line.text));
  if (start < 0) return { entries: [], after: 0 };
  const entries: string[] = [];
  let index = start + 1;
  for (; index < lines.length; index += 1) {
    const match = tocMatch(lines[index].text);
    if (!match) break;
    entries.push(match[1].replace(NUMBERING, '').trim());
  }
  // a bare word "Inhalt" in the middle of the text is a heading, no table of contents
  if (entries.length === 0) return { entries, after: 0 };
  return { entries, after: index };
}

interface Topic {
  text: string;
  main: boolean;
}

function usable(text: string): boolean {
  return (
    text.length > 0 &&
    !GENERIC_PART.test(text) &&
    !NOT_A_TOPIC.test(text) &&
    !hasMarker(text)
  );
}

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The topics in the order of the text: main headings (table of contents) and bold subheadings. */
function collectTopics(
  lines: readonly Line[],
  entries: readonly string[],
  from: number
): Topic[] {
  const mains = new Set(
    entries
      .map(clean)
      .filter(usable)
      .map(e => e.toLowerCase())
  );
  const topics: Topic[] = [];
  const seen = new Set<string>();
  const add = (text: string, main: boolean) => {
    const key = text.toLowerCase();
    if (seen.has(key) || !usable(text)) return;
    seen.add(key);
    topics.push({ text, main });
  };
  for (const line of lines.slice(from)) {
    if (tocMatch(line.text) !== null) continue;
    const text = clean(line.text).replace(NUMBERING, '');
    if (mains.has(text.toLowerCase())) {
      add(text, true);
      continue;
    }
    if (
      line.bold &&
      !line.inTable &&
      text.length <= MAX_HEADING &&
      !/[.!?:;,]$/.test(text) &&
      !SOURCE_NOTE.test(text)
    ) {
      add(text, false);
    }
  }
  if (topics.length === 0) {
    // no headings in the text: the main headings of the table of contents
    for (const entry of entries) add(clean(entry), true);
  }
  return topics;
}

/** `count` items spread evenly over the list, in order. */
function spread<T>(items: readonly T[], count: number): T[] {
  if (count >= items.length) return [...items];
  const out: T[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(items[Math.floor(((2 * i + 1) * items.length) / (2 * count))]);
  }
  return out;
}

/** At most `limit` topics: the main headings first, the free places go to subheadings. */
function pick(topics: readonly Topic[], limit: number): Topic[] {
  if (topics.length <= limit) return [...topics];
  const mains = topics.filter(t => t.main);
  const keptMains = new Set(spread(mains, Math.min(mains.length, limit)));
  const subs = topics.filter(t => !t.main);
  const keptSubs = new Set(spread(subs, Math.max(0, limit - keptMains.size)));
  return topics.filter(t => keptMains.has(t) || keptSubs.has(t));
}

function render(intro: string, topics: readonly Topic[]): string {
  const list = topics.map(t => `- ${shortenText(t.text, MAX_ENTRY)}`);
  return `${intro}\n\n${list.join('\n')}`;
}

/** The first sentences of the first paragraph of running text, up to the minimum length. */
function leadText(lines: readonly Line[], from: number): string {
  for (const line of lines.slice(from)) {
    if (
      line.text.length < MIN_PARAGRAPH ||
      SOURCE_NOTE.test(line.text) ||
      tocMatch(line.text) !== null ||
      !/[.!?]["”“)»]*$/.test(line.text)
    ) {
      continue;
    }
    const sentences = splitSentences(line.text).filter(s => !hasMarker(s));
    let lead = '';
    for (const sentence of sentences) {
      const next = lead ? `${lead} ${sentence}` : sentence;
      if (next.length > ENABLER_SUMMARY_MAX) break;
      lead = next;
      if (lead.length >= ENABLER_SUMMARY_MIN) break;
    }
    if (!lead && sentences.length > 0) {
      lead = shortenText(sentences[0], ENABLER_SUMMARY_MAX);
    }
    if (lead) return lead;
  }
  return '';
}

/** A document that is short anyway is its own description: whole paragraphs up to the limit. */
function shortParagraphs(lines: readonly Line[], from: number): string {
  const parts: string[] = [];
  for (const line of lines.slice(from)) {
    if (TOC_HEADING.test(line.text) || tocMatch(line.text) !== null) continue;
    if (SOURCE_NOTE.test(line.text) || hasMarker(line.text)) continue;
    if ([...parts, line.text].join('\n\n').length > ENABLER_SUMMARY_MAX) break;
    parts.push(line.text);
  }
  return parts.join('\n\n');
}

/**
 * The short description of an enabler from the paragraphs of its document
 * (the heading line already removed), or null if the document gives none.
 * `title` is the title of the enabler for the intro line.
 */
export function summarizeEnablerText(
  paragraphs: ReadonlyArray<string | Paragraph>,
  title?: string | null
): string | null {
  const lines = toLines(paragraphs);
  if (lines.length === 0) return null;
  const { entries, after } = tocEntries(lines);
  const topics = collectTopics(lines, entries, after);
  const intro = enablerSummaryIntro(title);

  if (topics.length > 0) {
    // as many topics as fit: cut down the list until the text is short enough
    for (let limit = ENABLER_SUMMARY_MAX_TOPICS; limit > 1; limit -= 1) {
      const text = render(intro, pick(topics, limit));
      if (text.length <= ENABLER_SUMMARY_MAX) return text;
    }
    // one topic is at most MAX_ENTRY characters, so it always fits
    return render(intro, pick(topics, 1));
  }
  const text = leadText(lines, after) || shortParagraphs(lines, after);
  return text.length > 0 ? text : null;
}
