'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Clock, CheckCircle, XCircle, Award, Target, RefreshCw, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { QuizWithQuestions } from '@/db/queries';

interface QuizProps {
  quiz: QuizWithQuestions;
}

type QuizPhase = 'answering' | 'review' | 'retry' | 'completed';

export default function Quiz({ quiz }: QuizProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  const [timeLeft, setTimeLeft] = useState(quiz.timeLimitMinutes * 60);
  const [phase, setPhase] = useState<QuizPhase>('answering');
  const [score, setScore] = useState(0);
  const [wrongQuestionIds, setWrongQuestionIds] = useState<string[]>([]);
  const [attemptCount, setAttemptCount] = useState(1);

  // Memoize quiz data to prevent unnecessary recalculations
  const quizData = useMemo(() => quiz, [quiz]);

  // Get current questions based on phase (all questions or only wrong ones)
  const currentQuestions = useMemo(() => {
    if (phase === 'retry') {
      return quizData.questions.filter(q => wrongQuestionIds.includes(q.id));
    }
    return quizData.questions;
  }, [quizData.questions, wrongQuestionIds, phase]);

  // Reset quiz state function
  const resetQuiz = useCallback(() => {
    setCurrentQuestion(0);
    setSelectedAnswers({});
    setTimeLeft(quiz.timeLimitMinutes * 60);
    setPhase('answering');
    setScore(0);
    setWrongQuestionIds([]);
    setAttemptCount(1);
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
    if (currentQuestion < currentQuestions.length - 1) {
      setCurrentQuestion(prev => prev + 1);
    } else {
      handleQuizCompletion();
    }
  }, [currentQuestion, currentQuestions.length]);

  const handleQuizCompletion = useCallback(() => {
    // Calculate which answers are wrong
    const wrongIds: string[] = [];
    let correctAnswers = 0;

    currentQuestions.forEach(question => {
      const selectedAnswer = selectedAnswers[question.id];
      if (selectedAnswer !== undefined && selectedAnswer === question.correctIndex) {
        correctAnswers++;
      } else {
        wrongIds.push(question.id);
      }
    });

    const finalScore = Math.round((correctAnswers / currentQuestions.length) * 100);
    setScore(finalScore);

    if (wrongIds.length === 0) {
      // 100% correct - quiz completed!
      setPhase('completed');
    } else {
      // Some wrong answers - show review
      setWrongQuestionIds(wrongIds);
      setPhase('review');
    }
  }, [selectedAnswers, currentQuestions]);

  // Start retry with wrong questions only
  const handleStartRetry = useCallback(() => {
    // Clear answers only for wrong questions
    setSelectedAnswers(prev => {
      const newAnswers = { ...prev };
      wrongQuestionIds.forEach(id => {
        delete newAnswers[id];
      });
      return newAnswers;
    });
    setCurrentQuestion(0);
    setAttemptCount(prev => prev + 1);
    setPhase('retry');
  }, [wrongQuestionIds]);

  const getProgressPercentage = useCallback(() => {
    return ((currentQuestion + 1) / currentQuestions.length) * 100;
  }, [currentQuestion, currentQuestions.length]);

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
        if (prev <= 1) {
          handleQuizCompletion();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [phase, timeLeft, handleQuizCompletion]);

  // Review screen - showing wrong answers
  if (phase === 'review') {
    const correctCount = quizData.totalQuestions - wrongQuestionIds.length;
    
    return (
      <div className="from-background flex min-h-full items-center justify-center bg-gradient-to-br via-amber-900/20 to-amber-800/30 p-6">
        <div className="glass-effect-enhanced border-amber-500/40 w-full max-w-3xl rounded-3xl border-2 p-8 shadow-2xl">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-500 shadow-2xl">
              <AlertTriangle className="h-12 w-12 text-white" />
            </div>

            <h1 className="text-slate-900 dark:text-white mb-4 text-3xl font-bold">
              {t('quiz.notPerfectYet')}
            </h1>

            <p className="text-slate-600 dark:text-slate-300 mb-2 text-lg">
              {t('quiz.yourScore')}: <span className="text-amber-600 font-bold">{score}%</span>
            </p>
            
            <p className="text-slate-500 dark:text-slate-400 mb-6">
              {t('quiz.wrongAnswersCount').replace('{count}', String(wrongQuestionIds.length))}
            </p>
          </div>

          {/* Show wrong questions for review */}
          <div className="bg-slate-100 dark:bg-slate-800/50 rounded-2xl p-6 mb-8 max-h-[300px] overflow-y-auto">
            <h3 className="text-slate-900 dark:text-white font-semibold mb-4">
              {t('quiz.questionsToCorrect')}:
            </h3>
            <div className="space-y-3">
              {wrongQuestionIds.map((qId, idx) => {
                const question = quizData.questions.find(q => q.id === qId);
                if (!question) return null;
                
                return (
                  <div key={qId} className="bg-white dark:bg-slate-700/50 rounded-xl p-4 border border-red-200 dark:border-red-500/30">
                    <div className="flex items-start gap-3">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 dark:bg-red-500/20 text-xs font-bold text-red-600 dark:text-red-400">
                        {idx + 1}
                      </span>
                      <div className="flex-1">
                        <p className="text-slate-800 dark:text-slate-200 text-sm font-medium">
                          {question.question}
                        </p>
                        <p className="text-red-600 dark:text-red-400 text-xs mt-1">
                          {t('quiz.yourAnswerWas')}: {question.options[selectedAnswers[qId]] || t('quiz.noAnswer')}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <button
              onClick={handleStartRetry}
              className="flex items-center justify-center gap-2 from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 transform rounded-2xl bg-gradient-to-r px-8 py-4 font-semibold text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
            >
              <RefreshCw className="h-5 w-5" />
              {t('quiz.correctWrongAnswers')}
            </button>
          </div>

          <p className="text-center text-slate-500 dark:text-slate-400 text-sm mt-4">
            {t('quiz.mustGet100')}
          </p>
        </div>
      </div>
    );
  }

  // Completed screen - 100% correct!
  if (phase === 'completed') {
    return (
      <div className="from-background flex min-h-full items-center justify-center bg-gradient-to-br via-green-900/20 to-emerald-800/30 p-6">
        <div className="glass-effect-enhanced border-green-500/40 w-full max-w-2xl rounded-3xl border-2 p-8 text-center shadow-2xl">
          <div className="mb-8">
            <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-emerald-500 shadow-2xl animate-pulse">
              <Award className="h-12 w-12 text-white" />
            </div>

            <h1 className="text-slate-900 dark:text-white mb-4 text-4xl font-bold">
              🎉 {t('quiz.perfectScore')} 🎉
            </h1>

            <p className="text-slate-600 dark:text-slate-300 mb-6 text-xl">
              {t('quiz.youGot')} <span className="text-green-600 font-bold">100%</span> {t('quiz.correct')}!
            </p>

            <div className="bg-green-50 dark:bg-green-900/20 rounded-2xl p-6 mb-8">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-white dark:bg-slate-800/50 rounded-xl p-3 text-center">
                  <p className="text-slate-500 dark:text-slate-400">{t('quiz.totalQuestions')}</p>
                  <p className="text-2xl font-bold text-green-600">
                    {quizData.totalQuestions}
                  </p>
                </div>
                <div className="bg-white dark:bg-slate-800/50 rounded-xl p-3 text-center">
                  <p className="text-slate-500 dark:text-slate-400">{t('quiz.attempts')}</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">
                    {attemptCount}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <button
              onClick={() => router.push('/trainee/dashboard')}
              className="from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 transform rounded-2xl bg-gradient-to-r px-6 py-3 font-medium text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
            >
              {t('quiz.toDashboard')}
            </button>
          </div>
        </div>
      </div>
    );
  }

const currentQ = currentQuestions[currentQuestion];
  const isAnswerSelected = selectedAnswers[currentQ.id] !== undefined;
  const isRetryPhase = phase === 'retry';

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      {/* Retry Mode Banner */}
      {isRetryPhase && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/30 rounded-2xl p-4 flex items-center gap-3">
          <RefreshCw className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="text-amber-800 dark:text-amber-200 font-medium">
              {t('quiz.retryMode')} - {t('quiz.attemptNumber').replace('{number}', String(attemptCount))}
            </p>
            <p className="text-amber-600 dark:text-amber-400 text-sm">
              {t('quiz.correctingQuestions').replace('{count}', String(currentQuestions.length))}
            </p>
          </div>
        </div>
      )}

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
            disabled={!isAnswerSelected && currentQuestion !== currentQuestions.length - 1}
            aria-label={currentQuestion === currentQuestions.length - 1 ? t('quiz.complete') : t('quiz.nextQuestion')}
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
              .replace('{total}', String(currentQuestions.length))}
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
            {currentQuestion === currentQuestions.length - 1 ? t('quiz.complete') : t('quiz.nextQuestion')}
          </button>
        </div>
      </div>
    </div>
  );
}

