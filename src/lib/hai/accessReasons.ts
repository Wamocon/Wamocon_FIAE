/**
 * Which access reasons the pipeline knows when it asks the model (see
 * denial.ts for the categories and the notes).
 *
 * The model is asked only for questions that are not answered by a fixed text
 * first. For those the pipeline can still know why an answer may be limited: a
 * search that found nothing inside the released content, an open page whose
 * content was dropped, a question that touches the protected solutions, data of
 * other people. Each case becomes a key, the prompt turns the keys into a short
 * section (buildAccessReasonRules in prompts.ts). Without a key the prompt does
 * not change.
 *
 * Everything here is derived on the server (audience from the database, the
 * search result, the data intent), never from what the message claims. The
 * message is only read for words ("Lösung", "Azubis"), a wrong guess adds a
 * conditional note and nothing else: the notes say "if the question asks for
 * ...", so a false match changes no answer.
 *
 * Pure module (no database, no network).
 *
 * @module lib/hai/accessReasons
 */

import {
  TRAINEE_SEARCH_NOT_FOUND_MARKER,
  type AccessReasonKey,
} from './denial';
import { foldText } from './navigation/fold';

export interface AccessReasonInput {
  message: string;
  /** From the database (retrieval access), never from the request. */
  audience: 'trainer' | 'trainee';
  /** The vector search and the page index ran and returned nothing. */
  searchEmpty: boolean;
  /** An enabler or course id of the request was dropped (outside the catalogs). */
  contextDropped: boolean;
  /** The live data block of this turn (data context), if one was loaded. */
  liveDataContext?: string | null;
}

/** A word that asks for a solution or a right answer. */
const SOLUTION_WORDS =
  /\b(?:\w*loesung\w*|\w*schluessel\w*|richtig\w*|korrekt\w*|antwort\w*)\b/;

/**
 * Data of other people or trainer evaluations ("meine Azubis", "die Noten von",
 * "offene Bewertungen"). Narrow on purpose: a trainee who writes "ich bin
 * Azubi" asks for nothing of the kind.
 */
const OTHERS_DATA =
  /\b(?:(?:meine|alle|die|andere[nr]?)\s+(?:azubis|auszubildende[nr]?|mitschueler|kollegen)|(?:noten|ergebnisse|fortschritt|stand|berichte|abgaben)\s+(?:von|der)\s+(?:den\s+|meinen\s+)?(?:azubis|auszubildenden|kollegen|mitschuelern|anderen)|offene\s+bewertungen)\b/;

export function detectAccessReasons(
  input: AccessReasonInput
): AccessReasonKey[] {
  const keys: AccessReasonKey[] = [];
  if (input.searchEmpty) keys.push('UMFANG_SEARCH');
  if (input.contextDropped) keys.push('UMFANG_CONTEXT');

  if (input.audience === 'trainee') {
    if (SOLUTION_WORDS.test(foldText(input.message))) {
      keys.push('LOESUNGSSCHUTZ_ANSWER');
    }
    if (OTHERS_DATA.test(foldText(input.message))) {
      keys.push('ROLLE_OTHERS_DATA');
    }
  } else if (input.liveDataContext?.includes(TRAINEE_SEARCH_NOT_FOUND_MARKER)) {
    keys.push('ZUSTAENDIGKEIT_TRAINEE');
  }
  return keys;
}
