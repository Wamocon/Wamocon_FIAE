// From a checked answer to a proposal row (docs/ki-upload-konzept.md 6.2, 6.4).
// Pure.
//
// Rules of the derivation, in the order that matters:
//
//   1. The model never wins against the rules. When the answer contradicts a field
//      that the rule stage already named (type, component, enabler or level), the
//      result is a CONFLICT: a proposal that keeps the values of the rules, has the
//      band "conflict" and says that the model disagrees. A person decides.
//   2. Otherwise the answer fills what the rules left open and keeps what they had.
//   3. The source is "ki", the confidence at most 0.80, the band "medium" at best
//      and "medium" only for a complete assignment that the model was fairly sure
//      about (never "high": the database refuses it as well).
//   4. The reasons of the rule stage stay in the proposal. A reason like
//      SOLUTION_MARKER makes the review ask a person to name the assignment, and
//      the model must not be able to switch that off by writing a proposal.

import {
  CONFIDENCE,
  REASON_TEXT_MAX,
  type ProposalBand,
  type Reason,
} from '@/lib/content-upload/classify/types';
import type { KiAnswer } from '@/lib/content-upload/ki/answer';
import type {
  ProposalRecord,
  ProposalWrite,
} from '@/lib/content-upload/review/types';

export type KiOutcome =
  | { kind: 'proposal'; write: ProposalWrite }
  | { kind: 'conflict'; write: ProposalWrite }
  | { kind: 'no_result' };

/** Medium needs at least this confidence from the model. */
export const MEDIUM_FROM = 0.6;
// the reasons of the rules are never cut (one of them may be what asks for a person)
const MAX_REASONS = 25;

const NEEDS_ENABLER = new Set(['enabler', 'quiz', 'scenario', 'use_case']);

type Fields = Pick<
  ProposalWrite,
  'docType' | 'componentCode' | 'enablerCode' | 'quizLevel'
>;

function isComplete(f: Fields): boolean {
  if (!f.docType || !f.componentCode) return false;
  if (NEEDS_ENABLER.has(f.docType) && !f.enablerCode) return false;
  if (f.docType === 'quiz' && !f.quizLevel) return false;
  return true;
}

const differs = (a: string | null, b: string | null) =>
  a !== null && b !== null && a !== b;

/** The fields in which two assignments name different, non empty values. */
export function contradictions(rule: Fields, ki: Fields): string[] {
  const out: string[] = [];
  if (differs(rule.docType, ki.docType)) out.push('docType');
  if (differs(rule.componentCode, ki.componentCode)) out.push('componentCode');
  if (differs(rule.enablerCode, ki.enablerCode)) out.push('enablerCode');
  if (differs(rule.quizLevel, ki.quizLevel)) out.push('quizLevel');
  return out;
}

const cut = (text: string) => text.slice(0, REASON_TEXT_MAX);

function describe(f: Fields): string {
  const parts = [
    f.docType ? `Typ ${f.docType}` : null,
    f.componentCode ? `Komponente ${f.componentCode}` : null,
    f.enablerCode ? `Enabler ${f.enablerCode}` : null,
    f.quizLevel ? `Stufe ${f.quizLevel}` : null,
  ].filter(Boolean);
  return parts.join(', ');
}

function mergedReasons(first: Reason, rule: ProposalRecord | null): Reason[] {
  return [first, ...(rule?.reasons ?? [])].slice(0, MAX_REASONS);
}

export function deriveProposal(
  answer: KiAnswer,
  rule: ProposalRecord | null,
  model: string
): KiOutcome {
  const ki: Fields = {
    docType: answer.docType,
    componentCode: answer.componentCode,
    enablerCode: answer.enablerCode,
    quizLevel: answer.quizLevel,
  };
  if (!ki.docType && !ki.componentCode && !ki.enablerCode) {
    return { kind: 'no_result' };
  }
  const known: Fields = {
    docType: rule?.docType ?? null,
    componentCode: rule?.componentCode ?? null,
    enablerCode: rule?.enablerCode ?? null,
    quizLevel: rule?.quizLevel ?? null,
  };

  if (rule && contradictions(known, ki).length > 0) {
    return {
      kind: 'conflict',
      write: {
        // the rules stay the source and the values: the model only raises a flag
        source: rule.source === 'ki' ? 'content' : rule.source,
        ...known,
        confidence: CONFIDENCE.conflict,
        band: 'conflict',
        reasons: mergedReasons(
          {
            code: 'KI_CONTRADICTS',
            text: cut(
              `Sokrates schlägt eine andere Zuordnung vor (${describe(ki)}). Die Regeln gelten, bitte prüfen.`
            ),
          },
          rule
        ),
        model: null,
      },
    };
  }

  const merged: Fields = {
    docType: known.docType ?? ki.docType,
    componentCode: known.componentCode ?? ki.componentCode,
    enablerCode: known.enablerCode ?? ki.enablerCode,
    quizLevel: known.quizLevel ?? ki.quizLevel,
  };
  const band: ProposalBand =
    isComplete(merged) && answer.confidence >= MEDIUM_FROM ? 'medium' : 'low';
  return {
    kind: 'proposal',
    write: {
      source: 'ki',
      ...merged,
      confidence: answer.confidence,
      band,
      reasons: mergedReasons(
        {
          code: 'KI_PROPOSAL',
          text: cut(
            answer.reason
              ? `Vorschlag von Sokrates: ${answer.reason}`
              : 'Vorschlag von Sokrates, nur ein Vorschlag.'
          ),
        },
        rule
      ),
      model,
    },
  };
}
