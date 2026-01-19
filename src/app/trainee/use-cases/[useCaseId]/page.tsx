'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { ChevronLeft } from 'lucide-react';

export default function TraineeUseCaseDetailPage() {
  const params = useParams<{ useCaseId: string }>();
  const useCaseId = params?.useCaseId as string;
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [useCase, setUseCase] = useState<{
    id: string;
    title: string;
    descriptionText: string;
    isActive?: boolean;
    durationValue?: number | null;
    durationUnit?: 'DAYS' | 'WEEKS' | null;
    activatedAt?: string | null;
    courseId?: string;
    courseTitle?: string;
  } | null>(null);
  const [submissionText, setSubmissionText] = useState('');
  const [links, setLinks] = useState<Array<{ url: string; description?: string }>>([{ url: '', description: '' }]);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const [documents, setDocuments] = useState<Array<{ id: string; title: string; storageUrl: string; documentType: string }>>([]);
  const [selectedPdfUrl, setSelectedPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!profile?.id || !useCaseId) return;
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/trainee/use-cases/${useCaseId}?traineeId=${profile.id}`, { cache: 'no-store' });
        if (!r.ok) throw new Error('Use Case konnte nicht geladen werden');
        const data = await r.json();
        setUseCase(data.useCase);
        if (data.submission) {
          setSubmissionText(data.submission.submissionText || '');
          const mapped = (data.submission.links || []).map((l: any) => ({ url: l.url as string, description: (l.description as string) || '' }));
          setLinks(mapped.length ? mapped : [{ url: '', description: '' }]);
        }

        // Fetch documents
        try {
          const dr = await fetch(`/api/trainer/use-cases/${useCaseId}/documents`, { cache: 'no-store' });
          if (dr.ok) {
            const dj = await dr.json();
            setDocuments(dj.documents || []);
          }
        } catch (e) {
          console.error('Error fetching documents', e);
        }

      } catch (e: any) {
        setError(e?.message || 'Unbekannter Fehler');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [profile?.id, useCaseId]);

  const submit = async () => {
    if (!profile?.id) return setError('Profil fehlt');
    setSaving(true);
    setSuccess(null);
    try {
      const body = {
        traineeId: profile.id,
        submissionText: submissionText || null,
        links: links.filter((l) => l.url && l.url.trim()),
      };
      const r = await fetch(`/api/trainee/use-cases/${useCaseId}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('Abgabe fehlgeschlagen');
      setSuccess('Abgabe gespeichert. Status: Ausstehend');
    } catch (e: any) {
      setError(e?.message || 'Unbekannter Fehler');
    } finally {
      setSaving(false);
    }
  };

  if (!profile) return <div className="p-6">Bitte anmelden…</div>;
  if (loading) return <div className="p-6">Lade…</div>;
  if (error) return <div className="p-6 text-red-500">{error}</div>;
  if (!useCase) return <div className="p-6">Nicht gefunden</div>;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="rounded-3xl border border-accent/30 bg-card p-5">
        <h1 className="text-foreground text-2xl font-bold">{useCase.title}</h1>
        <p className="text-muted-foreground mt-2 whitespace-pre-line">{useCase.descriptionText}</p>

        {/* PDF Documents List */}
        {documents.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-3">
            {documents.map((doc) => (
              <button
                key={doc.id}
                onClick={() => setSelectedPdfUrl(prev => prev === doc.storageUrl ? null : doc.storageUrl)}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${selectedPdfUrl === doc.storageUrl ? 'bg-background text-foreground hover:bg-accent/30' : 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 scale-105'}`}
              >
                <div className="flex items-center gap-2">
                  {selectedPdfUrl === doc.storageUrl ? <ChevronLeft className="h-4 w-4 rotate-[-90deg]" /> : <ChevronLeft className="h-4 w-4 rotate-90" />}
                  <span>{doc.title}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Inline PDF Viewer */}
        {selectedPdfUrl && (
          <div className="mt-4 animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="relative w-full h-[80vh] rounded-xl overflow-hidden border border-accent/30 bg-card shadow-2xl">
              <iframe
                src={`${selectedPdfUrl}#toolbar=1&navpanes=0&view=FitH`}
                className="w-full h-full"
                title="PDF Viewer"
              />
            </div>
          </div>
        )}

        {useCase.isActive && useCase.durationValue && useCase.activatedAt && (
          <div className="mt-4 text-sm pt-4 border-t border-accent/10">
            {(() => {
              const started = new Date(useCase.activatedAt as string).getTime();
              const now = Date.now();
              const daysElapsed = Math.floor((now - started) / (1000 * 60 * 60 * 24));
              const total = Number(useCase.durationValue || 0);
              const left = Math.max(0, total - daysElapsed);
              const dueDate = new Date(started + total * 24 * 60 * 60 * 1000);
              return <span className="text-muted-foreground">Restzeit: <span className={left < 3 ? 'text-red-400 font-bold' : 'text-foreground'}>{left} Tage</span> • Fällig am {dueDate.toLocaleDateString()}</span>;
            })()}
          </div>
        )}
      </div>

      {success && <div className="rounded-md border border-green-500/40 bg-green-500/10 p-3 text-green-300">{success}</div>}

      <div className="space-y-4 rounded-3xl border border-accent/30 bg-card p-5">

        <div>
          <label className="mb-1 block text-sm font-medium">Deine Lösung / Beschreibung</label>
          <textarea value={submissionText} onChange={(e) => setSubmissionText(e.target.value)} className="w-full rounded-xl border border-accent/30 bg-muted px-3 py-2 text-foreground" rows={6} />
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium">Links zu deiner Arbeit</div>
          {links.map((l, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <input className="rounded-xl border border-accent/30 bg-muted px-3 py-2 md:col-span-2 text-foreground" placeholder="https://github.com/... oder https://1drv.ms/..." value={l.url} onChange={(e) => setLinks((prev) => prev.map((x, idx) => idx === i ? { ...x, url: e.target.value } : x))} />
              <input className="rounded-xl border border-accent/30 bg-muted px-3 py-2 text-foreground" placeholder="Beschreibung (optional)" value={l.description || ''} onChange={(e) => setLinks((prev) => prev.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))} />
            </div>
          ))}
          <div className="flex gap-2">
            <button className="rounded-md border border-accent/30 px-3 py-2 text-sm hover:bg-background/60" onClick={() => setLinks((prev) => [...prev, { url: '', description: '' }])}>+ Link hinzufügen</button>
            {links.length > 1 && (
              <button className="rounded-md border border-accent/30 px-3 py-2 text-sm hover:bg-background/60" onClick={() => setLinks((prev) => prev.slice(0, -1))}>Letzten Link entfernen</button>
            )}
          </div>
        </div>
        <div className="flex justify-end">
          <button disabled={saving} onClick={submit} className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-60">Abgeben</button>
        </div>
      </div>

      {/* Link back to module */}
      {useCase.courseId && (
        <div className="flex justify-center mt-8 pb-8">
          <Link href={`/trainee/modules/${useCase.courseId}`} className="text-muted-foreground hover:text-accent transition-colors flex items-center gap-2 text-sm font-medium">
            <ChevronLeft className="h-4 w-4" />
            Zurück zu {useCase.courseTitle || 'Modul'}
          </Link>
        </div>
      )}
    </div>
  );
}
