'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
    Award,
    User,
    TrendingUp,
    CheckCircle2,
    Sparkles,
    Loader2,
    AlertCircle,
    Lock
} from 'lucide-react';
import { SkillRadarChart } from '@/components/trainer/arbeitszeugnis/SkillRadarChart';

interface ComponentData {
    componentId: string;
    componentCode: string;
    componentTitle: string;
    averageGrade: number | null;
    finalGrade: number | null;
    totalHours: number;
    gradedCount: number;
    totalUseCases: number;
}

interface AggregatedData {
    traineeId: string;
    traineeName: string;
    ausbildungsjahr: number;
    components: ComponentData[];
    overallAverage: number | null;
    shorteningEligible: boolean;
}

interface SkillRadarData {
    radarData: Array<{
        component: string;
        fullTitle: string;
        label: string;
        grade: number | null;
        radarValue: number | null;
        gradedCount: number;
    }>;
}

export default function TraineeArbeitszeugnisPage() {
    const { user } = useAuth();
    const [ausbildungsjahr, setAusbildungsjahr] = useState<number>(1);
    const [loading, setLoading] = useState(false);
    const [aggregatedData, setAggregatedData] = useState<AggregatedData | null>(null);
    const [radarData, setRadarData] = useState<SkillRadarData | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!user) return;

        async function loadData() {
            setLoading(true);
            setError(null);

            try {
                // Fetch data from secure trainee endpoint
                const res = await fetch(`/api/trainee/arbeitszeugnis/stats?ausbildungsjahr=${ausbildungsjahr}`);

                if (res.ok) {
                    const data = await res.json();
                    setAggregatedData(data.aggregatedData);
                    setRadarData(data.radarData);
                } else {
                    console.error('Failed to load data:', res.status);
                    setError('Fehler beim Laden der Zeugnisdaten.');
                }
            } catch (err) {
                console.error('Error loading data:', err);
                setError('Ein unerwarteter Fehler ist aufgetreten.');
            } finally {
                setLoading(false);
            }
        }

        loadData();
    }, [user, ausbildungsjahr]);

    const getGradeColor = (grade: number | null) => {
        if (grade === null) return 'text-muted-foreground';
        if (grade <= 1.5) return 'text-emerald-600';
        if (grade <= 2.5) return 'text-green-600';
        if (grade <= 3.5) return 'text-yellow-600';
        if (grade <= 4.5) return 'text-orange-600';
        return 'text-red-600';
    };

    if (!user) {
        return <div className="p-8 text-center">Bitte melden Sie sich an.</div>;
    }

    return (
        <div className="container mx-auto py-8 space-y-8 max-w-5xl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20">
                        <Award className="h-6 w-6 text-blue-600" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">Mein Ausbildungszeugnis</h1>
                        <p className="text-sm text-muted-foreground">
                            Leistungsübersicht und Kompetenzprofil
                        </p>
                    </div>
                </div>

                {/* Year Selection */}
                <select
                    value={ausbildungsjahr}
                    onChange={(e) => setAusbildungsjahr(parseInt(e.target.value))}
                    className="px-4 py-2 rounded-xl bg-background border border-border text-sm font-medium"
                >
                    <option value={1}>1. Ausbildungsjahr</option>
                    <option value={2}>2. Ausbildungsjahr</option>
                    <option value={3}>3. Ausbildungsjahr</option>
                </select>
            </div>

            {loading && (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-accent" />
                </div>
            )}

            {error && (
                <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex items-center gap-3">
                    <AlertCircle className="h-5 w-5 text-destructive" />
                    <span className="text-destructive">{error}</span>
                </div>
            )}

            {aggregatedData && !loading && (
                <div className="space-y-6">
                    {/* Overview Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-4 rounded-xl bg-card border border-border">
                            <div className="flex items-center gap-3 mb-2">
                                <TrendingUp className="h-5 w-5 text-accent" />
                                <span className="text-sm font-medium">Gesamtdurchschnitt</span>
                            </div>
                            <p className={`text-2xl font-bold ${getGradeColor(aggregatedData.overallAverage)}`}>
                                {aggregatedData.overallAverage?.toFixed(2) || '–'}
                            </p>
                        </div>

                        <div className="p-4 rounded-xl bg-card border border-border">
                            <div className="flex items-center gap-3 mb-2">
                                <CheckCircle2 className="h-5 w-5 text-accent" />
                                <span className="text-sm font-medium">Bewertete Komponenten</span>
                            </div>
                            <p className="text-lg font-bold">
                                {aggregatedData.components.filter(c => c.finalGrade !== null).length} / {aggregatedData.components.length}
                            </p>
                        </div>

                        {aggregatedData.shorteningEligible && (
                            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                                <div className="flex items-center gap-3 mb-2">
                                    <Sparkles className="h-5 w-5 text-emerald-600" />
                                    <span className="text-sm font-medium text-emerald-600">Verkürzung möglich</span>
                                </div>
                                <p className="text-sm text-emerald-600">
                                    Durchschnitt {"<"} 2,45
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Skill Radar */}
                    {radarData && radarData.radarData.length >= 3 && (
                        <div className="p-6 rounded-2xl bg-card border border-border">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                                <TrendingUp className="h-5 w-5 text-accent" />
                                Kompetenzprofil (Skill-Radar)
                            </h3>
                            <SkillRadarChart data={radarData.radarData} size={400} />
                        </div>
                    )}

                    {/* Components Detail */}
                    <div className="p-6 rounded-2xl bg-card border border-border">
                        <h3 className="text-lg font-bold mb-4">Detaillierte Leistungsbewertung</h3>
                        <div className="space-y-3">
                            {aggregatedData.components.map((comp) => (
                                <div
                                    key={comp.componentId}
                                    className="p-4 rounded-xl bg-muted/50 border border-border flex items-center justify-between"
                                >
                                    <div className="flex-1">
                                        <p className="font-medium">{comp.componentTitle}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {comp.componentCode} • {comp.totalHours} Std. • {comp.gradedCount}/{comp.totalUseCases} bewertet
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        {comp.finalGrade !== null ? (
                                            <span className={`text-2xl font-bold ${getGradeColor(comp.averageGrade)}`}>
                                                {comp.finalGrade}
                                            </span>
                                        ) : (
                                            <span className="text-muted-foreground">–</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Info Box */}
                    <div className="p-4 rounded-xl bg-muted border border-border flex items-start gap-3">
                        <Lock className="h-5 w-5 text-muted-foreground mt-0.5" />
                        <div className="text-sm text-muted-foreground">
                            Dies ist eine Vorschau Ihrer aktuellen Leistungsdaten.
                            Das offizielle Zeugnis wird von Ihrem Ausbilder ausgestellt und digital signiert.
                            Ein direkter Download ist hier nicht möglich.
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
