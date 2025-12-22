'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
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

type TraineeItem = { id: string; full_name: string; avatar_url?: string | null };

export function AcceptanceProtocol() {
  const { user, profile } = useAuth() as any;
  const [formData, setFormData] = useState({
    trainee_id: '',
    milestone: '',
    comments: '',
    date: new Date().toISOString().split('T')[0],
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGenerated, setIsGenerated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [trainees, setTrainees] = useState<TraineeItem[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!user || !profile) return;
      try {
        const params = new URLSearchParams();
        if (user.id) params.set('trainerAuthId', user.id);
        if (profile.id) params.set('trainerProfileId', profile.id);
        const res = await fetch(`/api/trainer/trainees?${params.toString()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Konnte Auszubildende nicht laden');
        const data = await res.json();
        setTrainees(data.trainees || []);
      } catch (e: any) {
        setError(e?.message || 'Unbekannter Fehler');
      }
    };
    load();
  }, [user, profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!formData.trainee_id) return setError('Bitte Auszubildenden auswählen.');
    if (!formData.milestone.trim()) return setError('Bitte einen Meilenstein angeben.');
    if (!formData.comments.trim()) return setError('Bitte Kommentare hinzufügen.');

    try {
      setIsGenerating(true);
      const payload = {
        trainee_id: formData.trainee_id,
        trainer_id: profile?.id,
        milestone_name: formData.milestone.trim(),
        comments: formData.comments.trim(),
        acceptance_date: formData.date,
      };
      const res = await fetch('/api/trainer/acceptance-protocols', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Erstellung fehlgeschlagen');
      const data = await res.json();
      setSuccessId(data.protocol?.id || null);
      setIsGenerated(true);
    } catch (e: any) {
      setError(e?.message || 'Unbekannter Fehler');
    } finally {
      setIsGenerating(false);
    }
  };

  // Generate a simple PDF client-side using pdf-lib
  const generatePdfBlob = async () => {
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4 portrait in points
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const margin = 50;
    let y = page.getHeight() - margin;

    // Fetch and embed the logo image
    const imageBytes = await fetch('/WMC_Logo.png').then(res => res.arrayBuffer());
    const logoImage = await pdfDoc.embedPng(imageBytes);
    const logoWidth = 100;
    const logoHeight = 60;
    const logoX = page.getWidth() - logoWidth - margin;
    const logoY = page.getHeight() - logoHeight - margin;
    page.drawImage(logoImage, { x: logoX, y: logoY, width: logoWidth, height: logoHeight });

    const drawText = (text: string, opts?: { size?: number; color?: any; bold?: boolean }) => {
      const size = opts?.size ?? 12;
      const f = opts?.bold ? titleFont : font;
      y -= size + 8;
      page.drawText(text, { x: margin, y, size, font: f, color: opts?.color ?? rgb(0, 0, 0) });
    };

    // Header
    drawText('Digitales Abnahmeprotokoll', { size: 20, bold: true });
    drawText(`Protokoll-ID: ${successId ?? '-'}`, { size: 10, color: rgb(0.3, 0.3, 0.3) });

    const trainee = trainees.find(t => t.id === formData.trainee_id);
    const traineeName = trainee?.full_name ?? formData.trainee_id;
    const trainerName = profile?.full_name ?? '-';

    // Meta
    drawText(`Auszubildender: ${traineeName}`);
    drawText(`Ausbilder: ${trainerName}`);
    drawText(`Datum: ${formData.date}`);

    // Content
    y -= 6;
    drawText('Abgenommener Meilenstein:', { bold: true });
    drawText(formData.milestone);

    y -= 6;
    drawText('Kommentare:', { bold: true });

    // Wrap comments roughly
    const wrap = (text: string, max = 90) => {
      const words = text.split(/\s+/);
      const lines: string[] = [];
      let line = '';
      for (const w of words) {
        if ((line + ' ' + w).trim().length > max) {
          lines.push(line.trim());
          line = w;
        } else {
          line += ' ' + w;
        }
      }
      if (line.trim()) lines.push(line.trim());
      return lines;
    };
    for (const l of wrap(formData.comments, 95)) {
      drawText(l);
      if (y < margin + 50) break; // simplistic overflow guard
    }

    // Footer
    y = margin + 20;
    page.drawText('Dieses Dokument wurde automatisch generiert.', {
      x: margin,
      y,
      size: 9,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });

  const bytes = await pdfDoc.save();
  // Normalize to a real ArrayBuffer (not SharedArrayBuffer) for BlobPart
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  // Cast to satisfy strict TS typings across environments
  return new Blob([ab as unknown as ArrayBuffer], { type: 'application/pdf' });
  };

  const handleDownloadPdf = async () => {
    try {
      setIsDownloading(true);
      const blob = await generatePdfBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const trainee = trainees.find(t => t.id === formData.trainee_id);
      const traineeSlug = (trainee?.full_name || 'auszubildender').toLowerCase().replace(/\s+/g, '-');
      a.href = url;
      a.download = `abnahmeprotokoll-${traineeSlug}-${formData.date}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || 'PDF konnte nicht erzeugt werden');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSharePdf = async () => {
    try {
      setIsSharing(true);
      const blob = await generatePdfBlob();
      const trainee = trainees.find(t => t.id === formData.trainee_id);
      const traineeSlug = (trainee?.full_name || 'auszubildender').toLowerCase().replace(/\s+/g, '-');
      const file = new File([blob], `abnahmeprotokoll-${traineeSlug}-${formData.date}.pdf`, { type: 'application/pdf' });
      if ((navigator as any).canShare && (navigator as any).canShare({ files: [file] })) {
        await (navigator as any).share({
          title: 'Digitales Abnahmeprotokoll',
          text: 'Hier ist das digitale Abnahmeprotokoll.',
          files: [file],
        });
      } else if (navigator.share) {
        // Fallback to blob URL share if files not supported
        const url = URL.createObjectURL(blob);
        try {
          await navigator.share({ title: 'Digitales Abnahmeprotokoll', url });
        } finally {
          URL.revokeObjectURL(url);
        }
      } else {
        // Final fallback: trigger a download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `abnahmeprotokoll-${traineeSlug}-${formData.date}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      setError(e?.message || 'Teilen fehlgeschlagen');
    } finally {
      setIsSharing(false);
    }
  };

  if (isGenerated) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="glass-effect border-accent/30 rounded-3xl border p-8 text-center shadow-lg">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-emerald-500">
            <CheckCircle className="h-10 w-10 text-foregroundround" />
          </div>
          <h2 className="text-foreground mb-2 text-2xl font-bold">
            Protokoll erfolgreich generiert!
          </h2>
          <p className="text-muted mb-6">
            Das digitale Abnahmeprotokoll wurde erstellt und ist bereit zum
            Download.
          </p>

          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <button
              onClick={handleDownloadPdf}
              disabled={isDownloading}
              className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 flex transform items-center gap-2 rounded-2xl bg-gradient-to-r px-6 py-3 font-medium text-foregroundroundround shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl disabled:opacity-60"
            >
              {isDownloading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <Download className="h-5 w-5" />
              )}
              {isDownloading ? 'Wird vorbereitet…' : 'PDF herunterladen'}
            </button>
            <button
              onClick={handleSharePdf}
              disabled={isSharing}
              className="text-muted bg-muted/30 hover:bg-muted/50 flex items-center gap-2 rounded-2xl px-6 py-3 font-medium transition-all duration-200 disabled:opacity-60"
            >
              {isSharing ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground/80 border-t-transparent" />
              ) : (
                <Share2 className="h-5 w-5" />
              )}
              {isSharing ? 'Wird geteilt…' : 'Teilen'}
            </button>
            {successId && (
              <div className="text-xs text-muted">ID: {successId}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      {/* Header */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-foreground mb-2 text-3xl font-bold">
              Digitales Abnahmeprotokoll
            </h1>
            <p className="text-muted">
              Erstellen Sie ein formales Abnahmeprotokoll für eine
              Ausbildungsphase
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="from-accent to-primary flex h-12 items-center rounded-2xl bg-gradient-to-r px-6">
              <span className="text-sm font-bold text-foreground">WMC-Siegel</span>
            </div>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-8 shadow-lg">
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Participant Information */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <label className="text-foreground mb-2 flex items-center gap-2 text-sm font-medium">
                <User className="h-4 w-4" />
                Auszubildender
              </label>
              <select
                className="bg-background/50 border-accent/30 text-foreground w-full rounded-2xl border px-4 py-3"
                value={formData.trainee_id}
                onChange={e => setFormData(prev => ({ ...prev, trainee_id: e.target.value }))}
              >
                <option value="">Bitte auswählen</option>
                {trainees.map(t => (
                  <option key={t.id} value={t.id}>{t.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-foreground mb-2 flex items-center gap-2 text-sm font-medium">
                <Building className="h-4 w-4" />
                Ausbilder
              </label>
              <input
                type="text"
                className="bg-background/50 border-accent/30 text-foreground w-full rounded-2xl border px-4 py-3"
                value={profile?.full_name || ''}
                disabled
              />
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="text-foreground mb-2 flex items-center gap-2 text-sm font-medium">
              <Calendar className="h-4 w-4" />
              Datum der Abnahme
            </label>
            <input
              type="date"
              className="bg-background/50 border-accent/30 focus:ring-accent text-foreground w-full rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
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
              className="text-foreground mb-2 flex items-center gap-2 text-sm font-medium"
            >
              <Award className="h-4 w-4" />
              Abgenommener Meilenstein
            </label>
            <input
              type="text"
              id="milestone_name"
              required
              className="bg-background/50 border-accent/30 focus:ring-accent text-foreground placeholder-muted w-full rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
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
              className="text-foreground mb-2 flex items-center gap-2 text-sm font-medium"
            >
              <FileCheck2 className="h-4 w-4" />
              Finale Kommentare des Ausbilders
            </label>
            <textarea
              id="comments"
              rows={6}
              required
              className="bg-background/50 border-accent/30 focus:ring-accent text-foreground placeholder-muted w-full resize-none rounded-2xl border px-4 py-3 focus:border-transparent focus:ring-2 focus:outline-none"
              placeholder="Beschreiben Sie die erreichten Lernziele, besondere Leistungen und Empfehlungen für die nächste Phase..."
              value={formData.comments}
              onChange={e =>
                setFormData(prev => ({ ...prev, comments: e.target.value }))
              }
            />
          </div>

          {error && (
            <div className="text-red-500">{error}</div>
          )}

          {/* Actions */}
          <div className="border-accent/30 flex flex-col items-center justify-between gap-4 border-t pt-6 sm:flex-row">
            <button
              type="button"
              className="text-muted bg-muted/30 hover:bg-muted/50 rounded-2xl px-6 py-3 font-medium transition-all duration-200"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={
                isGenerating || !formData.trainee_id || !formData.milestone || !formData.comments
              }
              className="from-accent to-primary hover:from-accent/90 hover:to-primary/90 focus:ring-accent flex transform items-center gap-2 rounded-2xl bg-gradient-to-r px-8 py-3 font-semibold text-foreground shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGenerating ? (
                <>
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                  Wird generiert...
                </>
              ) : (
                <>
                  <FileCheck2 className="h-5 w-5" />
                  Protokoll generieren & autorisieren
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Info Card */}
      <div className="glass-effect border-accent/30 rounded-3xl border p-6">
        <h3 className="text-foreground mb-3 text-lg font-semibold">
          Wichtige Hinweise
        </h3>
        <div className="text-muted grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
          <div className="flex items-start gap-2">
            <div className="bg-accent mt-2 h-2 w-2 flex-shrink-0 rounded-full"></div>
            <span>
              Das Protokoll wird digital signiert und ist rechtlich bindend
            </span>
          </div>
          <div className="flex items-start gap-2">
            <div className="bg-accent mt-2 h-2 w-2 flex-shrink-0 rounded-full"></div>
            <span>Alle Beteiligten erhalten eine Kopie per E-Mail</span>
          </div>
          <div className="flex items-start gap-2">
            <div className="bg-accent mt-2 h-2 w-2 flex-shrink-0 rounded-full"></div>
            <span>Das Protokoll wird automatisch archiviert</span>
          </div>
          <div className="flex items-start gap-2">
            <div className="bg-accent mt-2 h-2 w-2 flex-shrink-0 rounded-full"></div>
            <span>Änderungen sind nach der Generierung nicht mehr möglich</span>
          </div>
        </div>
      </div>
    </div>
  );
}
