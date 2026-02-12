'use client';

import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useEffect, useState } from 'react';
import { MarkdownText } from '@/components/ui/MarkdownText';

type Opt = { id: string; optionText: string; isCorrect: boolean; explanation?: string | null };
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
  const { profile } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [difficulty, setDifficulty] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('LOW');
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
    options: type === 'MCQ' ? [0, 1, 2, 3].map((i) => ({ id: '', optionText: '', isCorrect: i === 0, explanation: '' })) : []
  });

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const r = await fetch(`/api/trainer/enablers/${enablerId}/quizzes/${quizId}`);
        if (!r.ok) throw new Error('Quiz nicht gefunden');
        const data = await r.json();
        const qz = data.quiz;
        setTitle(qz.title);
        setIsActive(!!qz.isActive);
        setDifficulty(qz.difficulty);
        setQuestions((qz.questions || []).map((q: any) => ({
          id: q.id,
          questionText: q.questionText,
          orderIndex: q.orderIndex ?? null,
          questionType: q.questionType || 'MCQ',
          expectedAnswer: q.expectedAnswer ?? null,
          options: (q.options || [])
        })));
      } catch (e: any) {
        setError(e?.message || 'Unbekannter Fehler');
      } finally {
        setLoading(false);
      }
    };
    if (enablerId && quizId) load();
  }, [enablerId, quizId]);

  if (loading) return <div className="p-6">Lade…</div>;
  if (error) return <div className="p-6 text-red-500">{error}</div>;

  return (
    <div className="mx-auto mt-6 max-w-7xl bg-background border border-accent/20 rounded-2xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Lesson-Quiz</h1>
        <div className="flex items-center gap-2">
          {editing && (
            <button
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600"
              onClick={async () => {
                if (!confirm('Dieses Quiz wirklich löschen?')) return;
                try {
                  const r = await fetch(`/api/trainer/enablers/${enablerId}/quizzes/${quizId}`, { method: 'DELETE' });
                  if (!r.ok) throw new Error('Löschen fehlgeschlagen');
                  router.back();
                } catch (e: any) {
                  toast.error(e?.message || 'Unbekannter Fehler');
                }
              }}
            >Löschen</button>
          )}
          <button className="rounded-md border border-accent/30 px-3 py-1.5 text-sm" onClick={() => setEditing(!editing)}>{editing ? 'Ansicht' : 'Bearbeiten'}</button>
          <button className="rounded-md border border-accent/30 px-3 py-1.5 text-sm" onClick={() => router.back()}>Zurück</button>
        </div>
      </div>

      <div className="rounded-2xl border border-accent/20 bg-background/40 p-5 space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Schwierigkeit</label>
            {editing ? (
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as any)} className="w-full rounded-xl border border-accent/20 bg-background/60 px-3 py-2">
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </select>
            ) : (
              <div className="text-sm">{difficulty}</div>
            )}
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium">Quiz-Titel</label>
            {editing ? (
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-xl border border-accent/20 bg-background/60 px-3 py-2" />
            ) : (
              <div className="text-sm">{title}</div>
            )}
          </div>
        </div>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={isActive} disabled={!editing} onChange={(e) => setIsActive(e.target.checked)} />
          <span>Aktiv</span>
        </label>

        <div>
          <div className="mb-2 text-sm font-semibold">Fragen</div>
          <div className="space-y-4">
            {questions.map((q, qi) => {
              const correctIndex = q.options.findIndex(o => o.isCorrect) ?? 0;
              const correctExplanation = q.options[correctIndex]?.explanation || '';
              return (
                <div key={q.id || qi} className="rounded-lg border border-accent/20 bg-background/40 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="font-medium">Frage {qi + 1}</div>
                    {editing && (
                      <button
                        type="button"
                        className="text-xs rounded-md border border-accent/30 px-2 py-1"
                        onClick={() => setQuestions(prev => prev.filter((_, i) => i !== qi))}
                      >Entfernen</button>
                    )}
                  </div>
                  {editing ? (
                    <input className="w-full rounded-xl border border-accent/20 bg-background/60 px-3 py-2" value={q.questionText} onChange={(e) => setQuestions(prev => prev.map((x, i) => i === qi ? { ...x, questionText: e.target.value } : x))} />
                  ) : (
                    <MarkdownText className="text-sm">{q.questionText}</MarkdownText>
                  )}
                  {editing && (
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="radio"
                          name={`type-${qi}`}
                          checked={(q.questionType || 'MCQ') === 'MCQ'}
                          onChange={() => setQuestions(prev => prev.map((x, i) => i === qi ? {
                            ...x,
                            questionType: 'MCQ',
                            expectedAnswer: null,
                            options: x.options && x.options.length ? x.options : [0, 1, 2, 3].map((j) => ({ id: '', optionText: '', isCorrect: j === 0, explanation: '' }))
                          } : x))}
                        /> Multiple Choice
                      </label>
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="radio"
                          name={`type-${qi}`}
                          checked={q.questionType === 'TEXT'}
                          onChange={() => setQuestions(prev => prev.map((x, i) => i === qi ? {
                            ...x,
                            questionType: 'TEXT',
                            expectedAnswer: x.expectedAnswer ?? '',
                            options: []
                          } : x))}
                        /> Textantwort
                      </label>
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                    {q.questionType === 'TEXT' ? (
                      <div className="col-span-2 space-y-2">
                        <div className="text-xs uppercase tracking-wide">Textantwort</div>
                        {editing ? (
                          <textarea
                            rows={2}
                            className="w-full rounded-xl border border-accent/20 bg-background/60 px-3 py-2"
                            placeholder="Erwartete korrekte Antwort (optional für automatische Bewertung)"
                            value={q.expectedAnswer || ''}
                            onChange={(e) => setQuestions(prev => prev.map((x, i) => i === qi ? { ...x, expectedAnswer: e.target.value } : x))}
                          />
                        ) : (
                          <div className="text-sm text-muted-foreground">Erwartete Antwort: {q.expectedAnswer || '–'}</div>
                        )}
                      </div>
                    ) : (
                      q.options.map((o, oi) => (
                        <div key={o.id || oi} className={`rounded-md border ${o.isCorrect ? 'border-green-400' : 'border-accent/20'} bg-background/30 p-2`}>
                          <div className="flex items-center justify-between">
                            <div className="text-xs uppercase tracking-wide">{o.isCorrect ? 'Richtig' : 'Option'}</div>
                            {editing && (
                              <label className="flex items-center gap-1 text-xs">
                                <input
                                  type="radio"
                                  name={`correct-${qi}`}
                                  checked={o.isCorrect}
                                  onChange={() => {
                                    setQuestions(prev => prev.map((x, i) => {
                                      if (i !== qi) return x;
                                      const prevCorrect = x.options.findIndex(oo => oo.isCorrect);
                                      const prevExpl = prevCorrect >= 0 ? (x.options[prevCorrect].explanation || '') : '';
                                      return {
                                        ...x,
                                        options: x.options.map((oo, j) => {
                                          if (j === oi) {
                                            return { ...oo, isCorrect: true, explanation: oo.explanation || prevExpl };
                                          }
                                          if (j === prevCorrect) {
                                            return { ...oo, isCorrect: false };
                                          }
                                          return { ...oo, isCorrect: false };
                                        })
                                      };
                                    }));
                                  }}
                                />
                                <span>Als richtig markieren</span>
                              </label>
                            )}
                          </div>
                          {editing ? (
                            <input className="mt-1 w-full rounded-xl border border-accent/20 bg-background/60 px-3 py-2" value={o.optionText} onChange={(e) => setQuestions(prev => prev.map((x, i) => i === qi ? { ...x, options: x.options.map((oo, j) => j === oi ? { ...oo, optionText: e.target.value } : oo) } : x))} />
                          ) : (
                            <MarkdownText inline className="text-sm">{o.optionText}</MarkdownText>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                  {q.questionType !== 'TEXT' && (
                    <div className="mt-3">
                      <label className="mb-1 block text-xs font-medium">Erklärung (für die richtige Antwort)</label>
                      {editing ? (
                        <textarea
                          className="w-full rounded-xl border border-accent/20 bg-background/60 px-3 py-2"
                          rows={2}
                          value={correctExplanation}
                          onChange={(e) => setQuestions(prev => prev.map((x, i) => {
                            if (i !== qi) return x;
                            const ci = x.options.findIndex(o => o.isCorrect);
                            return {
                              ...x,
                              options: x.options.map((oo, j) => j === ci ? { ...oo, explanation: e.target.value } : oo)
                            };
                          }))}
                        />
                      ) : (
                        <div className="text-sm text-muted-foreground whitespace-pre-wrap">{correctExplanation || '-'}</div>
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
                className="inline-flex items-center gap-2 rounded-xl border border-accent/30 px-3 py-2 text-sm"
                onClick={() => setQuestions(prev => [...prev, newBlankQuestion('MCQ')])}
              >+ MCQ Frage</button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-accent/30 px-3 py-2 text-sm"
                onClick={() => setQuestions(prev => [...prev, newBlankQuestion('TEXT')])}
              >+ Textfrage</button>
            </div>
          )}
        </div>

        {editing && (
          <div className="flex justify-end">
            <button className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 disabled:opacity-60" disabled={saving} onClick={async () => {
              if (!profile?.id) { toast.error('Kein Trainerprofil'); return; }
              setSaving(true);
              try {
                const payload = {
                  trainerId: profile.id,
                  title,
                  isActive,
                  difficulty,
                  questions: questions.map((q) => (
                    (q.questionType === 'TEXT')
                      ? ({ questionText: q.questionText, questionType: 'TEXT', expectedAnswer: q.expectedAnswer })
                      : ({ questionText: q.questionText, questionType: 'MCQ', options: q.options.map((o) => ({ optionText: o.optionText, isCorrect: o.isCorrect, explanation: (o.explanation ?? '') || null })) })
                  )),
                };
                const r = await fetch(`/api/trainer/enablers/${enablerId}/quizzes/${quizId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                if (!r.ok) throw new Error('Speichern fehlgeschlagen');
                setEditing(false);
              } catch (e: any) {
                toast.error(e?.message || 'Unbekannter Fehler');
              } finally {
                setSaving(false);
              }
            }}>Speichern</button>
          </div>
        )}
      </div>
    </div>
  );
}
