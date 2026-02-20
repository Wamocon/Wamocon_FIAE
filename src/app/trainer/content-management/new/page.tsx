'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';

export default function NewCoursePage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { t } = useLanguage();

  const [title, setTitle] = useState('');
  const [year, setYear] = useState<'1' | '2' | '3' | ''>('');
  const [chapter, setChapter] = useState<string>('');
  const [examPart, setExamPart] = useState<'1' | '2' | ''>('');
  const [skills, setSkills] = useState<string>(''); // comma-separated
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // No lessons in the new schema; handled as Enablers/Use Cases at course level

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
  if (!title.trim()) return setError(t('course.form.titleRequired'));
  if (!year) return setError(t('course.form.yearRequired'));

    try {
      setSubmitting(true);
      const payload: any = {
        title: title.trim(),
        year: Number(year),
        chapter: chapter ? Number(chapter) : undefined,
        examPart: examPart ? Number(examPart) : undefined,
        createdById: profile?.id,
        skills: skills
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };

      const res = await fetch('/api/trainer/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(t('course.form.saveFailed'));

      // Go back to Content Management after creation
      router.replace('/trainer/content-management');
    } catch (e: any) {
      setError(e?.message || t('error.unknown'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Header card */}
      <div className="glass-effect rounded-3xl border border-accent/30 bg-black/30 p-6 shadow-lg">
        <h1 className="text-foreground text-2xl font-bold">{t('course.form.newCourse')}</h1>
        <p className="text-muted mt-1 text-sm">{t('course.form.description')}</p>
      </div>

      {/* Form card */}
      <form onSubmit={handleSubmit} className="glass-effect rounded-3xl border border-accent/30 bg-black/30 p-6 shadow-lg">
        {error && <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium">{t('course.form.titleLabel')}</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full rounded-xl border border-accent/30 bg-background/60 px-3 py-2"
              placeholder={t('course.form.titlePlaceholder')}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">{t('course.form.yearLabel')}</label>
            <select
              value={year}
              onChange={e => setYear(e.target.value as any)}
              className="w-full rounded-xl border border-accent/30 bg-background/60 px-3 py-2"
            >
              <option value="">{t('course.form.yearSelect')}</option>
              <option value="1">{t('course.form.yearOption').replace('{year}', '1')}</option>
              <option value="2">{t('course.form.yearOption').replace('{year}', '2')}</option>
              <option value="3">{t('course.form.yearOption').replace('{year}', '3')}</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">{t('course.form.moduleLabel')}</label>
            <input
              value={chapter}
              onChange={(e) => setChapter(e.target.value)}
              className="w-full rounded-xl border border-accent/30 bg-background/60 px-3 py-2"
              placeholder={t('course.form.modulePlaceholder')}
              inputMode="numeric"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">{t('course.form.examPartLabel')}</label>
            <select
              value={examPart}
              onChange={e => setExamPart(e.target.value as any)}
              className="w-full rounded-xl border border-accent/30 bg-background/60 px-3 py-2"
            >
              <option value="">{t('course.form.examPartSelect')}</option>
              <option value="1">{t('course.form.examPartOption').replace('{part}', '1')}</option>
              <option value="2">{t('course.form.examPartOption').replace('{part}', '2')}</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium">{t('course.form.skillsLabel')}</label>
            <input
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              className="w-full rounded-xl border border-accent/30 bg-background/60 px-3 py-2"
              placeholder={t('course.form.skillsPlaceholder')}
            />
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl px-4 py-2 disabled:opacity-60"
          >
            {submitting ? t('course.form.saving') : t('course.form.save')}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-xl border border-accent/30 px-4 py-2 hover:bg-background/60"
          >
            {t('course.form.cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
