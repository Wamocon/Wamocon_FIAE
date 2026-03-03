'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  FileText,
  Plus,
  Calendar,
  Clock,
  User,
  AlertCircle,
  X,
  Trash2,
} from 'lucide-react';

interface Exam {
  id: string;
  examDate: string;
  dayOfWeek: string | null;
  period: string | null;
  teacher: string | null;
  subject: string;
  examTypeValue: string | null;
  lernfeldCode: string | null;
  notes: string | null;
  isPersonal: boolean;
  result?: {
    grade: string | null;
    points: number | null;
    passed: boolean | null;
  } | null;
  meta?: {
    daysUntil: number;
    isPast: boolean;
    isToday: boolean;
    isSoon: boolean;
  };
}

const EXAM_TYPES = {
  KLAUSUR: {
    labelKey: 'exams.type.klausur',
    bg: 'bg-rose-500/20',
    text: 'text-rose-600 dark:text-rose-400',
    border: 'border-rose-500/30',
  },
  TEST: {
    labelKey: 'exams.type.test',
    bg: 'bg-amber-500/20',
    text: 'text-amber-600 dark:text-amber-400',
    border: 'border-amber-500/30',
  },
  ABGABE: {
    labelKey: 'exams.type.abgabe',
    bg: 'bg-blue-500/20',
    text: 'text-blue-600 dark:text-blue-400',
    border: 'border-blue-500/30',
  },
  PRAESENTATION: {
    labelKey: 'exams.type.praesentation',
    bg: 'bg-violet-500/20',
    text: 'text-violet-600 dark:text-violet-400',
    border: 'border-violet-500/30',
  },
  MUENDLICH: {
    labelKey: 'exams.type.muendlich',
    bg: 'bg-green-500/20',
    text: 'text-green-600 dark:text-green-400',
    border: 'border-green-500/30',
  },
};

export function ExamManager() {
  const { profile } = useAuth();
  const { t } = useLanguage();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [activeView, setActiveView] = useState<'upcoming' | 'past'>('upcoming');

  useEffect(() => {
    if (!profile?.id) return;
    loadExams();
  }, [profile?.id, activeView]);

  const loadExams = async () => {
    if (!profile?.id) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/trainee/school/exams?traineeId=${profile.id}&upcoming=${activeView === 'upcoming'}`,
        { cache: 'no-store' }
      );
      if (!res.ok) throw new Error(t('exams.error.load'));
      const data = await res.json();
      setExams(data.exams || []);
    } catch (e: any) {
      setError(e.message);
      setExams([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddExam = async (examData: Partial<Exam>) => {
    if (!profile?.id) return;

    try {
      const res = await fetch('/api/trainee/school/exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          traineeId: profile.id,
          ...examData,
        }),
      });

      if (!res.ok) throw new Error(t('exams.error.add'));

      const data = await res.json();
      // Optimistic: add the new exam to state immediately
      if (data.exam) {
        setExams(prev => [...prev, data.exam]);
      }
      setShowAddModal(false);
      // Background refresh to ensure data consistency
      loadExams();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDeleteExam = async (examId: string) => {
    if (!confirm(t('exams.deleteConfirm'))) return;

    // Optimistic: remove from state immediately
    setExams(prev => prev.filter(e => e.id !== examId));

    try {
      const res = await fetch(`/api/trainee/school/exams/${examId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(t('exams.error.delete'));
      // Background refresh
      loadExams();
    } catch (e: any) {
      setError(e.message);
      // Revert on error — re-fetch the full list
      loadExams();
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('de-DE', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const getCountdownText = (daysUntil: number) => {
    if (daysUntil === 0) return t('exams.today');
    if (daysUntil === 1) return t('exams.tomorrow');
    if (daysUntil < 0)
      return t('exams.daysAgo').replace('{days}', String(Math.abs(daysUntil)));
    if (daysUntil <= 7)
      return t('exams.inDays').replace('{days}', String(daysUntil));
    if (daysUntil <= 14)
      return t('exams.inWeek').replace(
        '{weeks}',
        String(Math.ceil(daysUntil / 7))
      );
    return t('exams.inWeeks').replace(
      '{weeks}',
      String(Math.ceil(daysUntil / 7))
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-foreground text-xl font-bold">
            {t('exams.title')}
          </h2>
          <p className="text-muted-foreground text-sm">
            {exams.length}{' '}
            {activeView === 'upcoming'
              ? t('exams.upcomingCount')
              : t('exams.pastCount')}{' '}
            {t('exams.examsLabel')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="bg-card border-border flex rounded-xl border p-1">
            <button
              onClick={() => setActiveView('upcoming')}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                activeView === 'upcoming'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {t('exams.upcoming')}
            </button>
            <button
              onClick={() => setActiveView('past')}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                activeView === 'past'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {t('exams.past')}
            </button>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="btn-accent flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{t('exams.add')}</span>
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-destructive/10 border-destructive/20 flex items-center gap-3 rounded-xl border p-4">
          <AlertCircle className="text-destructive h-5 w-5" />
          <p className="text-destructive text-sm">{error}</p>
          <button
            onClick={() => setError(null)}
            className="hover:bg-destructive/10 ml-auto rounded p-1"
          >
            <X className="text-destructive h-4 w-4" />
          </button>
        </div>
      )}

      {/* Exams List */}
      {exams.length === 0 ? (
        <div className="glass-effect rounded-2xl py-12 text-center">
          <FileText className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
          <p className="text-muted-foreground">
            {activeView === 'upcoming'
              ? t('exams.noUpcoming')
              : t('exams.noPast')}
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="text-accent mt-4 text-sm hover:underline"
          >
            {t('exams.addExam')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {exams.map(exam => {
            const examType = exam.examTypeValue
              ? EXAM_TYPES[exam.examTypeValue as keyof typeof EXAM_TYPES]
              : null;
            const isUrgent = exam.meta?.isSoon && !exam.meta?.isPast;

            return (
              <div
                key={exam.id}
                className={`glass-effect glass-static rounded-xl p-4 transition-all duration-200 hover:scale-[1.005] hover:shadow-md ${isUrgent ? 'border-destructive/40 hover:border-destructive/60 border-2' : 'hover:border-accent/40'} `}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-foreground font-semibold">
                        {exam.subject}
                      </h3>
                      {examType && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${examType.bg} ${examType.text}`}
                        >
                          {t(examType.labelKey)}
                        </span>
                      )}
                      {exam.lernfeldCode && (
                        <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400">
                          {exam.lernfeldCode}
                        </span>
                      )}
                    </div>

                    <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-4 text-sm">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {formatDate(exam.examDate)}
                      </span>
                      {exam.period && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {exam.period}
                          {t('exams.periodSuffix')}
                        </span>
                      )}
                      {exam.teacher && (
                        <span className="flex items-center gap-1">
                          <User className="h-3.5 w-3.5" />
                          {exam.teacher}
                        </span>
                      )}
                    </div>

                    {exam.notes && (
                      <p className="text-muted-foreground mt-2 text-sm">
                        {exam.notes}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Countdown */}
                    {exam.meta && activeView === 'upcoming' && (
                      <div
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                          exam.meta.isToday
                            ? 'bg-destructive text-white'
                            : exam.meta.isSoon
                              ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                              : 'bg-muted text-muted-foreground'
                        } `}
                      >
                        {getCountdownText(exam.meta.daysUntil)}
                      </div>
                    )}

                    {/* Delete */}
                    <button
                      onClick={() => handleDeleteExam(exam.id)}
                      className="hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded-lg p-2 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Exam Modal */}
      {showAddModal && (
        <AddExamModal
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddExam}
        />
      )}
    </div>
  );
}

// Add Exam Modal
function AddExamModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (data: Partial<Exam>) => void;
}) {
  const { t } = useLanguage();
  const [examDate, setExamDate] = useState('');
  const [subject, setSubject] = useState('');
  const [examType, setExamType] = useState('');
  const [period, setPeriod] = useState('');
  const [teacher, setTeacher] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!examDate || !subject) return;

    onAdd({
      examDate: new Date(examDate).toISOString(),
      subject,
      examTypeValue: examType || null,
      period: period || null,
      teacher: teacher || null,
      notes: notes || null,
      isPersonal: true,
    } as Partial<Exam>);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="bg-card border-border w-full max-w-md overflow-hidden rounded-2xl border shadow-2xl">
        <div className="border-border border-b p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-foreground text-lg font-bold">
              {t('exams.addExam')}
            </h3>
            <button
              onClick={onClose}
              className="hover:bg-muted text-foreground rounded-lg p-2 transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div>
            <label className="text-foreground mb-2 block text-sm font-medium">
              {t('exams.date')} *
            </label>
            <input
              type="date"
              value={examDate}
              onChange={e => setExamDate(e.target.value)}
              className="w-full rounded-xl px-4 py-3"
              required
            />
          </div>

          <div>
            <label className="text-foreground mb-2 block text-sm font-medium">
              {t('exams.subject')}
            </label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="w-full rounded-xl px-4 py-3"
              placeholder={t('exams.subjectPlaceholder')}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-foreground mb-2 block text-sm font-medium">
                {t('exams.type')}
              </label>
              <select
                value={examType}
                onChange={e => setExamType(e.target.value)}
                className="bg-muted border-border text-foreground w-full rounded-xl border px-4 py-3"
              >
                <option value="">{t('exams.selectType')}</option>
                <option value="KLAUSUR">{t('exams.type.klausur')}</option>
                <option value="TEST">{t('exams.type.test')}</option>
                <option value="ABGABE">{t('exams.type.abgabe')}</option>
                <option value="PRAESENTATION">
                  {t('exams.type.praesentation')}
                </option>
                <option value="MUENDLICH">{t('exams.type.muendlich')}</option>
              </select>
            </div>

            <div>
              <label className="text-foreground mb-2 block text-sm font-medium">
                {t('exams.periodLabel')}
              </label>
              <input
                type="text"
                value={period}
                onChange={e => setPeriod(e.target.value)}
                className="w-full rounded-xl px-4 py-3"
                placeholder={t('exams.periodPlaceholder')}
              />
            </div>
          </div>

          <div>
            <label className="text-foreground mb-2 block text-sm font-medium">
              {t('exams.teacher')}
            </label>
            <input
              type="text"
              value={teacher}
              onChange={e => setTeacher(e.target.value)}
              className="w-full rounded-xl px-4 py-3"
              placeholder={t('exams.teacherPlaceholder')}
            />
          </div>

          <div>
            <label className="text-foreground mb-2 block text-sm font-medium">
              {t('exams.notes')}
            </label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full rounded-xl px-4 py-3"
              placeholder={t('exams.notesPlaceholder')}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="glass-effect text-foreground flex-1 rounded-xl px-4 py-3 font-medium"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn-accent flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 font-medium"
            >
              <Plus className="h-4 w-4" />
              {t('exams.add')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
