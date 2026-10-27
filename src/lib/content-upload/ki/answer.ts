// The check of the answer of Sokrates (docs/ki-upload-konzept.md 6.4). Pure.
//
// The answer is untrusted text. This is where the protection against prompt
// injection sits, because the excerpt cannot be made harmless: whatever a document
// says to the model, the answer only counts when it
//
//   - is one JSON object (first "{" to last "}"), at most 4000 characters
//   - has the fixed schema (zod). Unknown fields are dropped, a wrong type fails
//   - names a type of the fixed list
//   - names codes that stand on the positive list of the run (never an invented one)
//   - and then still only becomes a PROPOSAL that a person sees and decides on.
//     Nothing of the answer is ever executed, used as a path, put into a query or
//     passed to a second request (except the checked code of the component that the
//     second stage lists the enablers for).
//
// The reason text is for display. It is cleaned (control characters, links and
// personal patterns) and cut to 200 characters. It is never a ground for a
// decision of the platform.

import { z } from 'zod';
import { redactPersonalData } from '../patterns';
import { sanitizeExcerptText } from '../text-clean';
import {
  DOC_TYPES_OF_ANSWER,
  type KiCatalog,
} from '@/lib/content-upload/ki/prompt';
import type {
  QuizLevelCode,
  UploadDocType,
} from '@/lib/content-upload/classify/types';

export const MAX_ANSWER_CHARS = 4000;
export const MAX_REASON_CHARS = 200;
/** The model alone never gets above this (concept 6.2, and a check of the database). */
export const KI_CONFIDENCE_CAP = 0.8;

const nullableCode = z
  .string()
  .max(40)
  .nullable()
  .optional()
  .transform(v => v ?? null);

const AnswerSchema = z.object({
  typ: z.enum(DOC_TYPES_OF_ANSWER),
  komponente: nullableCode,
  enabler: nullableCode,
  stufe: z
    .enum(['low', 'medium', 'high'])
    .nullable()
    .optional()
    .transform(v => v ?? null),
  konfidenz: z.number().finite(),
  begruendung: z
    .string()
    .max(2000)
    .optional()
    .transform(v => v ?? ''),
});

/** What survived the check. */
export interface KiAnswer {
  docType: UploadDocType | null;
  componentCode: string | null;
  enablerCode: string | null;
  quizLevel: QuizLevelCode | null;
  /** 0 to 1, at most KI_CONFIDENCE_CAP. */
  confidence: number;
  /** Cleaned, at most 200 characters, for display only. */
  reason: string;
}

export type AnswerStatus = 'invalid_json' | 'not_in_whitelist';

export type AnswerResult =
  | { ok: true; answer: KiAnswer }
  | { ok: false; status: AnswerStatus };

const TYPE_OF_ANSWER: Record<string, UploadDocType | null> = {
  enabler: 'enabler',
  quiz: 'quiz',
  global_quiz: 'global_quiz',
  szenario: 'scenario',
  use_case: 'use_case',
  unbekannt: null,
};

/** The reason text for display: plain, short, without links or personal patterns. */
export function cleanReason(text: string): string {
  const plain = sanitizeExcerptText(text)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    // no markup and no list syntax in the display text
    .replace(/[<>`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const redacted = redactPersonalData(plain).text;
  return redacted.slice(0, MAX_REASON_CHARS).trim();
}

/** The JSON object of a text: from the first "{" to the last "}". */
export function jsonObjectOf(text: string): unknown | null {
  if (text.length > MAX_ANSWER_CHARS) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export interface AnswerContext {
  catalog: KiCatalog;
  /** The second stage: the component the enablers were listed for. */
  expectedComponent?: string;
}

/**
 * Checks the text of an answer against the schema and the positive list. A code
 * that is not on the list, or an enabler that does not belong to the component,
 * fails the whole answer (not_in_whitelist): a partly invented answer is not
 * trusted for the part that happens to fit.
 */
export function checkAnswer(
  text: string,
  context: AnswerContext
): AnswerResult {
  const raw = jsonObjectOf(text);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 'invalid_json' };
  }
  const parsed = AnswerSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 'invalid_json' };
  const value = parsed.data;
  const docType = TYPE_OF_ANSWER[value.typ] ?? null;

  const enablerOwner = new Map<string, string>();
  const components = new Set<string>();
  for (const component of context.catalog.components) {
    components.add(component.code);
    for (const enabler of component.enablers) {
      enablerOwner.set(enabler.code, component.code);
    }
  }

  let componentCode = value.komponente;
  let enablerCode = value.enabler;
  if (componentCode !== null && !components.has(componentCode)) {
    return { ok: false, status: 'not_in_whitelist' };
  }
  if (enablerCode !== null) {
    const owner = enablerOwner.get(enablerCode);
    if (owner === undefined) return { ok: false, status: 'not_in_whitelist' };
    // an enabler of another component than the named one: not trusted at all
    if (componentCode !== null && owner !== componentCode) {
      return { ok: false, status: 'not_in_whitelist' };
    }
    componentCode = owner;
  }
  if (
    context.expectedComponent !== undefined &&
    componentCode !== null &&
    componentCode !== context.expectedComponent
  ) {
    return { ok: false, status: 'not_in_whitelist' };
  }

  // "unbekannt" says nothing: no type, no codes, whatever the fields claim
  if (docType === null) {
    componentCode = null;
    enablerCode = null;
  }
  // A global quiz belongs to a component, never to one enabler
  if (docType === 'global_quiz') enablerCode = null;
  const quizLevel = docType === 'quiz' ? value.stufe : null;

  const confidence = Math.min(
    KI_CONFIDENCE_CAP,
    Math.max(0, Math.round(value.konfidenz * 100) / 100)
  );
  return {
    ok: true,
    answer: {
      docType,
      componentCode,
      enablerCode,
      quizLevel,
      confidence: docType === null ? 0 : confidence,
      reason: cleanReason(value.begruendung),
    },
  };
}
