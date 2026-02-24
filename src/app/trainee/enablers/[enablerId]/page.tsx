'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
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
import { BookOpen, CheckCircle, Clock, AlertCircle, FileText, Layers } from 'lucide-react';

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

  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // API URLs
  const enablerUrl = profile?.id && enablerId ? `/api/trainee/enablers/${enablerId}?traineeId=${profile.id}` : null;
  const quizzesUrl = profile?.id && enablerId ? `/api/trainee/enablers/${enablerId}/quizzes?traineeId=${profile.id}` : null;
  const docsUrl = enablerId ? `/api/trainer/enablers/${enablerId}/documents` : null;

  // Data fetching via React Query
  type EnablerResponse = { enabler: any | null; submission: any | null };
  type QuizzesResponse = { quizzes: GatedQuizInfo[] };
  type DocsResponse = { documents: Array<{ id: string; title: string; storageUrl: string; documentType: string }> };

  const { data: enablerData, isLoading: loading, error: enablerError } = useApiQuery<EnablerResponse>(enablerUrl);
  const { data: quizzesData } = useApiQuery<QuizzesResponse>(quizzesUrl);
  const { data: docsData } = useApiQuery<DocsResponse>(docsUrl);

  const enabler = enablerData?.enabler || null;
  const documents = docsData?.documents || [];
  const gated = useMemo(() => {
    const list = quizzesData?.quizzes || [];
    const order: Difficulty[] = ['LOW', 'MEDIUM', 'HIGH'];
    return order.map(d => list.find(x => x.difficulty === d) || { difficulty: d, unlocked: false });
  }, [quizzesData]);

  // Form state
  const [solutions, setSolutions] = useState<
    Array<{ scenarioIndex: number; text: string }>
  >([]);
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

  // Sync form state (submission + solutions) from server data
  useEffect(() => {
    if (!enablerData) return;
    if (enablerData.submission) {
      setSubmission({
        id: enablerData.submission.id,
        status: enablerData.submission.status,
        trainerFeedback: enablerData.submission.trainerFeedback,
        feedbacks: enablerData.submission.feedbacks,
      });
      if (enablerData.submission.solutions && Array.isArray(enablerData.submission.solutions)) {
        setSolutions(enablerData.submission.solutions);
      } else if (enablerData.submission.solutionText) {
        setSolutions([{ scenarioIndex: 0, text: enablerData.submission.solutionText }]);
      }
    } else {
      setSolutions([{ scenarioIndex: 0, text: '' }]);
    }
  }, [enablerData]);

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
    setQuizLocked(!!g.completed);
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

  const [quizLocked, setQuizLocked] = useState(false);
  const [submittingQuiz, setSubmittingQuiz] = useState(false);

  const submitQuiz = async () => {
    if (submittingQuiz) return;
    if (!profile?.id || !quizContent?.quizId)
      return setError(t('enablerPage.missingProfile'));
    setSubmittingQuiz(true);
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

      // Handle locked response (quiz already submitted, single-attempt)
      if (data.locked) {
        setQuizLocked(true);
        // Map the stored selectedOptionId into answers for display
        if (Array.isArray(data.feedback)) {
          const storedAnswers: Record<string, string> = {};
          data.feedback.forEach((f: any) => {
            if (f.selectedOptionId)
              storedAnswers[String(f.questionId)] = String(f.selectedOptionId);
            if (!f.selectedOptionId && f.selectedText)
              storedAnswers[String(f.questionId)] = String(f.selectedText);
          });
          setAnswers(storedAnswers);
        }
      }

      setResult({
        score: Number(data.score || 0),
        feedback: (data.feedback || []) as QuizFeedback[],
      });
      // Refresh gated list to reflect unlocking next level
      if (quizzesUrl) queryClient.invalidateQueries({ queryKey: [quizzesUrl] });
    } catch (e: any) {
      setError(e?.message || t('error.unknown'));
    } finally {
      setSubmittingQuiz(false);
    }
  };

  const [savingSolution, setSavingSolution] = useState(false);

  const submitSolution = async () => {
    if (!profile?.id || !enablerId || savingSolution)
      return setError(t('enablerPage.profileMissing'));
    setSavingSolution(true);
    setSaveSuccess(null);
    setError(null);
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

      // Optimistically update to PENDING, then refetch from server
      setSubmission(prev => prev
        ? { ...prev, status: 'PENDING', trainerFeedback: null, feedbacks: null }
        : { id: '', status: 'PENDING' });
      if (enablerUrl) queryClient.invalidateQueries({ queryKey: [enablerUrl] });
    } catch (e: any) {
      setError(e?.message || t('error.unknown'));
    } finally {
      setSavingSolution(false);
    }
  };

  const difficultyLabel = (d: Difficulty) =>
    d === 'LOW'
      ? t('enablerPage.difficultyLow')
      : d === 'MEDIUM'
        ? t('enablerPage.difficultyMedium')
        : t('enablerPage.difficultyHigh');

  // Split documents into theory and scenario
  const theoryDocs = useMemo(
    () => documents.filter(d => d.documentType !== 'EXERCISE'),
    [documents]
  );
  const scenarioDocs = useMemo(
    () => {
      const exercises = documents.filter(d => d.documentType === 'EXERCISE');
      // Sort by extracted part number so display order is Part 1, 2, 3... regardless of upload order
      return exercises.sort((a, b) => {
        const partA = a.title.match(/Part\s*(\d+)/i);
        const partB = b.title.match(/Part\s*(\d+)/i);
        const numA = partA ? parseInt(partA[1], 10) : 9999;
        const numB = partB ? parseInt(partB[1], 10) : 9999;
        return numA - numB;
      });
    },
    [documents]
  );

  /** Clean up scenario document title for display */
  const formatScenarioLabel = (title: string): { part: number | null; label: string } => {
    let cleaned = title
      .replace(/^Szenario:\s*/i, '')       // Remove "Szenario: " prefix
      .replace(/^Szenarien[\s_]*/i, '')    // Remove "Szenarien_" prefix
      .replace(/^\d{10,}_/, '')             // Remove leading timestamp "1771857633602_"
      .replace(/_/g, ' ')                   // Replace underscores with spaces
      .replace(/\s*\bKORRIGIERT\b\s*/gi, '')
      .replace(/\s*\bKORR\b\s*/gi, '')
      .replace(/\s*\bBEARBEITET\b\s*/gi, '')
      .replace(/\s*\bNEU\b\s*/gi, '')
      .replace(/\s*\bREVIEW\d*\b\s*/gi, '')
      .replace(/\s*\bREV\d*\b\s*/gi, '')
      .replace(/\s*\bPASST\b\s*/gi, '')
      .replace(/\s*\bsortiert\b\s*/gi, '')
      .replace(/\s*\(\d+\)\s*/g, '')        // Remove "(1)" duplicates
      .replace(/\s*\bFR-\d+\b\s*/gi, '')    // Remove "FR-732" references
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Replace encoded German characters
    const fixGermanEncoding = (s: string) => s
      .replace(/\bKuenstliche\b/g, 'Künstliche')
      .replace(/\bkuenstliche\b/g, 'künstliche')
      .replace(/\bfuer\b/gi, 'für')
      .replace(/\bueber\b/gi, 'über')
      .replace(/\bmassnahm/gi, 'maßnahm')
      .replace(/\bae\b/g, 'ä')
      .replace(/\boe\b/g, 'ö')
      .replace(/\bue\b/g, 'ü');

    cleaned = fixGermanEncoding(cleaned);

    // Extract part number: "Part1 Name" or "Part 1 Name" or "Part5a Name"
    const partMatch = cleaned.match(/^Part\s*(\d+)\s*([a-z]?)\s*(.*)$/i);
    if (partMatch) {
      const partNum = parseInt(partMatch[1], 10);
      const subPart = partMatch[2] || '';
      let label = partMatch[3].replace(/^[\s\-_:]+/, '').trim();

      // Remove truncated final word (from PDF filename length limits)
      // Known valid short German/IT words that should NOT be stripped
      const validShortWords = new Set([
        'und', 'der', 'die', 'das', 'von', 'mit', 'für', 'bei', 'zur', 'zum',
        'Web', 'Code', 'SQL', 'OOP', 'DMZ', 'VPN', 'Test', 'Recht', 'Teil',
        'Schutz', 'Markt', 'Daten', 'Netz', 'Agil', 'Cloud', 'Tools', 'Audit',
        'Praxis', 'Rahmen', 'Module', 'Normen', 'Maven', 'Virus', 'Büro',
        'Git', 'LAN', 'DSL', 'QM', 'DB', 'IO', 'SCM', 'PHP', 'CSS', 'HTML',
        'MQTT', 'RISC', 'CISC', 'ISMS', 'P2P', 'CSV', 'XML', 'JSON', 'HTTP',
      ]);
      // Detect truncated ending: last word 1-6 chars, starts uppercase, preceded by longer word
      const truncMatch = label.match(/^(.+\s\S{4,})\s+([A-ZÄÖÜ]\S{0,5})$/);
      if (truncMatch && !validShortWords.has(truncMatch[2])) {
        label = truncMatch[1];
      }

      label = label.replace(/\s{2,}/g, ' ').trim();
      const partLabel = subPart ? `Teil ${partNum}${subPart}` : `Teil ${partNum}`;
      return { part: partNum, label: label || partLabel };
    }
    return { part: null, label: cleaned };
  };

  if (!profile)
    return <div className="p-6">{t('enablerPage.pleaseLogin')}</div>;
  if (loading) return <div className="p-6">{t('common.loading')}</div>;
  if (enablerError || error) return <div className="p-6 text-red-500">{enablerError?.message || error}</div>;
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
        {/* Theory materials */}
        {(theoryDocs.length > 0 || enabler.videoUrl || enabler.pptUrl) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {theoryDocs.map(doc => (
              <button
                key={doc.id}
                onClick={() => flipbook.openPdf(doc.title, doc.storageUrl)}
                className="border-accent/30 hover:bg-accent/15 hover:border-accent/60 flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
              >
                <BookOpen className="h-4 w-4 shrink-0" />
                <span>{doc.title}</span>
              </button>
            ))}
            {enabler.videoUrl && (
              <a
                className="border-accent/30 hover:bg-accent/15 hover:border-accent/60 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors"
                href={enabler.videoUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t('enablerPage.watchVideo')}
              </a>
            )}
            {enabler.pptUrl && (
              <a
                className="border-accent/30 hover:bg-accent/15 hover:border-accent/60 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors"
                href={enabler.pptUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t('enablerPage.openPpt')}
              </a>
            )}
          </div>
        )}

        {/* PDF Flipbook Viewer Modal */}
        <FlipbookViewer
          title={flipbook.title}
          pdfUrl={flipbook.pdfUrl}
          isOpen={flipbook.isOpen}
          onClose={flipbook.closePdf}
        />

      </div>

      {/* Scenario Section */}
      {(scenarioDocs.length > 0 || enabler.scenarioPdfUrl) && (
        <div className="border-accent/30 bg-background rounded-3xl border p-5">
          <div className="mb-4 flex items-center gap-2">
            <Layers className="text-amber-500 h-5 w-5" />
            <h2 className="text-lg font-semibold">{t('enablerPage.scenarioSection')}</h2>
            {scenarioDocs.length > 0 && (
              <span className="text-muted-foreground ml-1 text-sm">
                ({scenarioDocs.length === 1
                  ? t('enablerPage.scenarioPartSingular')
                  : t('enablerPage.scenarioParts').replace('{count}', String(scenarioDocs.length))})
              </span>
            )}
          </div>

          {/* Legacy single scenario PDF */}
          {enabler.scenarioPdfUrl && scenarioDocs.length === 0 && (
            <button
              onClick={() => flipbook.openPdf(t('trainer.content.scenarios'), enabler.scenarioPdfUrl)}
              className="bg-amber-600 hover:bg-amber-700 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-white shadow-sm transition-colors"
            >
              <FileText className="h-5 w-5" />
              <span className="font-medium">{t('enablerPage.openScenario')}</span>
            </button>
          )}

          {/* Scenario parts grid */}
          {scenarioDocs.length > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {scenarioDocs.map((doc) => {
                const { part, label } = formatScenarioLabel(doc.title);
                return (
                  <button
                    key={doc.id}
                    onClick={() => flipbook.openPdf(label, doc.storageUrl)}
                    className="border-accent/20 hover:border-amber-500/50 hover:bg-amber-500/10 group flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-amber-500/10 active:scale-[0.98]"
                  >
                    {part !== null && (
                      <span className="bg-amber-500/15 text-amber-500 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold">
                        {part}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-foreground truncate text-sm font-medium group-hover:text-amber-500 transition-colors">
                        {label}
                      </div>
                      <div className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
                        <FileText className="h-3 w-3" />
                        PDF
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Status Banner */}
      {
        submission?.status === 'APPROVED' && (
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
        )
      }

      {
        submission?.status === 'PENDING' && (
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
        )
      }

      {
        submission?.status === 'REJECTED' && (
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
        )
      }

      {/* Summary/Reflection Section */}
      <div className="border-accent/30 bg-background space-y-4 rounded-3xl border p-5">
        {saveSuccess && (
          <div className="rounded-md border border-green-500/40 bg-green-500/10 p-2 text-sm text-green-600 dark:text-green-400">
            {saveSuccess}
          </div>
        )}

        <div className="mb-2 text-lg font-semibold">
          {t('enablerPage.summaryLabel')}
        </div>

        <div className="border-accent/20 bg-background/30 relative rounded-xl border p-4">
          <textarea
            value={solutions[0]?.text || ''}
            onChange={e => {
              if (!canEdit) return;
              const newSolutions = [...solutions];
              if (!newSolutions[0]) newSolutions[0] = { scenarioIndex: 0, text: '' };
              newSolutions[0].text = e.target.value;
              setSolutions(newSolutions);
            }}
            className={`border-accent/30 w-full rounded-xl border bg-muted/30 px-3 py-2 ${!canEdit ? 'cursor-not-allowed opacity-60' : ''}`}
            rows={10}
            placeholder={t('enablerPage.describeSolution')}
            disabled={!canEdit}
          />
        </div>

        {canEdit && (
          <div className="flex justify-end">
            <button
              onClick={submitSolution}
              disabled={savingSolution}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 disabled:opacity-50"
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

        {/* Show message when no quizzes are available */}
        {gated.every(g => !g.quizId) ? (
          <div className="border-accent/10 rounded-2xl border bg-muted/10 p-6 text-center">
            <div className="text-muted-foreground text-sm">
              {t('enablerPage.noQuizzesYet')}
            </div>
          </div>
        ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {gated.map(g => {
            const disabled = !g.unlocked || !g.isActive || !g.quizId;
            return (
              <button
                key={g.difficulty}
                onClick={() => !disabled && handleTileClick(g)}
                className={`rounded-2xl border p-4 text-left transition-all duration-200 ${disabled ? 'border-accent/20 cursor-not-allowed bg-muted/20 opacity-60' : 'border-accent/30 hover:bg-accent/15 hover:border-accent/60 hover:shadow-accent/20 cursor-pointer bg-muted/30 hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]'}`}
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
                    <span className="rounded bg-green-600/20 px-2 py-0.5 text-green-600 dark:text-green-400">
                      {t('enablerPage.completed')}
                    </span>
                  ) : disabled ? (
                    <span className="bg-muted/30 rounded px-2 py-0.5">
                      {t('enablerPage.locked')}
                    </span>
                  ) : (
                    <span className="rounded bg-blue-600/20 px-2 py-0.5 text-blue-600 dark:text-blue-400">
                      {t('enablerPage.available')}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        )}

        {/* Active quiz runner */}
        {quizContent && (
          <div className="border-accent/20 mt-6 space-y-4 rounded-2xl border bg-muted/20 p-4">
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
                          className="inline-flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 disabled:opacity-60"
                          onClick={submitQuiz}
                          disabled={submittingQuiz || quizContent.questions.some(q =>
                            q.questionType === 'TEXT'
                              ? !String(answers[q.id] || '').trim()
                              : !answers[q.id]
                          )}
                        >
                          {submittingQuiz && <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
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
                {(quizLocked || reviewMode) && (
                  <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-2 text-sm text-yellow-600 dark:text-yellow-400">
                    {t('enablerPage.quizAlreadySubmitted')}
                  </div>
                )}
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
                          <div className="border-accent/20 text-muted-foreground mt-2 rounded-md border bg-muted/30 p-2 text-xs">
                            {t('enablerPage.explanationLabel')} {explanation}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <button
                  className="border-accent/30 hover:bg-background/60 rounded-md border px-4 py-2"
                  onClick={() => {
                    setQuizContent(null);
                    setResult(null);
                    setReviewMode(false);
                    setQuizLocked(false);
                    setAnswers({});
                    setSelectedDifficulty(null);
                  }}
                >
                  {t('enablerPage.backToQuizzes')}
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
    </div >
  );
}
