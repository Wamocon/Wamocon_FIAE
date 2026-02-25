import { useState, useEffect } from 'react';
import { Loader2, Copy, Check, Star } from 'lucide-react';

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

export function EvidenceSection({ traineeId, query = '', onCopy }: EvidenceSectionProps) {
    const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    useEffect(() => {
        if (!traineeId) return;

        async function loadEvidence() {
            setLoading(true);
            try {
                const res = await fetch(`/api/trainer/arbeitszeugnis/evidence/${traineeId}${query}`, { cache: 'no-store' });
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
        return <div className="p-4 flex justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div>;
    }

    if (evidence.length === 0) return null;

    return (
        <div className="p-6 rounded-2xl bg-card border border-border">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Star className="h-5 w-5 text-accent" />
                Vorschläge aus Tätigkeitsnachweisen
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
                Klicken Sie auf "Kopieren", um Highlights in den Abschlusstext zu übernehmen.
            </p>
            <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                {evidence.map((item) => (
                    <div key={item.id} className="p-3 rounded-xl bg-muted/50 border border-border hover:bg-muted/80 transition flex items-start justify-between group">
                        <div className="text-sm">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs text-muted-foreground">{new Date(item.date).toLocaleDateString()}</span>
                                {item.grade && (
                                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${item.grade <= 2 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 text-gray-700'}`}>
                                        Note: {item.grade.toFixed(1)}
                                    </span>
                                )}
                                {item.relevantComponent && (
                                    <span className="text-xs text-muted-foreground/70 truncate max-w-[150px]">• {item.relevantComponent}</span>
                                )}
                            </div>
                            {item.text}
                        </div>
                        <button
                            onClick={() => handleCopy(item)}
                            className="ml-3 p-2 rounded-lg hover:bg-background transition text-muted-foreground hover:text-foreground"
                            title="In Zusammenfassung kopieren"
                        >
                            {copiedId === item.id ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
