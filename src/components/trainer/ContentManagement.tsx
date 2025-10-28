'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
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

type CourseCard = {
  id: string;
  title: string;
  year: number | null;
  chapter: number | null;
  enablersCount: number;
  useCasesCount: number;
};

export function ContentManagement() {
  const router = useRouter();
  const { profile } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedYear, setSelectedYear] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const [courses, setCourses] = useState<CourseCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
  if (!profile?.id) return;
  if (searchTerm.trim()) params.set('q', searchTerm.trim());
  if (selectedYear) params.set('year', selectedYear);
  params.set('trainerProfileId', profile.id);
  const res = await fetch(`/api/trainer/courses?${params.toString()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load content');
        const data = await res.json();
        setCourses(data.courses || []);
      } catch (e: any) {
        setError(e?.message || 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [searchTerm, selectedYear, profile?.id]);

  const filteredCurriculum = useMemo(() => courses, [courses]);

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
            Neuer Kurs
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
          {filteredCurriculum.map(course => (
            <div
              key={course.id}
              className="glass-effect border-accent/30 rounded-3xl border p-6 shadow-lg transition-all duration-300 hover:shadow-xl h-[420px] flex flex-col"
            >
              <div className="mb-4 flex items-start justify-between">
                <div className="from-accent to-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
                  <BookOpen className="h-6 w-6 text-white" />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => router.push(`/trainer/content-management/${course.id}/edit`)}
                    className="text-muted hover:text-accent hover:bg-accent/10 rounded-xl p-2 transition-all duration-200"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm('Modul löschen? Dies löscht auch alle enthaltenen Kapitel.')) return;
                      try {
                        const res = await fetch(`/api/trainer/courses/${course.id}?trainerId=${profile?.id || ''}`, { method: 'DELETE' });
                        if (!res.ok) throw new Error('Fehler beim Löschen');
                        setCourses(prev => prev.filter(c => c.id !== course.id));
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
                {course.title}
              </h3>
              <div className="text-muted mb-4 flex items-center gap-2 text-sm">
                <span className="bg-accent rounded-full px-3 py-1 font-medium text-white">
                  Jahr {course.year ?? '-'}
                </span>
                <span className="bg-muted/30 text-muted rounded-full px-3 py-1">
                  Capital {course.chapter ?? '-'}
                </span>
              </div>

              <div className="mb-4 space-y-3 flex-1 overflow-y-auto pr-1">
                <div className="bg-muted/30 flex items-center justify-between gap-3 rounded-xl p-3">
                  <div className="min-w-0">
                    <h4 className="text-foreground text-sm font-medium">Enabler</h4>
                    <p className="text-muted text-xs">{course.enablersCount} Themen</p>
                  </div>
                  <button
                    onClick={async () => {
                      const title = window.prompt('Enabler Titel');
                      if (!title) return;
                      try {
                        const res = await fetch(`/api/trainer/courses/${course.id}/enablers?trainerId=${profile?.id || ''}`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ title }),
                        });
                        if (!res.ok) throw new Error('Fehler beim Erstellen');
                        // Reload list
                        const r = await fetch(`/api/trainer/courses?trainerProfileId=${profile?.id || ''}&year=${selectedYear}&q=${encodeURIComponent(searchTerm)}`);
                        const data = await r.json();
                        setCourses(data.courses || []);
                      } catch (e: any) {
                        alert(e?.message || 'Unbekannter Fehler');
                      }
                    }}
                    className="text-accent hover:text-accent/90 text-sm font-medium"
                  >
                    + Hinzufügen
                  </button>
                </div>

                <div className="bg-muted/30 flex items-center justify-between gap-3 rounded-xl p-3">
                  <div className="min-w-0">
                    <h4 className="text-foreground text-sm font-medium">Use Cases</h4>
                    <p className="text-muted text-xs">{course.useCasesCount} Aufgaben</p>
                  </div>
                  <button
                    onClick={async () => {
                      const title = window.prompt('Use Case Titel');
                      if (!title) return;
                      try {
                        const res = await fetch(`/api/trainer/courses/${course.id}/use-cases?trainerId=${profile?.id || ''}`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ title }),
                        });
                        if (!res.ok) throw new Error('Fehler beim Erstellen');
                        const r = await fetch(`/api/trainer/courses?trainerProfileId=${profile?.id || ''}&year=${selectedYear}&q=${encodeURIComponent(searchTerm)}`);
                        const data = await r.json();
                        setCourses(data.courses || []);
                      } catch (e: any) {
                        alert(e?.message || 'Unbekannter Fehler');
                      }
                    }}
                    className="text-accent hover:text-accent/90 text-sm font-medium"
                  >
                    + Hinzufügen
                  </button>
                </div>
              </div>

              <div className="border-accent/30 flex items-center justify-between border-t pt-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => router.push(`/trainer/content-management/${course.id}/edit`)}
                    className="text-accent hover:text-accent/90 text-sm font-medium"
                  >
                    Bearbeiten
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
          {filteredCurriculum.map(course => (
            <div
              key={course.id}
              className="glass-effect border-accent/30 rounded-2xl border p-6 shadow-lg"
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="from-accent to-primary flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br">
                    <BookOpen className="h-6 w-6 text-white" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-foreground text-xl font-bold truncate">
                      {course.title}
                    </h3>
                    <div className="text-muted flex items-center gap-2 text-sm">
                      <span>Jahr {course.year ?? '-'}</span>
                      <span>•</span>
                      <span>Capital {course.chapter ?? '-'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => router.push(`/trainer/content-management/${course.id}/edit`)}
                    className="text-muted hover:text-accent hover:bg-accent/10 rounded-xl p-2 transition-all duration-200"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm('Modul löschen? Dies löscht auch alle enthaltenen Kapitel.')) return;
                      try {
                        const res = await fetch(`/api/trainer/courses/${course.id}?trainerId=${profile?.id || ''}`, { method: 'DELETE' });
                        if (!res.ok) throw new Error('Fehler beim Löschen');
                        setCourses(prev => prev.filter(c => c.id !== course.id));
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
                <div className="bg-muted/30 border-accent/30 rounded-xl border p-4 h-28 flex flex-col overflow-hidden">
                  <div className="flex-1">
                    <h4 className="text-foreground flex items-start gap-2 font-semibold min-w-0">
                      <FolderOpen className="text-muted h-4 w-4 mt-0.5" />
                      <span className="truncate">Enabler: {course.enablersCount}</span>
                    </h4>
                  </div>
                </div>
                <div className="bg-muted/30 border-accent/30 rounded-xl border p-4 h-28 flex flex-col overflow-hidden">
                  <div className="flex-1">
                    <h4 className="text-foreground flex items-start gap-2 font-semibold min-w-0">
                      <FileText className="h-4 w-4" />
                      <span className="truncate">Use Cases: {course.useCasesCount}</span>
                    </h4>
                  </div>
                </div>
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
            Keine Kurse gefunden
          </h3>
          <p className="text-muted mb-6">
            {searchTerm || selectedYear !== 'all'
              ? 'Versuchen Sie andere Suchkriterien oder Filter.'
              : 'Erstellen Sie Ihren ersten Kurs, um zu beginnen.'}
          </p>
          <button
            onClick={() => router.push('/trainer/content-management/new')}
            className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 transform rounded-2xl bg-gradient-to-r px-6 py-3 font-medium text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
          >
            Neuen Kurs erstellen
          </button>
        </div>
      )}
    </div>
  );
}
