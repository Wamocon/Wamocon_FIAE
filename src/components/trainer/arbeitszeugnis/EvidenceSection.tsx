import { useState, useEffect } from 'react';
import { Loader2, Copy, Check, Star } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface EvidenceItem {
  id: string;
  text: string;
  grade?: number;
  date: string;
  relevantComponent?: string;
  category: 'project' | 'skill' | 'achievement';
}

interface EvidenceSectionProps {
  traineeId: string;
  query?: string;
  onCopy: (text: string) => void;
}

export function EvidenceSection({
  traineeId,
  query = '',
  onCopy,
}: EvidenceSectionProps) {
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!traineeId) return;

    async function loadEvidence() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/trainer/arbeitszeugnis/evidence/${traineeId}${query}`,
          { cache: 'no-store' }
        );
        if (res.ok) {
          const data = await res.json();
          setEvidence(data.highlights || []);
        }
      } catch (err) {
        console.error('Failed to load evidence', err);
      } finally {
        setLoading(false);
      }
    }
    loadEvidence();
  }, [traineeId, query]);

  const handleCopy = (item: EvidenceItem) => {
    onCopy(item.text);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading) {
    return (
      <div className="flex justify-center p-4">
        <LoadingSpinner size="sm" />
      </div>
    );
  }

  if (evidence.length === 0) return null;

  return (
    <div className="bg-card border-border rounded-2xl border p-6">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-bold">
        <Star className="text-accent h-5 w-5" />
        Vorschläge aus Tätigkeitsnachweisen
      </h3>
      <p className="text-muted-foreground mb-4 text-sm">
        Klicken Sie auf "Kopieren", um Highlights in den Abschlusstext zu
        übernehmen.
      </p>
      <div className="max-h-60 space-y-3 overflow-y-auto pr-2">
        {evidence.map(item => (
          <div
            key={item.id}
            className="bg-muted/50 border-border hover:bg-muted/80 group flex items-start justify-between rounded-xl border p-3 transition"
          >
            <div className="text-sm">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-muted-foreground text-xs">
                  {new Date(item.date).toLocaleDateString()}
                </span>
                {item.grade && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${item.grade <= 2 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 text-gray-700'}`}
                  >
                    Note: {item.grade.toFixed(1)}
                  </span>
                )}
                {item.relevantComponent && (
                  <span className="text-muted-foreground/70 max-w-[150px] truncate text-xs">
                    • {item.relevantComponent}
                  </span>
                )}
              </div>
              {item.text}
            </div>
            <button
              onClick={() => handleCopy(item)}
              className="hover:bg-background text-muted-foreground hover:text-foreground ml-3 rounded-lg p-2 transition"
              title="In Zusammenfassung kopieren"
            >
              {copiedId === item.id ? (
                <Check className="h-4 w-4 text-emerald-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
