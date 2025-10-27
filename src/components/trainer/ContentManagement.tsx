'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Edit,
  Trash2,
  BookOpen,
  FolderOpen,
  FileText,
  Eye,
  MoreVertical,
  Search,
  Filter,
  Trash,
} from 'lucide-react';

type LessonItem = { id: string; title: string; subLessonsCount: number };
type ModuleItem = {
  id: string;
  title: string;
  training_year: number;
  lessonsCount: number;
  subLessonsCount: number;
  lessons: LessonItem[];
};

export function ContentManagement() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedYear, setSelectedYear] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const [modules, setModules] = useState<ModuleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (searchTerm.trim()) params.set('q', searchTerm.trim());
        if (selectedYear) params.set('year', selectedYear);
        const res = await fetch(`/api/trainer/content?${params.toString()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load content');
        const data = await res.json();
        setModules(data.modules || []);
      } catch (e: any) {
        setError(e?.message || 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [searchTerm, selectedYear]);

  const filteredCurriculum = useMemo(() => modules, [modules]);

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-foreground mb-2 text-3xl font-bold">
              Inhalts-Verwaltung
            </h1>
            <p className="text-muted">
              Verwalten Sie Lernmodule, Kapitel und Lektionen
            </p>
          </div>
          <button
            onClick={() => {
              // Navigate to new module page with form
              router.push('/trainer/content-management/new');
            }}
            className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 flex transform items-center gap-2 rounded-2xl bg-gradient-to-r px-6 py-3 font-semibold text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
          >
            <Plus className="h-5 w-5" />
            Neues Modul
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
                placeholder="Nach Modulen suchen..."
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

          {/* View Mode Toggle */}
          <div className="bg-muted/30 flex rounded-2xl p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 ${
                viewMode === 'grid'
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              Grid
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 ${
                viewMode === 'list'
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              Liste
            </button>
          </div>
        </div>
      </div>

      {/* Content Grid/List */}
      {loading && (
        <div className="text-muted">Lade Inhalte…</div>
      )}
      {error && (
        <div className="text-red-500">{error}</div>
      )}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredCurriculum.map(module => (
            <div
              key={module.id}
              className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg transition-all duration-300 hover:shadow-xl h-[420px] flex flex-col"
            >
              <div className="mb-4 flex items-start justify-between">
                <div className="from-accent to-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
                  <BookOpen className="h-6 w-6 text-white" />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => router.push(`/trainer/content-management/${module.id}/edit`)}
                    className="text-muted hover:text-accent hover:bg-accent/10 rounded-xl p-2 transition-all duration-200"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm('Modul löschen? Dies löscht auch alle enthaltenen Kapitel.')) return;
                      try {
                        const res = await fetch(`/api/trainer/content/modules/${module.id}`, { method: 'DELETE' });
                        if (!res.ok) throw new Error('Fehler beim Löschen');
                        setModules(prev => prev.filter(m => m.id !== module.id));
                      } catch (e: any) {
                        alert(e?.message || 'Unbekannter Fehler');
                      }
                    }}
                    className="text-muted rounded-xl p-2 transition-all duration-200 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <h3 className="text-foreground mb-2 text-xl font-bold truncate">
                {module.title}
              </h3>
              <div className="text-muted mb-4 flex items-center gap-2 text-sm">
                <span className="bg-accent rounded-full px-3 py-1 font-medium text-white">
                  Jahr {module.training_year}
                </span>
                <span className="bg-muted/30 text-muted rounded-full px-3 py-1">
                  {module.lessons.length} Kapitel
                </span>
              </div>

              <div className="mb-4 space-y-3 flex-1 overflow-y-auto pr-1">
                {module.lessons.map((lesson, index) => (
                  <div
                    key={index}
                    className="bg-muted/30 flex items-center gap-3 rounded-xl p-3"
                  >
                    <FolderOpen className="text-muted h-4 w-4" />
                    <div className="min-w-0 flex-1">
                      <h4 className="text-foreground text-sm font-medium truncate">
                        {lesson.title}
                      </h4>
                      <p className="text-muted text-xs">
                        {lesson.subLessonsCount} Lektionen
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-accent/30 flex items-center justify-between border-t pt-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={async () => {
                      const title = window.prompt('Kapitel (Lektion) Titel');
                      if (!title) return;
                      try {
                        const res = await fetch(`/api/trainer/content/modules/${module.id}/lessons`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ title }),
                        });
                        if (!res.ok) throw new Error('Fehler beim Erstellen');
                        const rj = await res.json();
                        setModules(prev => prev.map(m => (m.id === module.id ? { ...m, lessons: [{ id: rj.lesson.id, title: rj.lesson.title, subLessonsCount: 0 }, ...m.lessons], lessonsCount: m.lessonsCount + 1 } : m)));
                      } catch (e: any) {
                        alert(e?.message || 'Unbekannter Fehler');
                      }
                    }}
                    className="text-accent hover:text-accent/90 text-sm font-medium"
                  >
                    Neues Kapitel
                  </button>
                  <button className="text-accent hover:text-accent/90 text-sm font-medium">
                    Alle Kapitel anzeigen
                  </button>
                </div>
                <button className="text-muted hover:text-foreground text-sm">
                  <MoreVertical className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredCurriculum.map(module => (
            <div
              key={module.id}
              className="glass-effect border-accent/30 rounded-2xl border p-6 shadow-lg"
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="from-accent to-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
                    <BookOpen className="h-6 w-6 text-white" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-foreground text-xl font-bold truncate">
                      {module.title}
                    </h3>
                    <div className="text-muted flex items-center gap-2 text-sm">
                      <span>Jahr {module.training_year}</span>
                      <span>•</span>
                      <span>{module.lessons.length} Kapitel</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => router.push(`/trainer/content-management/${module.id}/edit`)}
                    className="text-muted hover:text-accent hover:bg-accent/10 rounded-xl p-2 transition-all duration-200"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm('Modul löschen? Dies löscht auch alle enthaltenen Kapitel.')) return;
                      try {
                        const res = await fetch(`/api/trainer/content/modules/${module.id}`, { method: 'DELETE' });
                        if (!res.ok) throw new Error('Fehler beim Löschen');
                        setModules(prev => prev.filter(m => m.id !== module.id));
                      } catch (e: any) {
                        alert(e?.message || 'Unbekannter Fehler');
                      }
                    }}
                    className="text-muted rounded-xl p-2 transition-all duration-200 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {module.lessons.map((lesson, index) => (
                  <div
                    key={index}
                    className="bg-muted/30 border-accent/30 rounded-xl border p-4 h-28 flex flex-col overflow-hidden"
                  >
                    <div className="flex-1">
                      <h4 className="text-foreground flex items-start gap-2 font-semibold min-w-0">
                        <FolderOpen className="text-muted h-4 w-4 mt-0.5" />
                        <span className="truncate">{lesson.title}</span>
                      </h4>
                    </div>
                    <div className="text-muted mt-2 flex items-center gap-2 text-sm shrink-0">
                      <FileText className="h-4 w-4" />
                      <span>{lesson.subLessonsCount} Lektionen</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredCurriculum.length === 0 && (
        <div className="glass-effect border-accent/30 rounded-3xl border p-12 text-center shadow-lg">
          <div className="from-muted to-muted/30 mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br">
            <BookOpen className="text-muted h-10 w-10" />
          </div>
          <h3 className="text-foreground mb-2 text-xl font-semibold">
            Keine Module gefunden
          </h3>
          <p className="text-muted mb-6">
            {searchTerm || selectedYear !== 'all'
              ? 'Versuchen Sie andere Suchkriterien oder Filter.'
              : 'Erstellen Sie Ihr erstes Lernmodul, um zu beginnen.'}
          </p>
          <button
            onClick={() => router.push('/trainer/content-management/new')}
            className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 transform rounded-2xl bg-gradient-to-r px-6 py-3 font-medium text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
          >
            Neues Modul erstellen
          </button>
        </div>
      )}
    </div>
  );
}
