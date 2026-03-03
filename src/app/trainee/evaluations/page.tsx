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
import {
  Loader2,
  Plus,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Award,
  CheckCircle2,
  Clock,
  XCircle,
  BarChart3,
  FileText,
} from 'lucide-react';
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
  const queryClient = useQueryClient();
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

  const evalUrl = profile?.id
    ? `/api/trainee/evaluations?userId=${profile.id}&year=${selectedYear}`
    : null;
  const { data: evalData, isLoading: loading } = useApiQuery<{
    evaluations: Evaluation[];
  }>(evalUrl);
  const evaluations = evalData?.evaluations || [];

  const handleRefresh = () => {
    setSelectedWeek(null);
    setShowNewForm(false);
    if (evalUrl) queryClient.invalidateQueries({ queryKey: [evalUrl] });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
      case 'REJECTED':
        return <XCircle className="h-4 w-4 text-red-400" />;
      case 'SUBMITTED':
        return <Clock className="h-4 w-4 text-blue-400" />;
      default:
        return (
          <div className="border-muted-foreground/30 h-4 w-4 rounded-full border-2" />
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
        return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
      case 'REJECTED':
        return 'bg-red-500/15 text-red-400 border-red-500/30';
      case 'SUBMITTED':
        return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
      default:
        return 'bg-muted/30 text-muted-foreground border-border/60';
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
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl space-y-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="from-primary/20 to-primary/5 border-primary/20 rounded-2xl border bg-gradient-to-br p-3">
            <Award className="text-primary h-7 w-7" />
          </div>
          <div>
            <h1 className="text-foreground text-2xl font-bold">
              Azubi-Abschlusszeugnis
            </h1>
            <p className="text-muted-foreground mt-0.5">
              Wöchentliche Leistungsbewertungen für dein Arbeitszeugnis
            </p>
          </div>
        </div>

        {activeTab === 'weekly' && (
          <Button
            onClick={() => setShowNewForm(true)}
            disabled={showNewForm}
            className="from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 bg-gradient-to-r"
          >
            <Plus className="mr-2 h-4 w-4" />
            Neue Bewertung (KW {currentWeek})
          </Button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="py-4 text-center">
            <div className="text-foreground text-2xl font-bold">
              {stats.total}
            </div>
            <div className="text-muted-foreground mt-1 text-xs">Gesamt</div>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20 bg-emerald-500/10">
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-emerald-400">
              {stats.approved}
            </div>
            <div className="mt-1 text-xs text-emerald-400/70">Genehmigt</div>
          </CardContent>
        </Card>
        <Card className="border-blue-500/20 bg-blue-500/10">
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-blue-400">
              {stats.pending}
            </div>
            <div className="mt-1 text-xs text-blue-400/70">Zur Prüfung</div>
          </CardContent>
        </Card>
        <Card className="border-red-500/20 bg-red-500/10">
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-red-400">
              {stats.rejected}
            </div>
            <div className="mt-1 text-xs text-red-400/70">Abgelehnt</div>
          </CardContent>
        </Card>
      </div>

      {/* Tab Navigation */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-card border-border grid w-full grid-cols-2 border">
          <TabsTrigger
            value="weekly"
            className="data-[state=active]:bg-primary/20 flex items-center gap-2"
          >
            <FileText className="h-4 w-4" />
            Wöchentliche Bewertungen
          </TabsTrigger>
          <TabsTrigger
            value="annual"
            className="data-[state=active]:bg-primary/20 flex items-center gap-2"
          >
            <BarChart3 className="h-4 w-4" />
            Jahresübersicht
          </TabsTrigger>
        </TabsList>

        {/* Weekly Tab */}
        <TabsContent value="weekly" className="mt-6 space-y-6">
          {/* Year Navigation */}
          <div className="bg-card border-border flex w-fit items-center gap-3 rounded-xl border p-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSelectedYear(prev => prev - 1)}
              className="hover:bg-muted h-8 w-8"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2 px-3">
              <Calendar className="text-muted-foreground h-4 w-4" />
              <span className="text-foreground text-lg font-semibold">
                {selectedYear}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSelectedYear(prev => prev + 1)}
              disabled={selectedYear >= currentYear}
              className="hover:bg-muted h-8 w-8"
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
              <LoadingSpinner size="md" />
            </div>
          ) : evaluations.length === 0 && !showNewForm ? (
            <Card className="border-border bg-card/50 border-2 border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <div className="bg-muted/30 mb-4 rounded-2xl p-4">
                  <Calendar className="text-muted-foreground h-10 w-10" />
                </div>
                <p className="text-muted-foreground text-center">
                  Keine Bewertungen für {selectedYear} gefunden.
                </p>
                <p className="text-muted-foreground mt-1 text-center text-sm">
                  Erstelle deine erste wöchentliche Bewertung!
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {evaluations.map(item => (
                <Card
                  key={item.id}
                  className={`cursor-pointer transition-all duration-200 hover:scale-[1.005] hover:shadow-lg ${
                    selectedWeek === item.weekNumber
                      ? 'ring-primary/50 border-primary/30 bg-card shadow-primary/5 ring-2'
                      : 'bg-card/80 border-border hover:border-border/60 hover:shadow-accent/5'
                  }`}
                  onClick={() =>
                    setSelectedWeek(
                      selectedWeek === item.weekNumber ? null : item.weekNumber
                    )
                  }
                >
                  <CardHeader className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="min-w-[60px] text-center">
                          <div className="text-primary text-2xl font-bold">
                            KW {item.weekNumber}
                          </div>
                          <div className="text-muted-foreground text-xs">
                            {item.year}
                          </div>
                        </div>
                        <div className="bg-border h-10 w-px" />
                        <div>
                          <CardTitle className="text-foreground flex items-center gap-2 text-base">
                            {item.ausbildungsjahr}. Ausbildungsjahr
                          </CardTitle>
                          <CardDescription className="mt-1 flex items-center gap-3">
                            {item.selfRating && (
                              <span className="flex items-center gap-1.5">
                                <span className="text-muted-foreground text-xs">
                                  Selbst:
                                </span>
                                <span className="text-foreground/80 font-medium">
                                  Note {item.selfRating}
                                </span>
                              </span>
                            )}
                            {item.trainerRating && (
                              <span className="border-border flex items-center gap-1.5 border-l pl-3">
                                <span className="text-muted-foreground text-xs">
                                  Trainer:
                                </span>
                                <span className="text-foreground/80 font-medium">
                                  Note {item.trainerRating}
                                </span>
                              </span>
                            )}
                          </CardDescription>
                        </div>
                      </div>

                      <div
                        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${getStatusColor(item.status)}`}
                      >
                        {getStatusIcon(item.status)}
                        <span>{getStatusLabel(item.status)}</span>
                      </div>
                    </div>
                  </CardHeader>

                  {selectedWeek === item.weekNumber && (
                    <CardContent
                      className="pt-0 pb-6"
                      onClick={e => e.stopPropagation()}
                    >
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
