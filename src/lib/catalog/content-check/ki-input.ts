/**
 * What the AI review may see (pure): a short summary per component, built from
 * titles and the head of a description, never whole documents.
 *
 * Per component one unit with at most EXCERPT_MAX_CHARS characters (a component
 * with many enablers is split into several units, none is left out):
 *   Komponente: <title>
 *   E1: <enabler title> | Beschreibung: <head> | Szenarien: <titles> | Use Case: <title>
 * (Missing documents, quizzes and the like are no topic for the AI: the script
 * checks report them, and the AI would only repeat them.)
 *   E2: ...
 * The enablers get the handles E1, E2 ... of this unit. The answer names an
 * object by a handle only, never by a free text, so a made up object cannot be
 * mapped to anything (the courses and enablers of some catalogs have no code at
 * all, a handle works everywhere).
 *
 * What goes in: titles of the component, the enablers, the scenario documents
 * (type EXERCISE) and the use cases, and the head of the
 * description text of an enabler (at most DESCRIPTION_HEAD_CHARS characters,
 * only when it says more than the title). What never goes in: file names or
 * paths (a name can carry an instruction), the text of a document (scenario
 * texts name persons, solution texts must not leave the platform at all), ids,
 * codes of the database, anything of a user or an organization.
 * Every text passes the cleaning of the content upload (sanitizeExcerptText,
 * redactPersonalData, markers of a solution, wording that speaks to a model), a
 * text that does not pass is replaced by a note. A text that is cut ends with
 * the ellipsis, and the request tells the model that this is no error. The
 * guard of the upload (checkRequest) checks the finished excerpt once more
 * before it is sent (ki-review.ts).
 */

import { EXCERPT_MAX_CHARS } from '@/lib/content-upload/limits';
import {
  findInstructionText,
  hasSolutionMarker,
  redactPersonalData,
} from '@/lib/content-upload/patterns';
import { sanitizeExcerptText } from '@/lib/content-upload/text-clean';
import type {
  ContentSnapshot,
  SnapshotDocument,
  SnapshotEnabler,
} from '@/lib/catalog/content-check/snapshot';
import type { FindingRef } from '@/lib/catalog/content-check/types';

/** Longest head of an enabler description that goes into the summary. */
export const DESCRIPTION_HEAD_CHARS = 140;
/** Most scenario titles named per enabler. */
const MAX_DOC_TITLES = 3;
/** Room kept free below the limit of the excerpt. */
const EXCERPT_ROOM = 100;
/** Shown instead of a title that did not pass the cleaning. */
export const WITHHELD = '(Text nicht gesendet)';

export interface KiUnit {
  /** The component this unit describes. */
  courseId: string;
  /** Title of the component (cleaned), for the notes. */
  title: string;
  /** The excerpt, at most EXCERPT_MAX_CHARS characters. */
  excerpt: string;
  /** Handle of the answer ("K" or "E1") to the object of the report. */
  handles: Map<string, FindingRef>;
  /** Texts that were replaced by a note. */
  withheld: number;
}

/**
 * A label of a solution anywhere in a one line text ("Lösung: ...", "Antwort: ..."). The
 * marker check of the upload looks for such a label at the start of a LINE of a
 * document; a description is one line, so the label can stand in the middle.
 */
const SOLUTION_LABEL =
  /(?:^|[\s.])(?:L(?:ö|oe)sung(?:s(?:schl(?:ü|ue)ssel|vorschlag))?|Musterl(?:ö|oe)sung|(?:Richtige|Korrekte)\s+Antwort|Antwort(?:schl(?:ü|ue)ssel)?|Erkl(?:ä|ae)rung|Begr(?:ü|ue)ndung)\s*:/i;

/** A text for the summary: plain, short, without personal data, markers or instructions. Null if not usable. */
export function safeText(
  text: string | null | undefined,
  max: number
): string | null {
  if (!text) return null;
  const plain = sanitizeExcerptText(text)
    .replace(/[;=<>{}"'`\\[\]|\n\r]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length === 0) return null;
  if (
    hasSolutionMarker(plain) ||
    SOLUTION_LABEL.test(plain) ||
    findInstructionText(plain).length > 0
  ) {
    return null;
  }
  const redacted = redactPersonalData(plain).text.trim();
  if (redacted.length === 0) return null;
  return redacted.length > max
    ? `${redacted.slice(0, max - 1).trim()}…`
    : redacted;
}

interface Counter {
  withheld: number;
}

/** Longest titles by kind, in characters (the excerpt has 2500 in all). */
const TITLE_CHARS = { course: 100, enabler: 140, document: 70, useCase: 90 };

/** A title cleaned like the rest, or the note. A cut title ends with the ellipsis. */
function titleOf(
  text: string,
  counter: Counter,
  max: number = TITLE_CHARS.enabler
): string {
  const cleaned = safeText(text, max);
  if (cleaned === null) {
    counter.withheld += 1;
    return WITHHELD;
  }
  return cleaned;
}

/** The text of one enabler without its handle (the handle depends on the unit it lands in). */
function enablerBody(
  enabler: SnapshotEnabler,
  scenarios: readonly SnapshotDocument[],
  useCaseTitle: string | null,
  counter: Counter,
  descriptionChars: number
): string {
  const parts = [titleOf(enabler.title, counter)];
  if (descriptionChars > 0) {
    const head = safeText(enabler.description, descriptionChars);
    // A description that repeats the title says nothing more
    if (
      head &&
      head.toLowerCase() !==
        safeText(enabler.title, descriptionChars)?.toLowerCase()
    ) {
      parts.push(`Beschreibung: ${head}`);
    }
  }
  if (scenarios.length > 0) {
    parts.push(
      `Szenarien: ${scenarios
        .slice(0, MAX_DOC_TITLES)
        .map(d => titleOf(d.title, counter, TITLE_CHARS.document))
        .join('; ')}`
    );
  }
  if (useCaseTitle) {
    parts.push(
      `Use Case: ${titleOf(useCaseTitle, counter, TITLE_CHARS.useCase)}`
    );
  }
  return parts.join(' | ');
}

/**
 * The units of a catalog: one per component that has enablers, more for a
 * component whose enablers do not fit into one excerpt. The description heads
 * shrink (140, 60, 0 characters) before a component is split.
 */
export function buildKiUnits(snapshot: ContentSnapshot): KiUnit[] {
  const enablersOf = new Map<string, SnapshotEnabler[]>();
  for (const e of snapshot.enablers) {
    const list = enablersOf.get(e.courseId) ?? [];
    list.push(e);
    enablersOf.set(e.courseId, list);
  }
  const docsOf = new Map<string, SnapshotDocument[]>();
  for (const d of snapshot.documents) {
    if (d.useCaseId || !d.enablerId) continue;
    const list = docsOf.get(d.enablerId) ?? [];
    list.push(d);
    docsOf.set(d.enablerId, list);
  }
  const useCaseOf = new Map<string, string>();
  for (const u of snapshot.useCases) {
    if (u.enablerId && !useCaseOf.has(u.enablerId)) {
      useCaseOf.set(u.enablerId, u.title);
    }
  }
  const limit = EXCERPT_MAX_CHARS - EXCERPT_ROOM;

  const units: KiUnit[] = [];
  for (const course of snapshot.courses) {
    const enablers = enablersOf.get(course.id) ?? [];
    if (enablers.length === 0) continue;
    const counter: Counter = { withheld: 0 };
    const title = titleOf(course.title, counter, TITLE_CHARS.course);
    const header = `Komponente: ${title}`;
    const headerNext = `Komponente: ${title} (Fortsetzung)`;

    // The longest description head with which the component fits into one unit,
    // else none (the component is split then)
    let bodies: { enabler: SnapshotEnabler; body: string }[] = [];
    let withheld = 0;
    for (const chars of [DESCRIPTION_HEAD_CHARS, 60, 0]) {
      const inner: Counter = { withheld: 0 };
      bodies = enablers.map(enabler => {
        const docs = docsOf.get(enabler.id) ?? [];
        return {
          enabler,
          body: enablerBody(
            enabler,
            docs.filter(d => d.type === 'EXERCISE'),
            useCaseOf.get(enabler.id) ?? null,
            inner,
            chars
          ),
        };
      });
      withheld = inner.withheld;
      const total =
        header.length +
        bodies.reduce(
          (n, b, i) => n + `E${i + 1}: `.length + b.body.length + 1,
          0
        );
      if (total <= limit) break;
    }

    // Greedy packing: a new unit when the next line would not fit
    const courseLabel = course.code
      ? `${course.code}: ${course.title}`
      : course.title;
    let lines: string[] = [];
    let members: SnapshotEnabler[] = [];
    let length = header.length;
    const flush = () => {
      if (members.length === 0) return;
      const handles = new Map<string, FindingRef>();
      handles.set('K', { type: 'course', id: course.id, label: courseLabel });
      members.forEach((e, i) => {
        handles.set(`E${i + 1}`, {
          type: 'enabler',
          id: e.id,
          label: `${e.code ?? `Nr. ${e.orderIndex}`}: ${e.title}`,
        });
      });
      units.push({
        courseId: course.id,
        title: course.title,
        excerpt: [
          units.some(u => u.courseId === course.id) ? headerNext : header,
          ...lines,
        ].join('\n'),
        handles,
        withheld: units.some(u => u.courseId === course.id)
          ? 0
          : counter.withheld + withheld,
      });
      lines = [];
      members = [];
      length = headerNext.length;
    };
    for (const { enabler, body } of bodies) {
      let raw = `E${members.length + 1}: ${body}`;
      if (members.length > 0 && length + raw.length + 1 > limit) {
        flush();
        // The handle restarts in the next excerpt
        raw = `E${members.length + 1}: ${body}`;
      }
      // A line that is alone and still too long is cut, with the ellipsis
      const cap = limit - headerNext.length - 1;
      const placed =
        raw.length > cap ? `${raw.slice(0, cap - 1).trim()}…` : raw;
      lines.push(placed);
      members.push(enabler);
      length += placed.length + 1;
    }
    flush();
  }
  return units;
}
