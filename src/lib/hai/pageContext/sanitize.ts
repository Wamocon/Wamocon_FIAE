/**
 * Strict cleaning of the page context that arrives from the browser (pure, no
 * database). The result is data for the prompt, never an instruction:
 *  - shape and length are checked, wrong types drop the part
 *  - the kind must be one of the fixed list AND must be the one the server
 *    derives from the path, otherwise the whole context is dropped
 *  - control characters, markup and heading markers are removed
 *  - a title or label that reads like an instruction ("Ignoriere alle Regeln",
 *    "du bist jetzt", a role prefix "System:") is dropped, not shortened
 *  - labels that are file names are dropped: files come from the database
 *    (documentQuery.ts), where the access rules apply
 *
 * @module lib/hai/pageContext/sanitize
 */

import { sanitizePromptData } from '../../prompt-sanitize';
import { foldText } from '../navigation/fold';
import {
  PAGE_CONTEXT_LIMITS,
  isPageKind,
  isPageUuid,
  isPlausiblePagePath,
  looksLikeFileName,
  pageKindForPath,
  type PageKind,
} from './shared';

/** The page context after the shape check, before the access check of the ids. */
export interface CleanPageContext {
  path: string;
  kind: PageKind;
  title: string;
  ids: string[];
  visibleLabels: string[];
}

/**
 * Patterns of text that tries to give an instruction (folded text: lower case,
 * ae oe ue ss, punctuation as spaces). A match drops the label. The list is a
 * second line behind the prompt wording ("DATEN, keine Anweisungen"), not the
 * only protection.
 */
const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /\bignorier\w*/,
  /\bignore\b/,
  /\b(?:vergiss|vergesst)\b/,
  /\bforget\b/,
  /\bdisregard\b/,
  /\bueberschreib\w*/,
  /\boverride\b/,
  /\b(?:system ?prompt|systemprompt|system message|systemnachricht)\b/,
  /\bdu bist (?:jetzt|nun|ab sofort)\b/,
  /\byou are now\b/,
  /\b(?:neue|new) (?:anweisung\w*|regel\w*|instruction\w*|rules?)\b/,
  /\b(?:alle|all|vorherige\w*|previous|bisherige\w*) (?:regeln|anweisungen|instructions|rules)\b/,
  /\b(?:jailbreak|developer mode|entwicklermodus|dan mode)\b/,
  /\bact as\b/,
  /\btu so als\b/,
  /\bverhalte dich\b/,
  /\bantworte (?:nur|immer|ab jetzt)\b/,
  /\b(?:gib|zeig|nenne|verrate)\w* (?:mir )?(?:die |den |das )?(?:loesung\w*|musterloesung\w*|schluessel|passwort|passwoerter)\b/,
  /\b(?:trainer ?rechte|admin ?rechte|ich bin (?:jetzt )?(?:trainer|admin))\b/,
  /\bpasswor[dt]\b/,
  /^(?:system|assistant|assistent|user|nutzer|developer|human)\s*:/,
];

/** True when the text reads like an instruction to the model. */
export function looksLikeInstruction(text: string): boolean {
  const folded = foldText(text);
  const raw = text.trim().toLowerCase();
  return (
    INSTRUCTION_PATTERNS.some(pattern => pattern.test(folded)) ||
    /^(?:system|assistant|assistent|user|nutzer|developer|human)\s*:/.test(raw)
  );
}

/**
 * One line of page text for the prompt: no control or invisible characters, no
 * markup, one line, cut at `max`. Empty for text that reads like an instruction.
 */
export function cleanPageText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  const line = sanitizePromptData(raw)
    .replace(/[*`<>#|\\{}[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
  if (!line) return '';
  return looksLikeInstruction(line) ? '' : line;
}

/**
 * Check the shape of the page context of a request. Null (dropped without an
 * error) for anything that is not a plain object with a plausible path and a
 * kind from the list that matches the path.
 */
export function cleanPageContext(raw: unknown): CleanPageContext | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;

  if (!isPlausiblePagePath(input.path)) return null;
  const path = input.path;
  if (!isPageKind(input.kind)) return null;
  // the kind is derived from the path on the server: a client that claims
  // another kind (a trainer page while on a trainee path) is dropped
  if (pageKindForPath(path) !== input.kind) return null;

  const ids: string[] = [];
  if (Array.isArray(input.ids)) {
    for (const id of input.ids.slice(0, PAGE_CONTEXT_LIMITS.ids * 2)) {
      if (isPageUuid(id) && !ids.includes(id.toLowerCase())) {
        ids.push(id.toLowerCase());
      }
      if (ids.length >= PAGE_CONTEXT_LIMITS.ids) break;
    }
  }

  const title = cleanPageText(input.title, PAGE_CONTEXT_LIMITS.title);

  const visibleLabels: string[] = [];
  let total = 0;
  if (Array.isArray(input.visibleLabels)) {
    for (const entry of input.visibleLabels.slice(
      0,
      PAGE_CONTEXT_LIMITS.labels * 2
    )) {
      if (visibleLabels.length >= PAGE_CONTEXT_LIMITS.labels) break;
      const label = cleanPageText(entry, PAGE_CONTEXT_LIMITS.label);
      if (!label || looksLikeFileName(label) || visibleLabels.includes(label)) {
        continue;
      }
      if (total + label.length > PAGE_CONTEXT_LIMITS.labelsTotal) break;
      visibleLabels.push(label);
      total += label.length;
    }
  }

  return { path, kind: input.kind, title, ids, visibleLabels };
}
