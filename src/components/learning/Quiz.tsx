'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  CheckCircle,
  XCircle,
  Award,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';

interface QuizProps {
  quiz: {
    id: string;
    title: string;
    description?: string;
    totalQuestions: number;
    timeLimitMinutes: number;
    questions: Array<{
      id: string;
      question: string;
      options: Array<{ id: string; text: string }>;
      order_index?: number;
    }>;
  };
}

type QuizPhase = 'answering' | 'submitting' | 'results';

export default function Quiz({ quiz }: QuizProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const { profile } = useAuth() as any;
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<
    Record<string, string>
  >({});
  const [timeLeft, setTimeLeft] = useState(quiz.timeLimitMinutes * 60);
  const [attemptCount, setAttemptCount] = useState(1);
  const [phase, setPhase] = useState<QuizPhase>('answering');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<null | {
    score: number;
    feedback: Array<{
      questionId: string;
      correct: boolean;
      correctOptionId: string | null;
      explanation?: string | null;
      selectedOptionId?: string | null;
      selectedText?: string | null;
      correctAnswerText?: string | null;
    }>;
  }>(null);

  // Memoize quiz data to prevent unnecessary recalculations
  const quizData = useMemo(() => quiz, [quiz]);

  const questions = quizData.questions;

  // Reset quiz state function
  const resetQuiz = useCallback(() => {
    setCurrentQuestion(0);
    setSelectedAnswers({});
    setTimeLeft(quiz.timeLimitMinutes * 60);
    setPhase('answering');
    setError(null);
    setResult(null);
  }, [quiz.timeLimitMinutes]);

  const handlePrevQuestion = useCallback(() => {
    setCurrentQuestion(prev => (prev > 0 ? prev - 1 : prev));
  }, []);

  const handleAnswerSelect = useCallback(
    (questionId: string, optionId: string) => {
      setSelectedAnswers(prev => ({
        ...prev,
        [questionId]: optionId,
      }));
    },
    []
  );

  const unansweredQuestionIndexes = useMemo(() => {
    const out: number[] = [];
    questions.forEach((q, idx) => {
      if (!selectedAnswers[q.id]) out.push(idx + 1);
    });
    return out;
  }, [questions, selectedAnswers]);

  const allAnswered = unansweredQuestionIndexes.length === 0;

  const handleSubmit = useCallback(async () => {
    if (!profile?.id) {
      setError(t('quiz.userNotFound'));
      return;
    }

    if (!allAnswered) {
      const left = unansweredQuestionIndexes.length;
      // UI requirement: show an alert with how many questions are left
      alert(
        t('quiz.unansweredQuestions')
          .replace('{count}', String(left))
          .replace('{numbers}', unansweredQuestionIndexes.join(', '))
      );
      return;
    }

    try {
      setPhase('submitting');
      setError(null);

      const payload = {
        traineeId: profile.id,
        answers: questions.map(q => ({
          questionId: q.id,
          selectedOptionId: selectedAnswers[q.id],
        })),
      };

      const res = await fetch(`/api/trainee/quizzes/${quizData.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Submit failed');
      }
      setResult({ score: data.score, feedback: data.feedback || [] });
      setAttemptCount(prev => prev + 1);
      setPhase('results');
    } catch (e: any) {
      setError(e?.message || 'Unknown error');
      setPhase('answering');
    }
  }, [
    profile?.id,
    allAnswered,
    unansweredQuestionIndexes,
    t,
    questions,
    selectedAnswers,
    quizData.id,
  ]);

  const handleNextQuestion = useCallback(() => {
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(prev => prev + 1);
    } else {
      handleSubmit();
    }
  }, [currentQuestion, questions.length, handleSubmit]);

  const getProgressPercentage = useCallback(() => {
    return ((currentQuestion + 1) / questions.length) * 100;
  }, [currentQuestion, questions.length]);

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Timer effect (only during answering phase)
  useEffect(() => {
    if (phase !== 'answering' || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [phase, timeLeft]);

  // Results screen (submit regardless of correctness)
  if (phase === 'results' && result) {
    const feedbackMap = new Map(
      result.feedback.map(f => [String(f.questionId), f])
    );

    return (
      <div className="from-background flex min-h-full items-center justify-center bg-gradient-to-br via-slate-900/10 to-slate-800/10 p-6">
        <div className="glass-effect-enhanced w-full max-w-3xl rounded-3xl border border-border/60 p-8 shadow-2xl">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary shadow-xl">
              <Award className="h-10 w-10 text-foreground" />
            </div>
            <h1 className="text-foreground mb-2 text-3xl font-bold">
              {t('quiz.yourScore')}: {result.score}%
            </h1>
            <p className="text-muted-foreground">
              {t('quiz.totalQuestions')}: {questions.length}
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
              {error}
            </div>
          )}

          <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
            {questions.map((q, idx) => {
              const fb = feedbackMap.get(String(q.id));
              const chosenOptId = selectedAnswers[q.id];
              const chosenText =
                q.options.find(o => String(o.id) === String(chosenOptId))?.text ||
                t('quiz.noAnswer');
              const correctText = fb?.correctOptionId
                ? q.options.find(o => String(o.id) === String(fb.correctOptionId))
                    ?.text
                : null;

              return (
                <div
                  key={q.id}
                  className={`rounded-2xl border p-4 ${
                    fb?.correct
                      ? 'border-green-500/30 bg-green-500/10'
                      : 'border-red-500/30 bg-red-500/10'
                  }`}
                >
                  <div className="mb-2 flex items-start gap-3">
                    <span className="bg-muted/50 text-muted-foreground flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold">
                      {idx + 1}
                    </span>
                    <div className="flex-1">
                      <p className="text-foreground font-medium">{q.question}</p>
                      <p
                        className={`mt-1 text-sm ${
                          fb?.correct ? 'text-green-500' : 'text-red-500'
                        }`}
                      >
                        {t('quiz.yourAnswerWas')}: {chosenText}
                      </p>
                      {!fb?.correct && correctText && (
                        <p className="mt-1 text-sm text-green-500">
                          {t('quiz.correct')}: {correctText}
                        </p>
                      )}
                      {fb?.explanation && (
                        <p className="text-muted-foreground mt-1 text-xs">
                          {fb.explanation}
                        </p>
                      )}
                    </div>
                    {fb?.correct ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex flex-col justify-end gap-3 sm:flex-row">
            <button
              onClick={() => router.push('/trainee/quizzes')}
              className="bg-muted text-foreground hover:bg-muted/80 rounded-2xl px-6 py-3 font-medium transition"
            >
              {t('quiz.toDashboard')}
            </button>
            <button
              onClick={() => {
                resetQuiz();
                setAttemptCount(prev => prev + 1);
              }}
              className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 text-foreground flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r px-6 py-3 font-semibold shadow-lg transition"
            >
              <RefreshCw className="h-5 w-5" />
              {t('quiz.retryAgain')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentQ = questions[currentQuestion];
  const isAnswerSelected = !!selectedAnswers[currentQ.id];
  const isLast = currentQuestion === questions.length - 1;

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={handlePrevQuestion}
            className="text-muted hover:text-foreground hover:bg-accent/20 rounded-xl p-2 transition-all duration-200 disabled:opacity-50"
            disabled={currentQuestion === 0}
            aria-label={t('quiz.previousQuestion')}
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-foreground truncate text-3xl font-bold">
              {quizData.title}
            </h1>
            <p className="text-muted mt-1">{quizData.description}</p>
          </div>
          <button
            onClick={handleNextQuestion}
            className="text-muted hover:text-foreground hover:bg-accent/20 rounded-xl p-2 transition-all duration-200 disabled:opacity-50"
            disabled={!isAnswerSelected || phase === 'submitting'}
            aria-label={isLast ? t('common.submit') : t('quiz.nextQuestion')}
          >
            <ArrowRight className="h-6 w-6" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="bg-muted/30 mb-4 h-3 w-full rounded-full">
          <div
            className="from-accent to-primary h-3 rounded-full bg-gradient-to-r transition-all duration-500"
            style={{ width: `${getProgressPercentage()}%` }}
          />
        </div>

        <div className="text-muted flex items-center justify-between text-sm">
          <span>
            {t('quiz.questionOf')
              .replace('{current}', String(currentQuestion + 1))
              .replace('{total}', String(questions.length))}
          </span>
          <span>
            {t('quiz.completed').replace('{percent}', String(Math.round(getProgressPercentage())))}
          </span>
        </div>
      </div>

      {/* Timer - only show in answering phase */}
      {phase === 'answering' && (
        <div className="glass-effect border-accent/30 rounded-3xl border p-6">
          <div className="flex items-center justify-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-red-500 to-pink-500">
              <Clock className="h-6 w-6 text-foreground" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-red-600">
                {t('quiz.timeRemaining')}
              </p>
              <p className="text-2xl font-bold text-red-700">
                {formatTime(timeLeft)}
              </p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500">
          {error}
        </div>
      )}

      {/* Current Question */}
      <div className="rounded-3xl border glass-effect border-accent/30 p-8 shadow-lg">
        <div className="mb-6">
          <h3 className="mb-2 text-xl font-bold text-foreground">
            {t('quiz.questionNumber').replace('{number}', String(currentQuestion + 1))}
          </h3>
          <p className="text-lg text-foreground">{currentQ.question}</p>
        </div>

        <div className="space-y-4">
          {currentQ.options.map((option) => (
            <label
              key={option.id}
              className={`flex cursor-pointer items-center rounded-2xl glass-effect border-accent/30 border-2 p-4 transition-all duration-200 ${selectedAnswers[currentQ.id] === option.id
                  ? 'border-red-300 bg-gradient-to-r from-red-50 to-indigo-50 shadow-md dark:border-red-500/50 dark:from-red-950/40 dark:to-indigo-950/40'
                  : 'border-red-200/50 bg-card hover:border-red-200 hover:bg-accent/5 dark:border-border dark:hover:bg-accent/10'
                }`}
            >
              <input
                type="radio"
                name={`question-${currentQ.id}`}
                value={option.id}
                checked={selectedAnswers[currentQ.id] === option.id}
                onChange={() => handleAnswerSelect(currentQ.id, option.id)}
                className="sr-only"
              />
              <div
                className={`mr-4 flex h-5 w-5 items-center justify-center rounded-full border-2 ${selectedAnswers[currentQ.id] === option.id
                    ? 'border-red-500 bg-red-500'
                    : 'border-muted-foreground/30'
                  }`}
              >
                {selectedAnswers[currentQ.id] === option.id && (
                  <CheckCircle className="h-3 w-3 text-foreground" />
                )}
              </div>
              <span className="text-foreground">{option.text}</span>
            </label>
          ))}
        </div>

        {/* Navigation Buttons */}
        <div className="mt-8 flex justify-between">
          <button
            onClick={handlePrevQuestion}
            disabled={currentQuestion === 0}
            className="text-foreground rounded-2xl px-6 py-3 font-medium transition-all duration-200 disabled:opacity-50"
          >
            {t('quiz.previousQuestion')}
          </button>

          <button
            onClick={handleNextQuestion}
            disabled={
              phase === 'submitting' ||
              !isAnswerSelected ||
              (isLast && !allAnswered)
            }
            className="min-w-[160px] flex items-center justify-center rounded-2xl bg-red-600 px-6 py-3 font-semibold text-foreground shadow-lg transition duration-200 hover:bg-red-700 focus:outline-none focus:ring-4 focus:ring-red-300 active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === 'submitting'
              ? t('reports.submitting')
              : isLast
                ? t('common.submit')
                : t('quiz.nextQuestion')}
          </button>
        </div>
      </div>
    </div>
  );
}

