'use client';

import { useAuth } from '@/contexts/AuthContext';
import { MessageSquare, Award } from 'lucide-react';
import { useEffect, useState } from 'react';

type EnablerResult = { id: string; enablerId: string; enablerTitle: string; status: 'PENDING'|'APPROVED'|'REJECTED'; trainerFeedback?: string|null; feedbacks?: Array<{ scenarioIndex: number; feedback: string }>|null; solutionText?: string|null; solutions?: Array<{ scenarioIndex: number; text: string }>|null; submittedAt: string; reviewedAt?: string|null; attemptNumber?: number|null };
type UseCaseResult = { id: string; useCaseId: string; useCaseTitle: string; status: 'PENDING'|'APPROVED'|'REJECTED'; trainerFeedback?: string|null; submittedAt: string; reviewedAt?: string|null; attemptNumber?: number|null };
type EnablerQuizResult = { id: string; enablerId: string; enablerTitle: string; quizId: string; quizTitle: string; score: number|null; submittedAt: string; trainerFeedback?: string|null; attemptNumber?: number|null };
type GlobalQuizResult = { id: string; quizId: string; quizTitle: string; score: number|null; submittedAt: string; trainerFeedback?: string|null; attemptNumber?: number|null };

export default function TraineeFeedbackPage() {
  const { profile, loading } = useAuth();
  const [enablers, setEnablers] = useState<EnablerResult[]>([]);
  const [useCases, setUseCases] = useState<UseCaseResult[]>([]);
  const [quizzes, setQuizzes] = useState<EnablerQuizResult[]>([]);
  const [globalQuizzes, setGlobalQuizzes] = useState<GlobalQuizResult[]>([]);
  const [solutionIndexMap, setSolutionIndexMap] = useState<Record<string, number>>({});

  // Hooks must be declared before any conditional return
  useEffect(() => {
    const load = async () => {
      if (!profile?.id) return;
      try {
        const res = await fetch(`/api/trainee/feedback?traineeId=${profile.id}`, { cache: 'no-store' });
        const data = await res.json();
  setEnablers(data.enablerResults || []);
  setUseCases(data.useCaseResults || []);
        const quizResults = (data.enablerQuizResults || []) as EnablerQuizResult[];
        setQuizzes(
          quizResults.map((q) => ({
            id: q.id,
            enablerId: q.enablerId,
            enablerTitle: q.enablerTitle,
            quizId: q.quizId,
            quizTitle: q.quizTitle,
            score: q.score,
            submittedAt: q.submittedAt,
            trainerFeedback: (q as any).trainerFeedback ?? null,
            attemptNumber: (q as any).attemptNumber ?? null,
          }))
        );
        const globalResults = (data.globalQuizResults || []) as GlobalQuizResult[];
        setGlobalQuizzes(globalResults.map((g) => ({
          id: g.id,
          quizId: g.quizId,
          quizTitle: g.quizTitle,
          score: g.score,
          submittedAt: g.submittedAt,
          trainerFeedback: (g as any).trainerFeedback ?? null,
          attemptNumber: (g as any).attemptNumber ?? null,
        })));
      } catch (e) {
        console.error(e);
        setEnablers([]); setUseCases([]); setQuizzes([]);
      } finally {
        // no-op
      }
    };
    load();
  }, [profile?.id]);
  if (loading) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="border-accent/30 border-t-accent mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">Lade Trainer-Feedback...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="border-destructive/30 border-t-destructive mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">Benutzer nicht gefunden...</p>
        </div>
      </div>
    );
  }

  if (profile.role !== 'trainee') {
    return (
      <div className="bg-background flex min-h-full items-center justify-center">
        <div className="text-center">
          <div className="border-destructive/30 border-t-destructive mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"></div>
          <p className="text-muted-foreground">Zugriff verweigert...</p>
        </div>
      </div>
    );
  }



  const statusPill = (s: 'PENDING'|'APPROVED'|'REJECTED') => (
    <span className={`text-xs rounded-full px-2 py-1 border ${s==='PENDING'?'border-yellow-500 text-yellow-600': s==='APPROVED'?'border-green-500 text-green-600':'border-red-500 text-red-600'}`}>{s}</span>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-6">
          <div className="from-accent to-primary flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br">
            <MessageSquare className="h-8 w-8 text-foreground" />
          </div>
          <div>
            <h1 className="text-foreground mb-2 text-3xl font-bold">Trainer-Feedback</h1>
            <p className="text-muted">Status deiner Einreichungen und Ergebnisse der Lesson-Quizzes</p>
          </div>
        </div>
      </div>

      {/* Lesson submissions */}
      <div className="glass-effect rounded-3xl border border-accent/30 p-6 shadow-lg">
        <h2 className="text-foreground mb-4 text-xl font-semibold">Lesson-Einreichungen</h2>
        {enablers.length === 0 ? (
          <div className="text-muted-foreground">Keine Einreichungen.</div>
        ) : (
          <ul className="space-y-4">
            {enablers.map((e) => (
              <li key={e.id} className="rounded-2xl border border-accent/20 bg-background/40 p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">
                    {e.enablerTitle}
                    {e.attemptNumber ? <span className="ml-2 text-xs rounded-full border border-accent/30 px-2 py-0.5">Versuch {e.attemptNumber}</span> : null}
                  </div>
                  {statusPill(e.status)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Eingereicht am {new Date(e.submittedAt).toLocaleString()}</div>
                
                {/* Show submitted solutions */}
                {(e.solutions || e.solutionText) && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-muted-foreground mb-2">Deine eingereichte Lösung{e.solutions && e.solutions.length > 1 ? 'en' : ''}</div>
                    {e.solutions && e.solutions.length > 0 ? (
                      <div className="space-y-3">
                        {/* Counter */}
                        {e.solutions.length > 1 && (
                          <div className="text-center">
                            <span className="text-sm font-medium text-foreground">
                              Szenario {(solutionIndexMap[e.id] || 0) + 1} von {e.solutions.length}
                            </span>
                          </div>
                        )}

                        {/* Solution and Feedback Slider */}
                        <div className="relative overflow-hidden">
                          <div 
                            className="flex transition-transform duration-300 ease-in-out"
                            style={{ transform: `translateX(-${(solutionIndexMap[e.id] || 0) * 100}%)` }}
                          >
                            {e.solutions.map((sol, idx) => (
                              <div key={idx} className="w-full flex-shrink-0 px-2 space-y-3">
                                {/* Solution Box */}
                                <div className="rounded-xl border border-accent/20 bg-background/30 p-3">
                                  <div className="text-xs font-medium mb-1">Deine Lösung für Szenario {sol.scenarioIndex + 1}</div>
                                  <p className="text-sm whitespace-pre-wrap">{sol.text}</p>
                                </div>
                                
                                {/* Feedback Box for this scenario */}
                                <div className="rounded-xl border border-accent/20 bg-background/30 p-3">
                                  <div className="text-xs font-medium text-muted-foreground">Trainer Feedback für Szenario {sol.scenarioIndex + 1}</div>
                                  {e.feedbacks && e.feedbacks.find(f => f.scenarioIndex === sol.scenarioIndex)?.feedback ? (
                                    <div className="text-sm whitespace-pre-wrap">{e.feedbacks.find(f => f.scenarioIndex === sol.scenarioIndex)!.feedback}</div>
                                  ) : (
                                    <div className="text-xs italic text-muted-foreground">{e.status === 'PENDING' ? 'Noch in Prüfung…' : 'Kein individuelles Feedback vorhanden.'}</div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Navigation */}
                        {e.solutions.length > 1 && (
                          <div className="flex items-center justify-between">
                            <button
                              type="button"
                              disabled={(solutionIndexMap[e.id] || 0) === 0}
                              onClick={() => setSolutionIndexMap(prev => ({ ...prev, [e.id]: Math.max(0, (prev[e.id] || 0) - 1) }))}
                              className="rounded-md border border-accent/30 px-3 py-1 text-xs hover:bg-accent/10 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              ← Zurück
                            </button>
                            
                            <div className="flex items-center gap-2">
                              {e.solutions.map((_, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => setSolutionIndexMap(prev => ({ ...prev, [e.id]: idx }))}
                                  className={`h-2 rounded-full transition-all ${
                                    idx === (solutionIndexMap[e.id] || 0)
                                      ? 'w-6 bg-primary' 
                                      : 'w-2 bg-accent/30 hover:bg-accent/50'
                                  }`}
                                  aria-label={`Go to solution ${idx + 1}`}
                                />
                              ))}
                            </div>

                            <button
                              type="button"
                              disabled={(solutionIndexMap[e.id] || 0) === e.solutions.length - 1}
                              onClick={() => setSolutionIndexMap(prev => ({ ...prev, [e.id]: Math.min(e.solutions!.length - 1, (prev[e.id] || 0) + 1) }))}
                              className="rounded-md border border-accent/30 px-3 py-1 text-xs hover:bg-accent/10 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Weiter →
                            </button>
                          </div>
                        )}
                      </div>
                    ) : e.solutionText ? (
                      <>
                        <div className="rounded-xl border border-accent/20 bg-background/30 p-3">
                          <p className="text-sm whitespace-pre-wrap">{e.solutionText}</p>
                        </div>
                        <div className="mt-3 rounded-xl border border-accent/20 bg-background/30 p-3">
                          <div className="text-xs font-medium text-muted-foreground">Trainer Feedback</div>
                          {e.trainerFeedback ? (
                            <div className="text-sm whitespace-pre-wrap">{e.trainerFeedback}</div>
                          ) : (
                            <div className="text-xs italic text-muted-foreground">{e.status === 'PENDING' ? 'Noch in Prüfung…' : 'Kein individuelles Feedback vorhanden.'}</div>
                          )}
                        </div>
                      </>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

     

      {/* Use case submissions */}
      <div className="glass-effect rounded-3xl border border-accent/30 p-6 shadow-lg">
        <h2 className="text-foreground mb-4 text-xl font-semibold">Use-Case-Einreichungen</h2>
        {useCases.length === 0 ? (
          <div className="text-muted-foreground">Keine Einreichungen.</div>
        ) : (
          <ul className="space-y-4">
            {useCases.map((u) => (
              <li key={u.id} className="rounded-2xl border border-accent/20 bg-background/40 p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">
                    {u.useCaseTitle}
                    {u.attemptNumber ? <span className="ml-2 text-xs rounded-full border border-accent/30 px-2 py-0.5">Versuch {u.attemptNumber}</span> : null}
                  </div>
                  {statusPill(u.status)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Eingereicht am {new Date(u.submittedAt).toLocaleString()}</div>
                <div className="mt-2 rounded-xl border border-accent/20 bg-background/30 p-3">
                  <div className="text-xs font-medium text-muted-foreground">Feedback</div>
                  {u.trainerFeedback ? (
                    <div className="text-sm whitespace-pre-wrap">{u.trainerFeedback}</div>
                  ) : (
                    <div className="text-xs italic text-muted-foreground">{u.status === 'PENDING' ? 'Noch in Prüfung…' : 'Kein individuelles Feedback vorhanden.'}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Lesson quiz results */}
      <div className="glass-effect rounded-3xl border border-accent/30 p-6 shadow-lg">
        <h2 className="text-foreground mb-4 text-xl font-semibold">Lesson-Quiz Ergebnisse</h2>
        {quizzes.length === 0 ? (
          <div className="text-muted-foreground">Keine Ergebnisse.</div>
        ) : (
          <ul className="space-y-4">
            {quizzes.map((q) => (
              <li key={q.id} className="rounded-2xl border border-accent/20 bg-background/40 p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">
                    {q.enablerTitle}
                    {q.attemptNumber ? <span className="ml-2 text-xs rounded-full border border-accent/30 px-2 py-0.5">Versuch {q.attemptNumber}</span> : null}
                  </div>
                  <div className="inline-flex items-center gap-2 text-sm"><Award className="h-4 w-4"/> {q.score ?? 0}%</div>
                </div>
                <div className="text-xs text-muted-foreground mt-1">Abgegeben am {new Date(q.submittedAt).toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Quiz: {q.quizTitle}</div>
                <div className="mt-2 rounded-xl border border-accent/20 bg-background/30 p-3">
                  <div className="text-xs font-medium text-muted-foreground">Feedback</div>
                  {q.trainerFeedback ? (
                    <div className="text-sm whitespace-pre-wrap">{q.trainerFeedback}</div>
                  ) : (
                    <div className="text-xs italic text-muted-foreground">Noch in Prüfung…</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Global quiz results */}
      <div className="glass-effect rounded-3xl border border-accent/30 p-6 shadow-lg">
        <h2 className="text-foreground mb-4 text-xl font-semibold">Global-Quiz Ergebnisse</h2>
        {globalQuizzes.length === 0 ? (
          <div className="text-muted-foreground">Keine Ergebnisse.</div>
        ) : (
          <ul className="space-y-4">
            {globalQuizzes.map((q) => (
              <li key={q.id} className="rounded-2xl border border-accent/20 bg-background/40 p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">
                    {q.quizTitle}
                    {q.attemptNumber ? <span className="ml-2 text-xs rounded-full border border-accent/30 px-2 py-0.5">Versuch {q.attemptNumber}</span> : null}
                  </div>
                  <div className="inline-flex items-center gap-2 text-sm"><Award className="h-4 w-4"/> {q.score ?? 0}%</div>
                </div>
                <div className="text-xs text-muted-foreground mt-1">Abgegeben am {new Date(q.submittedAt).toLocaleString()}</div>
                <div className="mt-2 rounded-xl border border-accent/20 bg-background/30 p-3">
                  <div className="text-xs font-medium text-muted-foreground">Feedback</div>
                  {q.trainerFeedback ? (
                    <div className="text-sm whitespace-pre-wrap">{q.trainerFeedback}</div>
                  ) : (
                    <div className="text-xs italic text-muted-foreground">Noch in Prüfung…</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
