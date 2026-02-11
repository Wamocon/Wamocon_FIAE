'use client';

import { useState, useEffect } from 'react';
import { Star, Check, AlertCircle, Save } from 'lucide-react';

interface GradeEntry {
    entryId: string;
    useCaseLetter: string;
    useCaseDescription: string;
    actualHours: number;
    currentGrade: string | null;
    comment: string;
}

interface GradeInputSectionProps {
    reportId: string;
    entries: GradeEntry[];
    onGradesSaved: () => void;
    isReadOnly?: boolean;
}

const GRADE_OPTIONS = [
    { value: '1', label: 'Sehr gut', color: 'bg-emerald-500' },
    { value: '2', label: 'Gut', color: 'bg-green-500' },
    { value: '3', label: 'Befriedigend', color: 'bg-yellow-500' },
    { value: '4', label: 'Ausreichend', color: 'bg-orange-500' },
    { value: '5', label: 'Mangelhaft', color: 'bg-red-500' },
    { value: '6', label: 'Ungenügend', color: 'bg-red-700' },
];

export function GradeInputSection({
    reportId,
    entries: initialEntries,
    onGradesSaved,
    isReadOnly = false
}: GradeInputSectionProps) {
    const [entries, setEntries] = useState<GradeEntry[]>(initialEntries);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    const handleGradeChange = (entryId: string, grade: string) => {
        setEntries(prev => prev.map(e =>
            e.entryId === entryId ? { ...e, currentGrade: grade } : e
        ));
        setSaved(false);
    };

    const handleCommentChange = (entryId: string, comment: string) => {
        setEntries(prev => prev.map(e =>
            e.entryId === entryId ? { ...e, comment } : e
        ));
        setSaved(false);
    };

    const handleSave = async () => {
        setSaving(true);
        setError(null);

        try {
            const grades = entries
                .filter(e => e.currentGrade)
                .map(e => ({
                    entryId: e.entryId,
                    grade: e.currentGrade,
                    comment: e.comment || undefined,
                }));

            const res = await fetch('/api/trainer/arbeitszeugnis/grade', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reportId, grades }),
            });

            if (!res.ok) {
                throw new Error('Failed to save grades');
            }

            setSaved(true);
            onGradesSaved();
        } catch (err) {
            setError('Fehler beim Speichern der Noten');
        } finally {
            setSaving(false);
        }
    };

    const gradedCount = entries.filter(e => e.currentGrade).length;
    const allGraded = gradedCount === entries.length;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h4 className="font-semibold flex items-center gap-2">
                    <Star className="h-4 w-4 text-amber-500" />
                    Benotung für Arbeitszeugnis
                </h4>
                <span className="text-sm text-muted-foreground">
                    {gradedCount}/{entries.length} bewertet
                </span>
            </div>

            {entries.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                    Keine Use-Case-Einträge zum Bewerten vorhanden.
                </p>
            ) : (
                <div className="space-y-3">
                    {entries.map((entry) => (
                        <div
                            key={entry.entryId}
                            className="p-4 rounded-xl bg-muted/50 border border-border space-y-3"
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                    <p className="font-medium">
                                        <span className="text-accent">{entry.useCaseLetter})</span>{' '}
                                        {entry.useCaseDescription}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        {entry.actualHours} Stunden
                                    </p>
                                </div>
                            </div>

                            {!isReadOnly && (
                                <>
                                    <div className="flex flex-wrap gap-2">
                                        {GRADE_OPTIONS.map((opt) => (
                                            <button
                                                key={opt.value}
                                                onClick={() => handleGradeChange(entry.entryId, opt.value)}
                                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${entry.currentGrade === opt.value
                                                        ? `${opt.color} text-white shadow-lg scale-105`
                                                        : 'bg-background border border-border hover:bg-muted'
                                                    }`}
                                            >
                                                {opt.value} - {opt.label}
                                            </button>
                                        ))}
                                    </div>

                                    <input
                                        type="text"
                                        placeholder="Optionaler Kommentar zur Bewertung..."
                                        value={entry.comment}
                                        onChange={(e) => handleCommentChange(entry.entryId, e.target.value)}
                                        className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-border"
                                    />
                                </>
                            )}

                            {isReadOnly && entry.currentGrade && (
                                <div className="flex items-center gap-2">
                                    <span className={`px-3 py-1 rounded-lg text-sm font-medium text-white ${GRADE_OPTIONS.find(g => g.value === entry.currentGrade)?.color || 'bg-gray-500'
                                        }`}>
                                        Note {entry.currentGrade}
                                    </span>
                                    {entry.comment && (
                                        <span className="text-sm text-muted-foreground italic">
                                            "{entry.comment}"
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {!isReadOnly && entries.length > 0 && (
                <div className="flex items-center gap-4 pt-2">
                    <button
                        onClick={handleSave}
                        disabled={saving || gradedCount === 0}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent text-accent-foreground font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {saving ? (
                            <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        ) : saved ? (
                            <Check className="h-4 w-4" />
                        ) : (
                            <Save className="h-4 w-4" />
                        )}
                        {saved ? 'Gespeichert' : 'Noten speichern'}
                    </button>

                    {error && (
                        <span className="text-sm text-destructive flex items-center gap-1">
                            <AlertCircle className="h-4 w-4" /> {error}
                        </span>
                    )}

                    {!allGraded && (
                        <span className="text-sm text-amber-600 dark:text-amber-400">
                            Hinweis: Nicht alle Einträge wurden bewertet
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}
