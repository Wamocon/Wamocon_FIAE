'use client';

import { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Trophy,
  BookOpen,
} from 'lucide-react';

interface QuizProps {
  onNavigation: (view: string, data?: any) => void;
}

export function Quiz({ onNavigation }: QuizProps) {
  const [selectedAnswers, setSelectedAnswers] = useState<{
    [key: number]: number;
  }>({});
  const [timeLeft, setTimeLeft] = useState(1800); // 30 minutes in seconds
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [score, setScore] = useState(0);

  const mockQuiz = {
    title: 'Abschlusstest: Einführung in die Programmierung',
    description:
      'Teste dein Wissen aus dem Kapitel "Einführung in die Programmierung"',
    totalQuestions: 3,
    passingScore: 70,
    questions: [
      {
        id: 1,
        question: 'Was ist eine Variable in der Programmierung?',
        options: [
          'Ein Behälter für Daten',
          'Ein Computerprogramm',
          'Eine mathematische Formel',
          'Ein Fehler im Code',
        ],
        correctAnswer: 0,
      },
      {
        id: 2,
        question: 'Welcher Datentyp wird für Text verwendet?',
        options: ['Number', 'String', 'Boolean', 'Array'],
        correctAnswer: 1,
      },
      {
        id: 3,
        question: 'Was bedeutet "Hello World" in der Programmierung?',
        options: [
          'Ein Fehler im Code',
          'Das erste Programm, das man schreibt',
          'Eine Programmiersprache',
          'Ein Computer',
        ],
        correctAnswer: 1,
      },
    ],
  };

  // Timer effect
  useEffect(() => {
    if (timeLeft > 0 && !isSubmitted) {
      const timer = setInterval(() => {
        setTimeLeft(prev => prev - 1);
      }, 1000);
      return () => clearInterval(timer);
    } else if (timeLeft === 0 && !isSubmitted) {
      handleSubmit();
    }
  }, [timeLeft, isSubmitted]);

  const handleGoBack = () => {
    onNavigation('chapterDetail');
  };

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const handleAnswerSelect = (questionId: number, answerIndex: number) => {
    setSelectedAnswers(prev => ({
      ...prev,
      [questionId]: answerIndex,
    }));
  };

  const handleSubmit = () => {
    // Calculate score
    let correctAnswers = 0;
    mockQuiz.questions.forEach(question => {
      if (selectedAnswers[question.id] === question.correctAnswer) {
        correctAnswers++;
      }
    });

    const calculatedScore = Math.round(
      (correctAnswers / mockQuiz.questions.length) * 100
    );
    setScore(calculatedScore);
    setIsSubmitted(true);
  };

  const handleNextQuestion = () => {
    if (currentQuestion < mockQuiz.questions.length - 1) {
      setCurrentQuestion(prev => prev + 1);
    }
  };

  const handlePrevQuestion = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(prev => prev - 1);
    }
  };

  const getProgressPercentage = () => {
    return ((currentQuestion + 1) / mockQuiz.questions.length) * 100;
  };

  if (isSubmitted) {
    const passed = score >= mockQuiz.passingScore;
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="glass-effect border-accent/30 rounded-3xl border p-8 text-center shadow-lg">
          <div
            className={`mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full ${
              passed
                ? 'bg-gradient-to-br from-green-500 to-emerald-500'
                : 'bg-gradient-to-br from-red-500 to-pink-500'
            }`}
          >
            {passed ? (
              <Trophy className="h-10 w-10 text-white" />
            ) : (
              <XCircle className="h-10 w-10 text-white" />
            )}
          </div>

          <h2 className="text-foreground mb-2 text-2xl font-bold">
            {passed
              ? 'Quiz erfolgreich abgeschlossen! 🎉'
              : 'Quiz nicht bestanden'}
          </h2>

          <div className="mb-4 text-6xl font-bold">
            <span className={passed ? 'text-green-500' : 'text-red-500'}>
              {score}%
            </span>
          </div>

          <p className="text-muted mb-6">
            {passed
              ? `Glückwunsch! Du hast ${score}% der Fragen richtig beantwortet.`
              : `Du hast ${score}% der Fragen richtig beantwortet. Die Bestehensgrenze liegt bei ${mockQuiz.passingScore}%.`}
          </p>

          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <button
              onClick={() => onNavigation('dashboard')}
              className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 transform rounded-2xl bg-gradient-to-r px-6 py-3 font-medium text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
            >
              Zum Dashboard
            </button>
            {!passed && (
              <button
                onClick={() => window.location.reload()}
                className="text-muted bg-muted/30 hover:bg-muted/50 rounded-2xl px-6 py-3 font-medium transition-all duration-200"
              >
                Erneut versuchen
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const currentQ = mockQuiz.questions[currentQuestion];
  const isAnswerSelected = selectedAnswers[currentQ.id] !== undefined;

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={handleGoBack}
            className="text-muted hover:text-foreground hover:bg-accent/20 rounded-xl p-2 transition-all duration-200"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <div className="flex-1">
            <h1 className="text-foreground text-3xl font-bold">
              {mockQuiz.title}
            </h1>
            <p className="text-muted mt-1">{mockQuiz.description}</p>
          </div>
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
            Frage {currentQuestion + 1} von {mockQuiz.totalQuestions}
          </span>
          <span>{Math.round(getProgressPercentage())}% abgeschlossen</span>
        </div>
      </div>

      {/* Timer */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-6">
        <div className="flex items-center justify-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-red-500 to-pink-500">
            <Clock className="h-6 w-6 text-white" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-red-600">
              Verbleibende Zeit
            </p>
            <p className="text-2xl font-bold text-red-700">
              {formatTime(timeLeft)}
            </p>
          </div>
        </div>
      </div>

      {/* Current Question */}
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-lg">
        <div className="mb-6">
          <h3 className="mb-2 text-xl font-bold text-slate-800">
            Frage {currentQuestion + 1}
          </h3>
          <p className="text-lg text-slate-700">{currentQ.question}</p>
        </div>

        <div className="space-y-4">
          {currentQ.options.map((option, oIndex) => (
            <label
              key={oIndex}
              className={`flex cursor-pointer items-center rounded-2xl border-2 p-4 transition-all duration-200 ${
                selectedAnswers[currentQ.id] === oIndex
                  ? 'border-blue-300 bg-gradient-to-r from-blue-50 to-indigo-50 shadow-md'
                  : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100'
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
                className={`mr-4 flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                  selectedAnswers[currentQ.id] === oIndex
                    ? 'border-blue-500 bg-blue-500'
                    : 'border-slate-400'
                }`}
              >
                {selectedAnswers[currentQ.id] === oIndex && (
                  <div className="h-2 w-2 rounded-full bg-white"></div>
                )}
              </div>
              <span className="font-medium text-slate-800">{option}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Navigation */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <button
            onClick={handlePrevQuestion}
            disabled={currentQuestion === 0}
            className="flex items-center gap-2 rounded-2xl bg-slate-100 px-6 py-3 font-medium text-slate-600 transition-all duration-200 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Vorherige
          </button>

          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">
              {Object.keys(selectedAnswers).length} von{' '}
              {mockQuiz.totalQuestions} beantwortet
            </span>

            {currentQuestion === mockQuiz.questions.length - 1 ? (
              <button
                onClick={handleSubmit}
                disabled={
                  Object.keys(selectedAnswers).length <
                  mockQuiz.questions.length
                }
                className="flex transform items-center gap-2 rounded-2xl bg-gradient-to-r from-green-600 to-emerald-600 px-8 py-3 font-semibold text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:from-green-700 hover:to-emerald-700 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle className="h-5 w-5" />
                Quiz abschließen
              </button>
            ) : (
              <button
                onClick={handleNextQuestion}
                disabled={!isAnswerSelected}
                className="transform rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 font-medium text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:from-blue-700 hover:to-indigo-700 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
              >
                Nächste Frage
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
