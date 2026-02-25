'use client';

import React, { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

interface SoftskillCriterion {
    id: string;
    code: string;
    name: string;
    description: string;
    kLevel: string;
    competencyArea: 'FACHKOMPETENZ' | 'METHODENKOMPETENZ' | 'SOZIALKOMPETENZ' | 'PERSONALKOMPETENZ';
    orderIndex: number;
}

interface SoftskillRatingGridProps {
    ratings: Record<string, string>;
    trainerRatings?: Record<string, string>;
    onChange: (criterionId: string, rating: string) => void;
    onTrainerChange?: (criterionId: string, rating: string) => void;
    readOnly?: boolean;
    showTrainerRatings?: boolean;
    isTrainer?: boolean;
}

const GRADE_OPTIONS = [
    { value: '1', label: '1', color: 'bg-green-500/20 text-green-500 border-green-500/30' },
    { value: '2', label: '2', color: 'bg-green-400/20 text-green-400 border-green-400/30' },
    { value: '3', label: '3', color: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30' },
    { value: '4', label: '4', color: 'bg-orange-500/20 text-orange-500 border-orange-500/30' },
    { value: '5', label: '5', color: 'bg-red-400/20 text-red-400 border-red-400/30' },
    { value: '6', label: '6', color: 'bg-red-600/20 text-red-600 border-red-600/30' },
];

const COMPETENCY_LABELS: Record<string, { label: string; color: string }> = {
    FACHKOMPETENZ: { label: 'Fachkompetenz', color: 'bg-blue-500/20 text-blue-400' },
    METHODENKOMPETENZ: { label: 'Methodenkompetenz', color: 'bg-purple-500/20 text-purple-400' },
    SOZIALKOMPETENZ: { label: 'Sozialkompetenz', color: 'bg-green-500/20 text-green-400' },
    PERSONALKOMPETENZ: { label: 'Personalkompetenz', color: 'bg-orange-500/20 text-orange-400' },
};

export default function SoftskillRatingGrid({
    ratings,
    trainerRatings = {},
    onChange,
    onTrainerChange,
    readOnly = false,
    showTrainerRatings = false,
    isTrainer = false,
}: SoftskillRatingGridProps) {
    const [criteria, setCriteria] = useState<SoftskillCriterion[]>([]);
    const [loading, setLoading] = useState(true);
    const [groupedCriteria, setGroupedCriteria] = useState<Record<string, SoftskillCriterion[]>>({});

    useEffect(() => {
        async function fetchCriteria() {
            try {
                const res = await fetch('/api/trainee/evaluations/softskills', { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    setCriteria(data.criteria || []);
                    setGroupedCriteria(data.groupedByArea || {});
                }
            } catch (error) {
                console.error('Error fetching softskill criteria:', error);
            } finally {
                setLoading(false);
            }
        }
        fetchCriteria();
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const getDeviationColor = (selfRating: string, trainerRating: string) => {
        if (!selfRating || !trainerRating) return '';
        const diff = Math.abs(parseInt(selfRating) - parseInt(trainerRating));
        if (diff === 0) return 'bg-green-500/10';
        if (diff <= 1) return 'bg-yellow-500/10';
        return 'bg-red-500/10';
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(groupedCriteria).map(([area, areaCriteria]) => (
                areaCriteria.map((criterion) => {
                    const selfRating = ratings[criterion.id] || '';
                    const trainerRating = trainerRatings[criterion.id] || '';
                    const colorClass = COMPETENCY_LABELS[area]?.color || 'bg-gray-500/20 text-gray-400';

                    return (
                        <div
                            key={criterion.id}
                            className={`p-4 rounded-xl border border-border/50 bg-card hover:border-border transition-all ${showTrainerRatings ? getDeviationColor(selfRating, trainerRating) : ''}`}
                        >
                            {/* Header */}
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <Badge className={`${colorClass} mb-2 border-0`}>
                                        {COMPETENCY_LABELS[area]?.label || area}
                                    </Badge>
                                    <h4 className="font-medium text-foreground">{criterion.name}</h4>
                                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2" title={criterion.description}>
                                        {criterion.description}
                                    </p>
                                </div>
                            </div>

                            {/* Ratings */}
                            <div className="space-y-3 pt-3 border-t border-border/50">
                                {/* Self Rating */}
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium text-foreground/70">
                                        {isTrainer ? 'Azubi-Note:' : 'Deine Note:'}
                                    </span>
                                    {isTrainer ? (
                                        <div className="flex items-center gap-2">
                                            <span className={`text-lg font-bold ${selfRating ? GRADE_OPTIONS.find(g => g.value === selfRating)?.color.split(' ')[1] : 'text-muted-foreground/30'}`}>
                                                {selfRating || '-'}
                                            </span>
                                        </div>
                                    ) : (
                                        <Select
                                            value={selfRating}
                                            onValueChange={(val) => onChange(criterion.id, val)}
                                            disabled={readOnly}
                                        >
                                            <SelectTrigger className="w-[120px] h-9 bg-muted/20 border-border">
                                                <SelectValue placeholder="Note..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {GRADE_OPTIONS.map((grade) => (
                                                    <SelectItem key={grade.value} value={grade.value}>
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-bold w-4">{grade.value}</span>
                                                            <span className="text-muted-foreground text-xs hidden sm:inline">{grade.label.split(' ')[0]}</span>
                                                        </div>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                </div>

                                {/* Trainer Rating */}
                                {(showTrainerRatings || isTrainer) && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-medium text-emerald-400">
                                            Trainer-Note:
                                        </span>
                                        {isTrainer && onTrainerChange ? (
                                            <Select
                                                value={trainerRating}
                                                onValueChange={(val) => onTrainerChange(criterion.id, val)}
                                                disabled={readOnly}
                                            >
                                                <SelectTrigger className="w-[120px] h-9 bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
                                                    <SelectValue placeholder="Note..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {GRADE_OPTIONS.map((grade) => (
                                                        <SelectItem key={grade.value} value={grade.value}>
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-bold w-4">{grade.value}</span>
                                                                <span className="text-muted-foreground text-xs hidden sm:inline">{grade.label.split(' ')[0]}</span>
                                                            </div>
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            <span className={`text-lg font-bold ${trainerRating ? GRADE_OPTIONS.find(g => g.value === trainerRating)?.color.split(' ')[1] : 'text-muted-foreground/30'}`}>
                                                {trainerRating || '-'}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })
            ))}
        </div>
    );
}
