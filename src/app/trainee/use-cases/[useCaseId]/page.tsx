'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function TraineeUseCaseDetailPage() {
  const params = useParams<{ useCaseId: string }>();
  const useCaseId = params?.useCaseId as string;
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [useCase, setUseCase] = useState<{ id: string; title: string; descriptionText: string; isActive?: boolean; durationValue?: number | null; durationUnit?: 'DAYS' | 'WEEKS' | null; activatedAt?: string | null } | null>(null);
  const [submissionText, setSubmissionText] = useState('');
  const [links, setLinks] = useState<Array<{ url: string; description?: string }>>([{ url: '', description: '' }]);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

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
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{useCase.title}</h1>
        <p className="mt-2 whitespace-pre-line">{useCase.descriptionText}</p>
        {useCase.isActive && useCase.durationValue && useCase.activatedAt && (
          <div className="mt-2 text-sm">
            {(() => {
              const started = new Date(useCase.activatedAt as string).getTime();
              const now = Date.now();
              const daysElapsed = Math.floor((now - started) / (1000 * 60 * 60 * 24));
              const total = Number(useCase.durationValue || 0);
              const left = Math.max(0, total - daysElapsed);
              const dueDate = new Date(started + total * 24 * 60 * 60 * 1000);
              return <span>Restzeit: {left} Tage • Fällig am {dueDate.toLocaleDateString()}</span>;
            })()}
          </div>
        )}
      </div>

      {success && <div className="rounded-md border border-green-400 bg-green-50 p-3 text-green-700">{success}</div>}

      <div className="rounded-md border p-4 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Deine Lösung / Beschreibung</label>
          <textarea value={submissionText} onChange={(e) => setSubmissionText(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2" rows={6} />
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium">Links zu deiner Arbeit</div>
          {links.map((l, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <input className="rounded-md border border-border bg-background px-3 py-2 md:col-span-2" placeholder="https://github.com/... oder https://1drv.ms/..." value={l.url} onChange={(e) => setLinks((prev) => prev.map((x, idx) => idx === i ? { ...x, url: e.target.value } : x))} />
              <input className="rounded-md border border-border bg-background px-3 py-2" placeholder="Beschreibung (optional)" value={l.description || ''} onChange={(e) => setLinks((prev) => prev.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))} />
            </div>
          ))}
          <div className="flex gap-2">
            <button className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => setLinks((prev) => [...prev, { url: '', description: '' }])}>+ Link hinzufügen</button>
            {links.length > 1 && (
              <button className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => setLinks((prev) => prev.slice(0, -1))}>Letzten Link entfernen</button>
            )}
          </div>
        </div>
        <div className="flex justify-end">
          <button disabled={saving} onClick={submit} className="rounded-md bg-primary px-4 py-2 text-white disabled:opacity-60">Abgeben</button>
        </div>
      </div>
    </div>
  );
}
