'use client';

import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useEffect, useState } from 'react';

type BuilderQ = {
  questionText: string;
  questionType: 'MCQ' | 'TEXT';
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
  expectedAnswer?: string;
};

export default function NewEnablerQuizPage() {
  const params = useParams<{ enablerId: string }>();
  const enablerId = params?.enablerId as string;
  const { profile, isPlatformOwner, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  const [difficulty, setDifficulty] = useState<'LOW'|'MEDIUM'|'HIGH'>('LOW');
  const [title, setTitle] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [questions, setQuestions] = useState<BuilderQ[]>([
    { questionText: '', questionType: 'MCQ', options: ['', '', '', ''], correctIndex: 0, explanation: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!authLoading && !isPlatformOwner) {
      router.replace('/trainer/content-management');
    }
  }, [authLoading, isPlatformOwner, router]);

  if (!isPlatformOwner) return null;

  return (
    <div className="mx-auto mt-6 max-w-7xl bg-background border border-accent/20 rounded-2xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-bold">{t('enablerQuiz.newTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('enablerQuiz.description')}</p>
      </div>

      <div className="rounded-2xl border border-accent/20 bg-background/40 p-5 space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">{t('enablerQuiz.difficulty')}</label>
            <select value={difficulty} onChange={(e)=>setDifficulty(e.target.value as any)} className="w-full rounded-xl border border-accent/20 bg-background/60 px-3 py-2">
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium">{t('enablerQuiz.quizTitle')}</label>
            <input value={title} onChange={(e)=>setTitle(e.target.value)} className="w-full rounded-xl border border-accent/20 bg-background/60 px-3 py-2" placeholder={t('enablerQuiz.titlePlaceholder')} />
          </div>
        </div>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={isActive} onChange={(e)=>setIsActive(e.target.checked)} />
          <span>{t('enablerQuiz.active')}</span>
        </label>

        <div className="mt-2">
          <div className="mb-2 text-sm font-semibold">{t('enablerQuiz.questions')}</div>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            {questions.map((q, qi) => (
              <div key={qi} className="rounded-lg border border-accent/20 bg-background/40 p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{t('enablerQuiz.questionNumber').replace('{number}', String(qi + 1))}</div>
                  <button type="button" className="text-xs rounded-md border border-accent/30 px-2 py-1" onClick={() => setQuestions(prev => prev.filter((_, i) => i !== qi))}>{t('enablerQuiz.remove')}</button>
                </div>
                <input className="mt-2 w-full rounded-xl border border-accent/20 bg-background/60 px-3 py-2" placeholder={t('enablerQuiz.questionText')} value={q.questionText} onChange={e => setQuestions(prev => prev.map((x,i)=> i===qi?{...x, questionText: e.target.value}:x))} />
                <div className="mt-2 flex flex-wrap gap-4 text-xs">
                  <label className="inline-flex items-center gap-1">
                    <input type="radio" name={`type-${qi}`} checked={q.questionType === 'MCQ'} onChange={() => setQuestions(prev => prev.map((x,i)=> i===qi?{...x, questionType: 'MCQ', options: x.options, expectedAnswer: undefined }: x))} /> {t('enablerQuiz.multipleChoice')}
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input type="radio" name={`type-${qi}`} checked={q.questionType === 'TEXT'} onChange={() => setQuestions(prev => prev.map((x,i)=> i===qi?{...x, questionType: 'TEXT', options: ['', '', '', ''], correctIndex: 0 }: x))} /> {t('enablerQuiz.textAnswer')}
                  </label>
                </div>
                {q.questionType === 'TEXT' ? (
                  <div className="mt-3 space-y-2">
                    <label className="text-xs font-medium">{t('enablerQuiz.expectedAnswer')}</label>
                    <textarea
                      className="w-full rounded-xl border border-accent/20 bg-background/60 px-3 py-2"
                      rows={2}
                      placeholder={t('enablerQuiz.expectedAnswerPlaceholder')}
                      value={q.expectedAnswer || ''}
                      onChange={(e)=> setQuestions(prev => prev.map((x,i)=> i===qi?{...x, expectedAnswer: e.target.value}:x))}
                    />
                  </div>
                ) : (
                  <>
                    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                      {q.options.map((opt, oi) => (
                        <label key={oi} className="flex items-center gap-2">
                          <input type="radio" name={`correct-${qi}`} checked={q.correctIndex === oi} onChange={() => setQuestions(prev => prev.map((x,i)=> i===qi?{...x, correctIndex: oi}:x))} />
                          <input className="flex-1 rounded-xl border border-accent/20 bg-background/60 px-3 py-2" placeholder={t('enablerQuiz.optionPlaceholder').replace('{number}', String(oi+1))} value={opt} onChange={e => setQuestions(prev => prev.map((x,i)=> i===qi?{...x, options: x.options.map((o,j)=> j===oi? e.target.value: o) as [string,string,string,string]}:x))} />
                        </label>
                      ))}
                    </div>
                    <div className="mt-3">
                      <label className="mb-1 block text-sm font-medium">{t('enablerQuiz.explanation')}</label>
                      <textarea className="w-full rounded-xl border border-accent/20 bg-background/60 px-3 py-2" rows={2} value={q.explanation} onChange={(e)=> setQuestions(prev => prev.map((x,i)=> i===qi?{...x, explanation: e.target.value}:x))} />
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" className="inline-flex items-center gap-2 rounded-xl border border-accent/30 px-3 py-2 text-sm" onClick={() => setQuestions(prev => [...prev, { questionText: '', questionType: 'MCQ', options: ['', '', '', ''], correctIndex: 0, explanation: '' }])}>{t('enablerQuiz.addMcq')}</button>
            <button type="button" className="inline-flex items-center gap-2 rounded-xl border border-accent/30 px-3 py-2 text-sm" onClick={() => setQuestions(prev => [...prev, { questionText: '', questionType: 'TEXT', options: ['', '', '', ''], correctIndex: 0, explanation: '', expectedAnswer: '' }])}>{t('enablerQuiz.addText')}</button>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button className="rounded-md border border-accent/30 px-4 py-2" type="button" onClick={() => router.back()}>{t('enablerQuiz.cancel')}</button>
          <button className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 disabled:opacity-60" disabled={submitting} onClick={async () => {
            if (!profile?.id) { toast.error(t('enablerQuiz.noTrainerProfile')); return; }
            if (!title.trim()) { toast.error(t('enablerQuiz.titleRequired')); return; }
            const cleaned = questions
              .map(q => q.questionType === 'TEXT'
                ? ({ questionText: q.questionText.trim(), questionType: 'TEXT', expectedAnswer: (q.expectedAnswer || '').trim() })
                : ({ questionText: q.questionText.trim(), questionType: 'MCQ', options: q.options.map(o => o.trim()) as [string,string,string,string], correctIndex: Number(q.correctIndex), explanation: (q.explanation || '').trim() })
              )
              .filter(q => q.questionText && (q as any).questionType === 'TEXT' ? true : (q as any).options.every((o: string) => o));
            setSubmitting(true);
            try {
              const r = await fetch(`/api/trainer/enablers/${enablerId}/quizzes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: title.trim(), createdById: profile.id, difficulty, isActive, questions: cleaned }),
              });
              if (!r.ok) throw new Error(t('enablerQuiz.saveFailed'));
              router.back();
            } catch (e: any) {
              toast.error(e?.message || t('error.unknown'));
            } finally {
              setSubmitting(false);
            }
          }}>{t('enablerQuiz.save')}</button>
        </div>
      </div>
    </div>
  );
}
