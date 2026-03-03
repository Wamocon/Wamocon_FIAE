'use client';

import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle, XCircle, Clock, User, Calendar, ClipboardCheck, BarChart3, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
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
    const [selectedEvaluation, setSelectedEvaluation] = useState<string | null>(null);
    const [selectedTrainee, setSelectedTrainee] = useState<string | null>(null);

    // Data fetching via React Query — only the active tab's URL is non-null
    const evalStatus = activeTab === 'pending' ? 'SUBMITTED' : activeTab === 'reviewed' ? 'APPROVED' : '';
    const evalUrl = profile?.id && activeTab !== 'annual' ? `/api/trainer/evaluations?trainerId=${profile.id}&status=${evalStatus}` : null;
    const annualUrl = profile?.id && activeTab === 'annual' ? `/api/trainer/annual-overview?trainerId=${profile.id}` : null;

    const { data: evalData, isLoading: evalLoading } = useApiQuery<{ evaluations: EvaluationItem[]; pendingCount: number }>(evalUrl);
    const { data: annualData, isLoading: annualLoading } = useApiQuery<{ summaries: TraineeSummary[]; totals: { trainees: number; pendingReviews: number; warningsCount: number } }>(annualUrl);

    const evaluations = evalData?.evaluations || [];
    const pendingCount = evalData?.pendingCount || 0;
    const traineeSummaries = annualData?.summaries || [];
    const totals = annualData?.totals || { trainees: 0, pendingReviews: 0, warningsCount: 0 };
    const loading = evalLoading || annualLoading;

    const handleRefresh = () => {
        setSelectedEvaluation(null);
        if (evalUrl) queryClient.invalidateQueries({ queryKey: [evalUrl] });
        if (annualUrl) queryClient.invalidateQueries({ queryKey: [annualUrl] });
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'APPROVED': return <CheckCircle className="h-4 w-4 text-emerald-400" />;
            case 'REJECTED': return <XCircle className="h-4 w-4 text-red-400" />;
            case 'SUBMITTED': return <Clock className="h-4 w-4 text-amber-400" />;
            default: return <div className="h-4 w-4 rounded-full border-2 border-slate-400" />;
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'APPROVED': return 'Genehmigt';
            case 'REJECTED': return 'Abgelehnt';
            case 'SUBMITTED': return 'Zur Prüfung';
            default: return 'Entwurf';
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'APPROVED': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
            case 'REJECTED': return 'bg-red-500/10 text-red-400 border-red-500/30';
            case 'SUBMITTED': return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
            default: return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
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
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="container max-w-5xl mx-auto py-8 space-y-6">
            {/* Header */}
            <div className="flex items-start gap-4">
                <div className="p-3 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
                    <ClipboardCheck className="h-7 w-7 text-primary" />
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
                        <div className="text-2xl font-bold text-foreground">{totals.trainees || traineeSummaries.length}</div>
                        <div className="text-xs text-muted-foreground mt-1">Azubis</div>
                    </CardContent>
                </Card>
                <Card className="bg-amber-500/10 border-amber-500/20">
                    <CardContent className="py-4 text-center">
                        <div className="text-2xl font-bold text-amber-400">{pendingCount || totals.pendingReviews}</div>
                        <div className="text-xs text-amber-400/70 mt-1">Offen</div>
                    </CardContent>
                </Card>
                <Card className="bg-emerald-500/10 border-emerald-500/20">
                    <CardContent className="py-4 text-center">
                        <div className="text-2xl font-bold text-emerald-400">{evaluations.filter(e => e.evaluation.status === 'APPROVED').length}</div>
                        <div className="text-xs text-emerald-400/70 mt-1">Genehmigt</div>
                    </CardContent>
                </Card>
                <Card className="bg-red-500/10 border-red-500/20">
                    <CardContent className="py-4 text-center">
                        <div className="text-2xl font-bold text-red-400">{totals.warningsCount}</div>
                        <div className="text-xs text-red-400/70 mt-1">Warnungen</div>
                    </CardContent>
                </Card>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabType)} className="w-full">
                <TabsList className="w-full grid grid-cols-4 bg-card border border-border">
                    <TabsTrigger value="pending" className="flex items-center gap-2 data-[state=active]:bg-primary/20">
                        <Clock className="h-4 w-4" />
                        Offen
                        {pendingCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full bg-red-500/80 text-white text-xs">
                                {pendingCount}
                            </span>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="reviewed" className="flex items-center gap-2 data-[state=active]:bg-primary/20">
                        <CheckCircle className="h-4 w-4" />
                        Genehmigt
                    </TabsTrigger>
                    <TabsTrigger value="all" className="flex items-center gap-2 data-[state=active]:bg-primary/20">
                        Alle
                    </TabsTrigger>
                    <TabsTrigger value="annual" className="flex items-center gap-2 data-[state=active]:bg-primary/20">
                        <BarChart3 className="h-4 w-4" />
                        Jahresübersicht
                    </TabsTrigger>
                </TabsList>

                {/* Weekly Tabs Content */}
                {['pending', 'reviewed', 'all'].map((tab) => (
                    <TabsContent key={tab} value={tab} className="mt-6">
                        {loading ? (
                            <div className="flex items-center justify-center py-16">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : evaluations.length === 0 ? (
                            <Card className="border-dashed border-2 border-border/30 bg-card/30">
                                <CardContent className="flex flex-col items-center justify-center py-16">
                                    <div className="p-4 rounded-2xl bg-emerald-500/10 mb-4">
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
                                {evaluations.map((item) => (
                                    <Card
                                        key={item.evaluation.id}
                                        className={`cursor-pointer transition-all duration-200 hover:shadow-lg hover:border-border/60 ${selectedEvaluation === item.evaluation.id
                                            ? 'ring-2 ring-primary/50 border-primary/30 bg-primary/5'
                                            : 'bg-card/60 border-border/30'
                                            }`}
                                        onClick={() => setSelectedEvaluation(
                                            selectedEvaluation === item.evaluation.id ? null : item.evaluation.id
                                        )}
                                    >
                                        <CardHeader className="py-4">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-4">
                                                    <div className="p-2.5 rounded-xl bg-gradient-to-br from-slate-500/20 to-slate-500/5 border border-slate-500/20">
                                                        <User className="h-5 w-5 text-slate-400" />
                                                    </div>
                                                    <div>
                                                        <CardTitle className="text-base flex items-center gap-2">
                                                            {item.trainee.fullName}
                                                        </CardTitle>
                                                        <CardDescription className="flex items-center gap-3 mt-1">
                                                            <span className="flex items-center gap-1.5">
                                                                <Calendar className="h-3.5 w-3.5" />
                                                                KW {item.evaluation.weekNumber} / {item.evaluation.year}
                                                            </span>
                                                            <span className="text-xs bg-slate-500/10 px-2 py-0.5 rounded">
                                                                {item.evaluation.ausbildungsjahr}. Lehrjahr
                                                            </span>
                                                            {item.evaluation.selfRating && (
                                                                <span className="flex items-center gap-1.5 pl-2 border-l border-border/50">
                                                                    <span className="text-xs">Selbst:</span>
                                                                    <span className="font-medium text-foreground">Note {item.evaluation.selfRating}</span>
                                                                </span>
                                                            )}
                                                        </CardDescription>
                                                    </div>
                                                </div>

                                                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm ${getStatusColor(item.evaluation.status)}`}>
                                                    {getStatusIcon(item.evaluation.status)}
                                                    <span>{getStatusLabel(item.evaluation.status)}</span>
                                                </div>
                                            </div>
                                        </CardHeader>

                                        {selectedEvaluation === item.evaluation.id && (
                                            <CardContent className="pt-0 pb-6" onClick={(e) => e.stopPropagation()}>
                                                <TrainerEvaluationReview
                                                    evaluation={item.evaluation}
                                                    trainee={item.trainee}
                                                    trainerId={profile?.id}
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
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : traineeSummaries.length === 0 ? (
                        <Card className="border-dashed border-2 border-border/30 bg-card/30">
                            <CardContent className="flex flex-col items-center justify-center py-16">
                                <div className="p-4 rounded-2xl bg-muted/20 mb-4">
                                    <BarChart3 className="h-10 w-10 text-muted-foreground" />
                                </div>
                                <p className="text-muted-foreground text-center">
                                    Keine Azubi-Daten verfügbar.
                                </p>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="space-y-4">
                            {traineeSummaries.map((trainee) => (
                                <Card
                                    key={trainee.traineeId}
                                    className={`cursor-pointer transition-all duration-200 hover:shadow-lg ${trainee.warnings.length > 0
                                            ? 'border-red-500/30 bg-red-500/5'
                                            : 'bg-card border-border hover:border-border/60'
                                        } ${selectedTrainee === trainee.traineeId ? 'ring-2 ring-primary/50' : ''}`}
                                    onClick={() => setSelectedTrainee(
                                        selectedTrainee === trainee.traineeId ? null : trainee.traineeId
                                    )}
                                >
                                    <CardHeader className="py-4">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-4">
                                                <div className={`p-2.5 rounded-xl border ${trainee.warnings.length > 0
                                                        ? 'bg-red-500/20 border-red-500/30'
                                                        : 'bg-gradient-to-br from-slate-500/20 to-slate-500/5 border-slate-500/20'
                                                    }`}>
                                                    {trainee.warnings.length > 0
                                                        ? <AlertTriangle className="h-5 w-5 text-red-400" />
                                                        : <User className="h-5 w-5 text-slate-400" />
                                                    }
                                                </div>
                                                <div>
                                                    <CardTitle className="text-base flex items-center gap-2">
                                                        {trainee.traineeName}
                                                        {trainee.pendingCount > 0 && (
                                                            <Badge variant="secondary" className="bg-amber-500/20 text-amber-400 text-xs">
                                                                {trainee.pendingCount} offen
                                                            </Badge>
                                                        )}
                                                    </CardTitle>
                                                    <CardDescription className="flex items-center gap-3 mt-1">
                                                        <span>{trainee.totalEvaluations} Bewertungen</span>
                                                        {trainee.warnings.map((w, i) => (
                                                            <Badge key={i} variant="destructive" className="text-xs">
                                                                {w === 'PERFORMANCE_CRITICAL' ? 'Kritisch' :
                                                                    w === 'PERFORMANCE_LOW' ? 'Warnung' : w}
                                                            </Badge>
                                                        ))}
                                                    </CardDescription>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-6">
                                                {/* Ausbildungsjahr averages */}
                                                <div className="flex items-center gap-4">
                                                    {[1, 2, 3].map((aj) => {
                                                        const data = trainee.byAusbildungsjahr[aj];
                                                        if (!data || data.count === 0) return null;
                                                        return (
                                                            <div key={aj} className="text-center">
                                                                <div className={`text-lg font-bold ${getGradeColor(data.average)}`}>
                                                                    {data.average?.toFixed(1) || '–'}
                                                                </div>
                                                                <div className="text-xs text-muted-foreground">{aj}. Jahr</div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                {/* Overall Average */}
                                                <div className={`px-4 py-2 rounded-xl border ${trainee.trainerAverage && trainee.trainerAverage > 3.5
                                                        ? 'bg-red-500/20 border-red-500/30'
                                                        : 'bg-muted/20 border-border'
                                                    }`}>
                                                    <div className={`text-xl font-bold ${getGradeColor(trainee.trainerAverage)}`}>
                                                        {trainee.trainerAverage?.toFixed(2) || '–'}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground">Gesamt</div>
                                                </div>
                                            </div>
                                        </div>
                                    </CardHeader>

                                    {selectedTrainee === trainee.traineeId && (
                                        <CardContent className="pt-0 pb-6" onClick={(e) => e.stopPropagation()}>
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
