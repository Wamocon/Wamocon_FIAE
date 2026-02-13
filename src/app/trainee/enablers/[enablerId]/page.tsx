'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import LinkifyText from '@/components/ui/LinkifyText';
import dynamic from 'next/dynamic';
const MarkdownText = dynamic(
  () =>
    import('@/components/ui/MarkdownText').then(mod => ({
      default: mod.MarkdownText,
    })),
  { ssr: false }
);
import {
  FlipbookViewer,
  useFlipbookViewer,
} from '@/components/ui/FlipbookViewer';
import { ScenarioViewer } from '@/components/learning/ScenarioViewer';
import { BookOpen, CheckCircle, Clock, AlertCircle } from 'lucide-react';

// Types
type Difficulty = 'LOW' | 'MEDIUM' | 'HIGH';
type QuizOption = {
  id: string;
  optionText: string;
  explanation?: string | null;
};
type QuizQuestion = {
  id: string;
  questionText: string;
  questionType?: 'MCQ' | 'TEXT';
  options: QuizOption[];
};
type QuizContent = { quizId: string; title: string; questions: QuizQuestion[] };
type QuizFeedback = {
  questionId: string;
  correct: boolean;
  correctOptionId?: string | null;
  selectedOptionId?: string | null;
  selectedText?: string | null;
  correctAnswerText?: string | null;
  explanation?: string | null;
};
type GatedQuizInfo = {
  difficulty: Difficulty;
  quizId?: string;
  title?: string;
  unlocked: boolean;
  isActive?: boolean;
  completed?: boolean;
};

export default function TraineeEnablerPage() {
  const { profile } = useAuth();
  const { t } = useLanguage();
  const params = useParams();
  const enablerId = params?.enablerId as string | undefined;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enabler, setEnabler] = useState<any | null>(null);
  const [solutionText, setSolutionText] = useState('');
  const [solutions, setSolutions] = useState<
    Array<{ scenarioIndex: number; text: string }>
  >([]);
  const [currentScenarioIndex, setCurrentScenarioIndex] = useState(0);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Submission state for edit/status tracking
  const [submission, setSubmission] = useState<{
    id: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    trainerFeedback?: string | null;
    feedbacks?: Array<{ scenarioIndex: number; feedback: string }> | null;
  } | null>(null);

  // Determine if editing is allowed
  const canEdit = !submission || submission.status === 'REJECTED';

  // PDF flipbook viewer
  const flipbook = useFlipbookViewer();

  // Content documents (PDFs)
  const [documents, setDocuments] = useState<
    Array<{
      id: string;
      title: string;
      storageUrl: string;
      documentType: string;
    }>
  >([]);

  const [gated, setGated] = useState<GatedQuizInfo[]>([]);
  const [selectedDifficulty, setSelectedDifficulty] =
    useState<Difficulty | null>(null);
  const [quizContent, setQuizContent] = useState<QuizContent | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [result, setResult] = useState<{
    score: number;
    feedback: QuizFeedback[];
  } | null>(null);
  const [reviewMode, setReviewMode] = useState(false);

  const currentQuestion = useMemo(
    () => (quizContent ? quizContent.questions[currentIndex] : null),
    [quizContent, currentIndex]
  );

  // Initial load: enabler details + gated quizzes list + submission status
  useEffect(() => {
    if (!profile?.id || !enablerId) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        // Enabler details (use trainee-facing GET which includes submission info)
        const er = await fetch(
          `/api/trainee/enablers/${enablerId}?traineeId=${profile.id}`,
          { cache: 'no-store' }
        );
        if (er.ok) {
          const ej = await er.json();
          const enablerData = ej.enabler || null;
          const submissionData = ej.submission || null;

          setEnabler(enablerData);

          // Initialize solutions from submission if available, else empty
          if (
            enablerData &&
            Array.isArray(enablerData.scenarios) &&
            enablerData.scenarios.length > 0
          ) {
            const initialSolutions = enablerData.scenarios.map(
              (_: any, idx: number) => {
                const existing = submissionData?.solutions?.find(
                  (s: any) => s.scenarioIndex === idx
                );
                return { scenarioIndex: idx, text: existing?.text || '' };
              }
            );
            setSolutions(initialSolutions);
          } else if (enablerData?.scenarioText) {
            setSolutions([
              { scenarioIndex: 0, text: submissionData?.solutionText || '' },
            ]);
          }
        }

        // Fetch trainee submission status (with feedback for rejected submissions)
        try {
          const subRes = await fetch(
            `/api/trainee/enablers/${enablerId}?traineeId=${profile.id}`,
            { cache: 'no-store' }
          );
          if (subRes.ok) {
            const subData = await subRes.json();
            if (subData.submission) {
              setSubmission({
                id: subData.submission.id,
                status: subData.submission.status,
                trainerFeedback: subData.submission.trainerFeedback,
                feedbacks: subData.submission.feedbacks,
              });
              // Pre-fill solutions from existing submission
              if (
                subData.submission.solutions &&
                Array.isArray(subData.submission.solutions)
              ) {
                setSolutions(subData.submission.solutions);
              } else if (subData.submission.solutionText) {
                setSolutions([
                  { scenarioIndex: 0, text: subData.submission.solutionText },
                ]);
              }
            }
          }
        } catch {
          /* ignore */
        }

        // Gated quiz list
        const qr = await fetch(
          `/api/trainee/enablers/${enablerId}/quizzes?traineeId=${profile.id}`,
          { cache: 'no-store' }
        );
        if (qr.ok) {
          const qj = await qr.json();
          const list: GatedQuizInfo[] = (qj.quizzes || []) as GatedQuizInfo[];
          const order: Difficulty[] = ['LOW', 'MEDIUM', 'HIGH'];
          setGated(
            order.map(
              d =>
                list.find(x => x.difficulty === d) || {
                  difficulty: d,
                  unlocked: false,
                }
            )
          );
        } else {
          setGated([]);
        }

        // Fetch content documents (PDFs)
        try {
          const dr = await fetch(
            `/api/trainer/enablers/${enablerId}/documents`,
            { cache: 'no-store' }
          );
          if (dr.ok) {
            const dj = await dr.json();
            setDocuments(dj.documents || []);
          }
        } catch {
          /* ignore document errors */
        }
      } catch (e: any) {
        setError(e?.message || t('enablerPage.loadError'));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [profile?.id, enablerId, t]);

  const loadQuizContent = async (difficulty: Difficulty) => {
    if (!profile?.id || !enablerId) return;
    setError(null);
    setResult(null);
    setAnswers({});
    setCurrentIndex(0);
    try {
      const r = await fetch(
        `/api/trainee/enablers/${enablerId}/quizzes/${difficulty}?traineeId=${profile.id}`,
        { cache: 'no-store' }
      );
      if (!r.ok) throw new Error(t('enablerPage.quizLoadError'));
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
      setError(e?.message || t('error.unknown'));
    }
  };

  const handleTileClick = async (g: GatedQuizInfo) => {
    if (!g.quizId) return;
    setReviewMode(!!g.completed);
    await loadQuizContent(g.difficulty);
    // If already completed, fetch stored submission for review-only mode
    if (g.completed && profile?.id) {
      try {
        const vr = await fetch(
          `/api/trainee/quizzes/${g.quizId}/submit?traineeId=${profile.id}`,
          { cache: 'no-store' }
        );
        if (vr.ok) {
          const vj = await vr.json();
          // Map selected answers for showing "Deine Antwort"
          if (Array.isArray(vj.feedback)) {
            const ans: Record<string, string> = {};
            vj.feedback.forEach((f: any) => {
              if (f.selectedOptionId)
                ans[String(f.questionId)] = String(f.selectedOptionId);
              if (!f.selectedOptionId && f.selectedText)
                ans[String(f.questionId)] = String(f.selectedText);
            });
            setAnswers(ans);
          }
          setResult({
            score: Number(vj.score || 0),
            feedback: (vj.feedback || []) as QuizFeedback[],
          });
        }
      } catch {
        // ignore
      }
    }
  };

  const submitQuiz = async () => {
    if (!profile?.id || !quizContent?.quizId)
      return setError(t('enablerPage.missingProfile'));
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
      const r = await fetch(
        `/api/trainee/quizzes/${quizContent.quizId}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (!r.ok) throw new Error(t('enablerPage.submissionFailed'));
      const data = await r.json();
      setResult({
        score: Number(data.score || 0),
        feedback: (data.feedback || []) as QuizFeedback[],
      });
      // Refresh gated list to reflect unlocking next level
      try {
        const gr2 = await fetch(
          `/api/trainee/enablers/${enablerId}/quizzes?traineeId=${profile.id}`,
          { cache: 'no-store' }
        );
        if (gr2.ok) {
          const gj2 = await gr2.json();
          const list2: GatedQuizInfo[] = (gj2.quizzes ||
            gj2.list ||
            []) as GatedQuizInfo[];
          const order: Difficulty[] = ['LOW', 'MEDIUM', 'HIGH'];
          setGated(
            order.map(
              d =>
                list2.find(x => x.difficulty === d) || {
                  difficulty: d,
                  unlocked: false,
                }
            )
          );
        }
      } catch {
        // ignore refresh errors
      }
    } catch (e: any) {
      setError(e?.message || t('error.unknown'));
    }
  };

  const submitSolution = async () => {
    if (!profile?.id || !enablerId)
      return setError(t('enablerPage.profileMissing'));
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
          solutionText:
            filledSolutions.length === 1 ? filledSolutions[0].text : undefined, // Backward compat
        }),
      });
      if (!r.ok) throw new Error(t('enablerPage.submissionFailed'));
      setSaveSuccess(t('enablerPage.solutionSaved'));
    } catch (e: any) {
      setError(e?.message || t('error.unknown'));
    }
  };

  const difficultyLabel = (d: Difficulty) =>
    d === 'LOW'
      ? t('enablerPage.difficultyLow')
      : d === 'MEDIUM'
        ? t('enablerPage.difficultyMedium')
        : t('enablerPage.difficultyHigh');

  if (!profile)
    return <div className="p-6">{t('enablerPage.pleaseLogin')}</div>;
  if (loading) return <div className="p-6">{t('common.loading')}</div>;
  if (error) return <div className="p-6 text-red-500">{error}</div>;
  if (!enabler) return <div className="p-6">{t('enablerPage.notFound')}</div>;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {/* Enabler header */}
      <div className="border-accent/30 bg-background rounded-3xl border p-5">
        <h1 className="text-foreground text-2xl font-bold">{enabler.title}</h1>
        {enabler.isActive && enabler.durationValue && enabler.activatedAt && (
          <div className="mt-3 text-sm">
            {(() => {
              const started = new Date(enabler.activatedAt as string).getTime();
              const now = Date.now();
              const daysElapsed = Math.floor(
                (now - started) / (1000 * 60 * 60 * 24)
              );
              const total = Number(enabler.durationValue || 0);
              const left = Math.max(0, total - daysElapsed);
              const dueDate = new Date(started + total * 24 * 60 * 60 * 1000);
              return (
                <span>
                  {t('enablerPage.timeRemaining')
                    .replace('{days}', String(left))
                    .replace('{date}', dueDate.toLocaleDateString())}
                </span>
              );
            })()}
          </div>
        )}
        <div className="mt-3">
          {enabler.descriptionText && (
            <LinkifyText
              className="text-muted-foreground mt-2"
              text={String(enabler.descriptionText)}
              preserveLineBreaks
            />
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          {/* PDF Documents from content_documents table */}
          {documents.map(doc => (
            <button
              key={doc.id}
              onClick={() => flipbook.openPdf(doc.title, doc.storageUrl)}
              className="max-w bg-primary text-primary-foreground hover:bg-primary/90 flex rounded-md px-2 py-2"
            >
              <div className="max-w flex px-2 py-1">
                <BookOpen className="h-4 w-4" />
              </div>
              <div> {doc.title}</div>
            </button>
          ))}
          {enabler.videoUrl && (
            <a
              className="border-accent/30 hover:bg-background/60 rounded-xl border px-3 py-1.5 text-sm"
              href={enabler.videoUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t('enablerPage.watchVideo')}
            </a>
          )}
          {enabler.pptUrl && (
            <a
              className="border-accent/30 hover:bg-background/60 rounded-xl border px-3 py-1.5 text-sm"
              href={enabler.pptUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t('enablerPage.openPpt')}
            </a>
          )}
        </div>

        {/* PDF Flipbook Viewer Modal */}
        <FlipbookViewer
          title={flipbook.title}
          pdfUrl={flipbook.pdfUrl}
          isOpen={flipbook.isOpen}
          onClose={flipbook.closePdf}
        />

        {/* Scenarios Section - Redesigned with structured sections */}
        {profile?.id &&
          enablerId &&
          ((Array.isArray(enabler.scenarios) && enabler.scenarios.length > 0) ||
            enabler.scenarioText) && (
            <div className="mt-4">
              <ScenarioViewer
                scenarios={enabler.scenarios || []}
                currentIndex={currentScenarioIndex}
                onIndexChange={setCurrentScenarioIndex}
                scenarioText={enabler.scenarioText}
                hintText={enabler.hintText}
                initialAnswers={solutions}
                traineeId={profile.id}
                enablerId={enablerId}
              />
            </div>
          )}
      </div>

      {/* Status Banner */}
      {submission?.status === 'APPROVED' && (
        <div className="flex items-start gap-3 rounded-2xl border border-green-500/40 bg-green-500/10 p-4">
          <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
          <div>
            <div className="font-semibold text-green-600 dark:text-green-400">
              {t('enablerPage.approved')}
            </div>
            <div className="text-sm text-green-600/80 dark:text-green-400/80">
              {t('enablerPage.approvedDesc')}
            </div>
          </div>
        </div>
      )}

      {submission?.status === 'PENDING' && (
        <div className="flex items-start gap-3 rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-4">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-yellow-500" />
          <div>
            <div className="font-semibold text-yellow-600 dark:text-yellow-400">
              {t('enablerPage.pending')}
            </div>
            <div className="text-sm text-yellow-600/80 dark:text-yellow-400/80">
              {t('enablerPage.pendingDesc')}
            </div>
          </div>
        </div>
      )}

      {submission?.status === 'REJECTED' && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/40 bg-red-500/10 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <div className="flex-1">
            <div className="font-semibold text-red-600 dark:text-red-400">
              {t('enablerPage.rejected')}
            </div>
            <div className="mb-2 text-sm text-red-600/80 dark:text-red-400/80">
              {t('enablerPage.rejectedDesc')}
            </div>
            {/* Show general trainer feedback */}
            {submission.trainerFeedback && (
              <div className="mt-2 rounded-xl border border-red-500/20 bg-red-500/5 p-3">
                <div className="mb-1 text-xs font-medium text-red-600/70 dark:text-red-400/70">
                  {t('enablerPage.trainerFeedback')}
                </div>
                <p className="text-foreground text-sm whitespace-pre-line">
                  {submission.trainerFeedback}
                </p>
              </div>
            )}
            {/* Show per-scenario feedbacks */}
            {submission.feedbacks && submission.feedbacks.length > 0 && (
              <div className="mt-2 space-y-2">
                {submission.feedbacks.map((fb, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-red-500/20 bg-red-500/5 p-3"
                  >
                    <div className="mb-1 text-xs font-medium text-red-600/70 dark:text-red-400/70">
                      {t('enablerPage.feedbackForScenario').replace(
                        '{number}',
                        String(fb.scenarioIndex + 1)
                      )}
                    </div>
                    <p className="text-foreground text-sm whitespace-pre-line">
                      {fb.feedback}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Solution Slider */}
      <div className="border-accent/30 bg-background space-y-4 rounded-3xl border p-5">
        {saveSuccess && (
          <div className="rounded-md border border-green-500/40 bg-green-500/10 p-2 text-sm text-green-300">
            {saveSuccess}
          </div>
        )}

        <div className="mb-2 text-lg font-semibold">
          {t('enablerPage.yourSolutions')}
        </div>

        {solutions.length > 0 && (
          <>
            {/* Counter */}
            {solutions.length > 1 && (
              <div className="mb-3 text-center">
                <span className="text-foreground text-sm font-medium">
                  {t('enablerPage.solutionCounter')
                    .replace('{current}', String(currentScenarioIndex + 1))
                    .replace('{total}', String(solutions.length))}
                </span>
              </div>
            )}

            {/* Solution Slider */}
            <div className="border-accent/20 relative overflow-hidden rounded-xl border bg-black/20 p-4">
              <div
                className="flex transition-transform duration-300 ease-in-out"
                style={{
                  transform: `translateX(-${currentScenarioIndex * 100}%)`,
                }}
              >
                {solutions.map((sol, idx) => (
                  <div key={idx} className="w-full flex-shrink-0 px-2">
                    <label className="mb-1 block text-sm font-medium">
                      {t('enablerPage.yourSolutionFor').replace(
                        '{number}',
                        String(idx + 1)
                      )}
                    </label>
                    <textarea
                      value={sol.text}
                      onChange={e => {
                        if (!canEdit) return;
                        const newSolutions = [...solutions];
                        newSolutions[idx] = {
                          ...newSolutions[idx],
                          text: e.target.value,
                        };
                        setSolutions(newSolutions);
                      }}
                      className={`border-accent/30 w-full rounded-xl border bg-black/30 px-3 py-2 ${!canEdit ? 'cursor-not-allowed opacity-60' : ''}`}
                      rows={6}
                      placeholder={t('enablerPage.describeSolution')}
                      disabled={!canEdit}
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
                  onClick={() =>
                    setCurrentScenarioIndex(i => Math.max(0, i - 1))
                  }
                  className="border-accent/30 hover:bg-accent/10 rounded-md border px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('enablerPage.back')}
                </button>

                <div className="flex items-center gap-2">
                  {solutions.map((_, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setCurrentScenarioIndex(idx)}
                      className={`h-2 rounded-full transition-all ${
                        idx === currentScenarioIndex
                          ? 'bg-primary w-6'
                          : 'bg-accent/30 hover:bg-accent/50 w-2'
                      }`}
                      aria-label={`Go to solution ${idx + 1}`}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  disabled={currentScenarioIndex === solutions.length - 1}
                  onClick={() =>
                    setCurrentScenarioIndex(i =>
                      Math.min(solutions.length - 1, i + 1)
                    )
                  }
                  className="border-accent/30 hover:bg-accent/10 rounded-md border px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('enablerPage.next')}
                </button>
              </div>
            )}
          </>
        )}

        {canEdit && (
          <div className="flex justify-end">
            <button
              onClick={submitSolution}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2"
            >
              {submission?.status === 'REJECTED'
                ? t('enablerPage.resubmit')
                : t('enablerPage.submitAll')}
            </button>
          </div>
        )}
      </div>

      {/* Gated difficulties */}
      <div className="border-accent/30 bg-background rounded-3xl border p-5">
        <div className="mb-4 text-lg font-semibold">
          {t('enablerPage.gatedQuiz')}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {gated.map(g => {
            const disabled = !g.unlocked || !g.isActive || !g.quizId;
            return (
              <button
                key={g.difficulty}
                onClick={() => !disabled && handleTileClick(g)}
                className={`rounded-2xl border p-4 text-left transition-all duration-200 ${disabled ? 'border-accent/20 cursor-not-allowed bg-black/20 opacity-60' : 'border-accent/30 hover:bg-accent/15 hover:border-accent/60 hover:shadow-accent/20 cursor-pointer bg-black/30 hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]'}`}
                disabled={disabled}
              >
                <div className="text-muted-foreground text-sm">
                  {t('enablerPage.difficulty')}
                </div>
                <div className="text-foreground text-xl font-bold">
                  {difficultyLabel(g.difficulty)}
                </div>
                {g.title && (
                  <div className="text-muted-foreground mt-1 truncate text-xs">
                    {t('enablerPage.quizTitle')} {g.title}
                  </div>
                )}
                <div className="mt-2 text-xs">
                  {g.completed ? (
                    <span className="rounded bg-green-600/20 px-2 py-0.5 text-green-300">
                      {t('enablerPage.completed')}
                    </span>
                  ) : disabled ? (
                    <span className="bg-muted/30 rounded px-2 py-0.5">
                      {t('enablerPage.locked')}
                    </span>
                  ) : (
                    <span className="rounded bg-blue-600/20 px-2 py-0.5 text-blue-300">
                      {t('enablerPage.available')}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Active quiz runner */}
        {quizContent && (
          <div className="border-accent/20 mt-6 space-y-4 rounded-2xl border bg-black/20 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-muted-foreground text-sm">
                  {t('enablerPage.difficulty')}
                </div>
                <div className="text-foreground text-lg font-semibold">
                  {selectedDifficulty
                    ? difficultyLabel(selectedDifficulty)
                    : ''}
                </div>
              </div>
              <div className="text-muted-foreground text-sm">
                {t('enablerPage.questionCounter')
                  .replace('{current}', String(currentIndex + 1))
                  .replace('{total}', String(quizContent.questions.length))}
              </div>
            </div>

            {!result && !reviewMode ? (
              <div>
                {currentQuestion && (
                  <div className="space-y-3">
                    <MarkdownText className="font-medium">
                      {currentQuestion.questionText}
                    </MarkdownText>
                    <div className="space-y-2">
                      {currentQuestion.questionType === 'TEXT' ||
                      currentQuestion.options.length === 0 ? (
                        <div>
                          <textarea
                            className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                            rows={3}
                            placeholder={t('enablerPage.enterAnswer')}
                            value={answers[currentQuestion.id] || ''}
                            onChange={e =>
                              setAnswers(prev => ({
                                ...prev,
                                [currentQuestion.id]: e.target.value,
                              }))
                            }
                          />
                        </div>
                      ) : (
                        currentQuestion.options.map(o => (
                          <label key={o.id} className="flex items-center gap-2">
                            <input
                              type="radio"
                              name={`q-${currentQuestion.id}`}
                              checked={
                                answers[currentQuestion.id] === String(o.id)
                              }
                              onChange={() =>
                                setAnswers(prev => ({
                                  ...prev,
                                  [currentQuestion.id]: String(o.id),
                                }))
                              }
                            />
                            <MarkdownText inline>{o.optionText}</MarkdownText>
                          </label>
                        ))
                      )}
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                      <button
                        className="border-accent/30 hover:bg-background/60 rounded-md border px-3 py-1.5 disabled:opacity-60"
                        onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
                        disabled={currentIndex === 0}
                      >
                        {t('enablerPage.backShort')}
                      </button>
                      {currentIndex < quizContent.questions.length - 1 ? (
                        <button
                          className="border-accent/30 hover:bg-background/60 rounded-md border px-3 py-1.5 disabled:opacity-60"
                          onClick={() =>
                            setCurrentIndex(i =>
                              Math.min(quizContent.questions.length - 1, i + 1)
                            )
                          }
                          disabled={
                            currentQuestion.questionType === 'TEXT'
                              ? !String(
                                  answers[currentQuestion.id] || ''
                                ).trim()
                              : !answers[currentQuestion.id]
                          }
                        >
                          {t('enablerPage.nextShort')}
                        </button>
                      ) : (
                        <button
                          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 disabled:opacity-60"
                          onClick={submitQuiz}
                          disabled={quizContent.questions.some(q =>
                            q.questionType === 'TEXT'
                              ? !String(answers[q.id] || '').trim()
                              : !answers[q.id]
                          )}
                        >
                          {t('enablerPage.submitQuiz')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : reviewMode && !result ? (
              <div className="text-muted-foreground p-4 text-sm">
                {t('enablerPage.loadingResults')}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="font-medium">
                  {t('enablerPage.score')} {result?.score ?? 0}%
                </div>
                <ul className="space-y-2">
                  {quizContent.questions.map(q => {
                    const fb = result?.feedback.find(
                      f => String(f.questionId) === String(q.id)
                    );
                    const chosen = answers[q.id];
                    const correctOption = q.options.find(
                      o => String(o.id) === String(fb?.correctOptionId || '')
                    );
                    const explanation =
                      fb?.explanation || correctOption?.explanation;
                    return (
                      <li
                        key={q.id}
                        className={`rounded-xl border p-3 ${fb?.correct ? 'border-green-600/50 bg-green-500/10' : 'border-red-600/50 bg-red-500/10'}`}
                      >
                        <MarkdownText className="font-medium">
                          {q.questionText}
                        </MarkdownText>
                        <div
                          className={`mt-1 text-sm ${fb?.correct ? 'text-green-400' : 'text-red-400'}`}
                        >
                          {t('enablerPage.yourAnswer')}{' '}
                          {q.questionType === 'TEXT' || q.options.length === 0
                            ? fb?.selectedText || chosen || '-'
                            : q.options.find(
                                o => String(o.id) === String(chosen)
                              )?.optionText || '-'}
                        </div>
                        {q.questionType !== 'TEXT' && !fb?.correct && (
                          <div className="mt-1 text-sm text-green-400">
                            {t('enablerPage.correct')}{' '}
                            {correctOption?.optionText || '-'}
                          </div>
                        )}
                        {explanation && (
                          <div className="border-accent/20 text-muted-foreground mt-2 rounded-md border bg-black/30 p-2 text-xs">
                            {t('enablerPage.explanationLabel')} {explanation}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <button
                  className="border-accent/30 hover:bg-background/60 rounded-md border px-4 py-2"
                  onClick={async () => {
                    if (!quizContent?.quizId || !profile?.id) return;
                    try {
                      setReviewMode(true);
                      const vr = await fetch(
                        `/api/trainee/quizzes/${quizContent.quizId}/submit?traineeId=${profile.id}`,
                        { cache: 'no-store' }
                      );
                      if (vr.ok) {
                        const vj = await vr.json();
                        setResult({
                          score: Number(vj.score || 0),
                          feedback: (vj.feedback || []) as QuizFeedback[],
                        });
                      }
                    } catch {
                      // ignore
                    }
                  }}
                >
                  {t('enablerPage.viewOnly')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <Link href="/trainee/modules" className="text-sm underline">
          {t('enablerPage.backToModules')}
        </Link>
      </div>
    </div>
  );
}
