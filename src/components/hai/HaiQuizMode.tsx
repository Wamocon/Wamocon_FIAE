'use client';

/**
 * HAI quiz mode: the state of the session and the entry points.
 *
 * The provider sits above the chat views (HaiWrapper), so a switch between the
 * widget and the full screen keeps the running quiz. It holds the session of
 * lib/hai/quizMode/session.ts and talks to the two routes through
 * lib/hai/quizMode/client.ts. Nothing is stored: closing the quiz or leaving
 * the page drops the session, and the server never learns what was answered
 * beyond the check of one attempt.
 *
 * useHaiQuizMode works without the provider (a no-op), so a component that
 * starts the quiz can be rendered alone, in a test or in another page.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { fetchNextQuestion, submitQuizAnswer } from '@/lib/hai/quizMode/client';
import {
  initialQuizState,
  quizReducer,
  type QuizScope,
  type QuizSessionState,
} from '@/lib/hai/quizMode/session';

export interface HaiQuizModeApi {
  /** The quiz card is on screen. */
  active: boolean;
  state: QuizSessionState;
  /** Start a new session. Without a scope: everything the person may open. */
  start: (scope?: Partial<QuizScope>) => void;
  /** Check the attempt of the question on screen. */
  answer: (optionIds: string[]) => void;
  /** The next question (also the retry after an error). */
  next: () => void;
  /** Show the summary. */
  finish: () => void;
  /** Another round with the same scope, the history starts again. */
  restart: () => void;
  /** Leave the quiz mode and drop the session. */
  close: () => void;
}

const NOOP_API: HaiQuizModeApi = {
  active: false,
  state: initialQuizState(),
  start: () => undefined,
  answer: () => undefined,
  next: () => undefined,
  finish: () => undefined,
  restart: () => undefined,
  close: () => undefined,
};

const HaiQuizModeContext = createContext<HaiQuizModeApi | null>(null);

export function useHaiQuizMode(): HaiQuizModeApi {
  return useContext(HaiQuizModeContext) ?? NOOP_API;
}

export function HaiQuizModeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [active, setActive] = useState(false);
  const [state, dispatch] = useReducer(quizReducer, undefined, () =>
    initialQuizState()
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  // A response of an older request (the person pressed on) is dropped
  const requestRef = useRef(0);

  const load = useCallback(async (scope: QuizScope, asked: string[]) => {
    const id = ++requestRef.current;
    dispatch({ type: 'loading' });
    const result = await fetchNextQuestion({
      enablerId: scope.enablerId,
      topic: scope.topic,
      exclude: asked,
    });
    if (id !== requestRef.current) return;
    if (result.kind === 'question') {
      dispatch({
        type: 'question',
        question: result.question,
        total: result.total,
        remaining: result.remaining,
        occupation: result.occupation,
      });
    } else if (result.kind === 'empty') {
      dispatch({
        type: 'empty',
        reason: result.reason,
        total: result.total,
        occupation: result.occupation,
      });
    } else {
      dispatch({ type: 'failed', errorKey: result.errorKey });
    }
  }, []);

  const start = useCallback(
    (scope?: Partial<QuizScope>) => {
      const full: QuizScope = {
        enablerId: scope?.enablerId ?? null,
        topic: scope?.topic ?? null,
      };
      requestRef.current += 1;
      dispatch({ type: 'start', scope: full });
      setActive(true);
      void load(full, []);
    },
    [load]
  );

  const answer = useCallback(async (optionIds: string[]) => {
    const current = stateRef.current;
    if (current.phase !== 'question' || !current.question) return;
    if (optionIds.length === 0) return;
    const id = ++requestRef.current;
    dispatch({ type: 'checking' });
    const result = await submitQuizAnswer(current.question.id, optionIds);
    if (id !== requestRef.current) return;
    if (result.kind === 'ok') {
      dispatch({ type: 'answered', feedback: result.feedback });
    } else {
      dispatch({ type: 'answerFailed', errorKey: result.errorKey });
    }
  }, []);

  const next = useCallback(() => {
    const current = stateRef.current;
    void load(current.scope, current.asked);
  }, [load]);

  const finish = useCallback(() => {
    requestRef.current += 1;
    dispatch({ type: 'finish' });
  }, []);

  const restart = useCallback(() => {
    const scope = stateRef.current.scope;
    requestRef.current += 1;
    dispatch({ type: 'restart' });
    void load(scope, []);
  }, [load]);

  const close = useCallback(() => {
    requestRef.current += 1;
    setActive(false);
    dispatch({ type: 'start', scope: { enablerId: null, topic: null } });
  }, []);

  const value = useMemo<HaiQuizModeApi>(
    () => ({ active, state, start, answer, next, finish, restart, close }),
    [active, state, start, answer, next, finish, restart, close]
  );

  return (
    <HaiQuizModeContext.Provider value={value}>
      {children}
    </HaiQuizModeContext.Provider>
  );
}

export default HaiQuizModeProvider;
