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

  // Quick-add Enabler modal state (course list view)
  const [showAddEnabler, setShowAddEnabler] = useState(false);
  const [activeCourseId, setActiveCourseId] = useState<string | null>(null);
  const [enTitle, setEnTitle] = useState('');
  const [enDescription, setEnDescription] = useState('');
  const [enScenario, setEnScenario] = useState('');
  const [enHint, setEnHint] = useState('');
  const [enPpt, setEnPpt] = useState('');
  const [enVideo, setEnVideo] = useState('');
  type BuilderQuestion = { questionText: string; options: [string, string, string, string]; correctIndex: number };
  const [enQuestions, setEnQuestions] = useState<BuilderQuestion[]>([
    { questionText: '', options: ['', '', '', ''], correctIndex: 0 },
  ]);
  const [enSubmitting, setEnSubmitting] = useState(false);
  const [enDuration, setEnDuration] = useState<string>('');
  const [enActive, setEnActive] = useState<boolean>(false);
  // Quick-add Use Case modal state
  const [showAddUseCase, setShowAddUseCase] = useState(false);
  const [ucTitle, setUcTitle] = useState('');
  const [ucDesc, setUcDesc] = useState('');
  const [ucSubmitting, setUcSubmitting] = useState(false);
  const [ucDuration, setUcDuration] = useState<string>('');
  const [ucActive, setUcActive] = useState<boolean>(false);

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
                <img src="/WMC_Logo.png" alt={course.title} className="h-14 w-12 rounded-2xl object-cover" />
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
                    <h4 className="text-foreground text-sm font-medium">Lessons</h4>
                    <p className="text-muted text-xs">{course.enablersCount} Themen</p>
                  </div>
                  <button
                    onClick={() => {
                      setActiveCourseId(course.id);
                      setEnTitle('');
                      setEnDescription('');
                      setEnScenario('');
                      setEnHint('');
                      setEnPpt('');
                      setEnVideo('');
                      setEnQuestions([{ questionText: '', options: ['', '', '', ''], correctIndex: 0 }]);
                      setEnDuration('');
                      setEnActive(false);
                      setShowAddEnabler(true);
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
                    onClick={() => {
                      setActiveCourseId(course.id);
                      setUcTitle('');
                      setUcDesc('');
                      setUcDuration('');
                      setUcActive(false);
                      setShowAddUseCase(true);
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
                      <span>Module {course.chapter ?? '-'}</span>
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
                      <span className="truncate">Lessons: {course.enablersCount}</span>
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

      {/* Add Enabler Modal (Quick Add from course card) */}
      {showAddEnabler && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => !enSubmitting && setShowAddEnabler(false)} />
          <div className="relative z-10 w-full max-w-2xl rounded-xl border border-border bg-background p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Neuen Lesson erstellen</h2>
              <button className="rounded-md border border-border px-2 py-1 text-sm" onClick={() => !enSubmitting && setShowAddEnabler(false)}>Schließen</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Titel</label>
                <input value={enTitle} onChange={e => setEnTitle(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Beschreibung</label>
                <textarea value={enDescription} onChange={e => setEnDescription(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" rows={3} placeholder="Kurze Beschreibung des Lessons" />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">PPT-Link</label>
                  <input value={enPpt} onChange={e => setEnPpt(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" placeholder="https://..." />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Video-Link</label>
                  <input value={enVideo} onChange={e => setEnVideo(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" placeholder="https://..." />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">Dauer (Tage)</label>
                  <input type="number" min={0} value={enDuration} onChange={e => setEnDuration(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" placeholder="z.B. 7" />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={enActive} onChange={e => setEnActive(e.target.checked)} />
                    <span>Aktiv</span>
                  </label>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Szenario</label>
                <textarea value={enScenario} onChange={e => setEnScenario(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" rows={4} placeholder="Beschreibe hier das Szenario, das der Azubi lösen soll..." />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Hinweis (für Trainees sichtbar)</label>
                <textarea value={enHint} onChange={e => setEnHint(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" rows={3} placeholder="Tipp zur Lösung des Szenarios" />
              </div>
              <div className="mt-2">
                <div className="mb-2 text-sm font-semibold">Quiz-Fragen</div>
                <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-1">
                  {enQuestions.map((q, qi) => (
                    <div key={qi} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">Frage {qi + 1}</div>
                        <button type="button" className="text-xs rounded-md border border-border px-2 py-1" onClick={() => setEnQuestions(prev => prev.filter((_, i) => i !== qi))}>Entfernen</button>
                      </div>
                      <input className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2" placeholder="Fragetext" value={q.questionText} onChange={e => setEnQuestions(prev => prev.map((x,i)=> i===qi?{...x, questionText: e.target.value}:x))} />
                      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                        {q.options.map((opt, oi) => (
                          <label key={oi} className="flex items-center gap-2">
                            <input type="radio" name={`correct-${qi}`} checked={q.correctIndex === oi} onChange={() => setEnQuestions(prev => prev.map((x,i)=> i===qi?{...x, correctIndex: oi}:x))} />
                            <input className="flex-1 rounded-md border border-border bg-background px-3 py-2" placeholder={`Option ${oi+1}`} value={opt} onChange={e => setEnQuestions(prev => prev.map((x,i)=> i===qi?{...x, options: x.options.map((o,j)=> j===oi? e.target.value: o) as [string,string,string,string]}:x))} />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" className="mt-3 rounded-md border border-border px-3 py-2 text-sm" onClick={() => setEnQuestions(prev => [...prev, { questionText: '', options: ['', '', '', ''], correctIndex: 0 }])}>+ Frage hinzufügen</button>
              </div>
              <div className="flex justify-end gap-2">
                <button className="rounded-md border border-border px-4 py-2" type="button" onClick={() => !enSubmitting && setShowAddEnabler(false)}>Abbrechen</button>
                <button className="rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60" disabled={enSubmitting} onClick={async () => {
                  if (!profile?.id) { alert('Kein Trainerprofil'); return; }
                  if (!activeCourseId) { alert('Kein Kurs ausgewählt'); return; }
                  if (!enTitle.trim()) { alert('Bitte Titel eingeben'); return; }
                  const cleaned = enQuestions
                    .map(q => ({ questionText: q.questionText.trim(), options: q.options.map(o => o.trim()) as [string,string,string,string], correctIndex: Number(q.correctIndex) }))
                    .filter(q => q.questionText && q.options.every(o => o));
                  setEnSubmitting(true);
                  try {
                    // Create Lesson (active)
                    const res = await fetch(`/api/trainer/courses/${activeCourseId}/enablers?trainerId=${profile.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: enTitle.trim(), descriptionText: enDescription.trim() || undefined, scenarioText: enScenario.trim() || undefined, hintText: enHint.trim() || undefined, pptUrl: enPpt.trim() || undefined, videoUrl: enVideo.trim() || undefined, durationValue: enDuration ? Number(enDuration) : undefined, durationUnit: enDuration ? 'DAYS' : undefined, isActive: enActive }) });
                    if (!res.ok) throw new Error('Lesson konnte nicht erstellt werden');
                    const data = await res.json();
                    const enablerId = data.enabler?.id;
                    if (!enablerId) throw new Error('Fehlende Lesson ID');

                    // Create quiz if defined
                    if (cleaned.length) {
                      const rq = await fetch(`/api/trainer/enablers/${enablerId}/quiz`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `Quiz: ${enTitle.trim()}`, createdById: profile.id, questions: cleaned }) });
                      if (!rq.ok) throw new Error('Quiz konnte nicht gespeichert werden');
                    }

                    // Refresh course list
                    const r = await fetch(`/api/trainer/courses?trainerProfileId=${profile.id}&year=${selectedYear}&q=${encodeURIComponent(searchTerm)}`);
                    const fresh = await r.json();
                    setCourses(fresh.courses || []);

                    setShowAddEnabler(false);
                    setActiveCourseId(null);
                    setEnTitle(''); setEnDescription(''); setEnScenario(''); setEnHint(''); setEnPpt(''); setEnVideo(''); setEnDuration(''); setEnActive(false); setEnQuestions([{ questionText: '', options: ['', '', '', ''], correctIndex: 0 }]);
                  } catch (e: any) {
                    alert(e?.message || 'Unbekannter Fehler');
                  } finally {
                    setEnSubmitting(false);
                  }
                }}>Erstellen</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Use Case Modal (Quick Add from course card) */}
      {showAddUseCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => !ucSubmitting && setShowAddUseCase(false)} />
          <div className="relative z-10 w-full max-w-xl rounded-xl border border-border bg-background p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Neuen Use Case erstellen</h2>
              <button className="rounded-md border border-border px-2 py-1 text-sm" onClick={() => !ucSubmitting && setShowAddUseCase(false)}>Schließen</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Titel</label>
                <input value={ucTitle} onChange={e => setUcTitle(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Beschreibung (erforderlich)</label>
                <textarea value={ucDesc} onChange={e => setUcDesc(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" rows={4} />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">Dauer (Tage)</label>
                  <input type="number" min={0} value={ucDuration} onChange={e => setUcDuration(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" placeholder="z.B. 14" />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={ucActive} onChange={e => setUcActive(e.target.checked)} />
                    <span>Aktiv</span>
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button className="rounded-md border border-border px-4 py-2" type="button" onClick={() => !ucSubmitting && setShowAddUseCase(false)}>Abbrechen</button>
                <button className="rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60" disabled={ucSubmitting} onClick={async () => {
                  if (!profile?.id) { alert('Kein Trainerprofil'); return; }
                  if (!activeCourseId) { alert('Kein Kurs ausgewählt'); return; }
                  if (!ucTitle.trim()) { alert('Bitte Titel eingeben'); return; }
                  if (!ucDesc.trim()) { alert('Bitte Beschreibung eingeben'); return; }
                  setUcSubmitting(true);
                  try {
                    const res = await fetch(`/api/trainer/courses/${activeCourseId}/use-cases?trainerId=${profile.id}`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ title: ucTitle.trim(), descriptionText: ucDesc.trim(), durationValue: ucDuration ? Number(ucDuration) : undefined, durationUnit: ucDuration ? 'DAYS' : undefined, isActive: ucActive }),
                    });
                    if (!res.ok) throw new Error('Use Case konnte nicht erstellt werden');

                    // Refresh list
                    const r = await fetch(`/api/trainer/courses?trainerProfileId=${profile.id}&year=${selectedYear}&q=${encodeURIComponent(searchTerm)}`);
                    const fresh = await r.json();
                    setCourses(fresh.courses || []);

                    setShowAddUseCase(false);
                    setActiveCourseId(null);
                    setUcTitle('');
                    setUcDesc('');
                    setUcDuration('');
                    setUcActive(false);
                  } catch (e: any) {
                    alert(e?.message || 'Unbekannter Fehler');
                  } finally {
                    setUcSubmitting(false);
                  }
                }}>Erstellen</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

