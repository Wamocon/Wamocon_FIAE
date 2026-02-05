'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';

type ModuleItem = { id: string; title: string; training_year: number; lessons: Array<{ id: string; title: string }> };

export default function NewQuizPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [title, setTitle] = useState('');
  const [quizType, setQuizType] = useState<'mini' | 'big'>('mini');
  const [trainingYear, setTrainingYear] = useState<'1' | '2' | '3'>('1');
  const [timeLimit, setTimeLimit] = useState<string>('30');
  const [moduleId, setModuleId] = useState<string>('');
  const [lessonId, setLessonId] = useState<string>('');

  const [modules, setModules] = useState<ModuleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/trainer/content?limit=999', { cache: 'no-store' });
        if (!res.ok) throw new Error(t('quiz.form.loadModulesError'));
        const data = await res.json();
        const ms: ModuleItem[] = (data.modules || []).map((m: any) => ({
          id: m.id,
          title: m.title,
          training_year: m.training_year,
          lessons: (m.lessons || []).map((l: any) => ({ id: l.id, title: l.title })),
        }));
        setModules(ms);
      } catch (e: any) {
        setError(e?.message || t('error.unknown'));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filteredModules = useMemo(
    () => modules.filter(m => String(m.training_year) === trainingYear),
    [modules, trainingYear]
  );
  const lessonsForSelectedModule = useMemo(
    () => filteredModules.find(m => m.id === moduleId)?.lessons || [],
    [filteredModules, moduleId]
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError(t('quiz.form.titleRequired'));
    try {
      setSaving(true);
      const payload: any = {
        title: title.trim(),
        quiz_type: quizType,
        training_year: Number(trainingYear),
        time_limit_minutes: timeLimit ? Number(timeLimit) : undefined,
        module_id: moduleId || undefined,
        lesson_id: lessonId || undefined,
      };
      const res = await fetch('/api/trainer/quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(t('quiz.form.createFailed'));
      router.replace('/trainer/quiz-management');
    } catch (e: any) {
      setError(e?.message || t('error.unknown'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6">{t('common.loading')}</div>;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold">{t('quiz.newQuiz')}</h1>
      <form onSubmit={handleSave} className="space-y-6">
        {error && <div className="text-red-500">{error}</div>}

        <div>
          <label className="mb-1 block text-sm font-medium">{t('quiz.form.title')}</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2"
            placeholder={t('quiz.form.titlePlaceholder')}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">{t('quiz.form.quizType')}</label>
            <select
              value={quizType}
              onChange={e => setQuizType(e.target.value as any)}
              className="w-full rounded-md border border-border bg-background px-3 py-2"
            >
              <option value="mini">{t('quiz.form.typeMini')}</option>
              <option value="big">{t('quiz.form.typeBig')}</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">{t('quiz.form.trainingYear')}</label>
            <select
              value={trainingYear}
              onChange={e => setTrainingYear(e.target.value as any)}
              className="w-full rounded-md border border-border bg-background px-3 py-2"
            >
              <option value="1">{t('quiz.form.yearOption').replace('{year}', '1')}</option>
              <option value="2">{t('quiz.form.yearOption').replace('{year}', '2')}</option>
              <option value="3">{t('quiz.form.yearOption').replace('{year}', '3')}</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">{t('quiz.form.timeLimit')}</label>
            <input
              type="number"
              min={1}
              value={timeLimit}
              onChange={e => setTimeLimit(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">{t('quiz.form.moduleOptional')}</label>
            <select
              value={moduleId}
              onChange={e => { setModuleId(e.target.value); setLessonId(''); }}
              className="w-full rounded-md border border-border bg-background px-3 py-2"
            >
              <option value="">{t('quiz.form.noModule')}</option>
              {filteredModules.map(m => (
                <option key={m.id} value={m.id}>{m.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t('quiz.form.lessonOptional')}</label>
            <select
              value={lessonId}
              onChange={e => setLessonId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2"
              disabled={!moduleId}
            >
              <option value="">{t('quiz.form.noLesson')}</option>
              {lessonsForSelectedModule.map(l => (
                <option key={l.id} value={l.id}>{l.title}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-primary px-4 py-2 text-foregroundround hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? t('quiz.form.creating') : t('quiz.form.create')}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-md border border-border px-4 py-2 hover:bg-background/60"
          >
            {t('quiz.form.cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
