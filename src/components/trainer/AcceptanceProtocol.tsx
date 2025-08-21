'use client';

import { useState } from 'react';
import {
  FileCheck2,
  Download,
  Share2,
  CheckCircle,
  Calendar,
  User,
  Award,
  Building,
} from 'lucide-react';

export function AcceptanceProtocol() {
  const [formData, setFormData] = useState({
    milestone: '',
    comments: '',
    date: new Date().toISOString().split('T')[0],
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGenerated, setIsGenerated] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsGenerating(true);

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 2000));

    setIsGenerating(false);
    setIsGenerated(true);
  };

  if (isGenerated) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30 text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-green-500 to-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Protokoll erfolgreich generiert!
          </h2>
          <p className="text-muted mb-6">
            Das digitale Abnahmeprotokoll wurde erstellt und ist bereit zum
            Download.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button className="px-6 py-3 font-medium text-white bg-gradient-to-r from-accent to-primary rounded-2xl hover:from-accent/90 hover:to-primary/90 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 flex items-center gap-2">
              <Download className="w-5 h-5" />
              PDF herunterladen
            </button>
            <button className="px-6 py-3 font-medium text-muted bg-muted/30 rounded-2xl hover:bg-muted/50 transition-all duration-200 flex items-center gap-2">
              <Share2 className="w-5 h-5" />
              Teilen
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Digitales Abnahmeprotokoll
            </h1>
            <p className="text-muted">
              Erstellen Sie ein formales Abnahmeprotokoll für eine
              Ausbildungsphase
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-12 bg-gradient-to-r from-accent to-primary px-6 rounded-2xl flex items-center">
              <span className="text-white font-bold text-sm">WMC-Siegel</span>
            </div>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="glass-effect rounded-3xl p-8 shadow-lg border border-accent/30">
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Participant Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                <User className="w-4 h-4" />
                Auszubildender
              </label>
              <input
                type="text"
                className="w-full px-4 py-3 bg-background/50 border border-accent/30 rounded-2xl text-foreground"
                value="Elias Felsing"
                disabled
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                <Building className="w-4 h-4" />
                Ausbilder
              </label>
              <input
                type="text"
                className="w-full px-4 py-3 bg-background/50 border border-accent/30 rounded-2xl text-foreground"
                value="Waleri Moretz"
                disabled
              />
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Datum der Abnahme
            </label>
            <input
              type="date"
              className="w-full px-4 py-3 bg-background/50 border border-accent/30 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent text-foreground"
              value={formData.date}
              onChange={e =>
                setFormData(prev => ({ ...prev, date: e.target.value }))
              }
            />
          </div>

          {/* Milestone */}
          <div>
            <label
              htmlFor="milestone_name"
              className="block text-sm font-medium text-foreground mb-2 flex items-center gap-2"
            >
              <Award className="w-4 h-4" />
              Abgenommener Meilenstein
            </label>
            <input
              type="text"
              id="milestone_name"
              required
              className="w-full px-4 py-3 bg-background/50 border border-accent/30 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent text-foreground placeholder-muted"
              placeholder="z.B. Abschluss Phase 1 - Grundlagen der Programmierung"
              value={formData.milestone}
              onChange={e =>
                setFormData(prev => ({ ...prev, milestone: e.target.value }))
              }
            />
          </div>

          {/* Comments */}
          <div>
            <label
              htmlFor="comments"
              className="block text-sm font-medium text-foreground mb-2 flex items-center gap-2"
            >
              <FileCheck2 className="w-4 h-4" />
              Finale Kommentare des Ausbilders
            </label>
            <textarea
              id="comments"
              rows={6}
              required
              className="w-full px-4 py-3 bg-background/50 border border-accent/30 rounded-2xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent text-foreground placeholder-muted resize-none"
              placeholder="Beschreiben Sie die erreichten Lernziele, besondere Leistungen und Empfehlungen für die nächste Phase..."
              value={formData.comments}
              onChange={e =>
                setFormData(prev => ({ ...prev, comments: e.target.value }))
              }
            />
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-6 border-t border-accent/30">
            <button
              type="button"
              className="px-6 py-3 font-medium text-muted bg-muted/30 rounded-2xl hover:bg-muted/50 transition-all duration-200"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={
                isGenerating || !formData.milestone || !formData.comments
              }
              className="px-8 py-3 font-semibold text-white bg-gradient-to-r from-accent to-primary rounded-2xl hover:from-accent/90 hover:to-primary/90 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 flex items-center gap-2"
            >
              {isGenerating ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Wird generiert...
                </>
              ) : (
                <>
                  <FileCheck2 className="w-5 h-5" />
                  Protokoll generieren & autorisieren
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Info Card */}
      <div className="glass-effect rounded-3xl p-6 border border-accent/30">
        <h3 className="text-lg font-semibold text-foreground mb-3">
          Wichtige Hinweise
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-muted">
          <div className="flex items-start gap-2">
            <div className="w-2 h-2 bg-accent rounded-full mt-2 flex-shrink-0"></div>
            <span>
              Das Protokoll wird digital signiert und ist rechtlich bindend
            </span>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-2 h-2 bg-accent rounded-full mt-2 flex-shrink-0"></div>
            <span>Alle Beteiligten erhalten eine Kopie per E-Mail</span>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-2 h-2 bg-accent rounded-full mt-2 flex-shrink-0"></div>
            <span>Das Protokoll wird automatisch archiviert</span>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-2 h-2 bg-accent rounded-full mt-2 flex-shrink-0"></div>
            <span>Änderungen sind nach der Generierung nicht mehr möglich</span>
          </div>
        </div>
      </div>
    </div>
  );
}
