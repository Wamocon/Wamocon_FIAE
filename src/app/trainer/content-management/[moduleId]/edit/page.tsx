'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  BookOpen,
  Users,
  Plus,
  Save,
  X,
  FolderEdit,
  FileText,
  Trash2,
  Eye,
} from 'lucide-react';
import { PdfUploader } from '@/components/trainer/PdfUploader';
import { FlipbookViewer } from '@/components/ui/FlipbookViewer';

export default function EditCoursePage() {
  const router = useRouter();
  const params = useParams<{ moduleId: string }>();
  const courseId = params?.moduleId as string;
  const { profile } = useAuth();
  const { t } = useLanguage();
  const trainerId = profile?.id;

  const [title, setTitle] = useState('');
  const [year, setYear] = useState<'1' | '2' | '3' | ''>('');
  const [chapter, setChapter] = useState<string>('');
  const [examPart, setExamPart] = useState<'1' | '2' | ''>('');
  const [skills, setSkills] = useState<string>('');
  const [enablers, setEnablers] = useState<
    Array<{ id: string; title: string; isActive: boolean }>
  >([]);
  const [useCases, setUseCases] = useState<
    Array<{ id: string; title: string; isActive: boolean }>
  >([]);
  const [membersTrainers, setMembersTrainers] = useState<
    Array<{ id: string; fullName: string; email: string }>
  >([]);
  const [membersTrainees, setMembersTrainees] = useState<
    Array<{ id: string; fullName: string; email: string }>
  >([]);
  const [searchTrainer, setSearchTrainer] = useState('');
  const [searchTrainee, setSearchTrainee] = useState('');
  const [searchResultsTrainers, setSearchResultsTrainers] = useState<
    Array<{ id: string; fullName: string; email: string }>
  >([]);
  const [searchResultsTrainees, setSearchResultsTrainees] = useState<
    Array<{ id: string; fullName: string; email: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewPdf, setPreviewPdf] = useState<{ title: string; url: string } | null>(null);

  // UI: Add Enabler Modal state
  const [showAddEnabler, setShowAddEnabler] = useState(false);
  const [enablerTitle, setEnablerTitle] = useState('');
  const [enablerDescription, setEnablerDescription] = useState('');
  const [enablerScenarioPdf, setEnablerScenarioPdf] = useState('');
  const [enablerPpt, setEnablerPpt] = useState('');
  const [enablerVideo, setEnablerVideo] = useState('');
  const [enablerDuration, setEnablerDuration] = useState<string>('');
  const [enablerActive, setEnablerActive] = useState<boolean>(false);
  type BuilderQuestion = {
    questionText: string;
    options: [string, string, string, string];
    correctIndex: number;
  };
  const [enablerQuestions, setEnablerQuestions] = useState<BuilderQuestion[]>([
    { questionText: '', options: ['', '', '', ''], correctIndex: 0 },
  ]);
  const [enablerSubmitting, setEnablerSubmitting] = useState(false);
  // Pending PDFs for Add Lesson (before enabler is created)
  type PendingPdf = {
    id: string;
    url: string;
    fileName: string;
    title: string;
  };
  const [pendingEnablerPdfs, setPendingEnablerPdfs] = useState<PendingPdf[]>(
    []
  );
  const [pendingScenarioPdfs, setPendingScenarioPdfs] = useState<PendingPdf[]>(
    []
  );
  // Edit Enabler state
  const [showEditEnabler, setShowEditEnabler] = useState(false);
  const [editingEnablerId, setEditingEnablerId] = useState<string | null>(null);
  const [enablerQuizList, setEnablerQuizList] = useState<
    Array<{
      difficulty: 'LOW' | 'MEDIUM' | 'HIGH';
      quizId: string;
      title: string;
      isActive?: boolean;
      questionCount?: number;
    }>
  >([]);
  // PDF documents for enabler
  const [enablerDocuments, setEnablerDocuments] = useState<
    Array<{ id: string; title: string; storageUrl: string; fileName: string; documentType?: string }>
  >([]);

  // UI: Add Use Case Modal state
  const [showAddUseCase, setShowAddUseCase] = useState(false);
  const [useCaseTitle, setUseCaseTitle] = useState('');
  const [useCaseDesc, setUseCaseDesc] = useState('');
  const [useCaseDuration, setUseCaseDuration] = useState<string>('');
  const [useCaseYear, setUseCaseYear] = useState<'1' | '2' | '3' | ''>('');
  const [useCaseStage, setUseCaseStage] = useState<'1' | '2' | ''>('');
  const [useCaseLernfelder, setUseCaseLernfelder] = useState<string[]>([]);
  const [useCaseActive, setUseCaseActive] = useState<boolean>(false);
  const [useCaseSubmitting, setUseCaseSubmitting] = useState(false);
  // Pending PDFs for Add Use Case (before use case is created)
  const [pendingUseCasePdfs, setPendingUseCasePdfs] = useState<PendingPdf[]>(
    []
  );
  // Edit Use Case state
  const [showEditUseCase, setShowEditUseCase] = useState(false);
  const [editingUseCaseId, setEditingUseCaseId] = useState<string | null>(null);
  const [useCaseEditTitle, setUseCaseEditTitle] = useState('');
  const [useCaseEditDesc, setUseCaseEditDesc] = useState('');
  const [useCaseEditDuration, setUseCaseEditDuration] = useState<string>('');
  const [useCaseEditYear, setUseCaseEditYear] = useState<'1' | '2' | '3' | ''>(
    ''
  );
  const [useCaseEditStage, setUseCaseEditStage] = useState<'1' | '2' | ''>('');
  const [useCaseEditLernfelder, setUseCaseEditLernfelder] = useState<string[]>(
    []
  );
  const [useCaseEditActive, setUseCaseEditActive] = useState<boolean>(false);
  // PDF documents for use case (edit mode)
  const [useCaseDocuments, setUseCaseDocuments] = useState<
    Array<{ id: string; title: string; storageUrl: string; fileName: string; documentType?: string }>
  >([]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await fetch(
          `/api/trainer/courses/${courseId}?trainerId=${trainerId || ''}`,
          { cache: 'no-store' }
        );
        if (!res.ok)
          throw new Error(t('trainer.content.errorCourseLoadFailed'));
        const data = await res.json();
        setTitle(data.course.title);
        setYear(String(data.course.year ?? '') as any);
        setChapter(String(data.course.chapter ?? ''));
        setExamPart(String(data.course.examPart ?? '') as any);
        setSkills((data.skills || []).join(', '));
        setEnablers(
          (data.enablers || []).map((e: any) => ({
            id: e.id,
            title: e.title,
            isActive: !!e.isActive,
          }))
        );
        setUseCases(
          (data.useCases || []).map((u: any) => ({
            id: u.id,
            title: u.title,
            isActive: !!u.isActive,
          }))
        );
        // load members
        const memRes = await fetch(
          `/api/trainer/courses/${courseId}/members?trainerId=${trainerId || ''}`,
          { cache: 'no-store' }
        );
        if (memRes.ok) {
          const mem = await memRes.json();
          const trainers = (mem.members || [])
            .filter((m: any) => m.role === 'TRAINER')
            .map((m: any) => ({
              id: m.userId,
              fullName: m.fullName,
              email: m.email,
            }));
          const trainees = (mem.members || [])
            .filter((m: any) => m.role === 'TRAINEE')
            .map((m: any) => ({
              id: m.userId,
              fullName: m.fullName,
              email: m.email,
            }));
          setMembersTrainers(trainers);
          setMembersTrainees(trainees);
        }
      } catch (e: any) {
        setError(e?.message || t('common.unknownError'));
      } finally {
        setLoading(false);
      }
    };
    if (courseId) load();
  }, [courseId]);

  useEffect(() => {
    const q = searchTrainer.trim();
    if (!q) {
      setSearchResultsTrainers([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/trainer/profiles?role=TRAINER&q=${encodeURIComponent(q)}`,
          { signal: controller.signal }
        );
        if (!r.ok) return;
        const data = await r.json();
        const existing = new Set(membersTrainers.map(m => m.id));
        setSearchResultsTrainers(
          (data.profiles || []).filter((p: any) => !existing.has(p.id))
        );
      } catch {
        // Ignore aborted/failed searches
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [searchTrainer, membersTrainers]);

  useEffect(() => {
    const q = searchTrainee.trim();
    if (!q) {
      setSearchResultsTrainees([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/trainer/profiles?role=TRAINEE&q=${encodeURIComponent(q)}`,
          { signal: controller.signal }
        );
        if (!r.ok) return;
        const data = await r.json();
        const existing = new Set(membersTrainees.map(m => m.id));
        setSearchResultsTrainees(
          (data.profiles || []).filter((p: any) => !existing.has(p.id))
        );
      } catch {
        // Ignore aborted/failed searches
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [searchTrainee, membersTrainees]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError(t('trainer.content.errorTitle'));

    try {
      setSaving(true);
      const payload: any = {
        title: title.trim(),
        year: year ? Number(year) : null,
        chapter: chapter ? Number(chapter) : undefined,
        examPart: examPart ? Number(examPart) : null,
        skills: skills
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
      };

      const res = await fetch(
        `/api/trainer/courses/${courseId}?trainerId=${trainerId || ''}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) throw new Error(t('trainer.content.errorSaveFailed'));

      router.replace('/trainer/content-management');
    } catch (e: any) {
      setError(e?.message || t('common.unknownError'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6">{t('common.loading')}</div>;
  if (error) return <div className="p-6 text-red-500">{error}</div>;

  return (
    <div className="from-background relative min-h-full space-y-6 bg-gradient-to-br via-red-900/30 to-red-800/40 p-6">
      <div className="glass-effect border-accent/30 mx-auto max-w-7xl rounded-3xl border p-8 shadow-lg">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="from-accent to-primary flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br">
              <FolderEdit className="text-foreground h-5 w-5" />
            </div>
            <div>
              <h1 className="text-foreground text-xl font-bold">
                {t('trainer.content.editCourse')}
              </h1>
              <div className="text-muted-foreground text-xs">
                {t('trainer.content.editCourseSub')}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="border-accent/30 text-foreground hover:bg-background/60 inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"
            >
              <X className="h-4 w-4" /> {t('common.cancel')}
            </button>
            <button
              onClick={e => handleSave(e as any)}
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
              disabled={saving}
            >
              <Save className="h-4 w-4" />{' '}
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          {error && <div className="text-red-500">{error}</div>}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="border-accent/20 bg-background/40 rounded-2xl border p-5">
              <div className="mb-3 text-sm font-semibold">
                {t('trainer.content.courseDetails')}
              </div>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('trainer.content.courseTitle')}
                  </label>
                  <input
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('trainer.content.trainingYear')}
                  </label>
                  <select
                    value={year}
                    onChange={e => setYear(e.target.value as any)}
                    className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                  >
                    <option value="">{t('trainer.content.examPartNone')}</option>
                    <option value="1">{t('common.year1')}</option>
                    <option value="2">{t('common.year2')}</option>
                    <option value="3">{t('common.year3')}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('trainer.content.chapter')}
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setChapter(prev => String(Math.max(1, (parseInt(prev) || 0) - 1)))}
                      className="border-accent/20 bg-background/60 cursor-pointer rounded-l-xl border px-3 py-2 text-sm font-bold transition-colors hover:bg-accent/10"
                    >
                      −
                    </button>
                    <input
                      value={chapter}
                      onChange={e => setChapter(e.target.value.replace(/\D/g, ''))}
                      className="border-accent/20 bg-background/60 w-full border-y px-3 py-2 text-center"
                      placeholder={t('trainer.content.chapterPlaceholder')}
                      inputMode="numeric"
                    />
                    <button
                      type="button"
                      onClick={() => setChapter(prev => String((parseInt(prev) || 0) + 1))}
                      className="border-accent/20 bg-background/60 cursor-pointer rounded-r-xl border px-3 py-2 text-sm font-bold transition-colors hover:bg-accent/10"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('trainer.content.examPart')}
                  </label>
                  <select
                    value={examPart}
                    onChange={e => setExamPart(e.target.value as any)}
                    className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                  >
                    <option value="">{t('trainer.content.examPartNone')}</option>
                    <option value="1">{t('trainer.content.examPart1')}</option>
                    <option value="2">{t('trainer.content.examPart2')}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('trainer.content.skills')}
                  </label>
                  <input
                    value={skills}
                    onChange={e => setSkills(e.target.value)}
                    className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                    placeholder={t('trainer.content.skillsPlaceholder')}
                  />
                </div>
              </div>
            </div>

            <div className="border-accent/20 bg-background/40 rounded-2xl border p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Users className="h-4 w-4" />
                {t('trainer.content.members')}
              </div>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div>
                  <div className="mb-2 font-medium">
                    {t('trainer.content.trainers')}
                  </div>
                  <ul className="mb-2 space-y-1">
                    {membersTrainers.map(m => (
                      <li
                        key={m.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span>
                          {m.fullName} ({m.email})
                        </span>
                        <button
                          type="button"
                          className="border-accent/30 cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors hover:border-red-400 hover:text-red-400"
                          onClick={async () => {
                            const ok = window.confirm(t('trainer.content.confirmRemoveMember'));
                            if (!ok) return;
                            await fetch(
                              `/api/trainer/courses/${courseId}/members?userId=${m.id}&trainerId=${trainerId || ''}`,
                              { method: 'DELETE' }
                            );
                            setMembersTrainers(prev =>
                              prev.filter(x => x.id !== m.id)
                            );
                          }}
                        >
                          {t('common.remove')}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <input
                    value={searchTrainer}
                    onChange={e => setSearchTrainer(e.target.value)}
                    placeholder={t('trainer.content.searchTrainer')}
                    className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                  />
                  <div className="text-muted-foreground mt-1 text-xs">
                    {t('trainer.content.searchHint')}
                  </div>
                  <ul className="mt-2 space-y-2">
                    {searchResultsTrainers.map(p => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className="border-accent/30 bg-accent/5 hover:bg-accent/15 hover:border-accent/60 flex w-full flex-col gap-2 rounded-lg border px-3 py-2 text-left transition-colors sm:flex-row sm:items-center sm:justify-between"
                          onClick={async () => {
                            await fetch(
                              `/api/trainer/courses/${courseId}/members?trainerId=${trainerId || ''}`,
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  userId: p.id,
                                  role: 'TRAINER',
                                }),
                              }
                            );
                            setMembersTrainers(prev => [...prev, p]);
                            setSearchResultsTrainers(prev =>
                              prev.filter(x => x.id !== p.id)
                            );
                          }}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {p.fullName}
                            </span>
                            <span className="text-muted-foreground truncate text-xs">
                              {p.email}
                            </span>
                          </span>
                          <span className="text-accent border-accent/50 bg-accent/10 hover:bg-accent/20 flex flex-shrink-0 items-center rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap">
                            {t('trainer.content.clickToAdd')}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="mb-2 font-medium">
                    {t('trainer.content.trainees')}
                  </div>
                  <ul className="mb-2 space-y-1">
                    {membersTrainees.map(m => (
                      <li
                        key={m.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span>
                          {m.fullName} ({m.email})
                        </span>
                        <button
                          type="button"
                          className="border-accent/30 cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors hover:border-red-400 hover:text-red-400"
                          onClick={async () => {
                            const ok = window.confirm(t('trainer.content.confirmRemoveMember'));
                            if (!ok) return;
                            await fetch(
                              `/api/trainer/courses/${courseId}/members?userId=${m.id}&trainerId=${trainerId || ''}`,
                              { method: 'DELETE' }
                            );
                            setMembersTrainees(prev =>
                              prev.filter(x => x.id !== m.id)
                            );
                          }}
                        >
                          {t('common.remove')}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <input
                    value={searchTrainee}
                    onChange={e => setSearchTrainee(e.target.value)}
                    placeholder={t('trainer.content.searchTrainee')}
                    className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                  />
                  <div className="text-muted-foreground mt-1 text-xs">
                    {t('trainer.content.searchHint')}
                  </div>
                  <ul className="mt-2 space-y-2">
                    {searchResultsTrainees.map(p => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className="border-accent/30 bg-accent/5 hover:bg-accent/15 hover:border-accent/60 flex w-full flex-col gap-2 rounded-lg border px-3 py-2 text-left transition-colors sm:flex-row sm:items-center sm:justify-between"
                          onClick={async () => {
                            await fetch(
                              `/api/trainer/courses/${courseId}/members?trainerId=${trainerId || ''}`,
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  userId: p.id,
                                  role: 'TRAINEE',
                                }),
                              }
                            );
                            setMembersTrainees(prev => [...prev, p]);
                            setSearchResultsTrainees(prev =>
                              prev.filter(x => x.id !== p.id)
                            );
                          }}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {p.fullName}
                            </span>
                            <span className="text-muted-foreground truncate text-xs">
                              {p.email}
                            </span>
                          </span>
                          <span className="text-accent border-accent/50 bg-accent/10 hover:bg-accent/20 flex flex-shrink-0 items-center rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap">
                            {t('trainer.content.clickToAdd')}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div className="border-accent/20 bg-background/40 rounded-2xl border p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="h-4 w-4" />
              {t('trainer.content.lessons')}
            </div>
            <ul className="space-y-2">
              {enablers.map(e => (
                <li key={e.id} className="flex items-center justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="truncate font-medium">{e.title}</span>
                    <span
                      className={`ml-2 rounded-full border px-2 py-0.5 text-xs ${e.isActive ? 'border-green-500 text-green-600' : 'border-yellow-500 text-yellow-600'}`}
                    >
                      {e.isActive ? t('common.active') : t('common.inactive')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="border-accent/30 rounded-md border px-2 py-1 text-xs"
                      onClick={async () => {
                        await fetch(
                          `/api/trainer/enablers/${e.id}?trainerId=${trainerId || ''}`,
                          {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ isActive: !e.isActive }),
                          }
                        );
                        const r = await fetch(
                          `/api/trainer/courses/${courseId}?trainerId=${trainerId || ''}`
                        );
                        const data = await r.json();
                        setEnablers(
                          (data.enablers || []).map((x: any) => ({
                            id: x.id,
                            title: x.title,
                            isActive: !!x.isActive,
                          }))
                        );
                      }}
                    >
                      {e.isActive
                        ? t('common.deactivate')
                        : t('common.activate')}
                    </button>
                    <button
                      type="button"
                      className="border-accent/30 rounded-md border px-2 py-1 text-xs"
                      onClick={async () => {
                        // Prefill enabler details and quiz into add/edit fields and open edit modal
                        try {
                          setEditingEnablerId(e.id);
                          // Load enabler fields
                          const er = await fetch(
                            `/api/trainer/enablers/${e.id}`
                          );
                          if (er.ok) {
                            const ej = await er.json();
                            const en = ej.enabler || {};
                            setEnablerTitle(en.title || '');
                            setEnablerDescription(en.descriptionText || '');
                            setEnablerScenarioPdf(en.scenarioPdfUrl || '');
                          }
                          // Load multi-difficulty quiz list
                          const ql = await fetch(
                            `/api/trainer/enablers/${e.id}/quizzes`
                          );
                          if (ql.ok) {
                            const qlj = await ql.json();
                            setEnablerQuizList(qlj.quizzes || []);
                          } else {
                            setEnablerQuizList([]);
                          }
                          // Load documents
                          try {
                            const dr = await fetch(
                              `/api/trainer/enablers/${e.id}/documents`
                            );
                            if (dr.ok) {
                              const dj = await dr.json();
                              setEnablerDocuments(dj.documents || []);
                            } else {
                              setEnablerDocuments([]);
                            }
                          } catch {
                            setEnablerDocuments([]);
                          }
                          // Quizzes are managed via multi-difficulty section below; legacy single-quiz flow removed
                          setShowEditEnabler(true);
                        } catch (e) {
                          console.error(e);
                        }
                      }}
                    >
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600"
                      onClick={async () => {
                        if (!trainerId) {
                          alert(t('trainer.content.errorNoTrainer'));
                          return;
                        }
                        const ok = window.confirm(
                          t('trainer.content.confirmDeleteEnabler')
                        );
                        if (!ok) return;
                        try {
                          const del = await fetch(
                            `/api/trainer/enablers/${e.id}?trainerId=${trainerId || ''}`,
                            { method: 'DELETE' }
                          );
                          if (!del.ok)
                            throw new Error(
                              t('trainer.content.errorDeleteFailed')
                            );
                          const r = await fetch(
                            `/api/trainer/courses/${courseId}?trainerId=${trainerId || ''}`
                          );
                          const data = await r.json();
                          setEnablers(
                            (data.enablers || []).map((x: any) => ({
                              id: x.id,
                              title: x.title,
                              isActive: !!x.isActive,
                            }))
                          );
                        } catch (err: any) {
                          alert(err?.message || t('common.unknownError'));
                        }
                      }}
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="border-accent/30 mt-3 inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"
              onClick={() => setShowAddEnabler(true)}
            >
              <Plus className="h-4 w-4" /> {t('trainer.content.addLesson')}
            </button>
          </div>

          <div className="border-accent/20 bg-background/40 rounded-2xl border p-5">
            <div className="mb-3 text-sm font-semibold">
              {t('trainer.content.useCases')}
            </div>
            <ul className="space-y-2">
              {useCases.map(u => (
                <li key={u.id} className="flex items-center justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="truncate font-medium">{u.title}</span>
                    <span
                      className={`ml-2 rounded-full border px-2 py-0.5 text-xs ${u.isActive ? 'border-green-500 text-green-600' : 'border-yellow-500 text-yellow-600'}`}
                    >
                      {u.isActive ? t('common.active') : t('common.inactive')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="border-accent/30 rounded-md border px-2 py-1 text-xs"
                      onClick={async () => {
                        await fetch(
                          `/api/trainer/use-cases/${u.id}?trainerId=${trainerId || ''}`,
                          {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ isActive: !u.isActive }),
                          }
                        );
                        const r = await fetch(
                          `/api/trainer/courses/${courseId}?trainerId=${trainerId || ''}`
                        );
                        const data = await r.json();
                        setUseCases(
                          (data.useCases || []).map((x: any) => ({
                            id: x.id,
                            title: x.title,
                            isActive: !!x.isActive,
                          }))
                        );
                      }}
                    >
                      {u.isActive
                        ? t('common.deactivate')
                        : t('common.activate')}
                    </button>
                    <button
                      type="button"
                      className="border-accent/30 rounded-md border px-2 py-1 text-xs"
                      onClick={async () => {
                        try {
                          setEditingUseCaseId(u.id);
                          const ur = await fetch(
                            `/api/trainer/use-cases/${u.id}`
                          );
                          if (ur.ok) {
                            const uj = await ur.json();
                            const uc = uj.useCase || {};
                            setUseCaseEditTitle(uc.title || '');
                            setUseCaseEditDesc(uc.descriptionText || '');
                            setUseCaseEditDuration(
                              uc.durationValue ? String(uc.durationValue) : ''
                            );
                            setUseCaseEditYear(
                              uc.year ? String(uc.year) : ('' as any)
                            );
                            setUseCaseEditStage(
                              uc.trainingStage
                                ? String(uc.trainingStage)
                                : ('' as any)
                            );
                            setUseCaseEditLernfelder(uc.lernfelder || []);
                            setUseCaseEditActive(!!uc.isActive);
                          } else {
                            setUseCaseEditTitle(u.title);
                            setUseCaseEditDesc('');
                            setUseCaseEditDuration('');
                            setUseCaseEditYear('');
                            setUseCaseEditStage('');
                            setUseCaseEditLernfelder([]);
                            setUseCaseEditActive(false);
                          }
                          // Fetch documents for this use case
                          try {
                            const docRes = await fetch(
                              `/api/trainer/use-cases/${u.id}/documents`
                            );
                            if (docRes.ok) {
                              const docData = await docRes.json();
                              setUseCaseDocuments(docData.documents || []);
                            } else {
                              setUseCaseDocuments([]);
                            }
                          } catch {
                            setUseCaseDocuments([]);
                          }
                          setShowEditUseCase(true);
                        } catch (e) {
                          console.error(e);
                        }
                      }}
                    >
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600"
                      onClick={async () => {
                        if (!trainerId) {
                          alert(t('trainer.content.errorNoTrainer'));
                          return;
                        }
                        const ok = window.confirm(
                          t('trainer.content.confirmDeleteUseCase')
                        );
                        if (!ok) return;
                        try {
                          const del = await fetch(
                            `/api/trainer/use-cases/${u.id}?trainerId=${trainerId || ''}`,
                            { method: 'DELETE' }
                          );
                          if (!del.ok)
                            throw new Error(
                              t('trainer.content.errorDeleteFailed')
                            );
                          const r = await fetch(
                            `/api/trainer/courses/${courseId}?trainerId=${trainerId || ''}`
                          );
                          const data = await r.json();
                          setUseCases(
                            (data.useCases || []).map((x: any) => ({
                              id: x.id,
                              title: x.title,
                              isActive: !!x.isActive,
                            }))
                          );
                        } catch (err: any) {
                          alert(err?.message || t('common.unknownError'));
                        }
                      }}
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="border-accent/30 mt-3 inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"
              onClick={() => setShowAddUseCase(true)}
            >
              <Plus className="h-4 w-4" /> {t('trainer.content.addUseCase')}
            </button>
          </div>
        </form>
      </div>

      {/* Add Lesson Modal */}
      {showAddEnabler && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !enablerSubmitting && setShowAddEnabler(false)}
          />
          <div className="glass-effect border-accent/30 bg-background relative z-10 w-full max-w-2xl rounded-3xl border p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {t('trainer.content.createLesson')}
              </h2>
              <button
                className="border-accent/30 rounded-md border px-2 py-1 text-sm"
                onClick={() => !enablerSubmitting && setShowAddEnabler(false)}
              >
                {t('common.close')}
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t('common.title')}
                </label>
                <input
                  value={enablerTitle}
                  onChange={e => setEnablerTitle(e.target.value)}
                  className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t('common.description')}
                </label>
                <textarea
                  value={enablerDescription}
                  onChange={e => setEnablerDescription(e.target.value)}
                  className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                  rows={3}
                  placeholder={t(
                    'trainer.content.lessonDescriptionPlaceholder'
                  )}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('trainer.content.pptLink')}
                  </label>
                  <input
                    value={enablerPpt}
                    onChange={e => setEnablerPpt(e.target.value)}
                    className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                    placeholder="https://..."
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('trainer.content.videoLink')}
                  </label>
                  <input
                    value={enablerVideo}
                    onChange={e => setEnablerVideo(e.target.value)}
                    className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                    placeholder="https://..."
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('trainer.content.durationDays')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={enablerDuration}
                    onChange={e => setEnablerDuration(e.target.value)}
                    className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                    placeholder={t('trainer.content.durationPlaceholder')}
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={enablerActive}
                      onChange={e => setEnablerActive(e.target.checked)}
                    />
                    <span>{t('common.active')}</span>
                  </label>
                </div>
              </div>

              {/* Theory PDFs Section for Add Lesson */}
              <div className="border-accent/20 bg-background/30 rounded-xl border p-3">
                <div className="mb-2 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium">{t('trainer.content.theoryPdfs')}</span>
                  {pendingEnablerPdfs.length > 0 && (
                    <span className="text-muted text-xs">
                      ({pendingEnablerPdfs.length})
                    </span>
                  )}
                </div>

                {/* Pending theory PDFs - inline pills */}
                {pendingEnablerPdfs.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {pendingEnablerPdfs.map(pdf => (
                      <div
                        key={pdf.id}
                        className="flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-1"
                      >
                        <FileText className="h-3 w-3 flex-shrink-0 text-blue-500" />
                        <span className="max-w-[150px] truncate text-xs font-medium">
                          {pdf.title}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setPendingEnablerPdfs(prev =>
                              prev.filter(p => p.id !== pdf.id)
                            )
                          }
                          className="text-muted rounded p-0.5 transition-colors hover:bg-red-500/20 hover:text-red-400"
                          title={t('common.remove')}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Compact PDF Upload */}
                <PdfUploader
                  compact
                  userId={trainerId || ''}
                  onUpload={url => {
                    const fileName = url.split('/').pop() || 'document.pdf';
                    const title = fileName
                      .replace(/^\d+_/, '')
                      .replace(/\.pdf$/i, '');
                    setPendingEnablerPdfs(prev => [
                      ...prev,
                      { id: crypto.randomUUID(), url, fileName, title },
                    ]);
                  }}
                  disabled={!trainerId}
                />
              </div>

              {/* Scenario PDFs Section (Add Modal) */}
              <div className="border-accent/20 bg-background/30 rounded-xl border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-amber-500" />
                    <span className="text-sm font-medium">{t('trainer.content.scenarioPdfs')}</span>
                    {pendingScenarioPdfs.length > 0 && (
                      <span className="text-muted text-xs">
                        ({pendingScenarioPdfs.length})
                      </span>
                    )}
                  </div>
                </div>

                {/* Pending scenario PDFs - inline pills */}
                {pendingScenarioPdfs.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {pendingScenarioPdfs.map(pdf => (
                      <div
                        key={pdf.id}
                        className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1"
                      >
                        <FileText className="h-3 w-3 flex-shrink-0 text-amber-500" />
                        <span className="max-w-[150px] truncate text-xs font-medium">
                          {pdf.title}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setPendingScenarioPdfs(prev =>
                              prev.filter(p => p.id !== pdf.id)
                            )
                          }
                          className="text-muted rounded p-0.5 transition-colors hover:bg-red-500/20 hover:text-red-400"
                          title={t('common.remove')}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <PdfUploader
                  compact
                  userId={trainerId || ''}
                  onUpload={url => {
                    const fileName = url.split('/').pop() || 'scenario.pdf';
                    const title = fileName
                      .replace(/^\d+_/, '')
                      .replace(/\.pdf$/i, '');
                    setPendingScenarioPdfs(prev => [
                      ...prev,
                      { id: crypto.randomUUID(), url, fileName, title },
                    ]);
                  }}
                  disabled={!trainerId}
                />
              </div>
              {/* Legacy inline Quiz-Fragen removed from Add Lesson modal. Create the lesson first, then add quizzes in the edit modal using the multi-difficulty section. */}
              <div className="flex justify-end gap-2">
                <button
                  className="border-accent/30 rounded-md border px-4 py-2"
                  type="button"
                  onClick={() => !enablerSubmitting && setShowAddEnabler(false)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 disabled:opacity-60"
                  disabled={enablerSubmitting}
                  onClick={async () => {
                    if (!trainerId) {
                      alert(t('trainer.content.errorNoTrainer'));
                      return;
                    }
                    if (!enablerTitle.trim()) {
                      alert(t('trainer.content.errorNoTitle'));
                      return;
                    }
                    setEnablerSubmitting(true);
                    try {
                      // 1) Create Enabler
                      const res = await fetch(
                        `/api/trainer/courses/${courseId}/enablers?trainerId=${trainerId}`,
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            title: enablerTitle.trim(),
                            descriptionText:
                              enablerDescription.trim() || undefined,
                            scenarioPdfUrl: enablerScenarioPdf.trim() || undefined,
                            pptUrl: enablerPpt.trim() || undefined,
                            videoUrl: enablerVideo.trim() || undefined,
                            durationValue: enablerDuration
                              ? Number(enablerDuration)
                              : undefined,
                            durationUnit: enablerDuration ? 'DAYS' : undefined,
                            isActive: enablerActive,
                          }),
                        }
                      );
                      if (!res.ok)
                        throw new Error(
                          t('trainer.content.errorLessonCreateFailed')
                        );
                      const data = await res.json();
                      const newEnablerId = data.enabler?.id as
                        | string
                        | undefined;

                      // 2) Save pending theory PDFs if any
                      if (newEnablerId && pendingEnablerPdfs.length > 0) {
                        for (const pdf of pendingEnablerPdfs) {
                          try {
                            await fetch(
                              `/api/trainer/enablers/${newEnablerId}/documents?trainerId=${trainerId}`,
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  title: pdf.title,
                                  fileName: pdf.fileName,
                                  storageUrl: pdf.url,
                                  documentType: 'THEORY',
                                }),
                              }
                            );
                          } catch {
                            /* ignore individual PDF save errors */
                          }
                        }
                      }

                      // 2b) Save pending scenario PDFs if any
                      if (newEnablerId && pendingScenarioPdfs.length > 0) {
                        for (const pdf of pendingScenarioPdfs) {
                          try {
                            await fetch(
                              `/api/trainer/enablers/${newEnablerId}/documents?trainerId=${trainerId}`,
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  title: pdf.title,
                                  fileName: pdf.fileName,
                                  storageUrl: pdf.url,
                                  documentType: 'EXERCISE',
                                }),
                              }
                            );
                          } catch {
                            /* ignore individual PDF save errors */
                          }
                        }
                      }

                      // 3) Refresh and close
                      const r = await fetch(
                        `/api/trainer/courses/${courseId}?trainerId=${trainerId}`
                      );
                      const fresh = await r.json();
                      setEnablers(
                        (fresh.enablers || []).map((x: any) => ({
                          id: x.id,
                          title: x.title,
                          isActive: !!x.isActive,
                        }))
                      );

                      // Close the Add modal
                      setShowAddEnabler(false);

                      // Reset add form fields including pending PDFs
                      setEnablerTitle('');
                      setEnablerDescription('');
                      setEnablerScenarioPdf('');
                      setPendingEnablerPdfs([]);
                      setPendingScenarioPdfs([]);
                    } catch (e: any) {
                      alert(e?.message || t('common.unknownError'));
                    } finally {
                      setEnablerSubmitting(false);
                    }
                  }}
                >
                  {t('common.create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Use Case Modal */}
      {showAddUseCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !useCaseSubmitting && setShowAddUseCase(false)}
          />
          <div className="glass-effect border-accent/30 bg-background relative z-10 w-full max-w-xl rounded-3xl border p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {t('trainer.content.createUseCase')}
              </h2>
              <button
                className="border-accent/30 rounded-md border px-2 py-1 text-sm"
                onClick={() => !useCaseSubmitting && setShowAddUseCase(false)}
              >
                {t('common.close')}
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t('common.title')}
                </label>
                <input
                  value={useCaseTitle}
                  onChange={e => setUseCaseTitle(e.target.value)}
                  className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t('common.description')}
                </label>
                <textarea
                  value={useCaseDesc}
                  onChange={e => setUseCaseDesc(e.target.value)}
                  className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('trainer.content.trainingYear')}
                  </label>
                  <select
                    value={useCaseYear}
                    onChange={e => setUseCaseYear(e.target.value as any)}
                    className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                  >
                    <option value="">{t('common.select')}</option>
                    <option value="1">{t('common.year1')}</option>
                    <option value="2">{t('common.year2')}</option>
                    <option value="3">{t('common.year3')}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('trainer.content.trainingStage')}
                  </label>
                  <select
                    value={useCaseStage}
                    onChange={e => setUseCaseStage(e.target.value as any)}
                    className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                  >
                    <option value="">{t('common.select')}</option>
                    <option value="1">{t('trainer.content.stage1')}</option>
                    <option value="2">{t('trainer.content.stage2')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  {t('common.lernfelder')}
                </label>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {Array.from({ length: 12 }, (_, i) => `LF-${i + 1}`).map(
                    lf => (
                      <label
                        key={lf}
                        className="border-accent/20 bg-background/40 hover:bg-background/60 flex cursor-pointer items-center gap-2 rounded-lg border p-2"
                      >
                        <input
                          type="checkbox"
                          checked={useCaseLernfelder.includes(lf)}
                          onChange={e => {
                            if (e.target.checked)
                              setUseCaseLernfelder(prev => [...prev, lf]);
                            else
                              setUseCaseLernfelder(prev =>
                                prev.filter(x => x !== lf)
                              );
                          }}
                          className="border-accent/30 bg-background/50 rounded"
                        />
                        <span className="text-xs font-medium">{lf}</span>
                      </label>
                    )
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('trainer.content.durationDays')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={useCaseDuration}
                    onChange={e => setUseCaseDuration(e.target.value)}
                    className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                    placeholder={t('trainer.content.durationPlaceholder')}
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={useCaseActive}
                      onChange={e => setUseCaseActive(e.target.checked)}
                    />
                    <span>{t('common.active')}</span>
                  </label>
                </div>
              </div>

              {/* PDF Documents Section for Add Use Case */}
              <div className="border-accent/20 bg-background/30 rounded-xl border p-3">
                <div className="mb-2 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-red-500" />
                  <span className="text-sm font-medium">PDFs</span>
                  {pendingUseCasePdfs.length > 0 && (
                    <span className="text-muted text-xs">
                      ({pendingUseCasePdfs.length})
                    </span>
                  )}
                </div>

                {/* Pending PDFs - inline pills */}
                {pendingUseCasePdfs.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {pendingUseCasePdfs.map(pdf => (
                      <div
                        key={pdf.id}
                        className="flex items-center gap-1.5 rounded-lg border border-green-500/30 bg-green-500/10 px-2 py-1"
                      >
                        <FileText className="h-3 w-3 flex-shrink-0 text-green-500" />
                        <span className="max-w-[150px] truncate text-xs font-medium">
                          {pdf.title}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setPendingUseCasePdfs(prev =>
                              prev.filter(p => p.id !== pdf.id)
                            )
                          }
                          className="text-muted rounded p-0.5 transition-colors hover:bg-red-500/20 hover:text-red-400"
                          title={t('common.remove')}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Compact PDF Upload */}
                <PdfUploader
                  compact
                  userId={trainerId || ''}
                  onUpload={url => {
                    const fileName = url.split('/').pop() || 'document.pdf';
                    const title = fileName
                      .replace(/^\d+_/, '')
                      .replace(/\.pdf$/i, '');
                    setPendingUseCasePdfs(prev => [
                      ...prev,
                      { id: crypto.randomUUID(), url, fileName, title },
                    ]);
                  }}
                  disabled={!trainerId}
                />
                <p className="text-muted mt-1 text-xs">
                  {t('trainer.content.pdfSaveNotice')}
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  className="border-accent/30 rounded-md border px-4 py-2"
                  type="button"
                  onClick={() => !useCaseSubmitting && setShowAddUseCase(false)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 disabled:opacity-60"
                  disabled={useCaseSubmitting}
                  onClick={async () => {
                    if (!trainerId) {
                      alert(t('trainer.content.errorNoTrainer'));
                      return;
                    }
                    if (!useCaseTitle.trim()) {
                      alert(t('trainer.content.errorNoTitle'));
                      return;
                    }
                    if (!useCaseDesc.trim()) {
                      alert(t('trainer.content.errorNoDescription'));
                      return;
                    }
                    setUseCaseSubmitting(true);
                    try {
                      const res = await fetch(
                        `/api/trainer/courses/${courseId}/use-cases?trainerId=${trainerId}`,
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            title: useCaseTitle.trim(),
                            descriptionText: useCaseDesc.trim(),
                            durationValue: useCaseDuration
                              ? Number(useCaseDuration)
                              : undefined,
                            durationUnit: useCaseDuration ? 'DAYS' : undefined,
                            isActive: useCaseActive,
                            year: useCaseYear || undefined,
                            trainingStage: useCaseStage || undefined,
                            lernfelder:
                              useCaseLernfelder.length > 0
                                ? useCaseLernfelder
                                : undefined,
                          }),
                        }
                      );
                      if (!res.ok)
                        throw new Error(
                          t('trainer.content.errorUseCaseCreateFailed')
                        );
                      const newUseCaseData = await res.json();
                      const newUseCaseId = newUseCaseData.useCase?.id;

                      // Save pending PDFs if any
                      if (newUseCaseId && pendingUseCasePdfs.length > 0) {
                        for (const pdf of pendingUseCasePdfs) {
                          try {
                            await fetch(
                              `/api/trainer/use-cases/${newUseCaseId}/documents?trainerId=${trainerId}`,
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  title: pdf.title,
                                  fileName: pdf.fileName,
                                  storageUrl: pdf.url,
                                  documentType: 'THEORY',
                                }),
                              }
                            );
                          } catch (err) {
                            console.error('Failed to save use case PDF', err);
                          }
                        }
                      }

                      const r = await fetch(
                        `/api/trainer/courses/${courseId}?trainerId=${trainerId}`
                      );
                      const fresh = await r.json();
                      setUseCases(
                        (fresh.useCases || []).map((x: any) => ({
                          id: x.id,
                          title: x.title,
                          isActive: !!x.isActive,
                        }))
                      );
                      setShowAddUseCase(false);
                      setUseCaseTitle('');
                      setUseCaseDesc('');
                      setUseCaseDuration('');
                      setUseCaseActive(false);
                      setPendingUseCasePdfs([]);
                      setUseCaseYear('');
                      setUseCaseStage('');
                      setUseCaseLernfelder([]);
                    } catch (e: any) {
                      alert(e?.message || t('common.unknownError'));
                    } finally {
                      setUseCaseSubmitting(false);
                    }
                  }}
                >
                  {t('common.create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Lesson Modal */}
      {showEditEnabler && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowEditEnabler(false)}
          />
          <div className="glass-effect border-accent/30 bg-background relative z-10 max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-3xl border p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {t('trainer.content.editLesson')}
              </h2>
              <button
                className="border-accent/30 rounded-md border px-2 py-1 text-sm"
                onClick={() => setShowEditEnabler(false)}
              >
                {t('common.close')}
              </button>
            </div>
            <div className="space-y-4">
              {/* Multi-difficulty quizzes management */}
              <div className="border-accent/20 bg-background/50 rounded-xl border p-3">
                <div className="mb-2 text-sm font-semibold">
                  {t('trainer.content.lessonQuizzes')}
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {(['LOW', 'MEDIUM', 'HIGH'] as const).map(level => {
                    const item = enablerQuizList.find(
                      q => q.difficulty === level
                    );
                    return (
                      <div
                        key={level}
                        className="border-accent/20 bg-background/40 rounded-lg border p-3"
                      >
                        <div className="text-muted-foreground mb-1 text-xs tracking-wide uppercase">
                          {level}
                        </div>
                        {item ? (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                className="truncate text-left font-medium hover:underline"
                                onClick={() =>
                                  router.push(
                                    `/trainer/enablers/${editingEnablerId}/quizzes/${item.quizId}`
                                  )
                                }
                                title={item.title}
                              >
                                {item.title || t('common.untitled')}
                              </button>
                              <span
                                className={`rounded-full border px-2 py-0.5 text-xs ${item.isActive ? 'border-green-500 text-green-600' : 'border-yellow-500 text-yellow-600'}`}
                              >
                                {item.isActive
                                  ? t('common.active')
                                  : t('common.inactive')}
                              </span>
                            </div>
                            <div className="text-muted-foreground text-xs">
                              {t('trainer.content.questionCount').replace(
                                '{count}',
                                String(item.questionCount ?? '-')
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="border-accent/30 rounded-md border px-2 py-1 text-xs"
                                onClick={() =>
                                  router.push(
                                    `/trainer/enablers/${editingEnablerId}/quizzes/${item.quizId}`
                                  )
                                }
                              >
                                {t('common.edit')}
                              </button>
                              <button
                                type="button"
                                className="border-accent/30 rounded-md border px-2 py-1 text-xs"
                                onClick={async () => {
                                  if (!editingEnablerId) return;
                                  try {
                                    await fetch(
                                      `/api/trainer/enablers/${editingEnablerId}/quizzes/${item.quizId}`,
                                      {
                                        method: 'PATCH',
                                        headers: {
                                          'Content-Type': 'application/json',
                                        },
                                        body: JSON.stringify({
                                          isActive: !item.isActive,
                                        }),
                                      }
                                    );
                                    const ql = await fetch(
                                      `/api/trainer/enablers/${editingEnablerId}/quizzes`
                                    );
                                    const qlj = await ql.json();
                                    setEnablerQuizList(qlj.quizzes || []);
                                  } catch (e) {
                                    console.error(e);
                                  }
                                }}
                              >
                                {item.isActive
                                  ? t('common.deactivate')
                                  : t('common.activate')}
                              </button>
                              <button
                                type="button"
                                className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600"
                                onClick={async () => {
                                  if (!editingEnablerId) return;
                                  const ok = window.confirm(
                                    t('trainer.content.confirmDeleteQuiz')
                                  );
                                  if (!ok) return;
                                  try {
                                    await fetch(
                                      `/api/trainer/enablers/${editingEnablerId}/quizzes/${item.quizId}`,
                                      { method: 'DELETE' }
                                    );
                                    const ql = await fetch(
                                      `/api/trainer/enablers/${editingEnablerId}/quizzes`
                                    );
                                    const qlj = await ql.json();
                                    setEnablerQuizList(qlj.quizzes || []);
                                  } catch (e) {
                                    console.error(e);
                                  }
                                }}
                              >
                                {t('common.delete')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="text-muted-foreground text-sm">
                              {t('trainer.content.noQuiz').replace(
                                '{level}',
                                level
                              )}
                            </div>
                            <button
                              type="button"
                              className="border-accent/30 rounded-md border px-2 py-1 text-xs"
                              onClick={() =>
                                router.push(
                                  `/trainer/enablers/${editingEnablerId}/quizzes/new?difficulty=${level}`
                                )
                              }
                            >
                              {t('common.create')}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t('common.title')}
                </label>
                <input
                  value={enablerTitle}
                  onChange={e => setEnablerTitle(e.target.value)}
                  className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t('common.description')}
                </label>
                <textarea
                  value={enablerDescription}
                  onChange={e => setEnablerDescription(e.target.value)}
                  className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                  rows={3}
                  placeholder={t(
                    'trainer.content.lessonDescriptionPlaceholder'
                  )}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('trainer.content.pptLink')}
                  </label>
                  <input
                    value={enablerPpt}
                    onChange={e => setEnablerPpt(e.target.value)}
                    className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                    placeholder="https://..."
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('trainer.content.videoLink')}
                  </label>
                  <input
                    value={enablerVideo}
                    onChange={e => setEnablerVideo(e.target.value)}
                    className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                    placeholder="https://..."
                  />
                </div>
              </div>

              {/* Theory PDFs Section */}
              <div className="border-accent/20 bg-background/30 rounded-xl border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blue-500" />
                    <span className="text-sm font-medium">{t('trainer.content.theoryPdfs')}</span>
                    {enablerDocuments.filter(d => d.documentType === 'THEORY' || !d.documentType).length > 0 && (
                      <span className="text-muted text-xs">
                        ({enablerDocuments.filter(d => d.documentType === 'THEORY' || !d.documentType).length})
                      </span>
                    )}
                  </div>
                </div>

                {/* Theory documents - inline pills */}
                {enablerDocuments.filter(d => d.documentType === 'THEORY' || !d.documentType).length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {enablerDocuments.filter(d => d.documentType === 'THEORY' || !d.documentType).map(doc => (
                      <div
                        key={doc.id}
                        className="flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-1"
                      >
                        <FileText className="h-3 w-3 flex-shrink-0 text-blue-500" />
                        <span className="max-w-[150px] truncate text-xs font-medium">
                          {doc.title}
                        </span>
                        {doc.storageUrl && (
                          <button
                            type="button"
                            onClick={() => setPreviewPdf({ title: doc.title, url: doc.storageUrl })}
                            className="text-muted cursor-pointer rounded p-0.5 transition-colors hover:bg-blue-500/20 hover:text-blue-400"
                            title={t('trainer.content.previewPdf')}
                          >
                            <Eye className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={async () => {
                            if (!trainerId || !editingEnablerId) return;
                            const ok = window.confirm(
                              t('trainer.content.confirmDeleteDoc')
                            );
                            if (!ok) return;
                            try {
                              await fetch(
                                `/api/trainer/enablers/${editingEnablerId}/documents?trainerId=${trainerId}&documentId=${doc.id}`,
                                { method: 'DELETE' }
                              );
                              setEnablerDocuments(prev =>
                                prev.filter(d => d.id !== doc.id)
                              );
                            } catch (err) {
                              console.error(err);
                            }
                          }}
                          className="text-muted rounded p-0.5 transition-colors hover:bg-red-500/20 hover:text-red-400"
                          title={t('common.remove')}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Upload Theory PDF */}
                <PdfUploader
                  compact
                  userId={trainerId || ''}
                  onUpload={async url => {
                    if (!trainerId || !editingEnablerId) return;
                    const fileName = url.split('/').pop() || 'document.pdf';
                    const title = fileName
                      .replace(/^\d+_/, '')
                      .replace(/\.pdf$/i, '');
                    try {
                      const res = await fetch(
                        `/api/trainer/enablers/${editingEnablerId}/documents?trainerId=${trainerId}`,
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            title,
                            fileName,
                            storageUrl: url,
                            documentType: 'THEORY',
                          }),
                        }
                      );
                      if (res.ok) {
                        const data = await res.json();
                        setEnablerDocuments(prev => [...prev, data.document]);
                      }
                    } catch (err) {
                      console.error(err);
                    }
                  }}
                  disabled={!editingEnablerId}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('trainer.content.durationDays')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={enablerDuration}
                    onChange={e => setEnablerDuration(e.target.value)}
                    className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                    placeholder={t('trainer.content.durationPlaceholder')}
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={enablerActive}
                      onChange={e => setEnablerActive(e.target.checked)}
                    />
                    <span>{t('common.active')}</span>
                  </label>
                </div>
              </div>
              {/* Scenario PDFs Section */}
              <div className="border-accent/20 bg-background/30 rounded-xl border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-amber-500" />
                    <span className="text-sm font-medium">{t('trainer.content.scenarioPdfs')}</span>
                    {enablerDocuments.filter(d => d.documentType === 'EXERCISE').length > 0 && (
                      <span className="text-muted text-xs">
                        ({enablerDocuments.filter(d => d.documentType === 'EXERCISE').length})
                      </span>
                    )}
                  </div>
                </div>

                {/* Scenario documents - inline pills */}
                {enablerDocuments.filter(d => d.documentType === 'EXERCISE').length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {enablerDocuments.filter(d => d.documentType === 'EXERCISE').map(doc => (
                      <div
                        key={doc.id}
                        className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1"
                      >
                        <FileText className="h-3 w-3 flex-shrink-0 text-amber-500" />
                        <span className="max-w-[150px] truncate text-xs font-medium">
                          {doc.title}
                        </span>
                        {doc.storageUrl && (
                          <button
                            type="button"
                            onClick={() => setPreviewPdf({ title: doc.title, url: doc.storageUrl })}
                            className="text-muted cursor-pointer rounded p-0.5 transition-colors hover:bg-amber-500/20 hover:text-amber-400"
                            title={t('trainer.content.previewPdf')}
                          >
                            <Eye className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={async () => {
                            if (!trainerId || !editingEnablerId) return;
                            const ok = window.confirm(
                              t('trainer.content.confirmDeleteDoc')
                            );
                            if (!ok) return;
                            try {
                              await fetch(
                                `/api/trainer/enablers/${editingEnablerId}/documents?trainerId=${trainerId}&documentId=${doc.id}`,
                                { method: 'DELETE' }
                              );
                              setEnablerDocuments(prev =>
                                prev.filter(d => d.id !== doc.id)
                              );
                            } catch (err) {
                              console.error(err);
                            }
                          }}
                          className="text-muted rounded p-0.5 transition-colors hover:bg-red-500/20 hover:text-red-400"
                          title={t('common.remove')}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Legacy single scenario PDF */}
                {enablerScenarioPdf && (
                  <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-green-500/30 bg-green-500/10 px-2 py-1">
                    <FileText className="h-3 w-3 text-green-500" />
                    <span className="text-xs truncate max-w-[200px]">{enablerScenarioPdf.split('/').pop()}</span>
                    <button
                      type="button"
                      onClick={() => setPreviewPdf({ title: 'Scenario', url: enablerScenarioPdf })}
                      className="text-muted cursor-pointer rounded p-0.5 transition-colors hover:bg-green-500/20 hover:text-green-400"
                      title={t('trainer.content.previewPdf')}
                    >
                      <Eye className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEnablerScenarioPdf('')}
                      className="text-muted rounded p-0.5 transition-colors hover:bg-red-500/20 hover:text-red-400"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}

                {/* Upload Scenario PDF */}
                <PdfUploader
                  compact
                  userId={trainerId || ''}
                  onUpload={async url => {
                    if (!trainerId || !editingEnablerId) return;
                    const fileName = url.split('/').pop() || 'scenario.pdf';
                    const title = fileName
                      .replace(/^\d+_/, '')
                      .replace(/\.pdf$/i, '');
                    try {
                      const res = await fetch(
                        `/api/trainer/enablers/${editingEnablerId}/documents?trainerId=${trainerId}`,
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            title,
                            fileName,
                            storageUrl: url,
                            documentType: 'EXERCISE',
                          }),
                        }
                      );
                      if (res.ok) {
                        const data = await res.json();
                        setEnablerDocuments(prev => [...prev, data.document]);
                      }
                    } catch (err) {
                      console.error(err);
                    }
                  }}
                  disabled={!editingEnablerId}
                />
              </div>

              {/* Legacy inline Quiz-Fragen removed. Use the multi-difficulty section above to manage quizzes. */}
              <div className="flex justify-end gap-2">
                <button
                  className="border-accent/30 rounded-md border px-4 py-2"
                  type="button"
                  onClick={() => setShowEditEnabler(false)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2"
                  onClick={async () => {
                    if (!trainerId) {
                      alert(t('trainer.content.errorNoTrainer'));
                      return;
                    }
                    if (!editingEnablerId) {
                      alert(t('trainer.content.errorNoLessonSelected'));
                      return;
                    }
                    if (!enablerTitle.trim()) {
                      alert(t('trainer.content.errorNoTitle'));
                      return;
                    }
                    try {
                      // PATCH enabler details
                      const pr = await fetch(
                        `/api/trainer/enablers/${editingEnablerId}?trainerId=${trainerId}`,
                        {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            title: enablerTitle.trim(),
                            descriptionText: enablerDescription.trim() || null,
                            scenarioPdfUrl: enablerScenarioPdf.trim() || null,
                            pptUrl: enablerPpt.trim() || null,
                            videoUrl: enablerVideo.trim() || null,
                            durationValue: enablerDuration
                              ? Number(enablerDuration)
                              : null,
                            durationUnit: enablerDuration ? 'DAYS' : null,
                            isActive: enablerActive,
                          }),
                        }
                      );
                      if (!pr.ok)
                        throw new Error(
                          t('trainer.content.errorLessonUpdateFailed')
                        );

                      // Refresh and close
                      const r = await fetch(
                        `/api/trainer/courses/${courseId}?trainerId=${trainerId}`
                      );
                      const fresh = await r.json();
                      setEnablers(
                        (fresh.enablers || []).map((x: any) => ({
                          id: x.id,
                          title: x.title,
                          isActive: !!x.isActive,
                        }))
                      );
                      setShowEditEnabler(false);
                      setEditingEnablerId(null);
                    } catch (e: any) {
                      alert(e?.message || t('common.unknownError'));
                    }
                  }}
                >
                  {t('common.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Use Case Modal */}
      {showEditUseCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowEditUseCase(false)}
          />
          <div className="glass-effect border-accent/30 bg-background relative z-10 w-full max-w-xl rounded-3xl border p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {t('trainer.content.editUseCase')}
              </h2>
              <button
                className="border-accent/30 rounded-md border px-2 py-1 text-sm"
                onClick={() => setShowEditUseCase(false)}
              >
                {t('common.close')}
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t('common.title')}
                </label>
                <input
                  value={useCaseEditTitle}
                  onChange={e => setUseCaseEditTitle(e.target.value)}
                  className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t('common.description')}
                </label>
                <textarea
                  value={useCaseEditDesc}
                  onChange={e => setUseCaseEditDesc(e.target.value)}
                  className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('trainer.content.trainingYear')}
                  </label>
                  <select
                    value={useCaseEditYear}
                    onChange={e => setUseCaseEditYear(e.target.value as any)}
                    className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                  >
                    <option value="">{t('common.select')}</option>
                    <option value="1">{t('common.year1')}</option>
                    <option value="2">{t('common.year2')}</option>
                    <option value="3">{t('common.year3')}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('trainer.content.trainingStage')}
                  </label>
                  <select
                    value={useCaseEditStage}
                    onChange={e => setUseCaseEditStage(e.target.value as any)}
                    className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                  >
                    <option value="">{t('common.select')}</option>
                    <option value="1">{t('trainer.content.stage1')}</option>
                    <option value="2">{t('trainer.content.stage2')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  {t('common.lernfelder')}
                </label>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {Array.from({ length: 12 }, (_, i) => `LF-${i + 1}`).map(
                    lf => (
                      <label
                        key={lf}
                        className="border-accent/20 bg-background/40 hover:bg-background/60 flex cursor-pointer items-center gap-2 rounded-lg border p-2"
                      >
                        <input
                          type="checkbox"
                          checked={useCaseEditLernfelder.includes(lf)}
                          onChange={e => {
                            if (e.target.checked)
                              setUseCaseEditLernfelder(prev => [...prev, lf]);
                            else
                              setUseCaseEditLernfelder(prev =>
                                prev.filter(x => x !== lf)
                              );
                          }}
                          className="border-accent/30 bg-background/50 rounded"
                        />
                        <span className="text-xs font-medium">{lf}</span>
                      </label>
                    )
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('trainer.content.durationDays')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={useCaseEditDuration}
                    onChange={e => setUseCaseEditDuration(e.target.value)}
                    className="border-accent/20 bg-background/60 w-full rounded-xl border px-3 py-2"
                    placeholder={t('trainer.content.durationPlaceholder')}
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={useCaseEditActive}
                      onChange={e => setUseCaseEditActive(e.target.checked)}
                    />
                    <span>{t('common.active')}</span>
                  </label>
                </div>
              </div>

              {/* PDF Documents Section - Compact */}
              <div className="border-accent/20 bg-background/30 rounded-xl border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-red-500" />
                    <span className="text-sm font-medium">PDFs</span>
                    {useCaseDocuments.length > 0 && (
                      <span className="text-muted text-xs">
                        ({useCaseDocuments.length})
                      </span>
                    )}
                  </div>
                </div>

                {/* Uploaded documents - inline pills */}
                {useCaseDocuments.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {useCaseDocuments.map(doc => (
                      <div
                        key={doc.id}
                        className="flex items-center gap-1.5 rounded-lg border border-green-500/30 bg-green-500/10 px-2 py-1"
                      >
                        <FileText className="h-3 w-3 flex-shrink-0 text-green-500" />
                        <span className="max-w-[150px] truncate text-xs font-medium">
                          {doc.title}
                        </span>
                        {doc.documentType && (
                          <span className={`rounded px-1 py-0.5 text-[10px] font-medium leading-none ${
                            doc.documentType === 'THEORY' ? 'bg-blue-500/20 text-blue-400'
                            : doc.documentType === 'EXERCISE' ? 'bg-purple-500/20 text-purple-400'
                            : 'bg-amber-500/20 text-amber-400'
                          }`}>
                            {doc.documentType === 'THEORY' ? 'T' : doc.documentType === 'EXERCISE' ? 'E' : 'S'}
                          </span>
                        )}
                        {doc.storageUrl && (
                          <button
                            type="button"
                            onClick={() => setPreviewPdf({ title: doc.title, url: doc.storageUrl })}
                            className="text-muted cursor-pointer rounded p-0.5 transition-colors hover:bg-blue-500/20 hover:text-blue-400"
                            title={t('trainer.content.previewPdf')}
                          >
                            <Eye className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={async () => {
                            if (!trainerId || !editingUseCaseId) return;
                            const ok = window.confirm(
                              t('trainer.content.confirmDeleteDoc')
                            );
                            if (!ok) return;
                            try {
                              await fetch(
                                `/api/trainer/use-cases/${editingUseCaseId}/documents?trainerId=${trainerId}&documentId=${doc.id}`,
                                { method: 'DELETE' }
                              );
                              setUseCaseDocuments(prev =>
                                prev.filter(d => d.id !== doc.id)
                              );
                            } catch (err) {
                              console.error(err);
                            }
                          }}
                          className="text-muted rounded p-0.5 transition-colors hover:bg-red-500/20 hover:text-red-400"
                          title={t('common.remove')}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Compact PDF Upload */}
                <PdfUploader
                  compact
                  userId={trainerId || ''}
                  onUpload={async url => {
                    if (!trainerId || !editingUseCaseId) return;
                    const fileName = url.split('/').pop() || 'document.pdf';
                    const title = fileName
                      .replace(/^\d+_/, '')
                      .replace(/\.pdf$/i, '');
                    try {
                      const res = await fetch(
                        `/api/trainer/use-cases/${editingUseCaseId}/documents?trainerId=${trainerId}`,
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            title,
                            fileName,
                            storageUrl: url,
                            documentType: 'THEORY',
                          }),
                        }
                      );
                      if (res.ok) {
                        const data = await res.json();
                        setUseCaseDocuments(prev => [...prev, data.document]);
                      }
                    } catch (err) {
                      console.error(err);
                    }
                  }}
                  disabled={!editingUseCaseId}
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  className="border-accent/30 rounded-md border px-4 py-2"
                  type="button"
                  onClick={() => setShowEditUseCase(false)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2"
                  onClick={async () => {
                    if (!trainerId) {
                      alert(t('trainer.content.errorNoTrainer'));
                      return;
                    }
                    if (!editingUseCaseId) {
                      alert(t('trainer.content.errorNoUseCaseSelected'));
                      return;
                    }
                    if (!useCaseEditTitle.trim()) {
                      alert(t('trainer.content.errorNoTitle'));
                      return;
                    }
                    if (!useCaseEditDesc.trim()) {
                      alert(t('trainer.content.errorNoDescription'));
                      return;
                    }
                    try {
                      const pr = await fetch(
                        `/api/trainer/use-cases/${editingUseCaseId}?trainerId=${trainerId}`,
                        {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            title: useCaseEditTitle.trim(),
                            descriptionText: useCaseEditDesc.trim(),
                            durationValue: useCaseEditDuration
                              ? Number(useCaseEditDuration)
                              : null,
                            durationUnit: useCaseEditDuration ? 'DAYS' : null,
                            isActive: useCaseEditActive,
                            year: useCaseEditYear || null,
                            trainingStage: useCaseEditStage || null,
                            lernfelder:
                              useCaseEditLernfelder.length > 0
                                ? useCaseEditLernfelder
                                : [],
                          }),
                        }
                      );
                      if (!pr.ok)
                        throw new Error(
                          t('trainer.content.errorUseCaseUpdateFailed')
                        );
                      const r = await fetch(
                        `/api/trainer/courses/${courseId}?trainerId=${trainerId}`
                      );
                      const fresh = await r.json();
                      setUseCases(
                        (fresh.useCases || []).map((x: any) => ({
                          id: x.id,
                          title: x.title,
                          isActive: !!x.isActive,
                        }))
                      );
                      setShowEditUseCase(false);
                      setEditingUseCaseId(null);
                    } catch (e: any) {
                      alert(e?.message || t('common.unknownError'));
                    }
                  }}
                >
                  {t('common.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* PDF Preview Modal */}
      {previewPdf && (
        <FlipbookViewer
          pdfUrl={previewPdf.url}
          title={previewPdf.title}
          isOpen={!!previewPdf}
          onClose={() => setPreviewPdf(null)}
        />
      )}
    </div>
  );
}
