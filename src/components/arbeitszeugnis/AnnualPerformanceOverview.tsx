'use client';

import React, { useState, useEffect } from 'react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Award,
  BarChart3,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface AnnualSummary {
  traineeId: string;
  year: number;
  totalEvaluations: number;
  selfAverage: number | null;
  trainerAverage: number | null;
  overallAverage: number | null;
  gradeDistribution: Record<string, number>;
  byAusbildungsjahr: Record<
    string,
    {
      count: number;
      selfAverage: number | null;
      trainerAverage: number | null;
    }
  >;
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

const WARNING_MESSAGES: Record<
  string,
  { message: string; severity: 'warning' | 'critical' }
> = {
  PERFORMANCE_LOW: {
    message: 'Durchschnitt unter 3.5 - Feedback-Gespräch empfohlen',
    severity: 'warning',
  },
  PERFORMANCE_CRITICAL: {
    message: 'Durchschnitt unter 4.0 - Dringender Handlungsbedarf',
    severity: 'critical',
  },
  RATING_DISCREPANCY: {
    message: 'Große Abweichung zwischen Selbst- und Trainerbewertung',
    severity: 'warning',
  },
  MISSING_EVALUATIONS: {
    message: 'Zu wenige Bewertungen eingereicht',
    severity: 'warning',
  },
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
        const res = await fetch(
          `/api/trainee/annual-summary?traineeId=${traineeId}&year=${year}`,
          { cache: 'no-store' }
        );
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

    const recentAvg =
      recent
        .filter(t => t.trainerRating)
        .reduce((a, b) => a + (b.trainerRating || 0), 0) /
      recent.filter(t => t.trainerRating).length;
    const olderAvg =
      older
        .filter(t => t.trainerRating)
        .reduce((a, b) => a + (b.trainerRating || 0), 0) /
      older.filter(t => t.trainerRating).length;

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
        <LoadingSpinner size="md" />
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
        <CardContent className="text-muted-foreground py-12 text-center">
          Keine Daten verfügbar
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Card with Overall Stats */}
      <Card className="border-border from-card to-card/80 bg-gradient-to-br shadow-xl">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="from-primary/20 to-primary/5 border-primary/20 rounded-xl border bg-gradient-to-br p-2.5">
                <BarChart3 className="text-primary h-5 w-5" />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  Jahresübersicht {year}
                  {traineeName && (
                    <span className="text-muted-foreground font-normal">
                      – {traineeName}
                    </span>
                  )}
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
                    className={`flex items-center gap-3 rounded-lg border p-3 ${
                      info.severity === 'critical'
                        ? 'border-red-500/30 bg-red-500/10 text-red-400'
                        : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400'
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
            <div
              className={`rounded-xl p-4 ${getGradeBg(summary.overallAverage)} border-border border`}
            >
              <p className="text-muted-foreground text-xs tracking-wide uppercase">
                Gesamtdurchschnitt
              </p>
              <p
                className={`mt-1 text-3xl font-bold ${getGradeColor(summary.overallAverage)}`}
              >
                {summary.overallAverage?.toFixed(2) || '–'}
              </p>
            </div>

            {/* Self Average */}
            <div className="bg-muted/20 border-border rounded-xl border p-4">
              <p className="text-muted-foreground text-xs tracking-wide uppercase">
                Selbsteinschätzung
              </p>
              <p
                className={`mt-1 text-3xl font-bold ${getGradeColor(summary.selfAverage)}`}
              >
                {summary.selfAverage?.toFixed(2) || '–'}
              </p>
            </div>

            {/* Trainer Average */}
            <div className="bg-muted/20 border-border rounded-xl border p-4">
              <p className="text-muted-foreground text-xs tracking-wide uppercase">
                Trainerbewertung
              </p>
              <p
                className={`mt-1 text-3xl font-bold ${getGradeColor(summary.trainerAverage)}`}
              >
                {summary.trainerAverage?.toFixed(2) || '–'}
              </p>
            </div>
          </div>

          {/* Grade Distribution */}
          {showDetails && (
            <div className="mt-6">
              <p className="text-foreground/70 mb-3 text-sm font-medium">
                Notenverteilung
              </p>
              <div className="flex gap-2">
                {Object.entries(summary.gradeDistribution).map(
                  ([grade, count]) => {
                    const total = Object.values(
                      summary.gradeDistribution
                    ).reduce((a, b) => a + b, 0);
                    const percentage = total > 0 ? (count / total) * 100 : 0;
                    return (
                      <div key={grade} className="flex-1">
                        <div className="bg-muted/20 relative h-24 overflow-hidden rounded-lg">
                          <div
                            className={`absolute right-0 bottom-0 left-0 ${GRADE_LABELS[grade].color} transition-all duration-500`}
                            style={{ height: `${percentage}%` }}
                          />
                          <div className="absolute inset-0 flex flex-col items-center justify-end pb-2">
                            <span className="text-foreground text-lg font-bold">
                              {count}
                            </span>
                          </div>
                        </div>
                        <p className="text-muted-foreground mt-1 text-center text-xs">
                          Note {grade}
                        </p>
                      </div>
                    );
                  }
                )}
              </div>
            </div>
          )}

          {/* By Ausbildungsjahr */}
          {showDetails && Object.keys(summary.byAusbildungsjahr).length > 0 && (
            <div className="mt-6">
              <p className="text-foreground/70 mb-3 text-sm font-medium">
                Nach Ausbildungsjahr
              </p>
              <div className="space-y-2">
                {Object.entries(summary.byAusbildungsjahr)
                  .sort(([a], [b]) => parseInt(a) - parseInt(b))
                  .map(([aj, data]) => (
                    <div
                      key={aj}
                      className="bg-muted/20 border-border flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <Badge variant="secondary">{aj}. Jahr</Badge>
                        <span className="text-muted-foreground text-sm">
                          {data.count} Bewertungen
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <span className="text-muted-foreground text-xs">
                            Trainer:{' '}
                          </span>
                          <span
                            className={`font-semibold ${getGradeColor(data.trainerAverage)}`}
                          >
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
              <p className="text-foreground/70 mb-3 text-sm font-medium">
                Letzte 8 Wochen
              </p>
              <div className="flex h-16 items-end gap-1">
                {summary.trend.map((t, idx) => {
                  const rating = t.trainerRating || t.selfRating || 3;
                  // Invert for visual (1 = tallest, 6 = shortest)
                  const height = ((7 - rating) / 6) * 100;
                  return (
                    <div key={idx} className="group relative flex-1">
                      <div
                        className={`rounded-t transition-all ${getGradeBg(rating)} hover:opacity-80`}
                        style={{ height: `${height}%` }}
                      />
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 rounded bg-black/80 px-2 py-1 text-xs whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100">
                        KW{t.week}: {rating.toFixed(1)}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="text-muted-foreground/50 mt-1 flex justify-between text-xs">
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
