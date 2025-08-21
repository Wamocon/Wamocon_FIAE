'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Clock, CheckCircle, XCircle, Award, Target } from 'lucide-react'
import { mockQuiz } from '@/lib/supabase'

interface QuizProps {
  quizId: string
}

export default function Quiz({ quizId }: QuizProps) {
  const router = useRouter()
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({})
  const [timeLeft, setTimeLeft] = useState(300) // 5 minutes
  const [isCompleted, setIsCompleted] = useState(false)
  const [passed, setPassed] = useState(false)
  const [score, setScore] = useState(0)

  // Memoize quiz data to prevent unnecessary recalculations
  const quizData = useMemo(() => mockQuiz, [])

  // Reset quiz state function instead of page reload
  const resetQuiz = useCallback(() => {
    setCurrentQuestion(0)
    setSelectedAnswers({})
    setTimeLeft(300)
    setIsCompleted(false)
    setPassed(false)
    setScore(0)
  }, [])

  const handleGoBack = useCallback(() => {
    router.push('/trainee/modules')
  }, [router])

  const handleAnswerSelect = useCallback((questionId: string, optionIndex: number) => {
    setSelectedAnswers(prev => ({
      ...prev,
      [questionId]: optionIndex
    }))
  }, [])

  const handleNextQuestion = useCallback(() => {
    if (currentQuestion < quizData.totalQuestions - 1) {
      setCurrentQuestion(prev => prev + 1)
    } else {
      handleQuizCompletion()
    }
  }, [currentQuestion, quizData.totalQuestions])

  const handleQuizCompletion = useCallback(() => {
    setIsCompleted(true)
    
    // Calculate score
    let correctAnswers = 0
    quizData.questions.forEach(question => {
      const selectedAnswer = selectedAnswers[question.id]
      if (selectedAnswer !== undefined && selectedAnswer === question.correctAnswer) {
        correctAnswers++
      }
    })
    
    const finalScore = Math.round((correctAnswers / quizData.totalQuestions) * 100)
    setScore(finalScore)
    setPassed(finalScore >= 70)
  }, [selectedAnswers, quizData])

  const getProgressPercentage = useCallback(() => {
    return ((currentQuestion + 1) / quizData.totalQuestions) * 100
  }, [currentQuestion, quizData.totalQuestions])

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }, [])

  // Timer effect
  useEffect(() => {
    if (isCompleted || timeLeft <= 0) return

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          handleQuizCompletion()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [isCompleted, timeLeft, handleQuizCompletion])

  // Auto-submit when time runs out
  useEffect(() => {
    if (timeLeft <= 0 && !isCompleted) {
      handleQuizCompletion()
    }
  }, [timeLeft, isCompleted, handleQuizCompletion])

  if (isCompleted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-red-900/20 to-red-800/30 flex items-center justify-center p-6">
        <div className="glass-effect-enhanced max-w-2xl w-full p-8 rounded-3xl shadow-2xl border-2 border-accent/40 text-center">
          <div className="mb-8">
            {passed ? (
              <div className="w-24 h-24 bg-gradient-to-br from-green-500 to-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl">
                <Award className="w-12 h-12 text-white" />
              </div>
            ) : (
              <div className="w-24 h-24 bg-gradient-to-br from-red-500 to-pink-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl">
                <Target className="w-12 h-12 text-white" />
              </div>
            )}
            
            <h1 className="text-4xl font-bold text-foreground mb-4">
              {passed ? 'Quiz bestanden! 🎉' : 'Quiz nicht bestanden 😔'}
            </h1>
            
            <p className="text-xl text-muted-foreground mb-6">
              Dein Ergebnis: <span className="font-bold text-accent">{score}%</span>
            </p>
            
            <div className="bg-muted/30 rounded-2xl p-6 mb-8">
              <h3 className="text-lg font-semibold text-foreground mb-4">Zusammenfassung</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="text-center p-3 bg-background/50 rounded-xl">
                  <p className="text-muted">Richtige Antworten</p>
                  <p className="text-2xl font-bold text-green-600">
                    {Math.round((score / 100) * quizData.totalQuestions)}
                  </p>
                </div>
                <div className="text-center p-3 bg-background/50 rounded-xl">
                  <p className="text-muted">Fragen insgesamt</p>
                  <p className="text-2xl font-bold text-accent">{quizData.totalQuestions}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => router.push('/trainee/dashboard')}
              className="px-6 py-3 font-medium text-white bg-gradient-to-r from-accent to-primary rounded-2xl hover:from-accent/90 hover:to-primary/90 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            >
              Zum Dashboard
            </button>
            {!passed && (
              <button
                onClick={resetQuiz}
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

  const currentQ = quizData.questions[currentQuestion]
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
            <h1 className="text-3xl font-bold text-foreground">{quizData.title}</h1>
            <p className="text-muted mt-1">{quizData.description}</p>
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
          <span>Frage {currentQuestion + 1} von {quizData.totalQuestions}</span>
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
                  <CheckCircle className="w-3 h-3 text-white" />
                )}
              </div>
              <span className="text-slate-700">{option}</span>
            </label>
          ))}
        </div>

        {/* Navigation Buttons */}
        <div className="flex justify-between mt-8">
          <button
            onClick={handleGoBack}
            className="px-6 py-3 font-medium text-muted bg-muted/30 rounded-2xl hover:bg-muted/50 transition-all duration-200"
          >
            Zurück
          </button>
          
          <button
            onClick={handleNextQuestion}
            disabled={!isAnswerSelected}
            className="px-6 py-3 font-medium text-white bg-gradient-to-r from-accent to-primary rounded-2xl hover:from-accent/90 hover:to-primary/90 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {currentQuestion === quizData.totalQuestions - 1 ? 'Abschließen' : 'Nächste Frage'}
          </button>
        </div>
      </div>
    </div>
  )
}
