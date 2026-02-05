'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Clock, CheckCircle, XCircle, Award, Target } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { QuizWithQuestions } from '@/db/queries';

interface QuizProps {
  quiz: QuizWithQuestions;
}

export default function Quiz({ quiz }: QuizProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<
    Record<string, number>
  >({});
  const [timeLeft, setTimeLeft] = useState(quiz.timeLimitMinutes * 60);
  const [isCompleted, setIsCompleted] = useState(false);
  const [passed, setPassed] = useState(false);
  const [score, setScore] = useState(0);

  // Memoize quiz data to prevent unnecessary recalculations
  const quizData = useMemo(() => quiz, [quiz]);

  // Reset quiz state function instead of page reload
  const resetQuiz = useCallback(() => {
    setCurrentQuestion(0);
    setSelectedAnswers({});
    setTimeLeft(quiz.timeLimitMinutes * 60);
    setIsCompleted(false);
    setPassed(false);
    setScore(0);
  }, [quiz.timeLimitMinutes]);

  const handlePrevQuestion = useCallback(() => {
    setCurrentQuestion(prev => (prev > 0 ? prev - 1 : prev));
  }, []);

  const handleAnswerSelect = useCallback(
    (questionId: string, optionIndex: number) => {
      setSelectedAnswers(prev => ({
        ...prev,
        [questionId]: optionIndex,
      }));
    },
    []
  );

  const handleNextQuestion = useCallback(() => {
    if (currentQuestion < quizData.totalQuestions - 1) {
      setCurrentQuestion(prev => prev + 1);
    } else {
      handleQuizCompletion();
    }
  }, [currentQuestion, quizData.totalQuestions]);

  const handleQuizCompletion = useCallback(() => {
    setIsCompleted(true);

    // Calculate score
    let correctAnswers = 0;
    quizData.questions.forEach(question => {
      const selectedAnswer = selectedAnswers[question.id];
      if (selectedAnswer !== undefined && selectedAnswer === question.correctIndex) {
        correctAnswers++;
      }
    });

    const finalScore = Math.round(
      (correctAnswers / quizData.totalQuestions) * 100
    );
    setScore(finalScore);
    setPassed(finalScore >= 70);
  }, [selectedAnswers, quizData]);

  const getProgressPercentage = useCallback(() => {
    return ((currentQuestion + 1) / quizData.totalQuestions) * 100;
  }, [currentQuestion, quizData.totalQuestions]);

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Timer effect
  useEffect(() => {
    if (isCompleted || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          handleQuizCompletion();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isCompleted, timeLeft, handleQuizCompletion]);

  // Auto-submit when time runs out
  useEffect(() => {
    if (timeLeft <= 0 && !isCompleted) {
      handleQuizCompletion();
    }
  }, [timeLeft, isCompleted, handleQuizCompletion]);

  if (isCompleted) {
    return (
      <div className="from-background flex min-h-full items-center justify-center bg-gradient-to-br via-red-900/20 to-red-800/30 p-6">
        <div className="glass-effect-enhanced border-accent/40 w-full max-w-2xl rounded-3xl border-2 p-8 text-center shadow-2xl">
          <div className="mb-8">
            {passed ? (
              <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-emerald-500 shadow-2xl">
                <Award className="h-12 w-12 text-foreground" />
              </div>
            ) : (
              <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-pink-500 shadow-2xl">
                <Target className="h-12 w-12 text-foreground" />
              </div>
            )}

            <h1 className="text-foreground mb-4 text-4xl font-bold">
              {passed ? t('quiz.passed') : t('quiz.failed')}
            </h1>

            <p className="text-muted-foreground mb-6 text-xl">
              {t('quiz.yourResult')}{' '}
              <span className="text-accent font-bold">{score}%</span>
            </p>

            <div className="bg-muted/30 mb-8 rounded-2xl p-6">
              <h3 className="text-foreground mb-4 text-lg font-semibold">
                {t('quiz.summary')}
              </h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-background/50 rounded-xl p-3 text-center">
                  <p className="text-muted">{t('quiz.correctAnswers')}</p>
                  <p className="text-2xl font-bold text-green-600">
                    {Math.round((score / 100) * quizData.totalQuestions)}
                  </p>
                </div>
                <div className="bg-background/50 rounded-xl p-3 text-center">
                  <p className="text-muted">{t('quiz.totalQuestions')}</p>
                  <p className="text-accent text-2xl font-bold">
                    {quizData.totalQuestions}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <button
              onClick={() => router.push('/trainee/dashboard')}
              className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 transform rounded-2xl bg-gradient-to-r px-6 py-3 font-medium text-foreground shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
            >
              {t('quiz.toDashboard')}
            </button>
            {!passed && (
              <button
                onClick={resetQuiz}
                className="text-muted bg-muted/30 hover:bg-muted/50 rounded-2xl px-6 py-3 font-medium transition-all duration-200"
              >
                {t('quiz.retryAgain')}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const currentQ = quizData.questions[currentQuestion];
  const isAnswerSelected = selectedAnswers[currentQ.id] !== undefined;

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
          <div className="flex-1">
            <h1 className="text-foreground text-3xl font-bold">
              {quizData.title}
            </h1>
            <p className="text-muted mt-1">{quizData.description}</p>
          </div>
          <button
            onClick={handleNextQuestion}
            className="text-muted hover:text-foreground hover:bg-accent/20 rounded-xl p-2 transition-all duration-200 disabled:opacity-50"
            disabled={!isAnswerSelected && currentQuestion !== quizData.totalQuestions - 1}
            aria-label={currentQuestion === quizData.totalQuestions - 1 ? t('quiz.complete') : t('quiz.nextQuestion')}
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
              .replace('{total}', String(quizData.totalQuestions))}
          </span>
          <span>
            {t('quiz.completed').replace('{percent}', String(Math.round(getProgressPercentage())))}
          </span>
        </div>
      </div>

      {/* Timer */}
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

      {/* Current Question */}
      <div className="rounded-3xl border glass-effect border-accent/30 p-8 shadow-lg">
        <div className="mb-6">
          <h3 className="mb-2 text-xl font-bold text-foreground">
            {t('quiz.questionNumber').replace('{number}', String(currentQuestion + 1))}
          </h3>
          <p className="text-lg text-foreground">{currentQ.question}</p>
        </div>

        <div className="space-y-4">
          {currentQ.options.map((option, oIndex) => (
            <label
              key={oIndex}
              className={`flex cursor-pointer items-center rounded-2xl glass-effect border-accent/30 border-2 p-4 transition-all duration-200 ${selectedAnswers[currentQ.id] === oIndex
                  ? 'border-red-300 bg-gradient-to-r from-red-50 to-indigo-50 shadow-md dark:border-red-500/50 dark:from-red-950/40 dark:to-indigo-950/40'
                  : 'border-red-200/50 bg-card hover:border-red-200 hover:bg-accent/5 dark:border-border dark:hover:bg-accent/10'
                }`}
            >
              <input
                type="radio"
                name={`question-${currentQ.id}`}
                value={oIndex}
                checked={selectedAnswers[currentQ.id] === oIndex}
                onChange={() => handleAnswerSelect(currentQ.id, oIndex)}
                className="sr-only"
              />
              <div
                className={`mr-4 flex h-5 w-5 items-center justify-center rounded-full border-2 ${selectedAnswers[currentQ.id] === oIndex
                    ? 'border-red-500 bg-red-500'
                    : 'border-muted-foreground/30'
                  }`}
              >
                {selectedAnswers[currentQ.id] === oIndex && (
                  <CheckCircle className="h-3 w-3 text-foreground" />
                )}
              </div>
              <span className="text-foreground">{option}</span>
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
            disabled={!isAnswerSelected}
            className="min-w-[160px] flex items-center justify-center rounded-2xl bg-red-600 px-6 py-3 font-semibold text-foreground shadow-lg transition duration-200 hover:bg-red-700 focus:outline-none focus:ring-4 focus:ring-red-300 active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {currentQuestion === quizData.totalQuestions - 1 ? t('quiz.complete') : t('quiz.nextQuestion')}
          </button>
        </div>
      </div>
    </div>
  );
}

