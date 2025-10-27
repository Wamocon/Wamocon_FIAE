'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Edit,
  Trash2,
  FileQuestion,
  Clock,
  Target,
  Users,
  BarChart3,
  Search,
  Filter,
  Eye,
  Copy,
  MoreVertical,
} from 'lucide-react';

type QuizItem = {
  id: string;
  title: string;
  quiz_type: 'mini' | 'big';
  training_year: number;
  time_limit_minutes: number;
  module_id?: string | null;
  lesson_id?: string | null;
  module_title?: string | null;
  lesson_title?: string | null;
};

export function QuizManagement() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedYear, setSelectedYear] = useState('all');

  const [quizzes, setQuizzes] = useState<QuizItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (searchTerm.trim()) params.set('q', searchTerm.trim());
        if (selectedYear) params.set('year', selectedYear);
        const res = await fetch(`/api/trainer/quizzes?${params.toString()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load quizzes');
        const data = await res.json();
        setQuizzes(data.quizzes || []);
      } catch (e: any) {
        setError(e?.message || 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [searchTerm, selectedYear]);

  const filteredQuizzes = useMemo(() => quizzes, [quizzes]);

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-foreground mb-2 text-3xl font-bold">
              Quiz-Verwaltung
            </h1>
            <p className="text-muted">
              Erstellen und verwalten Sie Tests und Quizze für Ihre
              Auszubildenden
            </p>
          </div>
          <button
            onClick={() => router.push('/trainer/quiz-management/new-quiz')}
            className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 flex transform items-center gap-2 rounded-2xl bg-gradient-to-r px-6 py-3 font-semibold text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
          >
            <Plus className="h-5 w-5" />
            Neues Quiz
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg">
        <div className="flex flex-col items-center justify-between gap-4 lg:flex-row">
          {/* Search and Filters */}
          <div className="flex flex-1 flex-col gap-4 sm:flex-row">
            <div className="relative max-w-md flex-1">
              <Search className="text-muted absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Nach Quizzen suchen..."
                className="bg-background/50 border-accent/30 focus:ring-accent text-foreground w-full rounded-2xl border py-3 pr-4 pl-10 focus:border-transparent focus:ring-2 focus:outline-none"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>

            <select
              value={selectedYear}
              onChange={e => setSelectedYear(e.target.value)}
              className="bg-background/50 border-accent/30 focus:ring-accent text-foreground rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
            >
              <option value="all">Alle Jahre</option>
              <option value="1">Jahr 1</option>
              <option value="2">Jahr 2</option>
              <option value="3">Jahr 3</option>
            </select>
          </div>

          {/* Stats */}
          <div className="text-muted flex items-center gap-4 text-sm">
            <span>{filteredQuizzes.length} Quizze gefunden</span>
          </div>
        </div>
      </div>

      {/* Quiz Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filteredQuizzes.map(quiz => (
          <div
            key={quiz.id}
            className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg transition-all duration-300 hover:shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between">
              <div className="from-accent to-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
                <FileQuestion className="h-6 w-6 text-white" />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    if (!window.confirm('Quiz löschen? Dies löscht auch alle Fragen und Optionen.')) return;
                    try {
                      const res = await fetch(`/api/trainer/quizzes/${quiz.id}`, { method: 'DELETE' });
                      if (!res.ok) throw new Error('Fehler beim Löschen');
                      setQuizzes(prev => prev.filter(q => q.id !== quiz.id));
                    } catch (e: any) {
                      alert(e?.message || 'Unbekannter Fehler');
                    }
                  }}
                  className="text-muted rounded-xl p-2 transition-all duration-200 hover:bg-red-500/10 hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <h3 className="text-foreground mb-2 text-xl font-bold truncate">
              {quiz.title}
            </h3>
            <div className="mb-4 text-sm text-muted">
              <span className="rounded-full bg-muted/30 px-3 py-1">{quiz.quiz_type === 'mini' ? 'Mini' : 'Groß'}</span>
            </div>

            {/* Quiz Details */}
            <div className="mb-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <div className="text-muted flex items-center">
                  <Clock className="mr-2 h-4 w-4" />
                  Zeitlimit
                </div>
                <span className="text-foreground font-medium">
                  {quiz.time_limit_minutes} Min.
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Trainingsjahr</span>
                <span className="text-foreground font-medium">{quiz.training_year}</span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Zuordnung</span>
                <span className="text-foreground max-w-[60%] truncate text-right">
                  {quiz.lesson_title || quiz.module_title || '—'}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="border-accent/30 flex items-center justify-between border-t pt-4">
              <div />
              <div className="text-xs text-muted">Zuletzt aktualisiert</div>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {filteredQuizzes.length === 0 && !loading && (
        <div className="glass-effect border-accent/30 rounded-3xl border p-12 text-center shadow-lg">
          <div className="from-muted to-muted/30 mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br">
            <FileQuestion className="text-muted h-10 w-10" />
          </div>
          <h3 className="text-foreground mb-2 text-xl font-semibold">
            Keine Quizze gefunden
          </h3>
          <p className="text-muted mb-6">
            {searchTerm || selectedYear !== 'all'
              ? 'Versuchen Sie andere Suchkriterien oder Filter.'
              : 'Erstellen Sie Ihr erstes Quiz, um zu beginnen.'}
          </p>
          <button
            onClick={() => router.push('/trainer/quiz-management/new')}
            className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 transform rounded-2xl bg-gradient-to-r px-6 py-3 font-medium text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
          >
            Neues Quiz erstellen
          </button>
        </div>
      )}
    </div>
  );
}
