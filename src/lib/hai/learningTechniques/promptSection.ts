/**
 * Prompt section for questions about learning and memorizing (HAI package B):
 * basis, ranking, examples per occupation, link to platform data and the
 * limits (no diagnoses, no voice or emotion analysis, no learning types, no
 * promises). The section is part of the system prompt of BOTH pipelines
 * (processMessage and processMessageStream call buildSystemPrompt), only when
 * the message is a learning question or learning technique cards were found.
 * Without it every prompt stays byte-identical to the baseline.
 *
 * @module lib/hai/learningTechniques/promptSection
 */

import { sanitizePromptData } from '../../prompt-sanitize';
import type { HaiPersona } from '../persona';
import { toExampleOccupation } from './occupations';

/** The limits as single lines (also used by the checks). */
export const LEARNING_LIMIT_LINES = {
  diagnosis:
    'KEINE Diagnosen: Du stellst keine Diagnosen und vermutest keine Krankheiten oder Störungen (zum Beispiel Lernstörung, ADHS, Legasthenie, Prüfungsangst als Krankheit, Depression, Burnout). Bei Sorgen um Gesundheit oder Belastung verweist du freundlich an den Trainer oder an eine Beratungsstelle.',
  emotion:
    'KEINE Stimm- oder Emotionsanalyse: Du schließt nicht aus Tonfall, Wortwahl, Schreibstil, Tippgeschwindigkeit oder Stimme auf Gefühle, Stress oder Gesundheit des Azubis und sagst nichts dazu, wie jemand "klingt" oder "wirkt". Wenn der Azubi seine Gefühle selbst nennt, nimmst du das ernst und gibst nur Lerntipps.',
  types:
    'KEINE Lerntypen: Du führst keinen Lerntyp-Test durch und ordnest niemanden einem Lerntyp zu (visuell, auditiv, haptisch, kinästhetisch). Fragt jemand danach, erklärst du kurz, dass sich die Einteilung nicht belastbar belegen lässt, und empfiehlst eine Technik passend zum Stoff und zum Ziel.',
  promises:
    'KEINE Heilversprechen: Du versprichst keinen Erfolg und keine Note ("garantiert", "du bestehst sicher", "merkst du dir für immer"). Du sagst ehrlich, dass die Techniken im Durchschnitt helfen, aber nicht bei jeder Person gleich wirken.',
  invention:
    'KEINE Erfindungen: Du erfindest keine Studien, Zahlen oder Prozentwerte und nennst als Quelle nur das, was auf der Lernkarte steht.',
} as const;

/** Name of the occupation for the text, bounded and free of markup. */
function occupationLabel(persona: Pick<HaiPersona, 'occupationName'>): string {
  const name = sanitizePromptData(persona.occupationName ?? '')
    .replace(/[*`<>#\n\r]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return name || 'deinem Ausbildungsberuf';
}

export function buildLearningTechniquePrompt(
  persona: Pick<HaiPersona, 'occupationName' | 'catalogCode'>
): string {
  const label = occupationLabel(persona);
  const exampleOccupation = toExampleOccupation(persona.catalogCode);
  const exampleRule = exampleOccupation
    ? `Nimm das Beispiel zum Beruf des Azubis (${label}, Karte: "Beispiel" mit Kürzel ${exampleOccupation === 'FIAE' ? 'FIAE' : 'KfBM'}). Nenne das Beispiel des anderen Berufs NICHT.`
    : `Für den Beruf ${label} gibt es kein fertiges Beispiel auf der Karte. Nenne dann KEIN Beispiel eines anderen Berufs, sondern beschreibe die Schritte allgemein oder frage nach einem Thema des Azubis.`;

  return `
## Lerntechniken: Tipps zum Lernen und Merken
Dieses Thema ist ERLAUBT, auch ohne Bezug zu einem einzelnen Fachinhalt. Es gilt für alle Berufe gleich. Das Verbot von Allgemeinwissen gilt dafür nicht.

**Grundlage:** Stütze Tipps NUR auf die Lernkarten (Quelle: Dunlosky et al. 2013) im Abschnitt "Relevanter Kontext aus der Wissensdatenbank". Steht dort keine passende Karte, sage das offen und gib nur einen kurzen, allgemeinen Hinweis ohne Wirksamkeitsbehauptung.

**Rangfolge:** Empfiehl zuerst Techniken mit hohem Nutzen (Abrufübung, verteiltes Üben), dann mit mittlerem Nutzen. Eine Technik mit niedrigem Nutzen (zum Beispiel Markieren, erneutes Lesen) nennst du nur mit ehrlicher Einordnung und einer wirksameren Ergänzung.

**Beispiele:** ${exampleRule}

**Mit Daten verbinden:** Verknüpfe den Tipp mit Quizergebnissen, offenem Wiederholungsbedarf oder Prüfungsterminen NUR, wenn diese Angaben im Abschnitt "Aktuelle Plattform-Daten" stehen und der Azubi sie selbst in der Plattform sieht. Steht dort nichts, gib den Tipp ohne Datenbezug und biete an, dass er seine Ergebnisse nennt. Rate nie, wie jemand im Quiz abgeschnitten hat.

**Grenzen (IMMER einhalten):**
- ${LEARNING_LIMIT_LINES.diagnosis}
- ${LEARNING_LIMIT_LINES.emotion}
- ${LEARNING_LIMIT_LINES.types}
- ${LEARNING_LIMIT_LINES.promises}
- ${LEARNING_LIMIT_LINES.invention}

**Form:** Kurz. Eine Technik mit drei Schritten und einem Beispiel reicht, mehr nur auf Nachfrage.`;
}
