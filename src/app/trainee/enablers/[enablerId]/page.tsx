'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import LinkifyText from '@/components/ui/LinkifyText';
import { FlipbookViewer, useFlipbookViewer } from '@/components/ui/FlipbookViewer';
import { BookOpen } from 'lucide-react';

// Types
type Difficulty = 'LOW' | 'MEDIUM' | 'HIGH';
type QuizOption = { id: string; optionText: string; explanation?: string | null };
type QuizQuestion = { id: string; questionText: string; questionType?: 'MCQ' | 'TEXT'; options: QuizOption[] };
type QuizContent = { quizId: string; title: string; questions: QuizQuestion[] };
type QuizFeedback = { questionId: string; correct: boolean; correctOptionId?: string | null; selectedOptionId?: string | null; selectedText?: string | null; correctAnswerText?: string | null; explanation?: string | null };
type GatedQuizInfo = { difficulty: Difficulty; quizId?: string; title?: string; unlocked: boolean; isActive?: boolean; completed?: boolean };

export default function TraineeEnablerPage() {
  const { profile } = useAuth();
  const params = useParams();
  const enablerId = params?.enablerId as string | undefined;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enabler, setEnabler] = useState<any | null>(null);
  const [solutionText, setSolutionText] = useState('');
  const [solutions, setSolutions] = useState<Array<{ scenarioIndex: number; text: string }>>([]);
  const [currentScenarioIndex, setCurrentScenarioIndex] = useState(0);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // PDF flipbook viewer
  const flipbook = useFlipbookViewer();

  // Content documents (PDFs)
  const [documents, setDocuments] = useState<Array<{ id: string; title: string; storageUrl: string; documentType: string }>>([]);

  const [gated, setGated] = useState<GatedQuizInfo[]>([]);
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty | null>(null);
  const [quizContent, setQuizContent] = useState<QuizContent | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [result, setResult] = useState<{ score: number; feedback: QuizFeedback[] } | null>(null);
  const [reviewMode, setReviewMode] = useState(false);

  const currentQuestion = useMemo(() => (quizContent ? quizContent.questions[currentIndex] : null), [quizContent, currentIndex]);

  // Initial load: enabler details + gated quizzes list
  useEffect(() => {
    if (!profile?.id || !enablerId) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        // Enabler details (reuse trainer GET which doesn't require trainerId)
        const er = await fetch(`/api/trainer/enablers/${enablerId}`, { cache: 'no-store' });
        if (er.ok) {
          const ej = await er.json();
          const enablerData = ej.enabler || null;
          setEnabler(enablerData);
          // Initialize solutions array based on scenarios count
          if (enablerData && Array.isArray(enablerData.scenarios) && enablerData.scenarios.length > 0) {
            setSolutions(enablerData.scenarios.map((_: any, idx: number) => ({ scenarioIndex: idx, text: '' })));
          } else if (enablerData?.scenarioText) {
            // Legacy: single scenario
            setSolutions([{ scenarioIndex: 0, text: '' }]);
          }
        }
        // Gated quiz list
        const qr = await fetch(`/api/trainee/enablers/${enablerId}/quizzes?traineeId=${profile.id}`, { cache: 'no-store' });
        if (qr.ok) {
          const qj = await qr.json();
          const list: GatedQuizInfo[] = (qj.quizzes || []) as GatedQuizInfo[];
          const order: Difficulty[] = ['LOW', 'MEDIUM', 'HIGH'];
          setGated(order.map(d => list.find(x => x.difficulty === d) || { difficulty: d, unlocked: false }));
        } else {
          setGated([]);
        }

        // Fetch content documents (PDFs)
        try {
          const dr = await fetch(`/api/trainer/enablers/${enablerId}/documents`, { cache: 'no-store' });
          if (dr.ok) {
            const dj = await dr.json();
            setDocuments(dj.documents || []);
          }
        } catch { /* ignore document errors */ }
      } catch (e: any) {
        setError(e?.message || 'Fehler beim Laden');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [profile?.id, enablerId]);

  const loadQuizContent = async (difficulty: Difficulty) => {
    if (!profile?.id || !enablerId) return;
    setError(null);
    setResult(null);
    setAnswers({});
    setCurrentIndex(0);
    try {
      const r = await fetch(`/api/trainee/enablers/${enablerId}/quizzes/${difficulty}?traineeId=${profile.id}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('Quiz konnte nicht geladen werden');
      const j = await r.json();
      const qc: QuizContent = {
        quizId: String(j.quiz?.id || j.quizId),
        title: String(j.quiz?.title || j.title || `${difficulty} Quiz`),
        questions: (j.quiz?.questions || j.questions || []).map((q: any) => ({
          id: String(q.id),
          questionText: String(q.questionText || q.question),
          questionType: (q.questionType as any) || 'MCQ',
          options: (q.options || []).map((o: any) => ({
            id: String(o.id),
            optionText: String(o.optionText || o.text || o.value),
            explanation: o.explanation ? String(o.explanation) : null,
          })),
        })),
      };
      setSelectedDifficulty(difficulty);
      setQuizContent(qc);
    } catch (e: any) {
      setError(e?.message || 'Unbekannter Fehler');
    }
  };

  const handleTileClick = async (g: GatedQuizInfo) => {
    if (!g.quizId) return;
    setReviewMode(!!g.completed);
    await loadQuizContent(g.difficulty);
    // If already completed, fetch stored submission for review-only mode
    if (g.completed && profile?.id) {
      try {
        const vr = await fetch(`/api/trainee/quizzes/${g.quizId}/submit?traineeId=${profile.id}`, { cache: 'no-store' });
        if (vr.ok) {
          const vj = await vr.json();
          // Map selected answers for showing "Deine Antwort"
          if (Array.isArray(vj.feedback)) {
            const ans: Record<string, string> = {};
            vj.feedback.forEach((f: any) => {
              if (f.selectedOptionId) ans[String(f.questionId)] = String(f.selectedOptionId);
              if (!f.selectedOptionId && f.selectedText) ans[String(f.questionId)] = String(f.selectedText);
            });
            setAnswers(ans);
          }
          setResult({ score: Number(vj.score || 0), feedback: (vj.feedback || []) as QuizFeedback[] });
        }
      } catch {
        // ignore
      }
    }
  };

  const submitQuiz = async () => {
    if (!profile?.id || !quizContent?.quizId) return setError('Profil oder Quiz-ID fehlt');
    // Build answers payload including text answers
    const payloadAnswers = quizContent.questions.map(q => {
      const val = answers[q.id];
      if (q.questionType === 'TEXT' || q.options.length === 0) {
        return { questionId: q.id, textAnswer: val || '' };
      } else {
        return { questionId: q.id, selectedOptionId: val || '' };
      }
    });
    const payload = {
      traineeId: profile.id,
      answers: payloadAnswers,
    };
    try {
      const r = await fetch(`/api/trainee/quizzes/${quizContent.quizId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error('Abgabe fehlgeschlagen');
      const data = await r.json();
      setResult({ score: Number(data.score || 0), feedback: (data.feedback || []) as QuizFeedback[] });
      // Refresh gated list to reflect unlocking next level
      try {
        const gr2 = await fetch(`/api/trainee/enablers/${enablerId}/quizzes?traineeId=${profile.id}`, { cache: 'no-store' });
        if (gr2.ok) {
          const gj2 = await gr2.json();
          const list2: GatedQuizInfo[] = (gj2.quizzes || gj2.list || []) as GatedQuizInfo[];
          const order: Difficulty[] = ['LOW', 'MEDIUM', 'HIGH'];
          setGated(order.map(d => list2.find(x => x.difficulty === d) || { difficulty: d, unlocked: false }));
        }
      } catch {
        // ignore refresh errors
      }
    } catch (e: any) {
      setError(e?.message || 'Unbekannter Fehler');
    }
  };

  const submitSolution = async () => {
    if (!profile?.id || !enablerId) return setError('Profil fehlt');
    setSaveSuccess(null);
    try {
      // Filter out empty solutions and send only filled ones
      const filledSolutions = solutions.filter(s => s.text.trim().length > 0);
      const r = await fetch(`/api/trainee/enablers/${enablerId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          traineeId: profile.id,
          solutions: filledSolutions.length > 0 ? filledSolutions : undefined,
          solutionText: filledSolutions.length === 1 ? filledSolutions[0].text : undefined // Backward compat
        }),
      });
      if (!r.ok) throw new Error('Abgabe fehlgeschlagen');
      setSaveSuccess('Lösung gespeichert. Status: Ausstehend');
    } catch (e: any) {
      setError(e?.message || 'Unbekannter Fehler');
    }
  };

  const difficultyLabel = (d: Difficulty) => (d === 'LOW' ? 'Niedrig' : d === 'MEDIUM' ? 'Mittel' : 'Hoch');

  if (!profile) return <div className="p-6">Bitte anmelden…</div>;
  if (loading) return <div className="p-6">Lade…</div>;
  if (error) return <div className="p-6 text-red-500">{error}</div>;
  if (!enabler) return <div className="p-6">Nicht gefunden</div>;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {/* Enabler header */}
      <div className="rounded-3xl border border-accent/30 bg-black/30 p-5">
        <h1 className="text-foreground text-2xl font-bold">{enabler.title}</h1>
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
        <div className="mt-3">
          {enabler.descriptionText && (
            <LinkifyText className="text-muted-foreground mt-2" text={String(enabler.descriptionText)} preserveLineBreaks />
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          {/* PDF Documents from content_documents table */}
          {documents.map((doc) => (
            <button
              key={doc.id}
              onClick={() => flipbook.openPdf(doc.title, doc.storageUrl)}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-red-700 px-4 py-2 text-sm font-medium text-white hover:from-red-500 hover:to-red-600 transition-all shadow-lg"
            >
              <BookOpen className="h-4 w-4" />
              📖 {doc.title}
            </button>
          ))}
          {enabler.videoUrl && (
            <a className="rounded-xl border border-accent/30 px-3 py-1.5 text-sm hover:bg-background/60" href={enabler.videoUrl} target="_blank" rel="noreferrer">Video ansehen</a>
          )}
          {enabler.pptUrl && (
            <a className="rounded-xl border border-accent/30 px-3 py-1.5 text-sm hover:bg-background/60" href={enabler.pptUrl} target="_blank" rel="noreferrer">PPT öffnen</a>
          )}
        </div>

        {/* PDF Flipbook Viewer Modal */}
        <FlipbookViewer
          title={flipbook.title}
          pdfUrl={flipbook.pdfUrl}
          isOpen={flipbook.isOpen}
          onClose={flipbook.closePdf}
        />

        {/* Scenarios Slider */}
        {((Array.isArray(enabler.scenarios) && enabler.scenarios.length > 0) || enabler.scenarioText) && (
          <div className="mt-4">
            {/* Counter */}
            {Array.isArray(enabler.scenarios) && enabler.scenarios.length > 1 && (
              <div className="mb-3 text-center">
                <span className="text-sm font-medium text-foreground">
                  Szenario {currentScenarioIndex + 1} von {enabler.scenarios.length}
                </span>
              </div>
            )}

            {/* Slider Container */}
            <div className="relative overflow-hidden rounded-xl border border-accent/20 bg-black/20 p-4">
              <div
                className="flex transition-transform duration-300 ease-in-out"
                style={{ transform: `translateX(-${currentScenarioIndex * 100}%)` }}
              >
                {Array.isArray(enabler.scenarios) && enabler.scenarios.length > 0 ? (
                  enabler.scenarios.map((sc: any, idx: number) => (
                    <div key={idx} className="w-full flex-shrink-0 space-y-3 px-2">
                      <div>
                        <div className="mb-1 text-sm font-semibold">Szenario {idx + 1}</div>
                        <LinkifyText className="text-foreground/90" text={String(sc.text || '')} preserveLineBreaks />
                      </div>
                      {sc.hint && (
                        <div className="rounded-lg border border-accent/20 bg-black/10 p-3">
                          <div className="mb-1 text-xs font-semibold text-muted-foreground">Hinweis</div>
                          <LinkifyText className="text-muted-foreground text-sm" text={String(sc.hint)} preserveLineBreaks />
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="w-full flex-shrink-0 space-y-3 px-2">
                    <div>
                      <div className="mb-1 text-sm font-semibold">Szenario</div>
                      <LinkifyText className="text-foreground/90" text={String(enabler.scenarioText || '')} preserveLineBreaks />
                    </div>
                    {enabler.hintText && (
                      <div className="rounded-lg border border-accent/20 bg-black/10 p-3">
                        <div className="mb-1 text-xs font-semibold text-muted-foreground">Hinweis</div>
                        <LinkifyText className="text-muted-foreground text-sm" text={String(enabler.hintText)} preserveLineBreaks />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Navigation for multiple scenarios */}
            {Array.isArray(enabler.scenarios) && enabler.scenarios.length > 1 && (
              <div className="mt-3 flex items-center justify-between">
                <button
                  type="button"
                  disabled={currentScenarioIndex === 0}
                  onClick={() => setCurrentScenarioIndex(i => Math.max(0, i - 1))}
                  className="rounded-md border border-accent/30 px-3 py-1 text-xs hover:bg-accent/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ← Zurück
                </button>

                <div className="flex items-center gap-2">
                  {enabler.scenarios.map((_: any, idx: number) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setCurrentScenarioIndex(idx)}
                      className={`h-2 rounded-full transition-all ${idx === currentScenarioIndex
                        ? 'w-6 bg-primary'
                        : 'w-2 bg-accent/30 hover:bg-accent/50'
                        }`}
                      aria-label={`Go to scenario ${idx + 1}`}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  disabled={currentScenarioIndex === enabler.scenarios.length - 1}
                  onClick={() => setCurrentScenarioIndex(i => Math.min(enabler.scenarios.length - 1, i + 1))}
                  className="rounded-md border border-accent/30 px-3 py-1 text-xs hover:bg-accent/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Weiter →
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Solution Slider */}
      <div className="space-y-4 rounded-3xl border border-accent/30 bg-black/30 p-5">
        {saveSuccess && <div className="rounded-md border border-green-500/40 bg-green-500/10 p-2 text-sm text-green-300">{saveSuccess}</div>}

        <div className="mb-2 text-lg font-semibold">Deine Lösungen</div>

        {solutions.length > 0 && (
          <>
            {/* Counter */}
            {solutions.length > 1 && (
              <div className="mb-3 text-center">
                <span className="text-sm font-medium text-foreground">
                  Lösung für Szenario {currentScenarioIndex + 1} von {solutions.length}
                </span>
              </div>
            )}

            {/* Solution Slider */}
            <div className="relative overflow-hidden rounded-xl border border-accent/20 bg-black/20 p-4">
              <div
                className="flex transition-transform duration-300 ease-in-out"
                style={{ transform: `translateX(-${currentScenarioIndex * 100}%)` }}
              >
                {solutions.map((sol, idx) => (
                  <div key={idx} className="w-full flex-shrink-0 px-2">
                    <label className="mb-1 block text-sm font-medium">Deine Lösung für Szenario {idx + 1}</label>
                    <textarea
                      value={sol.text}
                      onChange={e => {
                        const newSolutions = [...solutions];
                        newSolutions[idx] = { ...newSolutions[idx], text: e.target.value };
                        setSolutions(newSolutions);
                      }}
                      className="w-full rounded-xl border border-accent/30 bg-black/30 px-3 py-2"
                      rows={6}
                      placeholder="Beschreibe deine Lösung..."
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Navigation for multiple solutions */}
            {solutions.length > 1 && (
              <div className="mt-3 flex items-center justify-between">
                <button
                  type="button"
                  disabled={currentScenarioIndex === 0}
                  onClick={() => setCurrentScenarioIndex(i => Math.max(0, i - 1))}
                  className="rounded-md border border-accent/30 px-3 py-1 text-xs hover:bg-accent/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ← Zurück
                </button>

                <div className="flex items-center gap-2">
                  {solutions.map((_, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setCurrentScenarioIndex(idx)}
                      className={`h-2 rounded-full transition-all ${idx === currentScenarioIndex
                        ? 'w-6 bg-primary'
                        : 'w-2 bg-accent/30 hover:bg-accent/50'
                        }`}
                      aria-label={`Go to solution ${idx + 1}`}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  disabled={currentScenarioIndex === solutions.length - 1}
                  onClick={() => setCurrentScenarioIndex(i => Math.min(solutions.length - 1, i + 1))}
                  className="rounded-md border border-accent/30 px-3 py-1 text-xs hover:bg-accent/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Weiter →
                </button>
              </div>
            )}
          </>
        )}

        <div className="flex justify-end">
          <button onClick={submitSolution} className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90">Alle Lösungen abgeben</button>
        </div>
      </div>

      {/* Gated difficulties */}
      <div className="rounded-3xl border border-accent/30 bg-black/30 p-5">
        <div className="mb-4 text-lg font-semibold">Enabler-Quiz (gestuft)</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {gated.map(g => {
            const disabled = !g.unlocked || !g.isActive || !g.quizId;
            return (
              <button
                key={g.difficulty}
                onClick={() => !disabled && handleTileClick(g)}
                className={`rounded-2xl border p-4 text-left transition ${disabled ? 'cursor-not-allowed border-accent/20 bg-black/20 opacity-60' : 'border-accent/30 bg-black/30 hover:bg-background/50'}`}
                disabled={disabled}
              >
                <div className="text-sm text-muted-foreground">Schwierigkeit</div>
                <div className="text-foreground text-xl font-bold">{difficultyLabel(g.difficulty)}</div>
                {g.title && <div className="mt-1 text-xs text-muted-foreground truncate">Titel: {g.title}</div>}
                <div className="mt-2 text-xs">
                  {g.completed ? (
                    <span className="rounded bg-green-600/20 px-2 py-0.5 text-green-300">Abgeschlossen</span>
                  ) : disabled ? (
                    <span className="rounded bg-muted/30 px-2 py-0.5">Gesperrt</span>
                  ) : (
                    <span className="rounded bg-blue-600/20 px-2 py-0.5 text-blue-300">Verfügbar</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Active quiz runner */}
        {quizContent && (
          <div className="mt-6 space-y-4 rounded-2xl border border-accent/20 bg-black/20 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-muted-foreground">Schwierigkeit</div>
                <div className="text-foreground text-lg font-semibold">{selectedDifficulty ? difficultyLabel(selectedDifficulty) : ''}</div>
              </div>
              <div className="text-sm text-muted-foreground">Frage {currentIndex + 1} / {quizContent.questions.length}</div>
            </div>

            {!result && !reviewMode ? (
              <div>
                {currentQuestion && (
                  <div className="space-y-3">
                    <div className="font-medium">{currentQuestion.questionText}</div>
                    <div className="space-y-2">
                      {(currentQuestion.questionType === 'TEXT' || currentQuestion.options.length === 0) ? (
                        <div>
                          <textarea
                            className="w-full rounded-xl border border-accent/20 bg-background/60 px-3 py-2"
                            rows={3}
                            placeholder="Antwort eingeben..."
                            value={answers[currentQuestion.id] || ''}
                            onChange={(e) => setAnswers(prev => ({ ...prev, [currentQuestion.id]: e.target.value }))}
                          />
                        </div>
                      ) : (
                        currentQuestion.options.map(o => (
                          <label key={o.id} className="flex items-center gap-2">
                            <input
                              type="radio"
                              name={`q-${currentQuestion.id}`}
                              checked={answers[currentQuestion.id] === String(o.id)}
                              onChange={() => setAnswers(prev => ({ ...prev, [currentQuestion.id]: String(o.id) }))}
                            />
                            <span>{o.optionText}</span>
                          </label>
                        ))
                      )}
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                      <button
                        className="rounded-md border border-accent/30 px-3 py-1.5 hover:bg-background/60 disabled:opacity-60"
                        onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
                        disabled={currentIndex === 0}
                      >
                        Zurück
                      </button>
                      {currentIndex < quizContent.questions.length - 1 ? (
                        <button
                          className="rounded-md border border-accent/30 px-3 py-1.5 hover:bg-background/60 disabled:opacity-60"
                          onClick={() => setCurrentIndex(i => Math.min(quizContent.questions.length - 1, i + 1))}
                          disabled={currentQuestion.questionType === 'TEXT' ? !String(answers[currentQuestion.id] || '').trim() : !answers[currentQuestion.id]}
                        >
                          Weiter
                        </button>
                      ) : (
                        <button
                          className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                          onClick={submitQuiz}
                          disabled={quizContent.questions.some(q => q.questionType === 'TEXT' ? !String(answers[q.id] || '').trim() : !answers[q.id])}
                        >
                          Quiz abgeben
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : reviewMode && !result ? (
              <div className="p-4 text-sm text-muted-foreground">Ergebnisse werden geladen…</div>
            ) : (
              <div className="space-y-3">
                <div className="font-medium">Score: {result?.score ?? 0}%</div>
                <ul className="space-y-2">
                  {quizContent.questions.map(q => {
                    const fb = result?.feedback.find(f => String(f.questionId) === String(q.id));
                    const chosen = answers[q.id];
                    const correctOption = q.options.find(o => String(o.id) === String(fb?.correctOptionId || ''));
                    const explanation = fb?.explanation || correctOption?.explanation;
                    return (
                      <li key={q.id} className={`rounded-xl border p-3 ${fb?.correct ? 'border-green-600/50 bg-green-500/10' : 'border-red-600/50 bg-red-500/10'}`}>
                        <div className="font-medium">{q.questionText}</div>
                        <div className="mt-1 text-sm">
                          Deine Antwort: {q.questionType === 'TEXT' || q.options.length === 0
                            ? (fb?.selectedText || chosen || '-')
                            : (q.options.find(o => String(o.id) === String(chosen))?.optionText || '-')}
                        </div>
                        {q.questionType !== 'TEXT' && !fb?.correct && (
                          <div className="mt-1 text-sm text-green-400">
                            Richtig: {correctOption?.optionText || '-'}
                          </div>
                        )}
                        {explanation && (
                          <div className="mt-2 rounded-md border border-accent/20 bg-black/30 p-2 text-xs text-muted-foreground">Erklärung: {explanation}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <button
                  className="rounded-md border border-accent/30 px-4 py-2 hover:bg-background/60"
                  onClick={async () => {
                    if (!quizContent?.quizId || !profile?.id) return;
                    try {
                      setReviewMode(true);
                      const vr = await fetch(`/api/trainee/quizzes/${quizContent.quizId}/submit?traineeId=${profile.id}`, { cache: 'no-store' });
                      if (vr.ok) {
                        const vj = await vr.json();
                        setResult({ score: Number(vj.score || 0), feedback: (vj.feedback || []) as QuizFeedback[] });
                      }
                    } catch {
                      // ignore
                    }
                  }}
                >
                  Nur ansehen (gesperrt)
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <Link href="/trainee/modules" className="text-sm underline">Zurück zu meinen Modulen</Link>
      </div>
    </div>
  );
}
