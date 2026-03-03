'use client';

import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  User,
  Calendar,
  ClipboardCheck,
  BarChart3,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import TrainerEvaluationReview from '@/components/arbeitszeugnis/TrainerEvaluationReview';
import AnnualPerformanceOverview from '@/components/arbeitszeugnis/AnnualPerformanceOverview';

interface EvaluationItem {
  evaluation: {
    id: string;
    traineeId: string;
    weekNumber: number;
    year: number;
    ausbildungsjahr: number;
    selfRating: string | null;
    selfComment: string | null;
    trainerRating: string | null;
    trainerComment: string | null;
    status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
    arpThemeText: string | null;
    selfSubmittedAt: string | null;
  };
  trainee: {
    id: string;
    fullName: string;
    email: string;
  };
}

interface TraineeSummary {
  traineeId: string;
  traineeName: string;
  traineeEmail: string;
  totalEvaluations: number;
  pendingCount: number;
  trainerAverage: number | null;
  selfAverage: number | null;
  byAusbildungsjahr: Record<number, { count: number; average: number | null }>;
  warnings: string[];
}

type TabType = 'pending' | 'reviewed' | 'all' | 'annual';

export default function TrainerEvaluationsPage() {
  const { profile, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>('pending');
  const [selectedEvaluation, setSelectedEvaluation] = useState<string | null>(
    null
  );
  const [selectedTrainee, setSelectedTrainee] = useState<string | null>(null);

  // Data fetching via React Query — only the active tab's URL is non-null
  const evalStatus =
    activeTab === 'pending'
      ? 'SUBMITTED'
      : activeTab === 'reviewed'
        ? 'APPROVED'
        : '';
  const evalUrl =
    profile?.id && activeTab !== 'annual'
      ? `/api/trainer/evaluations?trainerId=${profile.id}&status=${evalStatus}`
      : null;
  const annualUrl =
    profile?.id && activeTab === 'annual'
      ? `/api/trainer/annual-overview?trainerId=${profile.id}`
      : null;

  const { data: evalData, isLoading: evalLoading } = useApiQuery<{
    evaluations: EvaluationItem[];
    pendingCount: number;
  }>(evalUrl);
  const { data: annualData, isLoading: annualLoading } = useApiQuery<{
    summaries: TraineeSummary[];
    totals: { trainees: number; pendingReviews: number; warningsCount: number };
  }>(annualUrl);

  const evaluations = evalData?.evaluations || [];
  const pendingCount = evalData?.pendingCount || 0;
  const traineeSummaries = annualData?.summaries || [];
  const totals = annualData?.totals || {
    trainees: 0,
    pendingReviews: 0,
    warningsCount: 0,
  };
  const loading = evalLoading || annualLoading;

  const handleRefresh = () => {
    setSelectedEvaluation(null);
    if (evalUrl) queryClient.invalidateQueries({ queryKey: [evalUrl] });
    if (annualUrl) queryClient.invalidateQueries({ queryKey: [annualUrl] });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return <CheckCircle className="h-4 w-4 text-emerald-400" />;
      case 'REJECTED':
        return <XCircle className="h-4 w-4 text-red-400" />;
      case 'SUBMITTED':
        return <Clock className="h-4 w-4 text-amber-400" />;
      default:
        return (
          <div className="h-4 w-4 rounded-full border-2 border-slate-400" />
        );
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return 'Genehmigt';
      case 'REJECTED':
        return 'Abgelehnt';
      case 'SUBMITTED':
        return 'Zur Prüfung';
      default:
        return 'Entwurf';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'REJECTED':
        return 'bg-red-500/10 text-red-400 border-red-500/30';
      case 'SUBMITTED':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
    }
  };

  const getGradeColor = (grade: number | null): string => {
    if (grade === null) return 'text-muted-foreground';
    if (grade <= 1.5) return 'text-emerald-400';
    if (grade <= 2.5) return 'text-green-400';
    if (grade <= 3.5) return 'text-yellow-400';
    if (grade <= 4.5) return 'text-orange-400';
    return 'text-red-400';
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl space-y-6 py-8">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="from-primary/20 to-primary/5 border-primary/20 rounded-2xl border bg-gradient-to-br p-3">
          <ClipboardCheck className="text-primary h-7 w-7" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Azubi-Abschlusszeugnis</h1>
          <p className="text-muted-foreground mt-0.5">
            Wöchentliche Leistungsbewertungen deiner Auszubildenden prüfen
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="py-4 text-center">
            <div className="text-foreground text-2xl font-bold">
              {totals.trainees || traineeSummaries.length}
            </div>
            <div className="text-muted-foreground mt-1 text-xs">Azubis</div>
          </CardContent>
        </Card>
        <Card className="border-amber-500/20 bg-amber-500/10">
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-amber-400">
              {pendingCount || totals.pendingReviews}
            </div>
            <div className="mt-1 text-xs text-amber-400/70">Offen</div>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20 bg-emerald-500/10">
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-emerald-400">
              {
                evaluations.filter(e => e.evaluation.status === 'APPROVED')
                  .length
              }
            </div>
            <div className="mt-1 text-xs text-emerald-400/70">Genehmigt</div>
          </CardContent>
        </Card>
        <Card className="border-red-500/20 bg-red-500/10">
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-red-400">
              {totals.warningsCount}
            </div>
            <div className="mt-1 text-xs text-red-400/70">Warnungen</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={v => setActiveTab(v as TabType)}
        className="w-full"
      >
        <TabsList className="bg-card border-border grid w-full grid-cols-4 border">
          <TabsTrigger
            value="pending"
            className="data-[state=active]:bg-primary/20 flex items-center gap-2"
          >
            <Clock className="h-4 w-4" />
            Offen
            {pendingCount > 0 && (
              <span className="rounded-full bg-red-500/80 px-1.5 py-0.5 text-xs text-white">
                {pendingCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="reviewed"
            className="data-[state=active]:bg-primary/20 flex items-center gap-2"
          >
            <CheckCircle className="h-4 w-4" />
            Genehmigt
          </TabsTrigger>
          <TabsTrigger
            value="all"
            className="data-[state=active]:bg-primary/20 flex items-center gap-2"
          >
            Alle
          </TabsTrigger>
          <TabsTrigger
            value="annual"
            className="data-[state=active]:bg-primary/20 flex items-center gap-2"
          >
            <BarChart3 className="h-4 w-4" />
            Jahresübersicht
          </TabsTrigger>
        </TabsList>

        {/* Weekly Tabs Content */}
        {['pending', 'reviewed', 'all'].map(tab => (
          <TabsContent key={tab} value={tab} className="mt-6">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <LoadingSpinner size="md" />
              </div>
            ) : evaluations.length === 0 ? (
              <Card className="border-border/30 bg-card/30 border-2 border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-16">
                  <div className="mb-4 rounded-2xl bg-emerald-500/10 p-4">
                    <CheckCircle className="h-10 w-10 text-emerald-400" />
                  </div>
                  <p className="text-muted-foreground text-center font-medium">
                    {activeTab === 'pending'
                      ? 'Keine offenen Bewertungen zur Prüfung!'
                      : 'Keine Bewertungen gefunden.'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {evaluations.map(item => (
                  <Card
                    key={item.evaluation.id}
                    className={`hover:border-border/60 cursor-pointer transition-all duration-200 hover:shadow-lg ${
                      selectedEvaluation === item.evaluation.id
                        ? 'ring-primary/50 border-primary/30 bg-primary/5 ring-2'
                        : 'bg-card/60 border-border/30'
                    }`}
                    onClick={() =>
                      setSelectedEvaluation(
                        selectedEvaluation === item.evaluation.id
                          ? null
                          : item.evaluation.id
                      )
                    }
                  >
                    <CardHeader className="py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="rounded-xl border border-slate-500/20 bg-gradient-to-br from-slate-500/20 to-slate-500/5 p-2.5">
                            <User className="h-5 w-5 text-slate-400" />
                          </div>
                          <div>
                            <CardTitle className="flex items-center gap-2 text-base">
                              {item.trainee.fullName}
                            </CardTitle>
                            <CardDescription className="mt-1 flex items-center gap-3">
                              <span className="flex items-center gap-1.5">
                                <Calendar className="h-3.5 w-3.5" />
                                KW {item.evaluation.weekNumber} /{' '}
                                {item.evaluation.year}
                              </span>
                              <span className="rounded bg-slate-500/10 px-2 py-0.5 text-xs">
                                {item.evaluation.ausbildungsjahr}. Lehrjahr
                              </span>
                              {item.evaluation.selfRating && (
                                <span className="border-border/50 flex items-center gap-1.5 border-l pl-2">
                                  <span className="text-xs">Selbst:</span>
                                  <span className="text-foreground font-medium">
                                    Note {item.evaluation.selfRating}
                                  </span>
                                </span>
                              )}
                            </CardDescription>
                          </div>
                        </div>

                        <div
                          className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${getStatusColor(item.evaluation.status)}`}
                        >
                          {getStatusIcon(item.evaluation.status)}
                          <span>{getStatusLabel(item.evaluation.status)}</span>
                        </div>
                      </div>
                    </CardHeader>

                    {selectedEvaluation === item.evaluation.id && (
                      <CardContent
                        className="pt-0 pb-6"
                        onClick={e => e.stopPropagation()}
                      >
                        <TrainerEvaluationReview
                          evaluation={item.evaluation}
                          trainee={item.trainee}
                          onApprove={handleRefresh}
                          onReject={handleRefresh}
                          onSave={handleRefresh}
                        />
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        ))}

        {/* Annual Overview Tab */}
        <TabsContent value="annual" className="mt-6 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <LoadingSpinner size="md" />
            </div>
          ) : traineeSummaries.length === 0 ? (
            <Card className="border-border/30 bg-card/30 border-2 border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <div className="bg-muted/20 mb-4 rounded-2xl p-4">
                  <BarChart3 className="text-muted-foreground h-10 w-10" />
                </div>
                <p className="text-muted-foreground text-center">
                  Keine Azubi-Daten verfügbar.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {traineeSummaries.map(trainee => (
                <Card
                  key={trainee.traineeId}
                  className={`cursor-pointer transition-all duration-200 hover:shadow-lg ${
                    trainee.warnings.length > 0
                      ? 'border-red-500/30 bg-red-500/5'
                      : 'bg-card border-border hover:border-border/60'
                  } ${selectedTrainee === trainee.traineeId ? 'ring-primary/50 ring-2' : ''}`}
                  onClick={() =>
                    setSelectedTrainee(
                      selectedTrainee === trainee.traineeId
                        ? null
                        : trainee.traineeId
                    )
                  }
                >
                  <CardHeader className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div
                          className={`rounded-xl border p-2.5 ${
                            trainee.warnings.length > 0
                              ? 'border-red-500/30 bg-red-500/20'
                              : 'border-slate-500/20 bg-gradient-to-br from-slate-500/20 to-slate-500/5'
                          }`}
                        >
                          {trainee.warnings.length > 0 ? (
                            <AlertTriangle className="h-5 w-5 text-red-400" />
                          ) : (
                            <User className="h-5 w-5 text-slate-400" />
                          )}
                        </div>
                        <div>
                          <CardTitle className="flex items-center gap-2 text-base">
                            {trainee.traineeName}
                            {trainee.pendingCount > 0 && (
                              <Badge
                                variant="secondary"
                                className="bg-amber-500/20 text-xs text-amber-400"
                              >
                                {trainee.pendingCount} offen
                              </Badge>
                            )}
                          </CardTitle>
                          <CardDescription className="mt-1 flex items-center gap-3">
                            <span>{trainee.totalEvaluations} Bewertungen</span>
                            {trainee.warnings.map((w, i) => (
                              <Badge
                                key={i}
                                variant="destructive"
                                className="text-xs"
                              >
                                {w === 'PERFORMANCE_CRITICAL'
                                  ? 'Kritisch'
                                  : w === 'PERFORMANCE_LOW'
                                    ? 'Warnung'
                                    : w}
                              </Badge>
                            ))}
                          </CardDescription>
                        </div>
                      </div>

                      <div className="flex items-center gap-6">
                        {/* Ausbildungsjahr averages */}
                        <div className="flex items-center gap-4">
                          {[1, 2, 3].map(aj => {
                            const data = trainee.byAusbildungsjahr[aj];
                            if (!data || data.count === 0) return null;
                            return (
                              <div key={aj} className="text-center">
                                <div
                                  className={`text-lg font-bold ${getGradeColor(data.average)}`}
                                >
                                  {data.average?.toFixed(1) || '–'}
                                </div>
                                <div className="text-muted-foreground text-xs">
                                  {aj}. Jahr
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Overall Average */}
                        <div
                          className={`rounded-xl border px-4 py-2 ${
                            trainee.trainerAverage &&
                            trainee.trainerAverage > 3.5
                              ? 'border-red-500/30 bg-red-500/20'
                              : 'bg-muted/20 border-border'
                          }`}
                        >
                          <div
                            className={`text-xl font-bold ${getGradeColor(trainee.trainerAverage)}`}
                          >
                            {trainee.trainerAverage?.toFixed(2) || '–'}
                          </div>
                          <div className="text-muted-foreground text-xs">
                            Gesamt
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardHeader>

                  {selectedTrainee === trainee.traineeId && (
                    <CardContent
                      className="pt-0 pb-6"
                      onClick={e => e.stopPropagation()}
                    >
                      <AnnualPerformanceOverview
                        traineeId={trainee.traineeId}
                        traineeName={trainee.traineeName}
                        showDetails={true}
                      />
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
