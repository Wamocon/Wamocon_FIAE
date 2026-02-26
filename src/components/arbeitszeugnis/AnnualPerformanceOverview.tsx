'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, TrendingUp, TrendingDown, AlertTriangle, Award, BarChart3, ChevronDown, ChevronUp } from 'lucide-react';

interface AnnualSummary {
    traineeId: string;
    year: number;
    totalEvaluations: number;
    selfAverage: number | null;
    trainerAverage: number | null;
    overallAverage: number | null;
    gradeDistribution: Record<string, number>;
    byAusbildungsjahr: Record<string, {
        count: number;
        selfAverage: number | null;
        trainerAverage: number | null;
    }>;
    trend: Array<{
        week: number;
        year: number;
        trainerRating: number | null;
        selfRating: number | null;
    }>;
    warnings: string[];
}

interface AnnualPerformanceOverviewProps {
    traineeId: string;
    traineeName?: string;
    year?: number;
    showDetails?: boolean;
}

const GRADE_LABELS: Record<string, { label: string; color: string }> = {
    '1': { label: 'Sehr gut', color: 'bg-emerald-500' },
    '2': { label: 'Gut', color: 'bg-green-500' },
    '3': { label: 'Befriedigend', color: 'bg-yellow-500' },
    '4': { label: 'Ausreichend', color: 'bg-orange-500' },
    '5': { label: 'Mangelhaft', color: 'bg-red-500' },
    '6': { label: 'Ungenügend', color: 'bg-red-700' },
};

const WARNING_MESSAGES: Record<string, { message: string; severity: 'warning' | 'critical' }> = {
    'PERFORMANCE_LOW': { message: 'Durchschnitt unter 3.5 - Feedback-Gespräch empfohlen', severity: 'warning' },
    'PERFORMANCE_CRITICAL': { message: 'Durchschnitt unter 4.0 - Dringender Handlungsbedarf', severity: 'critical' },
    'RATING_DISCREPANCY': { message: 'Große Abweichung zwischen Selbst- und Trainerbewertung', severity: 'warning' },
    'MISSING_EVALUATIONS': { message: 'Zu wenige Bewertungen eingereicht', severity: 'warning' },
};

export default function AnnualPerformanceOverview({
    traineeId,
    traineeName,
    year = new Date().getFullYear(),
    showDetails = true,
}: AnnualPerformanceOverviewProps) {
    const [summary, setSummary] = useState<AnnualSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedYear, setExpandedYear] = useState<number | null>(null);

    useEffect(() => {
        async function fetchSummary() {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`/api/trainee/annual-summary?traineeId=${traineeId}&year=${year}`, { cache: 'no-store' });
                if (!res.ok) {
                    throw new Error('Failed to fetch summary');
                }
                const data = await res.json();
                setSummary(data.summary);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        }

        if (traineeId) {
            fetchSummary();
        }
    }, [traineeId, year]);

    const getGradeColor = (grade: number | null): string => {
        if (grade === null) return 'text-muted-foreground';
        if (grade <= 1.5) return 'text-emerald-400';
        if (grade <= 2.5) return 'text-green-400';
        if (grade <= 3.5) return 'text-yellow-400';
        if (grade <= 4.5) return 'text-orange-400';
        return 'text-red-400';
    };

    const getGradeBg = (grade: number | null): string => {
        if (grade === null) return 'bg-muted/20';
        if (grade <= 1.5) return 'bg-emerald-500/20';
        if (grade <= 2.5) return 'bg-green-500/20';
        if (grade <= 3.5) return 'bg-yellow-500/20';
        if (grade <= 4.5) return 'bg-orange-500/20';
        return 'bg-red-500/20';
    };

    const getTrendIcon = () => {
        if (!summary || summary.trend.length < 2) return null;
        const recent = summary.trend.slice(-4);
        const older = summary.trend.slice(-8, -4);

        if (recent.length === 0 || older.length === 0) return null;

        const recentAvg = recent.filter(t => t.trainerRating).reduce((a, b) => a + (b.trainerRating || 0), 0) / recent.filter(t => t.trainerRating).length;
        const olderAvg = older.filter(t => t.trainerRating).reduce((a, b) => a + (b.trainerRating || 0), 0) / older.filter(t => t.trainerRating).length;

        // Lower grade = better (German grading system)
        if (recentAvg < olderAvg - 0.3) {
            return <TrendingUp className="h-4 w-4 text-emerald-400" />;
        } else if (recentAvg > olderAvg + 0.3) {
            return <TrendingDown className="h-4 w-4 text-red-400" />;
        }
        return null;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error) {
        return (
            <Card className="border-red-500/30 bg-red-500/10">
                <CardContent className="py-6 text-center text-red-400">
                    Fehler beim Laden: {error}
                </CardContent>
            </Card>
        );
    }

    if (!summary) {
        return (
            <Card className="border-border bg-card">
                <CardContent className="py-12 text-center text-muted-foreground">
                    Keine Daten verfügbar
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header Card with Overall Stats */}
            <Card className="border-border bg-gradient-to-br from-card to-card/80 shadow-xl">
                <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
                                <BarChart3 className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    Jahresübersicht {year}
                                    {traineeName && <span className="text-muted-foreground font-normal">– {traineeName}</span>}
                                </CardTitle>
                                <CardDescription>
                                    {summary.totalEvaluations} genehmigte Bewertungen
                                </CardDescription>
                            </div>
                        </div>
                        {getTrendIcon()}
                    </div>
                </CardHeader>

                <CardContent className="pt-4">
                    {/* Warnings */}
                    {summary.warnings.length > 0 && (
                        <div className="mb-6 space-y-2">
                            {summary.warnings.map((warning, idx) => {
                                const info = WARNING_MESSAGES[warning];
                                if (!info) return null;
                                return (
                                    <div
                                        key={idx}
                                        className={`flex items-center gap-3 p-3 rounded-lg border ${info.severity === 'critical'
                                            ? 'bg-red-500/10 border-red-500/30 text-red-400'
                                            : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                                            }`}
                                    >
                                        <AlertTriangle className="h-4 w-4 shrink-0" />
                                        <span className="text-sm">{info.message}</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Main Stats Grid */}
                    <div className="grid grid-cols-3 gap-4">
                        {/* Overall Average */}
                        <div className={`p-4 rounded-xl ${getGradeBg(summary.overallAverage)} border border-border`}>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">Gesamtdurchschnitt</p>
                            <p className={`text-3xl font-bold mt-1 ${getGradeColor(summary.overallAverage)}`}>
                                {summary.overallAverage?.toFixed(2) || '–'}
                            </p>
                        </div>

                        {/* Self Average */}
                        <div className="p-4 rounded-xl bg-muted/20 border border-border">
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">Selbsteinschätzung</p>
                            <p className={`text-3xl font-bold mt-1 ${getGradeColor(summary.selfAverage)}`}>
                                {summary.selfAverage?.toFixed(2) || '–'}
                            </p>
                        </div>

                        {/* Trainer Average */}
                        <div className="p-4 rounded-xl bg-muted/20 border border-border">
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">Trainerbewertung</p>
                            <p className={`text-3xl font-bold mt-1 ${getGradeColor(summary.trainerAverage)}`}>
                                {summary.trainerAverage?.toFixed(2) || '–'}
                            </p>
                        </div>
                    </div>

                    {/* Grade Distribution */}
                    {showDetails && (
                        <div className="mt-6">
                            <p className="text-sm font-medium text-foreground/70 mb-3">Notenverteilung</p>
                            <div className="flex gap-2">
                                {Object.entries(summary.gradeDistribution).map(([grade, count]) => {
                                    const total = Object.values(summary.gradeDistribution).reduce((a, b) => a + b, 0);
                                    const percentage = total > 0 ? (count / total) * 100 : 0;
                                    return (
                                        <div key={grade} className="flex-1">
                                            <div className="h-24 bg-muted/20 rounded-lg relative overflow-hidden">
                                                <div
                                                    className={`absolute bottom-0 left-0 right-0 ${GRADE_LABELS[grade].color} transition-all duration-500`}
                                                    style={{ height: `${percentage}%` }}
                                                />
                                                <div className="absolute inset-0 flex flex-col items-center justify-end pb-2">
                                                    <span className="text-lg font-bold text-foreground">{count}</span>
                                                </div>
                                            </div>
                                            <p className="text-center text-xs mt-1 text-muted-foreground">Note {grade}</p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* By Ausbildungsjahr */}
                    {showDetails && Object.keys(summary.byAusbildungsjahr).length > 0 && (
                        <div className="mt-6">
                            <p className="text-sm font-medium text-foreground/70 mb-3">Nach Ausbildungsjahr</p>
                            <div className="space-y-2">
                                {Object.entries(summary.byAusbildungsjahr)
                                    .sort(([a], [b]) => parseInt(a) - parseInt(b))
                                    .map(([aj, data]) => (
                                        <div
                                            key={aj}
                                            className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border"
                                        >
                                            <div className="flex items-center gap-3">
                                                <Badge variant="secondary">{aj}. Jahr</Badge>
                                                <span className="text-sm text-muted-foreground">{data.count} Bewertungen</span>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <div className="text-right">
                                                    <span className="text-xs text-muted-foreground">Trainer: </span>
                                                    <span className={`font-semibold ${getGradeColor(data.trainerAverage)}`}>
                                                        {data.trainerAverage?.toFixed(2) || '–'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        </div>
                    )}

                    {/* Mini Trend Chart */}
                    {showDetails && summary.trend.length > 0 && (
                        <div className="mt-6">
                            <p className="text-sm font-medium text-foreground/70 mb-3">Letzte 8 Wochen</p>
                            <div className="flex items-end gap-1 h-16">
                                {summary.trend.map((t, idx) => {
                                    const rating = t.trainerRating || t.selfRating || 3;
                                    // Invert for visual (1 = tallest, 6 = shortest)
                                    const height = ((7 - rating) / 6) * 100;
                                    return (
                                        <div
                                            key={idx}
                                            className="flex-1 group relative"
                                        >
                                            <div
                                                className={`rounded-t transition-all ${getGradeBg(rating)} hover:opacity-80`}
                                                style={{ height: `${height}%` }}
                                            />
                                            <div className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/80 px-2 py-1 rounded text-xs whitespace-nowrap">
                                                KW{t.week}: {rating.toFixed(1)}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="flex justify-between text-xs text-muted-foreground/50 mt-1">
                                <span>KW{summary.trend[0]?.week}</span>
                                <span>KW{summary.trend[summary.trend.length - 1]?.week}</span>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
