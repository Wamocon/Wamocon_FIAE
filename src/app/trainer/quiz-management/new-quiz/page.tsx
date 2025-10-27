'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type ModuleItem = { id: string; title: string; training_year: number; lessons: Array<{ id: string; title: string }> };

export default function NewQuizPage() {
  const router = useRouter();
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
        if (!res.ok) throw new Error('Konnte Module nicht laden');
        const data = await res.json();
        const ms: ModuleItem[] = (data.modules || []).map((m: any) => ({
          id: m.id,
          title: m.title,
          training_year: m.training_year,
          lessons: (m.lessons || []).map((l: any) => ({ id: l.id, title: l.title })),
        }));
        setModules(ms);
      } catch (e: any) {
        setError(e?.message || 'Unbekannter Fehler');
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
    if (!title.trim()) return setError('Bitte einen Titel eingeben.');
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
      if (!res.ok) throw new Error('Quiz erstellen fehlgeschlagen');
      router.replace('/trainer/quiz-management');
    } catch (e: any) {
      setError(e?.message || 'Unbekannter Fehler');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6">Lade…</div>;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Neues Quiz</h1>
      <form onSubmit={handleSave} className="space-y-6">
        {error && <div className="text-red-500">{error}</div>}

        <div>
          <label className="mb-1 block text-sm font-medium">Titel</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2"
            placeholder="Quiz-Titel"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Quiz-Typ</label>
            <select
              value={quizType}
              onChange={e => setQuizType(e.target.value as any)}
              className="w-full rounded-md border border-border bg-background px-3 py-2"
            >
              <option value="mini">Mini</option>
              <option value="big">Groß</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Trainingsjahr</label>
            <select
              value={trainingYear}
              onChange={e => setTrainingYear(e.target.value as any)}
              className="w-full rounded-md border border-border bg-background px-3 py-2"
            >
              <option value="1">Jahr 1</option>
              <option value="2">Jahr 2</option>
              <option value="3">Jahr 3</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Zeitlimit (Minuten)</label>
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
            <label className="mb-1 block text-sm font-medium">Modul (optional)</label>
            <select
              value={moduleId}
              onChange={e => { setModuleId(e.target.value); setLessonId(''); }}
              className="w-full rounded-md border border-border bg-background px-3 py-2"
            >
              <option value="">Kein Modul</option>
              {filteredModules.map(m => (
                <option key={m.id} value={m.id}>{m.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Lektion (optional)</label>
            <select
              value={lessonId}
              onChange={e => setLessonId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2"
              disabled={!moduleId}
            >
              <option value="">Keine Lektion</option>
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
            className="rounded-md bg-primary px-4 py-2 text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? 'Erstellen…' : 'Erstellen'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-md border border-border px-4 py-2 hover:bg-background/60"
          >
            Abbrechen
          </button>
        </div>
      </form>
    </div>
  );
}
