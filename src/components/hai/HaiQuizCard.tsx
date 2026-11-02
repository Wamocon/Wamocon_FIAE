'use client';

/**
 * HAI quiz card: one question at a time, in the chat, without grading.
 *
 * Shows the question with the options as buttons (several can be selected for
 * a question with more than one right option), checks the attempt through the
 * parent, then shows right or wrong, the right solution and the explanation.
 * While the quiz of the question is not passed the server withholds the
 * solution (feedback.solutionWithheld): the card says right or wrong and that
 * the solution comes with the passed quiz, with a link to the enabler.
 * At the end a summary: x of y right and the enablers to repeat with a link.
 *
 * Keyboard: a number or a letter selects an option, Enter checks the attempt
 * (and goes on to the next question after the feedback). The question is read
 * aloud on request with the speech output of the browser.
 *
 * The card holds no solution before the attempt: the question it gets has none
 * (lib/hai/quizMode/logic.ts), the feedback arrives with the check.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  GraduationCap,
  Loader2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { optionLetter, speechTextOf } from '@/lib/hai/quizMode/logic';
import {
  buildSummary,
  toggleSelection,
  type QuizSessionState,
} from '@/lib/hai/quizMode/session';

export interface HaiQuizCardProps {
  state: QuizSessionState;
  onAnswer: (optionIds: string[]) => void;
  onNext: () => void;
  onFinish: () => void;
  onRestart: () => void;
  onClose: () => void;
  /** Start again with everything the person may open (after "no topic match"). */
  onMixed?: () => void;
}

const LETTERS = 'abcdefghijkl';

/** The index of the option a key selects, or -1: 1 to 9 or a letter. */
export function optionIndexForKey(key: string, optionCount: number): number {
  if (key.length !== 1) return -1;
  const digit = '123456789'.indexOf(key);
  const index = digit !== -1 ? digit : LETTERS.indexOf(key.toLowerCase());
  return index >= 0 && index < optionCount ? index : -1;
}

function canSpeak(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof (window as unknown as { SpeechSynthesisUtterance?: unknown })
      .SpeechSynthesisUtterance !== 'undefined'
  );
}

export function HaiQuizCard({
  state,
  onAnswer,
  onNext,
  onFinish,
  onRestart,
  onClose,
  onMixed,
}: HaiQuizCardProps) {
  const { t, language } = useLanguage();
  const { phase, question, feedback } = state;
  // The selection belongs to one question in one round. It is derived from
  // that key and not reset by an effect, so a click right after the question
  // appears cannot be wiped by a late effect
  const selectionKey = `${question?.id ?? ''}:${state.attempts.length}`;
  const [selection, setSelection] = useState<{ key: string; ids: string[] }>({
    key: '',
    ids: [],
  });
  const selected = selection.key === selectionKey ? selection.ids : [];
  const setSelected = (update: string[] | ((current: string[]) => string[])) =>
    setSelection(previous => {
      const current = previous.key === selectionKey ? previous.ids : [];
      return {
        key: selectionKey,
        ids: typeof update === 'function' ? update(current) : update,
      };
    });
  const [speaking, setSpeaking] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const baseId = useId();
  const questionId = `${baseId}-question`;
  const hintId = `${baseId}-hint`;

  const stopSpeaking = useCallback(() => {
    if (canSpeak()) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  // A new question puts the focus on the card, so the keys work at once
  useEffect(() => {
    stopSpeaking();
    if (phase === 'question') rootRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.id]);

  useEffect(() => {
    if (phase === 'feedback') nextRef.current?.focus();
    if (phase === 'summary') summaryRef.current?.focus();
    if (phase === 'checking' || phase === 'feedback' || phase === 'summary')
      stopSpeaking();
  }, [phase, stopSpeaking]);

  useEffect(() => stopSpeaking, [stopSpeaking]);

  const readAloud = () => {
    if (!question || !canSpeak()) return;
    if (speaking) {
      stopSpeaking();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speechTextOf(question));
    utterance.lang = language === 'en' ? 'en-US' : 'de-DE';
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };

  const submit = (ids: string[]) => {
    if (phase !== 'question' || ids.length === 0) return;
    onAnswer(ids);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (phase === 'feedback') {
      if (event.key === 'Enter' && event.target === rootRef.current) {
        event.preventDefault();
        onNext();
      }
      return;
    }
    if (phase !== 'question' || !question) return;

    const index = optionIndexForKey(event.key, question.options.length);
    if (index !== -1) {
      event.preventDefault();
      setSelected(current =>
        toggleSelection(question, current, question.options[index].id)
      );
      return;
    }
    if (event.key !== 'Enter') return;

    const target = event.target as HTMLElement;
    const optionId = target.getAttribute?.('data-option-id');
    if (optionId) {
      // Enter on an option selects it if nothing is chosen, then checks
      event.preventDefault();
      const ids = selected.length > 0 ? selected : [optionId];
      if (selected.length === 0) setSelected(ids);
      submit(ids);
    } else if (target === rootRef.current) {
      event.preventDefault();
      submit(selected);
    }
  };

  const summary = buildSummary(state.attempts);
  const scopeLabel = state.scope.enablerId
    ? question
      ? t('hai.quiz.scope.enabler', { title: question.enablerTitle })
      : t('hai.quiz.scope.thisEnabler')
    : state.scope.topic
      ? t('hai.quiz.scope.topic', { topic: state.scope.topic })
      : t('hai.quiz.scope.mixed');

  return (
    <section
      aria-label={t('hai.quiz.title')}
      data-testid="hai-quiz-card"
      data-phase={phase}
      className="w-full rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4 text-sm text-gray-100"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-cyan-400 uppercase">
            <GraduationCap className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t('hai.quiz.title')}
          </div>
          <p className="mt-1 text-xs text-gray-400">{t('hai.quiz.practice')}</p>
          <p className="mt-1 text-xs break-words text-gray-300">{scopeLabel}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('hai.quiz.close')}
          title={t('hai.quiz.close')}
          className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:outline-none"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      {phase === 'loading' && (
        <p
          role="status"
          className="mt-4 inline-flex items-center gap-2 text-xs text-gray-300"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('hai.quiz.loading')}
        </p>
      )}

      {(phase === 'question' || phase === 'checking' || phase === 'feedback') &&
        question && (
          <div
            ref={rootRef}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="mt-4 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
          >
            <p className="text-xs text-gray-400">
              {state.total
                ? t('hai.quiz.progress', {
                    n: state.asked.length,
                    total: state.total,
                  })
                : t('hai.quiz.progressOpen', { n: state.asked.length })}
            </p>
            <div className="mt-1 flex items-start justify-between gap-2">
              <h3
                id={questionId}
                className="text-base font-semibold break-words text-white"
              >
                {question.text}
              </h3>
              {canSpeak() && (
                <button
                  type="button"
                  onClick={readAloud}
                  aria-pressed={speaking}
                  aria-label={
                    speaking ? t('hai.quiz.readStop') : t('hai.quiz.read')
                  }
                  title={speaking ? t('hai.quiz.readStop') : t('hai.quiz.read')}
                  className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:outline-none"
                >
                  {speaking ? (
                    <VolumeX className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Volume2 className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              )}
            </div>
            <p id={hintId} className="mt-1 text-xs text-gray-400">
              {question.multiple
                ? t('hai.quiz.hintMultiple')
                : t('hai.quiz.hintSingle')}{' '}
              {phase === 'question' && t('hai.quiz.keysHint')}
            </p>

            <div
              role="group"
              aria-labelledby={questionId}
              aria-describedby={hintId}
              className="mt-3 flex flex-col gap-2"
            >
              {question.options.map((option, index) => {
                const isSelected =
                  phase === 'feedback' && feedback
                    ? feedback.selectedOptionIds.includes(option.id)
                    : selected.includes(option.id);
                // With the solution withheld nothing is marked right or wrong:
                // the pick only stays highlighted (the verdict is the text)
                const isRight =
                  phase === 'feedback' &&
                  !!feedback?.correctOptionIds.includes(option.id);
                const isWrongPick =
                  phase === 'feedback' &&
                  !feedback?.solutionWithheld &&
                  isSelected &&
                  !isRight;
                const tone = isRight
                  ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-100'
                  : isWrongPick
                    ? 'border-red-500/60 bg-red-500/10 text-red-100'
                    : isSelected
                      ? 'border-cyan-400 bg-cyan-500/15 text-white'
                      : 'border-white/10 bg-white/5 text-gray-200 hover:border-cyan-500/40 hover:bg-white/10';
                return (
                  <button
                    key={option.id}
                    type="button"
                    data-option-id={option.id}
                    aria-pressed={isSelected}
                    aria-keyshortcuts={`${index + 1} ${optionLetter(index)}`}
                    disabled={phase !== 'question'}
                    onClick={() =>
                      setSelected(current =>
                        toggleSelection(question, current, option.id)
                      )
                    }
                    className={`flex min-h-11 w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:outline-none disabled:cursor-default ${tone}`}
                  >
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-current text-xs font-semibold"
                    >
                      {optionLetter(index)}
                    </span>
                    <span className="min-w-0 flex-1 break-words">
                      {option.text}
                      {isRight && (
                        <span className="sr-only">
                          {' '}
                          ({t('hai.quiz.rightAnswer')})
                        </span>
                      )}
                      {isSelected && phase === 'feedback' && (
                        <span className="sr-only">
                          {' '}
                          ({t('hai.quiz.yourAnswer')})
                        </span>
                      )}
                    </span>
                    {isRight && (
                      <Check
                        className="mt-1 h-4 w-4 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    {isWrongPick && (
                      <X className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>

            {state.errorKey && phase === 'question' && (
              <p role="alert" className="mt-3 text-xs text-red-400">
                {t(`hai.quiz.error.${state.errorKey}`)}
              </p>
            )}

            {(phase === 'question' || phase === 'checking') && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => submit(selected)}
                  disabled={phase === 'checking' || selected.length === 0}
                  className="inline-flex min-h-9 items-center gap-2 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {phase === 'checking' && (
                    <Loader2
                      className="h-3 w-3 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  {phase === 'checking'
                    ? t('hai.quiz.checking')
                    : t('hai.quiz.check')}
                </button>
                <button
                  type="button"
                  onClick={onFinish}
                  className="inline-flex min-h-9 items-center rounded-md border border-white/10 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:outline-none"
                >
                  {t('hai.quiz.finish')}
                </button>
              </div>
            )}

            {phase === 'feedback' && feedback && (
              <div className="mt-3">
                <div role="status" aria-live="polite">
                  <p
                    className={`text-sm font-semibold ${
                      feedback.correct ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {feedback.correct
                      ? t('hai.quiz.correct')
                      : feedback.solutionWithheld
                        ? t('hai.quiz.wrongWithheld')
                        : t('hai.quiz.wrong')}
                  </p>
                  {feedback.solutionWithheld && (
                    <div
                      data-testid="hai-quiz-withheld"
                      className="mt-2 rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-gray-200"
                    >
                      {feedback.correctCount !== null && !feedback.correct && (
                        <p className="mb-1 break-words">
                          {t('hai.quiz.withheld.count', {
                            count: feedback.correctCount,
                          })}
                        </p>
                      )}
                      <p className="break-words">
                        {t('hai.quiz.withheld.note')}
                      </p>
                      {question.enablerHref && (
                        <p className="mt-1">
                          <Link
                            href={question.enablerHref}
                            className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200 focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:outline-none"
                          >
                            {t('hai.quiz.withheld.link', {
                              title: question.enablerTitle,
                            })}
                          </Link>
                        </p>
                      )}
                    </div>
                  )}
                  {feedback.explanation && (
                    <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-gray-200">
                      <p className="font-semibold text-gray-100">
                        {t('hai.quiz.explanation')}
                      </p>
                      <p className="mt-1 break-words whitespace-pre-line">
                        {feedback.explanation}
                      </p>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    ref={nextRef}
                    type="button"
                    onClick={onNext}
                    className="inline-flex min-h-9 items-center rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:outline-none"
                  >
                    {t('hai.quiz.next')}
                  </button>
                  <button
                    type="button"
                    onClick={onFinish}
                    className="inline-flex min-h-9 items-center rounded-md border border-white/10 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:outline-none"
                  >
                    {t('hai.quiz.finish')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

      {phase === 'summary' && (
        <div className="mt-4">
          <h3
            ref={summaryRef}
            tabIndex={-1}
            className="text-base font-semibold text-white outline-none"
          >
            {t('hai.quiz.summary.title')}
          </h3>
          <div role="status" className="mt-2 space-y-2">
            {summary.total === 0 ? (
              <p className="text-gray-300">{t('hai.quiz.summary.none')}</p>
            ) : (
              <p className="text-gray-100">
                <span className="font-semibold text-cyan-300">
                  {t('hai.quiz.summary.score', {
                    correct: summary.correct,
                    total: summary.total,
                  })}
                </span>
                {summary.repeat.length === 0 && (
                  <> {t('hai.quiz.summary.perfect')}</>
                )}
              </p>
            )}
            {summary.anyWithheld && (
              <p className="text-xs text-gray-400">
                {t('hai.quiz.summary.withheld')}
              </p>
            )}
            {state.reason === 'exhausted' && (
              <p className="text-xs text-gray-400">
                {t('hai.quiz.summary.allDone')}
              </p>
            )}
          </div>
          {summary.repeat.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-gray-200">
                {t('hai.quiz.summary.repeat')}
              </p>
              <ul className="mt-1 space-y-1">
                {summary.repeat.map(item => (
                  <li key={item.enablerId} className="text-xs text-gray-200">
                    {item.href ? (
                      <Link
                        href={item.href}
                        className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200 focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:outline-none"
                      >
                        {item.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{item.title}</span>
                    )}{' '}
                    <span className="text-gray-400">
                      {t('hai.quiz.summary.wrongCount', { wrong: item.wrong })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onRestart}
              className="inline-flex min-h-9 items-center rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:outline-none"
            >
              {t('hai.quiz.summary.again')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-9 items-center rounded-md border border-white/10 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:outline-none"
            >
              {t('hai.quiz.close')}
            </button>
          </div>
        </div>
      )}

      {phase === 'empty' && (
        <div className="mt-4">
          <p role="status" className="text-gray-200">
            {t(`hai.quiz.empty.${state.reason ?? 'no_content'}`)}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {state.reason === 'no_topic_match' && onMixed && (
              <button
                type="button"
                onClick={onMixed}
                className="inline-flex min-h-9 items-center rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:outline-none"
              >
                {t('hai.quiz.empty.mixed')}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-9 items-center rounded-md border border-white/10 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:outline-none"
            >
              {t('hai.quiz.close')}
            </button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="mt-4">
          <p role="alert" className="text-red-400">
            {t(`hai.quiz.error.${state.errorKey ?? 'generic'}`)}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onNext}
              className="inline-flex min-h-9 items-center rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:outline-none"
            >
              {t('hai.quiz.retry')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-9 items-center rounded-md border border-white/10 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:outline-none"
            >
              {t('hai.quiz.close')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default HaiQuizCard;
