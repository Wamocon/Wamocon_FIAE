'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';

export default function EditModulePage() {
  const router = useRouter();
  const params = useParams<{ moduleId: string }>();
  const moduleId = params?.moduleId as string;

  const [title, setTitle] = useState('');
  const [year, setYear] = useState<'1' | '2' | '3' | ''>('');
  const [lessons, setLessons] = useState<Array<{ id?: string; title: string; order_index?: number; duration_weeks?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/trainer/content/modules/${moduleId}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Konnte Modul nicht laden');
        const data = await res.json();
        setTitle(data.module.title);
        setYear(String(data.module.training_year) as any);
        setLessons(
          (data.lessons || []).map((l: any) => ({ id: l.id, title: l.title, order_index: l.order_index, duration_weeks: l.duration_weeks ?? '' }))
        );
      } catch (e: any) {
        setError(e?.message || 'Unbekannter Fehler');
      } finally {
        setLoading(false);
      }
    };
    if (moduleId) load();
  }, [moduleId]);

  const addLesson = () => setLessons(prev => [...prev, { title: '' }]);
  const removeLesson = (idx: number) => setLessons(prev => prev.filter((_, i) => i !== idx));
  const updateLesson = (idx: number, key: 'title' | 'duration_weeks', value: string) =>
    setLessons(prev => prev.map((l, i) => (i === idx ? { ...l, [key]: value } : l)));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError('Bitte einen Modultitel eingeben.');
    if (!year) return setError('Bitte ein Trainingsjahr wählen.');

    try {
      setSaving(true);
      const payload: any = {
        title: title.trim(),
        training_year: Number(year),
        lessons: lessons
          .map((l, i) => ({
            id: l.id,
            title: l.title.trim(),
            order_index: i + 1,
            duration_weeks: l.duration_weeks ? Number(l.duration_weeks) : undefined,
          }))
          .filter((l) => l.title.length > 0),
      };

      const res = await fetch(`/api/trainer/content/modules/${moduleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Speichern fehlgeschlagen');

      router.replace('/trainer/content-management');
    } catch (e: any) {
      setError(e?.message || 'Unbekannter Fehler');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6">Lade Modul…</div>;
  if (error) return <div className="p-6 text-red-500">{error}</div>;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Modul bearbeiten</h1>
      <form onSubmit={handleSave} className="space-y-6">
        {error && <div className="text-red-500">{error}</div>}

        <div>
          <label className="mb-1 block text-sm font-medium">Modultitel</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Trainingsjahr</label>
          <select
            value={year}
            onChange={e => setYear(e.target.value as any)}
            className="w-full rounded-md border border-border bg-background px-3 py-2"
          >
            <option value="1">Jahr 1</option>
            <option value="2">Jahr 2</option>
            <option value="3">Jahr 3</option>
          </select>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Kapitel (Lektionen)</label>
            <button
              type="button"
              onClick={addLesson}
              className="rounded-md bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent/90"
            >
              + Lektion hinzufügen
            </button>
          </div>

          {lessons.map((l, idx) => (
            <div key={idx} className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <input
                className="md:col-span-9 rounded-md border border-border bg-background px-3 py-2"
                placeholder={`Lektion ${idx + 1} Titel`}
                value={l.title}
                onChange={e => updateLesson(idx, 'title', e.target.value)}
              />
              <input
                className="md:col-span-2 rounded-md border border-border bg-background px-3 py-2"
                placeholder="Wochen"
                type="number"
                min={1}
                value={l.duration_weeks ?? ''}
                onChange={e => updateLesson(idx, 'duration_weeks', e.target.value)}
              />
              <button
                type="button"
                onClick={() => removeLesson(idx)}
                className="md:col-span-1 rounded-md border border-border px-3 py-2 text-sm hover:bg-red-500/10"
              >
                Entfernen
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-primary px-4 py-2 text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? 'Speichern…' : 'Speichern'}
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
