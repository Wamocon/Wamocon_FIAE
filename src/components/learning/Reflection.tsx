'use client';

import { useEffect, useState } from 'react';
import { Target, Send, CheckCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface ReflectionData {
  strengths: string;
  weaknesses: string;
  more: string;
  equal: string;
}

export function Reflection() {
  const { profile } = useAuth();
  const [reflectionData, setReflectionData] = useState<ReflectionData>({
    strengths: '',
    weaknesses: '',
    more: '',
    equal: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (field: keyof ReflectionData, value: string) => {
    setReflectionData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      if (!profile?.id) throw new Error('Kein Profil gefunden');
      // Create a new reflection (do not overwrite)
      const res = await fetch('/api/trainee/reflection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trainee_id: profile.id,
          strengths: reflectionData.strengths,
          weaknesses: reflectionData.weaknesses,
          mes_more: reflectionData.more,
          mes_equal: reflectionData.equal,
        }),
      });
      if (!res.ok) throw new Error('Speichern fehlgeschlagen');
      setIsSubmitted(true);
      // keep the form values as-is so the trainee sees what was saved
      setTimeout(() => setIsSubmitted(false), 2500);
      // Optionally reload latest from server to reflect any server-side adjustments
      await load();
    } catch (err: any) {
      setError(err.message || 'Unbekannter Fehler');
    } finally {
      setIsSubmitting(false);
    }
  };

  const load = async () => {
    if (!profile?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/trainee/reflection?traineeId=${profile.id}`);
      if (!res.ok) throw new Error('Fehler beim Laden der Reflektion');
      const data = await res.json();
      const r = data?.reflection;
      if (r) {
        setReflectionData({
          strengths: r.strengths || '',
          weaknesses: r.weaknesses || '',
          more: r.mesMore || '',
          equal: r.mesEqual || '',
        });
      }
    } catch (err: any) {
      setError(err.message || 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  if (isSubmitted) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="glass-effect max-w-md rounded-3xl p-8 text-center shadow-lg">
          <div className="from-accent to-primary mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br">
            <CheckCircle className="h-10 w-10 text-white" />
          </div>
          <h2 className="text-foreground mb-2 text-2xl font-bold">
            Reflektion erfolgreich gespeichert! 🎉
          </h2>
          <p className="text-muted">
            Deine Reflektion wurde erfolgreich gespeichert und wird von deinem
            Ausbilder überprüft.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      {/* Header Section */}
      <div className="glass-effect mb-8 rounded-3xl p-8 shadow-lg">
        <div className="mb-6 text-center">
          <div className="from-accent to-primary mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br">
            <Target className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-foreground mb-2 text-3xl font-bold">
            Reflektionstermin Q3/2025
          </h1>
          <p className="text-muted">
            Nutze die SWOT- und MES-Methode, um deinen Lernfortschritt und deine
            Erfahrungen zu reflektieren.
          </p>
        </div>
      </div>

      {/* Main Form */}
      <form onSubmit={handleSubmit} className="space-y-8">
        {error && (
          <div className="rounded-2xl border border-red-700 bg-red-900/20 p-4 text-red-300">{error}</div>
        )}
        {/* SWOT and MES Grid */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* SWOT Analysis - Left Column */}
          <div className="space-y-6">
            <h2 className="text-foreground mb-4 text-2xl font-semibold">
              SWOT-Analyse
            </h2>

            {/* Strengths */}
            <div>
              <label className="text-accent mb-2 block text-sm font-medium">
                Stärken (Strengths)
              </label>
              <textarea
                rows={4}
                value={reflectionData.strengths}
                onChange={e => handleInputChange('strengths', e.target.value)}
                className="bg-background/50 border-accent/30 focus:ring-accent text-foreground w-full resize-none rounded-xl border p-3 focus:ring-2 focus:outline-none"
                placeholder="Was lief besonders gut?"
                required
                disabled={loading}
              />
            </div>

            {/* Weaknesses */}
            <div>
              <label className="text-accent mb-2 block text-sm font-medium">
                Schwächen (Weaknesses)
              </label>
              <textarea
                rows={4}
                value={reflectionData.weaknesses}
                onChange={e => handleInputChange('weaknesses', e.target.value)}
                className="bg-background/50 border-accent/30 focus:ring-accent text-foreground w-full resize-none rounded-xl border p-3 focus:ring-2 focus:outline-none"
                placeholder="Wo hattest du Schwierigkeiten?"
                required
                disabled={loading}
              />
            </div>
          </div>

          {/* MES Feedback - Right Column */}
          <div className="space-y-6">
            <h2 className="mb-4 text-2xl font-semibold text-white">
              MES-Feedback
            </h2>

            {/* More */}
            <div>
              <label className="text-accent mb-2 block text-sm font-medium">
                Mehr davon (More)
              </label>
              <textarea
                rows={4}
                value={reflectionData.more}
                onChange={e => handleInputChange('more', e.target.value)}
                className="bg-background/50 border-accent/30 focus:ring-accent text-foreground w-full resize-none rounded-xl border p-3 focus:ring-2 focus:outline-none"
                placeholder="Was hat dir besonders geholfen?"
                required
                disabled={loading}
              />
            </div>

            {/* Equal */}
            <div>
              <label className="text-accent mb-2 block text-sm font-medium">
                Gleich lassen (Equal)
              </label>
              <textarea
                rows={4}
                value={reflectionData.equal}
                onChange={e => handleInputChange('equal', e.target.value)}
                className="bg-background/50 border-accent/30 focus:ring-accent text-foreground w-full resize-none rounded-xl border p-3 focus:ring-2 focus:outline-none"
                placeholder="Welche Aspekte sind gut so?"
                required
                disabled={loading}
              />
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex justify-center pt-6">
          <button
            type="submit"
            disabled={isSubmitting || loading}
            className="bg-accent hover:bg-accent/90 disabled:bg-accent/50 focus:ring-accent focus:ring-offset-background flex items-center gap-2 rounded-2xl px-8 py-3 font-semibold text-white transition-colors duration-300 focus:ring-2 focus:ring-offset-2 focus:outline-none"
          >
            {isSubmitting ? (
              <>
                <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-white"></div>
                Wird gespeichert...
              </>
            ) : (
              <>
                <Send className="h-5 w-5" />
                Reflektion speichern
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
