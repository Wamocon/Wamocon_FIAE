'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Plus, Calendar, ChevronLeft, ChevronRight, Award, CheckCircle2, Clock, XCircle, BarChart3, FileText } from 'lucide-react';
import WeeklyEvaluationForm from '@/components/arbeitszeugnis/WeeklyEvaluationForm';
import AnnualPerformanceOverview from '@/components/arbeitszeugnis/AnnualPerformanceOverview';

interface Evaluation {
    id: string;
    weekNumber: number;
    year: number;
    ausbildungsjahr: number;
    selfRating: string | null;
    selfComment: string | null;
    trainerRating: string | null;
    trainerComment: string | null;
    status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
    arpThemeText: string | null;
    arpUseCaseId: string | null;
    rejectionReason: string | null;
}

function getCurrentWeek(): number {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    const diff = now.getTime() - start.getTime();
    const oneWeek = 1000 * 60 * 60 * 24 * 7;
    return Math.ceil(diff / oneWeek);
}

export default function TraineeEvaluationsPage() {
    const { profile, loading: authLoading } = useAuth();
    const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [showNewForm, setShowNewForm] = useState(false);
    const [activeTab, setActiveTab] = useState('weekly');

    const currentWeek = getCurrentWeek();
    const currentYear = new Date().getFullYear();

    // Calculate trainee's Ausbildungsjahr (1, 2, or 3)
    const getAusbildungsjahr = (): number => {
        const profileAny = profile as unknown as Record<string, unknown>;
        if (!profileAny?.startDate) return 1;
        const startYear = new Date(profileAny.startDate as string).getFullYear();
        const yearDiff = currentYear - startYear + 1;
        return Math.min(Math.max(yearDiff, 1), 3);
    };

    useEffect(() => {
        if (!profile?.id) return;

        async function fetchEvaluations() {
            setLoading(true);
            try {
                const res = await fetch(`/api/trainee/evaluations?userId=${profile?.id}&year=${selectedYear}`);
                if (res.ok) {
                    const data = await res.json();
                    setEvaluations(data.evaluations || []);
                }
            } catch (error) {
                console.error('Error fetching evaluations:', error);
            } finally {
                setLoading(false);
            }
        }

        fetchEvaluations();
    }, [profile?.id, selectedYear]);

    const handleRefresh = () => {
        setSelectedWeek(null);
        setShowNewForm(false);
        if (profile?.id) {
            setLoading(true);
            fetch(`/api/trainee/evaluations?userId=${profile.id}&year=${selectedYear}`)
                .then(res => res.json())
                .then(data => setEvaluations(data.evaluations || []))
                .finally(() => setLoading(false));
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'APPROVED': return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
            case 'REJECTED': return <XCircle className="h-4 w-4 text-red-400" />;
            case 'SUBMITTED': return <Clock className="h-4 w-4 text-blue-400" />;
            default: return <div className="h-4 w-4 rounded-full border-2 border-white/30" />;
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
            case 'APPROVED': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
            case 'REJECTED': return 'bg-red-500/15 text-red-400 border-red-500/30';
            case 'SUBMITTED': return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
            default: return 'bg-white/5 text-white/50 border-white/20';
        }
    };

    // Stats for header
    const stats = {
        total: evaluations.length,
        approved: evaluations.filter(e => e.status === 'APPROVED').length,
        pending: evaluations.filter(e => e.status === 'SUBMITTED').length,
        rejected: evaluations.filter(e => e.status === 'REJECTED').length,
    };

    if (authLoading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="h-8 w-8 animate-spin text-white/50" />
            </div>
        );
    }

    return (
        <div className="container max-w-5xl mx-auto py-8 space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
                        <Award className="h-7 w-7 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-white">Azubi-Abschlusszeugnis</h1>
                        <p className="text-white/60 mt-0.5">
                            Wöchentliche Leistungsbewertungen für dein Arbeitszeugnis
                        </p>
                    </div>
                </div>

                {activeTab === 'weekly' && (
                    <Button
                        onClick={() => setShowNewForm(true)}
                        disabled={showNewForm}
                        className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70"
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        Neue Bewertung (KW {currentWeek})
                    </Button>
                )}
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4">
                <Card className="bg-[#1a1a1a] border-white/10">
                    <CardContent className="py-4 text-center">
                        <div className="text-2xl font-bold text-white">{stats.total}</div>
                        <div className="text-xs text-white/50 mt-1">Gesamt</div>
                    </CardContent>
                </Card>
                <Card className="bg-emerald-500/10 border-emerald-500/20">
                    <CardContent className="py-4 text-center">
                        <div className="text-2xl font-bold text-emerald-400">{stats.approved}</div>
                        <div className="text-xs text-emerald-400/70 mt-1">Genehmigt</div>
                    </CardContent>
                </Card>
                <Card className="bg-blue-500/10 border-blue-500/20">
                    <CardContent className="py-4 text-center">
                        <div className="text-2xl font-bold text-blue-400">{stats.pending}</div>
                        <div className="text-xs text-blue-400/70 mt-1">Zur Prüfung</div>
                    </CardContent>
                </Card>
                <Card className="bg-red-500/10 border-red-500/20">
                    <CardContent className="py-4 text-center">
                        <div className="text-2xl font-bold text-red-400">{stats.rejected}</div>
                        <div className="text-xs text-red-400/70 mt-1">Abgelehnt</div>
                    </CardContent>
                </Card>
            </div>

            {/* Tab Navigation */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="w-full grid grid-cols-2 bg-[#1a1a1a] border border-white/10">
                    <TabsTrigger value="weekly" className="flex items-center gap-2 data-[state=active]:bg-primary/20">
                        <FileText className="h-4 w-4" />
                        Wöchentliche Bewertungen
                    </TabsTrigger>
                    <TabsTrigger value="annual" className="flex items-center gap-2 data-[state=active]:bg-primary/20">
                        <BarChart3 className="h-4 w-4" />
                        Jahresübersicht
                    </TabsTrigger>
                </TabsList>

                {/* Weekly Tab */}
                <TabsContent value="weekly" className="space-y-6 mt-6">
                    {/* Year Navigation */}
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-[#1a1a1a] border border-white/10 w-fit">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedYear(prev => prev - 1)}
                            className="h-8 w-8 hover:bg-white/10"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <div className="flex items-center gap-2 px-3">
                            <Calendar className="h-4 w-4 text-white/50" />
                            <span className="font-semibold text-lg text-white">{selectedYear}</span>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedYear(prev => prev + 1)}
                            disabled={selectedYear >= currentYear}
                            className="h-8 w-8 hover:bg-white/10"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>

                    {/* New Evaluation Form */}
                    {showNewForm && (
                        <WeeklyEvaluationForm
                            weekNumber={currentWeek}
                            year={currentYear}
                            ausbildungsjahr={getAusbildungsjahr()}
                            onSave={handleRefresh}
                            onSubmit={handleRefresh}
                        />
                    )}

                    {/* Evaluations List */}
                    {loading ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader2 className="h-6 w-6 animate-spin text-white/50" />
                        </div>
                    ) : evaluations.length === 0 && !showNewForm ? (
                        <Card className="border-dashed border-2 border-white/10 bg-[#1a1a1a]/50">
                            <CardContent className="flex flex-col items-center justify-center py-16">
                                <div className="p-4 rounded-2xl bg-white/5 mb-4">
                                    <Calendar className="h-10 w-10 text-white/40" />
                                </div>
                                <p className="text-white/60 text-center">
                                    Keine Bewertungen für {selectedYear} gefunden.
                                </p>
                                <p className="text-white/40 text-center text-sm mt-1">
                                    Erstelle deine erste wöchentliche Bewertung!
                                </p>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="space-y-4">
                            {evaluations.map((item) => (
                                <Card
                                    key={item.id}
                                    className={`cursor-pointer transition-all duration-200 hover:shadow-lg ${selectedWeek === item.weekNumber
                                        ? 'ring-2 ring-primary/50 border-primary/30 bg-[#1a1a1a]'
                                        : 'bg-[#1a1a1a]/80 border-white/10 hover:border-white/20'
                                        }`}
                                    onClick={() => setSelectedWeek(selectedWeek === item.weekNumber ? null : item.weekNumber)}
                                >
                                    <CardHeader className="py-4">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-4">
                                                <div className="text-center min-w-[60px]">
                                                    <div className="text-2xl font-bold text-primary">KW {item.weekNumber}</div>
                                                    <div className="text-xs text-white/40">{item.year}</div>
                                                </div>
                                                <div className="h-10 w-px bg-white/10" />
                                                <div>
                                                    <CardTitle className="text-base flex items-center gap-2 text-white/90">
                                                        {item.ausbildungsjahr}. Ausbildungsjahr
                                                    </CardTitle>
                                                    <CardDescription className="flex items-center gap-3 mt-1">
                                                        {item.selfRating && (
                                                            <span className="flex items-center gap-1.5">
                                                                <span className="text-xs text-white/40">Selbst:</span>
                                                                <span className="font-medium text-white/80">Note {item.selfRating}</span>
                                                            </span>
                                                        )}
                                                        {item.trainerRating && (
                                                            <span className="flex items-center gap-1.5 pl-3 border-l border-white/10">
                                                                <span className="text-xs text-white/40">Trainer:</span>
                                                                <span className="font-medium text-white/80">Note {item.trainerRating}</span>
                                                            </span>
                                                        )}
                                                    </CardDescription>
                                                </div>
                                            </div>

                                            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm ${getStatusColor(item.status)}`}>
                                                {getStatusIcon(item.status)}
                                                <span>{getStatusLabel(item.status)}</span>
                                            </div>
                                        </div>
                                    </CardHeader>

                                    {selectedWeek === item.weekNumber && (
                                        <CardContent className="pt-0 pb-6" onClick={(e) => e.stopPropagation()}>
                                            <WeeklyEvaluationForm
                                                weekNumber={item.weekNumber}
                                                year={item.year}
                                                ausbildungsjahr={item.ausbildungsjahr}
                                                existingEvaluation={item}
                                                onSave={handleRefresh}
                                                onSubmit={handleRefresh}
                                            />
                                        </CardContent>
                                    )}
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                {/* Annual Overview Tab */}
                <TabsContent value="annual" className="mt-6">
                    {profile?.id && (
                        <AnnualPerformanceOverview
                            traineeId={profile.id}
                            traineeName={profile.full_name || undefined}
                            year={selectedYear}
                            showDetails={true}
                        />
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}
