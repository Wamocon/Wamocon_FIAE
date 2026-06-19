'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { PageLoader } from '@/components/ui/PageLoader';

type BuilderQuestion = {
  questionText: string;
  options: [string, string, string, string];
  correctIndex: number;
};

export default function EnablerQuizBuilderPage() {
  const router = useRouter();
  const params = useParams<{ enablerId: string }>();
  const enablerId = params?.enablerId as string;
  const { profile, isPlatformOwner, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && !isPlatformOwner) {
      router.replace('/trainer/content-management');
    }
  }, [authLoading, isPlatformOwner, router]);

  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<BuilderQuestion[]>([
    { questionText: '', options: ['', '', '', ''], correctIndex: 0 },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/trainer/enablers/${enablerId}/quiz`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error('Fehler beim Laden');
        const data = await res.json();
        if (data.quiz) {
          setTitle(data.quiz.title || '');
          setQuestions(
            (data.quiz.questions || []).map((q: any) => ({
              questionText: q.questionText,
              options: (q.options || []).map((o: any) => o.optionText) as [
                string,
                string,
                string,
                string,
              ],
              correctIndex: Math.max(
                0,
                (q.options || []).findIndex((o: any) => o.isCorrect)
              ),
            }))
          );
        }
      } catch (e: any) {
        setError(e?.message || 'Unbekannter Fehler');
      } finally {
        setLoading(false);
      }
    };
    if (enablerId) load();
  }, [enablerId]);

  const addQuestion = () =>
    setQuestions(prev => [
      ...prev,
      { questionText: '', options: ['', '', '', ''], correctIndex: 0 },
    ]);
  const removeQuestion = (idx: number) =>
    setQuestions(prev => prev.filter((_, i) => i !== idx));
  const updateQuestion = (idx: number, patch: Partial<BuilderQuestion>) =>
    setQuestions(prev =>
      prev.map((q, i) => (i === idx ? { ...q, ...patch } : q))
    );
  const updateOption = (qi: number, oi: number, value: string) =>
    setQuestions(prev =>
      prev.map((q, i) =>
        i === qi
          ? {
              ...q,
              options: q.options.map((o, j) => (j === oi ? value : o)) as any,
            }
          : q
      )
    );

  const save = async () => {
    setError(null);
    if (!profile?.id) return setError('Kein Trainerprofil gefunden');
    if (!title.trim()) return setError('Bitte einen Quiztitel eingeben.');
    const cleaned = questions
      .map(q => ({
        questionText: q.questionText.trim(),
        options: q.options.map(o => o.trim()) as [
          string,
          string,
          string,
          string,
        ],
        correctIndex: Number(q.correctIndex),
      }))
      .filter(
        q => q.questionText.length > 0 && q.options.every(o => o.length > 0)
      );
    if (cleaned.length === 0)
      return setError('Bitte mindestens eine vollständige Frage hinzufügen.');

    try {
      setSaving(true);
      const res = await fetch(`/api/trainer/enablers/${enablerId}/quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          createdById: profile.id,
          questions: cleaned,
        }),
      });
      if (!res.ok) throw new Error('Speichern fehlgeschlagen');
      router.back();
    } catch (e: any) {
      setError(e?.message || 'Unbekannter Fehler');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoader />;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Quiz für Enabler bearbeiten</h1>
      {error && <div className="text-red-500">{error}</div>}
      <div>
        <label className="mb-1 block text-sm font-medium">Quiztitel</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="border-border bg-background w-full rounded-md border px-3 py-2"
        />
      </div>
      <div className="space-y-6">
        {questions.map((q, i) => (
          <div key={i} className="border-border rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold">Frage {i + 1}</div>
              <button
                type="button"
                onClick={() => removeQuestion(i)}
                className="border-border rounded-md border px-2 py-1 text-sm"
              >
                Entfernen
              </button>
            </div>
            <input
              className="border-border bg-background mt-2 w-full rounded-md border px-3 py-2"
              placeholder="Fragetext"
              value={q.questionText}
              onChange={e =>
                updateQuestion(i, { questionText: e.target.value })
              }
            />
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              {q.options.map((opt, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`correct-${i}`}
                    checked={q.correctIndex === oi}
                    onChange={() => updateQuestion(i, { correctIndex: oi })}
                  />
                  <input
                    className="border-border bg-background flex-1 rounded-md border px-3 py-2"
                    placeholder={`Option ${oi + 1}`}
                    value={opt}
                    onChange={e => updateOption(i, oi, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addQuestion}
          className="border-border rounded-md border px-3 py-2 text-sm"
        >
          + Frage hinzufügen
        </button>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => router.back()}
          className="border-border rounded-md border px-4 py-2"
        >
          Abbrechen
        </button>
        <button
          disabled={saving}
          onClick={save}
          className="bg-primary text-foreground rounded-md px-4 py-2 disabled:opacity-60"
        >
          {saving ? 'Speichern…' : 'Speichern'}
        </button>
      </div>
    </div>
  );
}
