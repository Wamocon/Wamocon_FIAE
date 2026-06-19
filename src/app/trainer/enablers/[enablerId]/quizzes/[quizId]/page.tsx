'use client';

import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { PageLoader } from '@/components/ui/PageLoader';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
const MarkdownText = dynamic(
  () =>
    import('@/components/ui/MarkdownText').then(mod => ({
      default: mod.MarkdownText,
    })),
  { ssr: false }
);

type Opt = {
  id: string;
  optionText: string;
  isCorrect: boolean;
  explanation?: string | null;
};
type Q = {
  id: string;
  questionText: string;
  orderIndex: number | null;
  questionType?: 'MCQ' | 'TEXT';
  expectedAnswer?: string | null;
  options: Opt[];
};

export default function EditEnablerQuizPage() {
  const params = useParams<{ enablerId: string; quizId: string }>();
  const enablerId = params?.enablerId as string;
  const quizId = params?.quizId as string;
  const { profile, isPlatformOwner } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [difficulty, setDifficulty] = useState<'LOW' | 'MEDIUM' | 'HIGH'>(
    'LOW'
  );
  const [isActive, setIsActive] = useState(true);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const newBlankQuestion = (type: 'MCQ' | 'TEXT' = 'MCQ'): Q => ({
    id: '',
    questionText: '',
    orderIndex: null,
    questionType: type,
    expectedAnswer: type === 'TEXT' ? '' : null,
    options:
      type === 'MCQ'
        ? [0, 1, 2, 3].map(i => ({
            id: '',
            optionText: '',
            isCorrect: i === 0,
            explanation: '',
          }))
        : [],
  });

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const r = await fetch(
          `/api/trainer/enablers/${enablerId}/quizzes/${quizId}`,
          { cache: 'no-store' }
        );
        if (!r.ok) throw new Error(t('common.notFound'));
        const data = await r.json();
        const qz = data.quiz;
        setTitle(qz.title);
        setIsActive(!!qz.isActive);
        setDifficulty(qz.difficulty);
        setQuestions(
          (qz.questions || []).map((q: any) => ({
            id: q.id,
            questionText: q.questionText,
            orderIndex: q.orderIndex ?? null,
            questionType: q.questionType || 'MCQ',
            expectedAnswer: q.expectedAnswer ?? null,
            options: q.options || [],
          }))
        );
      } catch (e: any) {
        setError(e?.message || t('common.unknownError'));
      } finally {
        setLoading(false);
      }
    };
    if (enablerId && quizId) load();
  }, [enablerId, quizId]);

  if (loading) return <PageLoader />;
  if (error) return <div className="p-6 text-red-500">{error}</div>;

  return (
    <div className="bg-background border-accent/20 mx-auto mt-6 max-w-7xl space-y-6 rounded-2xl border p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t('trainer.enablerQuiz.title')}</h1>
        <div className="flex items-center gap-2">
          {editing && isPlatformOwner && (
            <button
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600"
              onClick={async () => {
                if (!confirm(t('trainer.enablerQuiz.deleteConfirm'))) return;
                try {
                  const r = await fetch(
                    `/api/trainer/enablers/${enablerId}/quizzes/${quizId}`,
                    { method: 'DELETE' }
                  );
                  if (!r.ok)
                    throw new Error(t('trainer.enablerQuiz.deleteFailed'));
                  router.back();
                } catch (e: any) {
                  toast.error(e?.message || t('common.unknownError'));
                }
              }}
            >
              {t('common.delete')}
            </button>
          )}
          {isPlatformOwner && (
            <button
              className="border-accent/30 rounded-md border px-3 py-1.5 text-sm"
              onClick={() => setEditing(!editing)}
            >
              {editing
                ? t('trainer.enablerQuiz.viewMode')
                : t('trainer.enablerQuiz.editMode')}
            </button>
          )}
          <button
            className="border-accent/30 rounded-md border px-3 py-1.5 text-sm"
            onClick={() => router.back()}
          >
            {t('common.back')}
          </button>
        </div>
      </div>

      <div className="border-accent/20 bg-background/40 space-y-4 rounded-2xl border p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t('trainer.enablerQuiz.difficulty')}
            </label>
            {editing ? (
              <select
                value={difficulty}
                onChange={e => setDifficulty(e.target.value as any)}
                className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </select>
            ) : (
              <div className="text-sm">{difficulty}</div>
            )}
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium">
              {t('trainer.enablerQuiz.quizTitle')}
            </label>
            {editing ? (
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
              />
            ) : (
              <div className="text-sm">{title}</div>
            )}
          </div>
        </div>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={isActive}
            disabled={!editing}
            onChange={e => setIsActive(e.target.checked)}
          />
          <span>{t('common.active')}</span>
        </label>

        <div>
          <div className="mb-2 text-sm font-semibold">
            {t('trainer.enablerQuiz.questions')}
          </div>
          <div className="space-y-4">
            {questions.map((q, qi) => {
              const correctIndex = q.options.findIndex(o => o.isCorrect) ?? 0;
              const correctExplanation =
                q.options[correctIndex]?.explanation || '';
              return (
                <div
                  key={q.id || qi}
                  className="border-accent/20 bg-background/40 rounded-lg border p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="font-medium">
                      {t('trainer.enablerQuiz.questionNumber').replace(
                        '{n}',
                        String(qi + 1)
                      )}
                    </div>
                    {editing && (
                      <button
                        type="button"
                        className="border-accent/30 rounded-md border px-2 py-1 text-xs"
                        onClick={() =>
                          setQuestions(prev => prev.filter((_, i) => i !== qi))
                        }
                      >
                        {t('common.remove')}
                      </button>
                    )}
                  </div>
                  {editing ? (
                    <input
                      className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                      value={q.questionText}
                      onChange={e =>
                        setQuestions(prev =>
                          prev.map((x, i) =>
                            i === qi
                              ? { ...x, questionText: e.target.value }
                              : x
                          )
                        )
                      }
                    />
                  ) : (
                    <MarkdownText className="text-sm">
                      {q.questionText}
                    </MarkdownText>
                  )}
                  {editing && (
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="radio"
                          name={`type-${qi}`}
                          checked={(q.questionType || 'MCQ') === 'MCQ'}
                          onChange={() =>
                            setQuestions(prev =>
                              prev.map((x, i) =>
                                i === qi
                                  ? {
                                      ...x,
                                      questionType: 'MCQ',
                                      expectedAnswer: null,
                                      options:
                                        x.options && x.options.length
                                          ? x.options
                                          : [0, 1, 2, 3].map(j => ({
                                              id: '',
                                              optionText: '',
                                              isCorrect: j === 0,
                                              explanation: '',
                                            })),
                                    }
                                  : x
                              )
                            )
                          }
                        />{' '}
                        {t('trainer.enablerQuiz.multipleChoice')}
                      </label>
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="radio"
                          name={`type-${qi}`}
                          checked={q.questionType === 'TEXT'}
                          onChange={() =>
                            setQuestions(prev =>
                              prev.map((x, i) =>
                                i === qi
                                  ? {
                                      ...x,
                                      questionType: 'TEXT',
                                      expectedAnswer: x.expectedAnswer ?? '',
                                      options: [],
                                    }
                                  : x
                              )
                            )
                          }
                        />{' '}
                        {t('trainer.enablerQuiz.textAnswer')}
                      </label>
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                    {q.questionType === 'TEXT' ? (
                      <div className="col-span-2 space-y-2">
                        <div className="text-xs tracking-wide uppercase">
                          {t('trainer.enablerQuiz.textAnswer')}
                        </div>
                        {editing ? (
                          <textarea
                            rows={2}
                            className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                            placeholder={t(
                              'trainer.enablerQuiz.expectedAnswerHint'
                            )}
                            value={q.expectedAnswer || ''}
                            onChange={e =>
                              setQuestions(prev =>
                                prev.map((x, i) =>
                                  i === qi
                                    ? { ...x, expectedAnswer: e.target.value }
                                    : x
                                )
                              )
                            }
                          />
                        ) : (
                          <div className="text-muted-foreground text-sm">
                            {t('trainer.enablerQuiz.expectedAnswerLabel')}:{' '}
                            {q.expectedAnswer || '–'}
                          </div>
                        )}
                      </div>
                    ) : (
                      q.options.map((o, oi) => (
                        <div
                          key={o.id || oi}
                          className={`rounded-md border ${o.isCorrect ? 'border-green-400' : 'border-accent/20'} bg-background/30 p-2`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-xs tracking-wide uppercase">
                              {o.isCorrect
                                ? t('trainer.enablerQuiz.correctOption')
                                : t('trainer.enablerQuiz.option')}
                            </div>
                            {editing && (
                              <label className="flex items-center gap-1 text-xs">
                                <input
                                  type="radio"
                                  name={`correct-${qi}`}
                                  checked={o.isCorrect}
                                  onChange={() => {
                                    setQuestions(prev =>
                                      prev.map((x, i) => {
                                        if (i !== qi) return x;
                                        const prevCorrect = x.options.findIndex(
                                          oo => oo.isCorrect
                                        );
                                        const prevExpl =
                                          prevCorrect >= 0
                                            ? x.options[prevCorrect]
                                                .explanation || ''
                                            : '';
                                        return {
                                          ...x,
                                          options: x.options.map((oo, j) => {
                                            if (j === oi) {
                                              return {
                                                ...oo,
                                                isCorrect: true,
                                                explanation:
                                                  oo.explanation || prevExpl,
                                              };
                                            }
                                            if (j === prevCorrect) {
                                              return {
                                                ...oo,
                                                isCorrect: false,
                                              };
                                            }
                                            return { ...oo, isCorrect: false };
                                          }),
                                        };
                                      })
                                    );
                                  }}
                                />
                                <span>
                                  {t('trainer.enablerQuiz.markCorrect')}
                                </span>
                              </label>
                            )}
                          </div>
                          {editing ? (
                            <input
                              className="border-accent/20 bg-background/60 mt-1 w-full rounded-xl border px-3 py-2"
                              value={o.optionText}
                              onChange={e =>
                                setQuestions(prev =>
                                  prev.map((x, i) =>
                                    i === qi
                                      ? {
                                          ...x,
                                          options: x.options.map((oo, j) =>
                                            j === oi
                                              ? {
                                                  ...oo,
                                                  optionText: e.target.value,
                                                }
                                              : oo
                                          ),
                                        }
                                      : x
                                  )
                                )
                              }
                            />
                          ) : (
                            <MarkdownText inline className="text-sm">
                              {o.optionText}
                            </MarkdownText>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                  {q.questionType !== 'TEXT' && (
                    <div className="mt-3">
                      <label className="mb-1 block text-xs font-medium">
                        {t('trainer.enablerQuiz.explanation')}
                      </label>
                      {editing ? (
                        <textarea
                          className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                          rows={2}
                          value={correctExplanation}
                          onChange={e =>
                            setQuestions(prev =>
                              prev.map((x, i) => {
                                if (i !== qi) return x;
                                const ci = x.options.findIndex(
                                  o => o.isCorrect
                                );
                                return {
                                  ...x,
                                  options: x.options.map((oo, j) =>
                                    j === ci
                                      ? { ...oo, explanation: e.target.value }
                                      : oo
                                  ),
                                };
                              })
                            )
                          }
                        />
                      ) : (
                        <div className="text-muted-foreground text-sm whitespace-pre-wrap">
                          {correctExplanation || '-'}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {editing && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="border-accent/30 inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"
                onClick={() =>
                  setQuestions(prev => [...prev, newBlankQuestion('MCQ')])
                }
              >
                {t('trainer.enablerQuiz.addMcq')}
              </button>
              <button
                type="button"
                className="border-accent/30 inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"
                onClick={() =>
                  setQuestions(prev => [...prev, newBlankQuestion('TEXT')])
                }
              >
                {t('trainer.enablerQuiz.addText')}
              </button>
            </div>
          )}
        </div>

        {editing && (
          <div className="flex justify-end">
            <button
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 disabled:opacity-60"
              disabled={saving}
              onClick={async () => {
                if (!profile?.id) {
                  toast.error(t('trainer.enablerQuiz.noTrainerProfile'));
                  return;
                }
                setSaving(true);
                try {
                  const payload = {
                    trainerId: profile.id,
                    title,
                    isActive,
                    difficulty,
                    questions: questions.map(q =>
                      q.questionType === 'TEXT'
                        ? {
                            questionText: q.questionText,
                            questionType: 'TEXT',
                            expectedAnswer: q.expectedAnswer,
                          }
                        : {
                            questionText: q.questionText,
                            questionType: 'MCQ',
                            options: q.options.map(o => ({
                              optionText: o.optionText,
                              isCorrect: o.isCorrect,
                              explanation: (o.explanation ?? '') || null,
                            })),
                          }
                    ),
                  };
                  const r = await fetch(
                    `/api/trainer/enablers/${enablerId}/quizzes/${quizId}`,
                    {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload),
                    }
                  );
                  if (!r.ok)
                    throw new Error(t('trainer.enablerQuiz.saveFailed'));
                  setEditing(false);
                } catch (e: any) {
                  toast.error(e?.message || t('common.unknownError'));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {t('common.save')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
