'use client';

/**
 * HAI quiz mode in the chat: the button that starts it and the panel that
 * shows the quiz card below the messages. Both read the session of
 * HaiQuizModeProvider, so the chat views only place them.
 */

import React, { useEffect, useRef } from 'react';
import { GraduationCap } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useHai } from './HaiProvider';
import { useHaiQuizMode } from './HaiQuizMode';
import { HaiQuizCard } from './HaiQuizCard';

/** The quiz card below the messages, nothing while the quiz mode is off. */
export function HaiQuizPanel() {
  const quiz = useHaiQuizMode();
  const ref = useRef<HTMLDivElement>(null);

  // A new question or the summary comes into view
  useEffect(() => {
    if (!quiz.active) return;
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [quiz.active, quiz.state.phase, quiz.state.question?.id]);

  if (!quiz.active) return null;
  return (
    <div ref={ref} data-testid="hai-quiz-panel">
      <HaiQuizCard
        state={quiz.state}
        onAnswer={quiz.answer}
        onNext={quiz.next}
        onFinish={quiz.finish}
        onRestart={quiz.restart}
        onClose={quiz.close}
        onMixed={() => quiz.start({})}
      />
    </div>
  );
}

/**
 * Button of the chat header: starts the quiz mode (for the open enabler when
 * the chat is open in one, otherwise mixed), a second press leaves it.
 */
export function HaiQuizModeButton({
  className,
}: {
  /** Classes of the button, so the header can match its other buttons. */
  className?: string;
}) {
  const { t } = useLanguage();
  const { context } = useHai();
  const quiz = useHaiQuizMode();

  return (
    <button
      type="button"
      onClick={() =>
        quiz.active
          ? quiz.close()
          : quiz.start({ enablerId: context.enablerId ?? null })
      }
      aria-pressed={quiz.active}
      aria-label={t('hai.quiz.buttonHint')}
      title={t('hai.quiz.buttonHint')}
      data-testid="hai-quiz-button"
      className={
        className ??
        'inline-flex items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-sm font-medium text-cyan-400 transition-colors hover:bg-cyan-500/20'
      }
    >
      <GraduationCap className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="hidden sm:inline">{t('hai.quiz.button')}</span>
    </button>
  );
}
