'use client'

import { useState, useEffect } from 'react'
import { ArrowLeft, Clock, CheckCircle, XCircle, AlertTriangle, Trophy, BookOpen } from 'lucide-react'

interface QuizProps {
  onNavigation: (view: string, data?: any) => void
}

export function Quiz({ onNavigation }: QuizProps) {
  const [selectedAnswers, setSelectedAnswers] = useState<{ [key: number]: number }>({})
  const [timeLeft, setTimeLeft] = useState(1800) // 30 minutes in seconds
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [score, setScore] = useState(0)

  const mockQuiz = {
    title: 'Abschlusstest: Einführung in die Programmierung',
    description: 'Teste dein Wissen aus dem Kapitel "Einführung in die Programmierung"',
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
          'Ein Fehler im Code'
        ],
        correctAnswer: 0
      },
      {
        id: 2,
        question: 'Welcher Datentyp wird für Text verwendet?',
        options: [
          'Number',
          'String',
          'Boolean',
          'Array'
        ],
        correctAnswer: 1
      },
      {
        id: 3,
        question: 'Was bedeutet "Hello World" in der Programmierung?',
        options: [
          'Ein Fehler im Code',
          'Das erste Programm, das man schreibt',
          'Eine Programmiersprache',
          'Ein Computer'
        ],
        correctAnswer: 1
      }
    ]
  }

  // Timer effect
  useEffect(() => {
    if (timeLeft > 0 && !isSubmitted) {
      const timer = setInterval(() => {
        setTimeLeft(prev => prev - 1)
      }, 1000)
      return () => clearInterval(timer)
    } else if (timeLeft === 0 && !isSubmitted) {
      handleSubmit()
    }
  }, [timeLeft, isSubmitted])

  const handleGoBack = () => {
    onNavigation('chapterDetail')
  }

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  const handleAnswerSelect = (questionId: number, answerIndex: number) => {
    setSelectedAnswers(prev => ({
      ...prev,
      [questionId]: answerIndex
    }))
  }

  const handleSubmit = () => {
    // Calculate score
    let correctAnswers = 0
    mockQuiz.questions.forEach(question => {
      if (selectedAnswers[question.id] === question.correctAnswer) {
        correctAnswers++
      }
    })
    
    const calculatedScore = Math.round((correctAnswers / mockQuiz.questions.length) * 100)
    setScore(calculatedScore)
    setIsSubmitted(true)
  }

  const handleNextQuestion = () => {
    if (currentQuestion < mockQuiz.questions.length - 1) {
      setCurrentQuestion(prev => prev + 1)
    }
  }

  const handlePrevQuestion = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(prev => prev - 1)
    }
  }

  const getProgressPercentage = () => {
    return ((currentQuestion + 1) / mockQuiz.questions.length) * 100
  }

  if (isSubmitted) {
    const passed = score >= mockQuiz.passingScore
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30 text-center">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${
            passed ? 'bg-gradient-to-br from-green-500 to-emerald-500' : 'bg-gradient-to-br from-red-500 to-pink-500'
          }`}>
            {passed ? <Trophy className="w-10 h-10 text-white" /> : <XCircle className="w-10 h-10 text-white" />}
          </div>
          
          <h2 className="text-2xl font-bold text-foreground mb-2">
            {passed ? 'Quiz erfolgreich abgeschlossen! 🎉' : 'Quiz nicht bestanden'}
          </h2>
          
          <div className="text-6xl font-bold mb-4">
            <span className={passed ? 'text-green-500' : 'text-red-500'}>{score}%</span>
          </div>
          
          <p className="text-muted mb-6">
            {passed 
              ? `Glückwunsch! Du hast ${score}% der Fragen richtig beantwortet.`
              : `Du hast ${score}% der Fragen richtig beantwortet. Die Bestehensgrenze liegt bei ${mockQuiz.passingScore}%.`
            }
          </p>
          
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => onNavigation('dashboard')}
              className="px-6 py-3 font-medium text-white bg-gradient-to-r from-accent to-primary rounded-2xl hover:from-accent/90 hover:to-primary/90 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            >
              Zum Dashboard
            </button>
            {!passed && (
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-3 font-medium text-muted bg-muted/30 rounded-2xl hover:bg-muted/50 transition-all duration-200"
              >
                Erneut versuchen
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const currentQ = mockQuiz.questions[currentQuestion]
  const isAnswerSelected = selectedAnswers[currentQ.id] !== undefined

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30">
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={handleGoBack}
            className="p-2 text-muted hover:text-foreground hover:bg-accent/20 rounded-xl transition-all duration-200"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-foreground">{mockQuiz.title}</h1>
            <p className="text-muted mt-1">{mockQuiz.description}</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-muted/30 rounded-full h-3 mb-4">
          <div 
            className="bg-gradient-to-r from-accent to-primary h-3 rounded-full transition-all duration-500" 
            style={{ width: `${getProgressPercentage()}%` }}
          />
        </div>
        
        <div className="flex items-center justify-between text-sm text-muted">
          <span>Frage {currentQuestion + 1} von {mockQuiz.totalQuestions}</span>
          <span>{Math.round(getProgressPercentage())}% abgeschlossen</span>
        </div>
      </div>

      {/* Timer */}
      <div className="glass-effect rounded-3xl p-6 border border-accent/30">
        <div className="flex items-center justify-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-pink-500 rounded-2xl flex items-center justify-center">
            <Clock className="w-6 h-6 text-white" />
          </div>
          <div className="text-center">
            <p className="text-sm text-red-600 font-medium">Verbleibende Zeit</p>
            <p className="text-2xl font-bold text-red-700">{formatTime(timeLeft)}</p>
          </div>
        </div>
      </div>

      {/* Current Question */}
      <div className="bg-white rounded-3xl p-8 shadow-lg border border-slate-200">
        <div className="mb-6">
          <h3 className="text-xl font-bold text-slate-800 mb-2">
            Frage {currentQuestion + 1}
          </h3>
          <p className="text-lg text-slate-700">{currentQ.question}</p>
        </div>
        
        <div className="space-y-4">
          {currentQ.options.map((option, oIndex) => (
            <label
              key={oIndex}
              className={`flex items-center p-4 rounded-2xl cursor-pointer transition-all duration-200 border-2 ${
                selectedAnswers[currentQ.id] === oIndex
                  ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-300 shadow-md'
                  : 'bg-slate-50 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
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
              <div className={`w-5 h-5 rounded-full border-2 mr-4 flex items-center justify-center ${
                selectedAnswers[currentQ.id] === oIndex
                  ? 'border-blue-500 bg-blue-500'
                  : 'border-slate-400'
              }`}>
                {selectedAnswers[currentQ.id] === oIndex && (
                  <div className="w-2 h-2 bg-white rounded-full"></div>
                )}
              </div>
              <span className="text-slate-800 font-medium">{option}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Navigation */}
      <div className="bg-white rounded-3xl p-6 shadow-lg border border-slate-200">
        <div className="flex justify-between items-center">
          <button
            onClick={handlePrevQuestion}
            disabled={currentQuestion === 0}
            className="px-6 py-3 font-medium text-slate-600 bg-slate-100 rounded-2xl hover:bg-slate-200 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Vorherige
          </button>
          
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">
              {Object.keys(selectedAnswers).length} von {mockQuiz.totalQuestions} beantwortet
            </span>
            
            {currentQuestion === mockQuiz.questions.length - 1 ? (
              <button
                onClick={handleSubmit}
                disabled={Object.keys(selectedAnswers).length < mockQuiz.questions.length}
                className="px-8 py-3 font-semibold text-white bg-gradient-to-r from-green-600 to-emerald-600 rounded-2xl hover:from-green-700 hover:to-emerald-700 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckCircle className="w-5 h-5" />
                Quiz abschließen
              </button>
            ) : (
              <button
                onClick={handleNextQuestion}
                disabled={!isAnswerSelected}
                className="px-6 py-3 font-medium text-white bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Nächste Frage
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
