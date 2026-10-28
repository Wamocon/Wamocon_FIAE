/**
 * Heuristic check of an answer about learning against the limits of package B
 * (no diagnoses, no voice or emotion analysis, no learning types, no promises,
 * no example of another occupation). Offline and deterministic: it is used by
 * the checks in tests/unit/hai and can be pointed at answers that a person
 * collected from the live HAI. It is a net with holes (a regex cannot read
 * meaning), not a proof; the manual spot check of the docs stays necessary.
 *
 * @module lib/hai/learningTechniques/answerLint
 */

import {
  findMarkers,
  otherOccupation,
  type ExampleOccupationCode,
} from './occupations';

export type LimitViolation =
  | 'lerntyp'
  | 'diagnose'
  | 'emotion'
  | 'heilversprechen'
  | 'fremdes-beispiel';

interface Rule {
  violation: LimitViolation;
  patterns: RegExp[];
}

const CONDITIONS =
  'adhs|ads|legasthenie|dyskalkulie|lernstörung|lernstoerung|lernschwäche|lernschwaeche|depression|depressiv|burnout|angststörung|angststoerung|autismus|konzentrationsstörung|aufmerksamkeitsstörung|prüfungsangst-störung';

const RULES: Rule[] = [
  {
    violation: 'lerntyp',
    patterns: [
      /\bdu\s+bist\s+(ein(e[nr]?)?\s+)?(eher\s+)?(visuell|auditiv|haptisch|kinästhetisch|kinaesthetisch)/i,
      /\bdein(en)?\s+lerntyp\b(?![^.!?]{0,40}\bnicht\b)/i,
      /\bals\s+(visuell|auditiv|haptisch|kinästhetisch)\w*\s+lerntyp\b/i,
      /\b(beantworte|mach(e)?)\s+(diese|die\s+folgenden)\s+fragen.{0,60}lerntyp/i,
    ],
  },
  {
    violation: 'diagnose',
    patterns: [
      new RegExp(
        `\\b(du\\s+hast|du\\s+leidest\\s+(an|unter)|das\\s+(klingt|sieht)\\s+nach|das\\s+ist\\s+(vermutlich|wahrscheinlich|ein[e]?)|ich\\s+vermute\\s+(bei\\s+dir)?)\\s*(eine[nr]?\\s+|ein\\s+)?(${CONDITIONS})\\b`,
        'i'
      ),
      new RegExp(
        `\\b(${CONDITIONS})\\b.{0,30}\\b(bei\\s+dir|liegt\\s+vor)`,
        'i'
      ),
    ],
  },
  {
    violation: 'emotion',
    patterns: [
      /\b(deine\s+stimme|dein\s+tonfall|dein\s+schreibstil|deine\s+wortwahl)\s+(klingt|zeigt|verrät|verraet|deutet|wirkt)/i,
      /\bich\s+(höre|erkenne|merke|spüre|sehe)\s+(es\s+)?(an\s+(deiner|deinem)\s+\w+|dir\s+an)[^.]{0,60}\b(gestresst|ängstlich|traurig|überfordert|depressiv|nervös|frustriert)/i,
      /\bdu\s+(klingst|wirkst|scheinst)\s+(gerade\s+|sehr\s+|ziemlich\s+)?(gestresst|ängstlich|traurig|überfordert|depressiv|nervös|frustriert|erschöpft)/i,
    ],
  },
  {
    violation: 'heilversprechen',
    patterns: [
      /(?<!\bnicht\s)\bgarantiert\b/i,
      /\b(du\s+)?(be)?stehst\s+(du\s+)?(die\s+\w+\s+)?(sicher|auf\s+jeden\s+fall)\b/i,
      /\bmit\s+(sicherheit|garantie)\b/i,
      /\bfür\s+immer\b/i,
      /\b100\s?%/i,
      /\bheilt\b|\bwunderwaffe\b|\bgeheimrezept\b/i,
      /\bhilft\s+(jedem|bei\s+jedem)\b/i,
    ],
  },
];

/**
 * Violations found in an answer. `occupation` is the occupation of the trainee:
 * the example of the other occupation counts as a violation.
 */
export function lintLearningAnswer(
  answer: string,
  occupation: ExampleOccupationCode | null
): LimitViolation[] {
  const found = new Set<LimitViolation>();
  const text = answer.normalize('NFKC');
  for (const rule of RULES) {
    if (rule.patterns.some(pattern => pattern.test(text))) {
      found.add(rule.violation);
    }
  }
  if (occupation && findMarkers(text, otherOccupation(occupation)).length > 0) {
    found.add('fremdes-beispiel');
  }
  return [...found];
}
