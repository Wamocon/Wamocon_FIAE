'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

type QuizQ = { id: string; questionText: string; options: { id: string; optionText: string }[] };

export default function TraineeEnablerQuizPage() {
  const params = useParams<{ enablerId: string }>();
  const enablerId = params?.enablerId as string;
  const { profile } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<QuizQ[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ score: number; feedback: Array<{ questionId: string; correct: boolean; correctOptionId?: string }> } | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!profile?.id) return;
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/trainee/enablers/${enablerId}/quiz?traineeId=${profile.id}`, { cache: 'no-store' });
        if (!r.ok) throw new Error('Quiz konnte nicht geladen werden');
        const data = await r.json();
        if (!data.quiz) throw new Error('Kein Quiz für diesen Enabler vorhanden');
        setTitle(data.quiz.title || 'Enabler-Quiz');
        setQuestions(data.quiz.questions || []);
      } catch (e: any) {
        setError(e?.message || 'Unbekannter Fehler');
      } finally {
        setLoading(false);
      }
    };
    if (enablerId) load();
  }, [enablerId, profile?.id]);

  const submit = async () => {
    if (!profile?.id) return setError('Profil fehlt');
    const payload = {
      traineeId: profile.id,
      answers: Object.entries(answers).map(([questionId, selectedOptionId]) => ({ questionId, selectedOptionId })),
    };
    try {
      const r = await fetch(`/api/trainee/enablers/${enablerId}/quiz/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error('Abgabe fehlgeschlagen');
      const data = await r.json();
      setResult({ score: data.score, feedback: data.feedback });
    } catch (e: any) {
      setError(e?.message || 'Unbekannter Fehler');
    }
  };

  if (loading) return <div className="p-6">Lade…</div>;
  if (error) return <div className="p-6 text-red-500">{error}</div>;

  if (result) {
    return (
      <div className="mx-auto max-w-2xl p-6 space-y-4">
        <h1 className="text-2xl font-bold">Ergebnis: {result.score}%</h1>
        <ul className="space-y-2">
          {questions.map((q) => {
            const fb = result.feedback.find((f) => String(f.questionId) === String(q.id));
            const chosen = answers[q.id];
            return (
              <li key={q.id} className={`rounded-md border p-3 ${fb?.correct ? 'border-green-600/50' : 'border-red-600/50'}`}>
                <div className="font-medium">{q.questionText}</div>
                <div className={`text-sm mt-1 ${fb?.correct ? 'text-green-400' : 'text-red-400'}`}>
                  Deine Antwort: {q.options.find((o) => String(o.id) === String(chosen))?.optionText || '-'}
                </div>
                {!fb?.correct && (
                  <div className="text-sm text-green-300 mt-1">
                    Richtige Antwort: {q.options.find((o) => String(o.id) === String(fb?.correctOptionId))?.optionText}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="flex gap-3">
          <button className="rounded-md border border-border px-4 py-2" onClick={() => router.push('/trainee/dashboard')}>Zum Dashboard</button>
          <button className="rounded-md border border-border px-4 py-2" onClick={() => { setResult(null); setAnswers({}); }}>Erneut versuchen</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <ul className="space-y-4">
        {questions.map((q) => (
          <li key={q.id} className="rounded-md border p-4">
            <div className="font-medium mb-2">{q.questionText}</div>
            <div className="space-y-2">
              {q.options.map((o) => (
                <label key={o.id} className="flex items-center gap-2">
                  <input type="radio" name={`q-${q.id}`} checked={answers[q.id] === String(o.id)} onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: String(o.id) }))} />
                  <span>{o.optionText}</span>
                </label>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <button onClick={submit} className="rounded-md bg-primary px-4 py-2 text-foreground">Abgeben</button>
    </div>
  );
}
