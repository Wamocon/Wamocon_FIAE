'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function NewCoursePage() {
  const router = useRouter();
  const { profile } = useAuth();

  const [title, setTitle] = useState('');
  const [year, setYear] = useState<'1' | '2' | '3' | ''>('');
  const [chapter, setChapter] = useState<string>('');
  const [skills, setSkills] = useState<string>(''); // comma-separated
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // No lessons in the new schema; handled as Enablers/Use Cases at course level

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
  if (!title.trim()) return setError('Bitte einen Kurstitel eingeben.');
  if (!year) return setError('Bitte ein Trainingsjahr wählen.');

    try {
      setSubmitting(true);
      const payload: any = {
        title: title.trim(),
        year: Number(year),
        chapter: chapter ? Number(chapter) : undefined,
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
      if (!res.ok) throw new Error('Speichern fehlgeschlagen');

      // Go back to Content Management after creation
      router.replace('/trainer/content-management');
    } catch (e: any) {
      setError(e?.message || 'Unbekannter Fehler');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Neuen Kurs anlegen</h1>
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && <div className="text-red-500">{error}</div>}

        <div>
          <label className="mb-1 block text-sm font-medium">Kurstitel</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2"
            placeholder="z.B. Einführung in Webentwicklung"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Trainingsjahr</label>
          <select
            value={year}
            onChange={e => setYear(e.target.value as any)}
            className="w-full rounded-md border border-border bg-background px-3 py-2"
          >
            <option value="">Bitte wählen</option>
            <option value="1">Jahr 1</option>
            <option value="2">Jahr 2</option>
            <option value="3">Jahr 3</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Module (z.B. Modul 1)</label>
          <input
            value={chapter}
            onChange={(e) => setChapter(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2"
            placeholder="z.B. 1"
            inputMode="numeric"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Skills (Kommagetrennt)</label>
          <input
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2"
            placeholder="z.B. Git, HTML, CSS, JavaScript"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-primary px-4 py-2 text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {submitting ? 'Speichern…' : 'Speichern'}
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
