// The rule stage for a quiz JSON file (package UP2 of docs/ki-upload-konzept.md, the
// JSON counterpart of assign.ts). Pure function: no database, no network, no model.
//
// A quiz file is not one document with one component, one enabler and one level: it
// holds many quizzes, and every quiz names its own component, enabler and level in its
// id (10a, 24_1a). So the assignment of the FILE is only its kind (`quiz` for the
// enabler quizzes, `global_quiz` for the global quizzes), and the codes of the quizzes
// are read by the same strict reader that the transfer uses.
//
// The kind comes from the CONTENT of the head (read-json.ts). The file name is only a
// cross check: a name that says "global" over a file of enabler quizzes (or the other
// way round) is a conflict, never a reason to read the file as the kind of its name.
//
// What a band means here (the table of 6.2 of the concept):
//   high      the head is valid, the strict reader found no error and no quiz without a
//             content key (hints of the reader do not lower the band: they are listed)
//   medium    the reader found errors in some sets or quizzes. The planner skips exactly
//             those sets with their reasons, the rest of the file can be transferred.
//             Reason PARSER_ERRORS, so a click ("confirm all with the same reasons")
//             does not take it, a person confirms it on purpose
//   conflict  the file name and the content name another kind
// A file without any usable set never gets here, it is refused (the extract step).
//
// Reasons carry stable codes and short German texts. They never quote the file: only
// counts and the codes of findings go in.

import {
  CONFIDENCE,
  REASON_TEXT_MAX,
  type ProposalBand,
  type Reason,
  type UploadDocType,
} from './types';

/**
 * What the rule needs to know about a reading (the summary of read-json.ts has these
 * fields and more; this folder imports nothing from the reading helpers but the cleaning).
 */
export interface QuizJsonSummary {
  kind: 'lesson' | 'global';
  quizzes: number;
  sets: number;
  questions: number;
  setsWithErrors: number;
  warnings: number;
  unmapped: number;
  /** Codes of the errors only. */
  errorCodes: readonly string[];
}

export interface JsonProposal {
  docType: Extract<UploadDocType, 'quiz' | 'global_quiz'>;
  source: 'content';
  band: ProposalBand;
  confidence: number;
  reasons: Reason[];
}

const KIND_TEXT = {
  lesson: 'Enabler-Quizze',
  global: 'Global-Quizze',
} as const;

/** What the file name says about the kind of a quiz file, or null when it says nothing clear. */
export function kindHintOfName(relPath: string): 'lesson' | 'global' | null {
  const name = relPath.split('/').pop()?.toLowerCase() ?? '';
  const global = /global/.test(name);
  const lesson = /enabler|lesson|lektion/.test(name);
  if (global === lesson) return null;
  return global ? 'global' : 'lesson';
}

const safeCodes = (codes: readonly string[]) =>
  codes.filter(code => /^[A-Z_]{1,40}$/.test(code)).slice(0, 6);

const cut = (text: string) =>
  text.length > REASON_TEXT_MAX ? text.slice(0, REASON_TEXT_MAX) : text;

export function classifyQuizJson(input: {
  relPath: string;
  summary: QuizJsonSummary;
}): JsonProposal {
  const { summary } = input;
  const kind = summary.kind;
  const docType = kind === 'lesson' ? 'quiz' : 'global_quiz';
  const reasons: Reason[] = [
    {
      code: 'JSON_HEAD',
      text: cut(
        `Der Kopf der Datei (Schema 1.0) zeigt: ${KIND_TEXT[kind]}, ${summary.quizzes} Quizze, ${summary.sets} Sätze, ${summary.questions} Fragen.`
      ),
    },
  ];

  const hint = kindHintOfName(input.relPath);
  if (hint !== null && hint !== kind) {
    reasons.push({
      code: 'CONFLICT_TYPE',
      text: cut(
        `Dateiname und Inhalt widersprechen sich beim Typ: Der Name nennt ${KIND_TEXT[hint]}, der Inhalt ${KIND_TEXT[kind]}.`
      ),
    });
    return {
      docType,
      source: 'content',
      band: 'conflict',
      confidence: CONFIDENCE.conflict,
      reasons,
    };
  }

  let band: ProposalBand = 'high';
  let confidence: number = CONFIDENCE.content;
  if (summary.setsWithErrors > 0 || summary.unmapped > 0) {
    band = 'medium';
    confidence = CONFIDENCE.medium;
    const codes = safeCodes(summary.errorCodes);
    reasons.push({
      code: 'PARSER_ERRORS',
      text: cut(
        `Der Leser meldet Fehler: ${summary.setsWithErrors} von ${summary.sets} Sätzen und ${summary.unmapped} Quizze ohne Schlüssel werden übersprungen${codes.length > 0 ? ` (${codes.join(', ')})` : ''}.`
      ),
    });
  }
  if (summary.warnings > 0) {
    reasons.push({
      code: 'PARSER_NOTES',
      text: cut(
        `Der Leser meldet ${summary.warnings} Hinweise zur Datei, sie ändern nichts an der Übernahme.`
      ),
    });
  }
  return { docType, source: 'content', band, confidence, reasons };
}
