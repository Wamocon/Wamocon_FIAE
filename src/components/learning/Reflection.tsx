'use client';

import { useState } from 'react';
import { Target, TrendingUp, Send, CheckCircle } from 'lucide-react';

interface ReflectionData {
  strengths: string;
  weaknesses: string;
  more: string;
  equal: string;
}

export function Reflection() {
  const [reflectionData, setReflectionData] = useState<ReflectionData>({
    strengths: '',
    weaknesses: '',
    more: '',
    equal: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleInputChange = (field: keyof ReflectionData, value: string) => {
    setReflectionData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Simulate submission
    await new Promise(resolve => setTimeout(resolve, 1000));

    setIsSubmitting(false);
    setIsSubmitted(true);

    // Reset form after showing success
    setTimeout(() => {
      setIsSubmitted(false);
      setReflectionData({
        strengths: '',
        weaknesses: '',
        more: '',
        equal: '',
      });
    }, 3000);
  };

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
              />
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex justify-center pt-6">
          <button
            type="submit"
            disabled={isSubmitting}
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
