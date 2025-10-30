'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

// Types for quiz payload
type QuizQ = { id: string; questionText: string; options: { id: string; optionText: string }[] };

export default function TraineeEnablerDetailPage() {
  const params = useParams<{ enablerId: string }>();
  const enablerId = params?.enablerId as string;
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enabler, setEnabler] = useState<{ id: string; title: string; descriptionText?: string | null; scenarioText?: string | null; hintText?: string | null; pptUrl?: string | null; videoUrl?: string | null; isActive?: boolean; durationValue?: number | null; durationUnit?: 'DAYS' | 'WEEKS' | null; activatedAt?: string | null } | null>(null);
  const [quiz, setQuiz] = useState<{ title: string; questions: QuizQ[] } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ score: number; feedback: Array<{ questionId: string; correct: boolean; correctOptionId?: string }> } | null>(null);
  const [solutionText, setSolutionText] = useState('');
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!profile?.id || !enablerId) return;
      setLoading(true);
      setError(null);
      try {
        const er = await fetch(`/api/trainee/enablers/${enablerId}?traineeId=${profile.id}`, { cache: 'no-store' });
        if (!er.ok) throw new Error('Enabler konnte nicht geladen werden');
        const ej = await er.json();
  setEnabler(ej.enabler);
  if (ej.submission) setSolutionText(ej.submission.solutionText || '');

        const qr = await fetch(`/api/trainee/enablers/${enablerId}/quiz?traineeId=${profile.id}`, { cache: 'no-store' });
        if (!qr.ok) throw new Error('Quiz konnte nicht geladen werden');
        const qj = await qr.json();
        if (qj.quiz) setQuiz(qj.quiz);
      } catch (e: any) {
        setError(e?.message || 'Unbekannter Fehler');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [profile?.id, enablerId]);

  const submitQuiz = async () => {
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

  const submitSolution = async () => {
    if (!profile?.id) return setError('Profil fehlt');
    setSaveSuccess(null);
    try {
      const r = await fetch(`/api/trainee/enablers/${enablerId}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ traineeId: profile.id, solutionText }) });
      if (!r.ok) throw new Error('Abgabe fehlgeschlagen');
      setSaveSuccess('Lösung gespeichert. Status: Ausstehend');
    } catch (e: any) {
      setError(e?.message || 'Unbekannter Fehler');
    }
  };

  if (!profile) return <div className="p-6">Bitte anmelden…</div>;
  if (loading) return <div className="p-6">Lade…</div>;
  if (error) return <div className="p-6 text-red-500">{error}</div>;
  if (!enabler) return <div className="p-6">Nicht gefunden</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="rounded-3xl border border-accent/30 bg-black/30 p-5">
        <h1 className="text-foreground text-2xl font-bold">{enabler.title}</h1>
        {enabler.descriptionText && (
          <p className="text-muted-foreground mt-2 whitespace-pre-line">{enabler.descriptionText}</p>
        )}
        {enabler.isActive && enabler.durationValue && enabler.activatedAt && (
          <div className="mt-3 text-sm">
            {(() => {
              const started = new Date(enabler.activatedAt as string).getTime();
              const now = Date.now();
              const daysElapsed = Math.floor((now - started) / (1000 * 60 * 60 * 24));
              const total = Number(enabler.durationValue || 0);
              const left = Math.max(0, total - daysElapsed);
              const dueDate = new Date(started + total * 24 * 60 * 60 * 1000);
              return <span>Restzeit: {left} Tage • Fällig am {dueDate.toLocaleDateString()}</span>;
            })()}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-3">
          {enabler.videoUrl && (
            <a className="rounded-xl border border-accent/30 px-3 py-1.5 text-sm hover:bg-background/60" href={enabler.videoUrl} target="_blank" rel="noreferrer">Video ansehen</a>
          )}
          {enabler.pptUrl && (
            <a className="rounded-xl border border-accent/30 px-3 py-1.5 text-sm hover:bg-background/60" href={enabler.pptUrl} target="_blank" rel="noreferrer">PPT öffnen</a>
          )}
        </div>
        {enabler.scenarioText && (
          <div className="mt-4 rounded-xl border border-accent/20 bg-black/20 p-4">
            <div className="mb-1 text-sm font-semibold">Szenario</div>
            <p className="whitespace-pre-line">{enabler.scenarioText}</p>
          </div>
        )}
        {enabler.hintText && (
          <div className="mt-3 rounded-xl border border-accent/20 bg-black/20 p-4">
            <div className="mb-1 text-sm font-semibold">Hinweis</div>
            <p className="whitespace-pre-line text-muted-foreground">{enabler.hintText}</p>
          </div>
        )}
      </div>

      <div className="space-y-4 rounded-3xl border border-accent/30 bg-black/30 p-5">
        {saveSuccess && <div className="rounded-md border border-green-500/40 bg-green-500/10 p-2 text-sm text-green-300">{saveSuccess}</div>}
        <div>
          <label className="mb-1 block text-sm font-medium">Deine Lösung zum Szenario</label>
          <textarea value={solutionText} onChange={(e) => setSolutionText(e.target.value)} className="w-full rounded-xl border border-accent/30 bg-black/30 px-3 py-2" rows={6} placeholder="Beschreibe deine Lösung..." />
        </div>
        <div className="flex justify-end">
          <button onClick={submitSolution} className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90">Lösung abgeben</button>
        </div>
      </div>

      {quiz && (
        <div className="space-y-4 rounded-3xl border border-accent/30 bg-black/30 p-5">
          <div className="text-lg font-semibold">Quiz: {quiz.title}</div>
          {result ? (
            <div className="space-y-3">
              <div className="font-medium">Score: {result.score}%</div>
              <ul className="space-y-2">
                {quiz.questions.map((q: QuizQ) => {
                  const fb = result.feedback.find((f) => String(f.questionId) === String(q.id));
                  const chosen = answers[q.id];
                  return (
                    <li key={q.id} className={`rounded-xl border p-3 ${fb?.correct ? 'border-green-600/50 bg-green-500/10' : 'border-red-600/50 bg-red-500/10'}`}>
                      <div className="font-medium">{q.questionText}</div>
                      <div className="mt-1 text-sm">Deine Antwort: {q.options.find((o) => String(o.id) === String(chosen))?.optionText || '-'}</div>
                      {!fb?.correct && (
                        <div className="mt-1 text-sm text-green-400">Richtig: {q.options.find((o) => String(o.id) === String(fb?.correctOptionId))?.optionText}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <button className="rounded-md border border-accent/30 px-4 py-2 hover:bg-background/60" onClick={() => { setResult(null); setAnswers({}); }}>Erneut versuchen</button>
            </div>
          ) : (
            <div className="space-y-4">
              {quiz.questions.map((q: QuizQ) => (
                <div key={q.id} className="rounded-xl border border-accent/20 bg-black/20 p-3">
                  <div className="mb-2 font-medium">{q.questionText}</div>
                  <div className="space-y-2">
                    {q.options.map((o: { id: string; optionText: string }) => (
                      <label key={o.id} className="flex items-center gap-2">
                        <input type="radio" name={`q-${q.id}`} checked={answers[q.id] === String(o.id)} onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: String(o.id) }))} />
                        <span>{o.optionText}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <button onClick={submitQuiz} className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90">Quiz abgeben</button>
            </div>
          )}
        </div>
      )}

      <div>
        <Link href={`/trainee/modules`} className="text-sm underline">Zurück zu meinen Modulen</Link>
      </div>
    </div>
  );
}
