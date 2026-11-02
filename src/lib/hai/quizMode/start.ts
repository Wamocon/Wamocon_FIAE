/**
 * HAI quiz mode: the fixed answer of the chat to "Frag mich ab".
 *
 * When the message asks to be quizzed (detect.ts) the turn ends before
 * retrieval and the model: the chat answers with a short fixed text and hands
 * the browser the start signal for the quiz card. The model never sees the
 * request, so it can never invent a question or give away an answer.
 *
 * Scope of the quiz: the enabler of the open chat when the person means it
 * ("diesen Enabler") or names no topic, otherwise all enablers the person may
 * open, narrowed by the topic. The enabler id comes from the context the chat
 * route already checked against the catalogs of the person, and the quiz route
 * checks it again.
 *
 * @module lib/hai/quizMode/start
 */

import { detectQuizModeRequest } from './detect';

/** The start signal the browser gets with the answer. */
export interface QuizModeStartSignal {
  topic: string | null;
  enablerId: string | null;
}

export interface QuizModeStart {
  response: string;
  quizMode: QuizModeStartSignal;
}

const PRACTICE_NOTE =
  'Das ist eine Übung ohne Wertung: Es wird nichts gespeichert und es zählt nicht für deinen Fortschritt. Die Quizkarte erscheint gleich unten im Chat.';

/**
 * The fixed answer and the start signal, or null when the message is no
 * request to be quizzed. `context` is what the chat route resolved on the
 * server (the open enabler and its title).
 */
export function quizModeStartFor(
  message: string,
  context: { currentEnablerId?: string; enablerTitle?: string }
): QuizModeStart | null {
  const request = detectQuizModeRequest(message);
  if (!request) return null;

  const inEnabler = !!context.currentEnablerId;
  const useEnabler = inEnabler && (request.thisEnabler || !request.topic);
  const enablerId = useEnabler ? (context.currentEnablerId as string) : null;
  const topic = useEnabler ? null : request.topic;

  let intro: string;
  if (useEnabler) {
    intro = context.enablerTitle
      ? `Gern, ich frage dich zu „${context.enablerTitle}“ ab.`
      : 'Gern, ich frage dich zu diesem Enabler ab.';
  } else if (topic) {
    intro = `Gern, ich frage dich zu „${topic}“ ab, mit Fragen aus den Enablern, die für dich freigeschaltet sind.`;
  } else {
    intro =
      'Gern, ich frage dich ab, gemischt aus den Enablern, die für dich freigeschaltet sind.';
  }

  return {
    response: `${intro} ${PRACTICE_NOTE}`,
    quizMode: { topic, enablerId },
  };
}
