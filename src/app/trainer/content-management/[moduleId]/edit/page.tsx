'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function EditCoursePage() {
  const router = useRouter();
  const params = useParams<{ moduleId: string }>();
  const courseId = params?.moduleId as string;
  const { profile } = useAuth();
  const trainerId = profile?.id;

  const [title, setTitle] = useState('');
  const [year, setYear] = useState<'1' | '2' | '3' | ''>('');
  const [chapter, setChapter] = useState<string>('');
  const [skills, setSkills] = useState<string>('');
  const [enablers, setEnablers] = useState<Array<{ id: string; title: string; isActive: boolean }>>([]);
  const [useCases, setUseCases] = useState<Array<{ id: string; title: string; isActive: boolean }>>([]);
  const [membersTrainers, setMembersTrainers] = useState<Array<{ id: string; fullName: string; email: string }>>([]);
  const [membersTrainees, setMembersTrainees] = useState<Array<{ id: string; fullName: string; email: string }>>([]);
  const [searchTrainer, setSearchTrainer] = useState('');
  const [searchTrainee, setSearchTrainee] = useState('');
  const [searchResultsTrainers, setSearchResultsTrainers] = useState<Array<{ id: string; fullName: string; email: string }>>([]);
  const [searchResultsTrainees, setSearchResultsTrainees] = useState<Array<{ id: string; fullName: string; email: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UI: Add Enabler Modal state
  const [showAddEnabler, setShowAddEnabler] = useState(false);
  const [enablerTitle, setEnablerTitle] = useState('');
  const [enablerDesc, setEnablerDesc] = useState('');
  const [enablerPpt, setEnablerPpt] = useState('');
  const [enablerVideo, setEnablerVideo] = useState('');
  type BuilderQuestion = { questionText: string; options: [string, string, string, string]; correctIndex: number };
  const [enablerQuestions, setEnablerQuestions] = useState<BuilderQuestion[]>([{ questionText: '', options: ['', '', '', ''], correctIndex: 0 }]);
  const [enablerSubmitting, setEnablerSubmitting] = useState(false);

  // UI: Add Use Case Modal state
  const [showAddUseCase, setShowAddUseCase] = useState(false);
  const [useCaseTitle, setUseCaseTitle] = useState('');
  const [useCaseDesc, setUseCaseDesc] = useState('');
  const [useCaseSubmitting, setUseCaseSubmitting] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
  const res = await fetch(`/api/trainer/courses/${courseId}?trainerId=${trainerId || ''}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Konnte Kurs nicht laden');
        const data = await res.json();
        setTitle(data.course.title);
        setYear(String(data.course.year ?? '') as any);
        setChapter(String(data.course.chapter ?? ''));
        setSkills((data.skills || []).join(', '));
        setEnablers((data.enablers || []).map((e: any) => ({ id: e.id, title: e.title, isActive: !!e.isActive })));
        setUseCases((data.useCases || []).map((u: any) => ({ id: u.id, title: u.title, isActive: !!u.isActive })));
        // load members
          const memRes = await fetch(`/api/trainer/courses/${courseId}/members?trainerId=${trainerId || ''}`, { cache: 'no-store' });
        if (memRes.ok) {
          const mem = await memRes.json();
          const trainers = (mem.members || []).filter((m: any) => m.role === 'TRAINER').map((m: any) => ({ id: m.userId, fullName: m.fullName, email: m.email }));
          const trainees = (mem.members || []).filter((m: any) => m.role === 'TRAINEE').map((m: any) => ({ id: m.userId, fullName: m.fullName, email: m.email }));
          setMembersTrainers(trainers);
          setMembersTrainees(trainees);
        }
      } catch (e: any) {
        setError(e?.message || 'Unbekannter Fehler');
      } finally {
        setLoading(false);
      }
    };
    if (courseId) load();
  }, [courseId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
  if (!title.trim()) return setError('Bitte einen Kurstitel eingeben.');
  if (!year) return setError('Bitte ein Trainingsjahr wählen.');

    try {
      setSaving(true);
      const payload: any = {
        title: title.trim(),
        year: Number(year),
        chapter: chapter ? Number(chapter) : undefined,
        skills: skills
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };

      const res = await fetch(`/api/trainer/courses/${courseId}?trainerId=${trainerId || ''}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Speichern fehlgeschlagen');

      router.replace('/trainer/content-management');
    } catch (e: any) {
      setError(e?.message || 'Unbekannter Fehler');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6">Lade Kurs…</div>;
  if (error) return <div className="p-6 text-red-500">{error}</div>;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Kurs bearbeiten</h1>
      <form onSubmit={handleSave} className="space-y-6">
        {error && <div className="text-red-500">{error}</div>}

        <div>
          <label className="mb-1 block text-sm font-medium">Kurstitel</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Trainingsjahr</label>
          <select
            value={year}
            onChange={e => setYear(e.target.value as any)}
            className="w-full rounded-md border border-border bg-background px-3 py-2"
          >
            <option value="1">Jahr 1</option>
            <option value="2">Jahr 2</option>
            <option value="3">Jahr 3</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Kapitel/Abschnitt</label>
          <input
            value={chapter}
            onChange={(e) => setChapter(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2"
            placeholder="z.B. 1"
            inputMode="numeric"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Skills (Kommagetrennt)</label>
          <input
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2"
            placeholder="z.B. Git, HTML, CSS, JavaScript"
          />
        </div>

        <div className="rounded-xl border border-border p-4">
          <div className="mb-3 text-sm font-semibold">Enabler</div>
          <ul className="space-y-2">
            {enablers.map((e) => (
              <li key={e.id} className="flex items-center justify-between">
                <span>{e.title}</span>
                <button
                  type="button"
                  className="text-xs rounded-md border border-border px-2 py-1"
                  onClick={async () => {
                    await fetch(`/api/trainer/enablers/${e.id}?trainerId=${trainerId || ''}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !e.isActive }) });
                    const r = await fetch(`/api/trainer/courses/${courseId}?trainerId=${trainerId || ''}`);
                    const data = await r.json();
                    setEnablers((data.enablers || []).map((x: any) => ({ id: x.id, title: x.title, isActive: !!x.isActive })));
                  }}
                >
                  {e.isActive ? 'Deaktivieren' : 'Aktivieren'}
                </button>
                <button
                  type="button"
                  className="ml-2 text-xs rounded-md border border-border px-2 py-1"
                  onClick={() => router.push(`/trainer/enablers/${e.id}/quiz`)}
                >
                  Quiz bearbeiten
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-3 text-sm text-accent"
            onClick={() => setShowAddEnabler(true)}
          >
            + Enabler hinzufügen
          </button>
        </div>

        <div className="rounded-xl border border-border p-4">
          <div className="mb-3 text-sm font-semibold">Use Cases</div>
          <ul className="space-y-2">
            {useCases.map((u) => (
              <li key={u.id} className="flex items-center justify-between">
                <span>{u.title}</span>
                <button
                  type="button"
                  className="text-xs rounded-md border border-border px-2 py-1"
                  onClick={async () => {
                    await fetch(`/api/trainer/use-cases/${u.id}?trainerId=${trainerId || ''}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !u.isActive }) });
                    const r = await fetch(`/api/trainer/courses/${courseId}?trainerId=${trainerId || ''}`);
                    const data = await r.json();
                    setUseCases((data.useCases || []).map((x: any) => ({ id: x.id, title: x.title, isActive: !!x.isActive })));
                  }}
                >
                  {u.isActive ? 'Deaktivieren' : 'Aktivieren'}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-3 text-sm text-accent"
            onClick={() => setShowAddUseCase(true)}
          >
            + Use Case hinzufügen
          </button>
        </div>

        <div className="rounded-xl border border-border p-4">
          <div className="mb-3 text-sm font-semibold">Mitglieder</div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <div className="mb-2 font-medium">Trainer</div>
              <ul className="mb-2 space-y-1">
                {membersTrainers.map((m) => (
                  <li key={m.id} className="flex items-center justify-between text-sm">
                    <span>{m.fullName} ({m.email})</span>
                    <button type="button" className="text-xs rounded-md border border-border px-2 py-1" onClick={async () => {
                      await fetch(`/api/trainer/courses/${courseId}/members?userId=${m.id}&trainerId=${trainerId || ''}`, { method: 'DELETE' });
                      setMembersTrainers(prev => prev.filter(x => x.id !== m.id));
                    }}>Entfernen</button>
                  </li>
                ))}
              </ul>
              <input value={searchTrainer} onChange={(e) => setSearchTrainer(e.target.value)} placeholder="Trainer suchen" className="w-full rounded-md border border-border bg-background px-3 py-2" />
              <button type="button" className="mt-2 rounded-md border border-border px-3 py-2 text-sm" onClick={async () => {
                const r = await fetch(`/api/trainer/profiles?role=TRAINER&q=${encodeURIComponent(searchTrainer)}`);
                const data = await r.json();
                setSearchResultsTrainers(data.profiles || []);
              }}>Suchen</button>
              <ul className="mt-2 space-y-1">
                {searchResultsTrainers.map((p) => (
                  <li key={p.id} className="flex items-center justify-between text-sm">
                    <span>{p.fullName} ({p.email})</span>
                    <button type="button" className="text-xs rounded-md border border-border px-2 py-1" onClick={async () => {
                      await fetch(`/api/trainer/courses/${courseId}/members?trainerId=${trainerId || ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: p.id, role: 'TRAINER' }) });
                      setMembersTrainers(prev => [...prev, p]);
                    }}>Hinzufügen</button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-2 font-medium">Azubis</div>
              <ul className="mb-2 space-y-1">
                {membersTrainees.map((m) => (
                  <li key={m.id} className="flex items-center justify-between text-sm">
                    <span>{m.fullName} ({m.email})</span>
                    <button type="button" className="text-xs rounded-md border border-border px-2 py-1" onClick={async () => {
                      await fetch(`/api/trainer/courses/${courseId}/members?userId=${m.id}&trainerId=${trainerId || ''}`, { method: 'DELETE' });
                      setMembersTrainees(prev => prev.filter(x => x.id !== m.id));
                    }}>Entfernen</button>
                  </li>
                ))}
              </ul>
              <input value={searchTrainee} onChange={(e) => setSearchTrainee(e.target.value)} placeholder="Azubi suchen" className="w-full rounded-md border border-border bg-background px-3 py-2" />
              <button type="button" className="mt-2 rounded-md border border-border px-3 py-2 text-sm" onClick={async () => {
                const r = await fetch(`/api/trainer/profiles?role=TRAINEE&q=${encodeURIComponent(searchTrainee)}`);
                const data = await r.json();
                setSearchResultsTrainees(data.profiles || []);
              }}>Suchen</button>
              <ul className="mt-2 space-y-1">
                {searchResultsTrainees.map((p) => (
                  <li key={p.id} className="flex items-center justify-between text-sm">
                    <span>{p.fullName} ({p.email})</span>
                    <button type="button" className="text-xs rounded-md border border-border px-2 py-1" onClick={async () => {
                      await fetch(`/api/trainer/courses/${courseId}/members?trainerId=${trainerId || ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: p.id, role: 'TRAINEE' }) });
                      setMembersTrainees(prev => [...prev, p]);
                    }}>Hinzufügen</button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-primary px-4 py-2 text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? 'Speichern…' : 'Speichern'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-md border border-border px-4 py-2 hover:bg-background/60"
          >
            Abbrechen
          </button>
        </div>
      </form>

      {/* Add Enabler Modal */}
      {showAddEnabler && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => !enablerSubmitting && setShowAddEnabler(false)} />
          <div className="relative z-10 w-full max-w-2xl rounded-xl border border-border bg-background p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Neuen Enabler erstellen</h2>
              <button className="rounded-md border border-border px-2 py-1 text-sm" onClick={() => !enablerSubmitting && setShowAddEnabler(false)}>Schließen</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Titel</label>
                <input value={enablerTitle} onChange={e => setEnablerTitle(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Beschreibung</label>
                <textarea value={enablerDesc} onChange={e => setEnablerDesc(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" rows={3} />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">PPT-Link</label>
                  <input value={enablerPpt} onChange={e => setEnablerPpt(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" placeholder="https://..." />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Video-Link</label>
                  <input value={enablerVideo} onChange={e => setEnablerVideo(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" placeholder="https://..." />
                </div>
              </div>
              <div className="mt-2">
                <div className="mb-2 text-sm font-semibold">Quiz-Fragen</div>
                <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-1">
                  {enablerQuestions.map((q, qi) => (
                    <div key={qi} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">Frage {qi + 1}</div>
                        <button type="button" className="text-xs rounded-md border border-border px-2 py-1" onClick={() => setEnablerQuestions(prev => prev.filter((_, i) => i !== qi))}>Entfernen</button>
                      </div>
                      <input className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2" placeholder="Fragetext" value={q.questionText} onChange={e => setEnablerQuestions(prev => prev.map((x,i)=> i===qi?{...x, questionText: e.target.value}:x))} />
                      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                        {q.options.map((opt, oi) => (
                          <label key={oi} className="flex items-center gap-2">
                            <input type="radio" name={`correct-${qi}`} checked={q.correctIndex === oi} onChange={() => setEnablerQuestions(prev => prev.map((x,i)=> i===qi?{...x, correctIndex: oi}:x))} />
                            <input className="flex-1 rounded-md border border-border bg-background px-3 py-2" placeholder={`Option ${oi+1}`} value={opt} onChange={e => setEnablerQuestions(prev => prev.map((x,i)=> i===qi?{...x, options: x.options.map((o,j)=> j===oi? e.target.value: o) as [string,string,string,string]}:x))} />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" className="mt-3 rounded-md border border-border px-3 py-2 text-sm" onClick={() => setEnablerQuestions(prev => [...prev, { questionText: '', options: ['', '', '', ''], correctIndex: 0 }])}>+ Frage hinzufügen</button>
              </div>
              <div className="flex justify-end gap-2">
                <button className="rounded-md border border-border px-4 py-2" type="button" onClick={() => !enablerSubmitting && setShowAddEnabler(false)}>Abbrechen</button>
                <button className="rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60" disabled={enablerSubmitting} onClick={async () => {
                  if (!trainerId) { alert('Kein Trainerprofil'); return; }
                  if (!enablerTitle.trim()) { alert('Bitte Titel eingeben'); return; }
                  const cleaned = enablerQuestions
                    .map(q => ({ questionText: q.questionText.trim(), options: q.options.map(o => o.trim()) as [string,string,string,string], correctIndex: Number(q.correctIndex) }))
                    .filter(q => q.questionText && q.options.every(o => o));
                  setEnablerSubmitting(true);
                  try {
                    // 1) Create Enabler
                    const res = await fetch(`/api/trainer/courses/${courseId}/enablers?trainerId=${trainerId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: enablerTitle.trim(), scenarioText: enablerDesc.trim() || undefined, pptUrl: enablerPpt.trim() || undefined, videoUrl: enablerVideo.trim() || undefined, isActive: true }) });
                    if (!res.ok) throw new Error('Enabler konnte nicht erstellt werden');
                    const data = await res.json();
                    const enablerId = data.enabler?.id;
                    if (!enablerId) throw new Error('Fehlende Enabler ID');

                    // 2) If quiz provided, create quiz
                    if (cleaned.length) {
                      const rq = await fetch(`/api/trainer/enablers/${enablerId}/quiz`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `Quiz: ${enablerTitle.trim()}`, createdById: trainerId, questions: cleaned }) });
                      if (!rq.ok) throw new Error('Quiz konnte nicht gespeichert werden');
                    }

                    // 3) Refresh and close
                    const r = await fetch(`/api/trainer/courses/${courseId}?trainerId=${trainerId}`);
                    const fresh = await r.json();
                    setEnablers((fresh.enablers || []).map((x: any) => ({ id: x.id, title: x.title, isActive: !!x.isActive })));
                    setShowAddEnabler(false);
                    setEnablerTitle(''); setEnablerDesc(''); setEnablerPpt(''); setEnablerVideo(''); setEnablerQuestions([{ questionText: '', options: ['', '', '', ''], correctIndex: 0 }]);
                  } catch (e: any) {
                    alert(e?.message || 'Unbekannter Fehler');
                  } finally {
                    setEnablerSubmitting(false);
                  }
                }}>Erstellen</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Use Case Modal */}
      {showAddUseCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => !useCaseSubmitting && setShowAddUseCase(false)} />
          <div className="relative z-10 w-full max-w-xl rounded-xl border border-border bg-background p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Neuen Use Case erstellen</h2>
              <button className="rounded-md border border-border px-2 py-1 text-sm" onClick={() => !useCaseSubmitting && setShowAddUseCase(false)}>Schließen</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Titel</label>
                <input value={useCaseTitle} onChange={e => setUseCaseTitle(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Beschreibung</label>
                <textarea value={useCaseDesc} onChange={e => setUseCaseDesc(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" rows={3} />
              </div>
              <div className="flex justify-end gap-2">
                <button className="rounded-md border border-border px-4 py-2" type="button" onClick={() => !useCaseSubmitting && setShowAddUseCase(false)}>Abbrechen</button>
                <button className="rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60" disabled={useCaseSubmitting} onClick={async () => {
                  if (!trainerId) { alert('Kein Trainerprofil'); return; }
                  if (!useCaseTitle.trim()) { alert('Bitte Titel eingeben'); return; }
                  if (!useCaseDesc.trim()) { alert('Bitte Beschreibung eingeben'); return; }
                  setUseCaseSubmitting(true);
                  try {
                    const res = await fetch(`/api/trainer/courses/${courseId}/use-cases?trainerId=${trainerId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: useCaseTitle.trim(), descriptionText: useCaseDesc.trim(), isActive: true }) });
                    if (!res.ok) throw new Error('Use Case konnte nicht erstellt werden');
                    const r = await fetch(`/api/trainer/courses/${courseId}?trainerId=${trainerId}`);
                    const fresh = await r.json();
                    setUseCases((fresh.useCases || []).map((x: any) => ({ id: x.id, title: x.title, isActive: !!x.isActive })));
                    setShowAddUseCase(false);
                    setUseCaseTitle(''); setUseCaseDesc('');
                  } catch (e: any) {
                    alert(e?.message || 'Unbekannter Fehler');
                  } finally {
                    setUseCaseSubmitting(false);
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
