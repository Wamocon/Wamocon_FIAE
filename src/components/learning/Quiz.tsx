'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Award,
  CheckCircle,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { authFetch } from '@/lib/authFetch';

// The global quiz of a trainee. The component gets the texts of the questions
// from GET /api/trainee/quizzes/[quizId] and holds no key: which option is
// right, and why, comes back with the answer of
// POST /api/trainee/quizzes/[quizId]/submit, after the trainee has handed in
// every answer. Score and right or wrong are the ones of the route.

export type QuizOptionView = { id: string; optionText: string };
export type QuizQuestionView = {
  id: string;
  questionText: string;
  questionType?: 'MCQ' | 'TEXT';
  options: QuizOptionView[];
};
export type QuizView = {
  id: string;
  title: string;
  questions: QuizQuestionView[];
};

type QuestionFeedback = {
  questionId: string;
  correct: boolean;
  correctOptionId?: string | null;
  selectedOptionId?: string | null;
  selectedText?: string | null;
  correctAnswerText?: string | null;
  explanation?: string | null;
};
type QuizResult = {
  score: number;
  locked: boolean;
  feedback: QuestionFeedback[];
};

interface QuizProps {
  quiz: QuizView;
}

const isTextQuestion = (q: QuizQuestionView) =>
  q.questionType === 'TEXT' || q.options.length === 0;

export default function Quiz({ quiz }: QuizProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const [current, setCurrent] = useState(0);
  // option id for a choice question, the typed text for a text question
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(1);

  const isAnswered = useCallback(
    (q: QuizQuestionView) => (answers[q.id] ?? '').trim() !== '',
    [answers]
  );

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await authFetch(`/api/trainee/quizzes/${quiz.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: quiz.questions.map(q =>
            isTextQuestion(q)
              ? { questionId: q.id, textAnswer: answers[q.id] ?? '' }
              : { questionId: q.id, selectedOptionId: answers[q.id] ?? '' }
          ),
        }),
      });
      if (!res.ok) throw new Error('submit failed');
      const data = await res.json();
      setResult({
        score: Number(data?.score ?? 0),
        locked: data?.locked === true,
        feedback: Array.isArray(data?.feedback) ? data.feedback : [],
      });
    } catch {
      setError(t('traineeQuiz.submitError'));
    } finally {
      setSubmitting(false);
    }
  };

  const tryAgain = () => {
    setAnswers({});
    setCurrent(0);
    setResult(null);
    setError(null);
    setAttempt(a => a + 1);
  };

  if (quiz.questions.length === 0) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <h1 className="text-foreground text-3xl font-bold">{quiz.title}</h1>
        <p className="text-muted mt-4">{t('traineeQuiz.noQuestions')}</p>
      </div>
    );
  }

  if (result) {
    const total = quiz.questions.length;
    const correctCount = result.feedback.filter(f => f.correct).length;
    const perfect = result.score >= 100;
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div className="glass-effect border-accent/30 rounded-3xl border p-8 text-center shadow-lg">
          <div
            className={`mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full shadow-xl ${
              perfect
                ? 'bg-gradient-to-br from-green-500 to-emerald-500'
                : 'bg-gradient-to-br from-amber-500 to-orange-500'
            }`}
          >
            {perfect ? (
              <Award className="h-10 w-10 text-white" />
            ) : (
              <AlertTriangle className="h-10 w-10 text-white" />
            )}
          </div>
          <h1 className="text-foreground mb-2 text-3xl font-bold">
            {perfect ? t('quiz.perfectScore') : t('quiz.notPerfectYet')}
          </h1>
          <p className="text-foreground text-4xl font-bold">{result.score}%</p>
          <p className="text-muted mt-2">
            {t('traineeQuiz.resultSummary', {
              correct: correctCount,
              total,
            })}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 text-sm">
            <span className="text-muted">{t('quiz.attempts')}</span>
            <span className="text-foreground font-semibold">{attempt}</span>
          </div>
        </div>

        <div className="space-y-3">
          {quiz.questions.map(q => {
            const f = result.feedback.find(
              x => String(x.questionId) === String(q.id)
            );
            const textQuestion = isTextQuestion(q);
            const optionText = (id?: string | null) =>
              q.options.find(o => String(o.id) === String(id))?.optionText;
            const given = textQuestion
              ? (f?.selectedText ?? answers[q.id])
              : optionText(f?.selectedOptionId ?? answers[q.id]);
            const right = textQuestion
              ? f?.correctAnswerText
              : optionText(f?.correctOptionId);
            return (
              <div
                key={q.id}
                data-testid="quiz-result-item"
                className={`rounded-2xl border p-4 ${
                  f?.correct
                    ? 'border-green-500/40 bg-green-500/5'
                    : 'border-red-500/40 bg-red-500/5'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-foreground font-medium">
                    {q.questionText}
                  </p>
                  {f && (
                    <span
                      className={`flex shrink-0 items-center gap-1 text-sm font-semibold ${
                        f.correct ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {f.correct ? (
                        <CheckCircle className="h-4 w-4" />
                      ) : (
                        <XCircle className="h-4 w-4" />
                      )}
                      <span>
                        {f.correct
                          ? t('traineeQuiz.correct')
                          : t('traineeQuiz.incorrect')}
                      </span>
                    </span>
                  )}
                </div>
                <p className="text-muted mt-2 text-sm">
                  {t('traineeQuiz.yourAnswer')}: {given || t('quiz.noAnswer')}
                </p>
                {f && !f.correct && right && (
                  <p className="mt-1 text-sm text-green-700 dark:text-green-400">
                    {t('traineeQuiz.correctAnswer')}: {right}
                  </p>
                )}
                {f?.explanation && (
                  <p className="text-muted mt-1 text-sm">
                    {t('traineeQuiz.explanation')}: {f.explanation}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-col justify-center gap-4 sm:flex-row">
          {!result.locked && (
            <button
              onClick={tryAgain}
              className="flex items-center justify-center gap-2 rounded-2xl bg-red-600 px-6 py-3 font-semibold text-white shadow-lg transition duration-200 hover:bg-red-700"
            >
              <RefreshCw className="h-5 w-5" />
              {t('traineeQuiz.tryAgain')}
            </button>
          )}
          <button
            onClick={() => router.push('/trainee/dashboard')}
            className="border-accent/30 text-foreground hover:bg-accent/10 rounded-2xl border px-6 py-3 font-medium transition-all duration-200"
          >
            {t('quiz.toDashboard')}
          </button>
        </div>
      </div>
    );
  }

  const question = quiz.questions[current];
  const isLast = current === quiz.questions.length - 1;
  const progress = ((current + 1) / quiz.questions.length) * 100;

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <h1 className="text-foreground text-3xl font-bold">{quiz.title}</h1>
        <div className="bg-muted/30 my-4 h-3 w-full rounded-full">
          <div
            className="from-accent to-primary h-3 rounded-full bg-gradient-to-r transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="text-muted flex items-center justify-between text-sm">
          <span>
            {t('quiz.questionOf', {
              current: current + 1,
              total: quiz.questions.length,
            })}
          </span>
          {attempt > 1 && (
            <span>{t('quiz.attemptNumber', { number: attempt })}</span>
          )}
        </div>
      </div>

      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-6">
          <h3 className="text-foreground mb-2 text-xl font-bold">
            {t('quiz.questionNumber', { number: current + 1 })}
          </h3>
          <p className="text-foreground text-lg">{question.questionText}</p>
        </div>

        {isTextQuestion(question) ? (
          <textarea
            value={answers[question.id] ?? ''}
            onChange={e =>
              setAnswers(prev => ({ ...prev, [question.id]: e.target.value }))
            }
            placeholder={t('traineeQuiz.textPlaceholder')}
            rows={4}
            className="border-accent/30 bg-card text-foreground w-full rounded-2xl border-2 p-4"
          />
        ) : (
          <div className="space-y-4">
            {question.options.map(option => {
              const selected = answers[question.id] === option.id;
              return (
                <label
                  key={option.id}
                  className={`glass-effect flex cursor-pointer items-center rounded-2xl border-2 p-4 transition-all duration-200 ${
                    selected
                      ? 'border-red-300 bg-gradient-to-r from-red-50 to-indigo-50 shadow-md dark:border-red-500/50 dark:from-red-950/40 dark:to-indigo-950/40'
                      : 'bg-card hover:bg-accent/5 dark:border-border dark:hover:bg-accent/10 border-red-200/50 hover:border-red-200'
                  }`}
                >
                  <input
                    type="radio"
                    name={`question-${question.id}`}
                    value={option.id}
                    checked={selected}
                    onChange={() =>
                      setAnswers(prev => ({
                        ...prev,
                        [question.id]: option.id,
                      }))
                    }
                    className="sr-only"
                  />
                  <div
                    className={`mr-4 flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                      selected
                        ? 'border-red-500 bg-red-500'
                        : 'border-muted-foreground/30'
                    }`}
                  >
                    {selected && (
                      <CheckCircle className="text-foreground h-3 w-3" />
                    )}
                  </div>
                  <span className="text-foreground">{option.optionText}</span>
                </label>
              );
            })}
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-8 flex justify-between">
          <button
            onClick={() => setCurrent(c => Math.max(0, c - 1))}
            disabled={current === 0 || submitting}
            className="text-foreground rounded-2xl px-6 py-3 font-medium transition-all duration-200 disabled:opacity-50"
          >
            {t('quiz.previousQuestion')}
          </button>

          <button
            onClick={isLast ? submit : () => setCurrent(c => c + 1)}
            disabled={!isAnswered(question) || submitting}
            className="flex min-w-[160px] items-center justify-center rounded-2xl bg-red-600 px-6 py-3 font-semibold text-white shadow-lg transition duration-200 hover:bg-red-700 focus:ring-4 focus:ring-red-300 focus:outline-none active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? t('traineeQuiz.submitting')
              : isLast
                ? t('quiz.complete')
                : t('quiz.nextQuestion')}
          </button>
        </div>
      </div>
    </div>
  );
}
