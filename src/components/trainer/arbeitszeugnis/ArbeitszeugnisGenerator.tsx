'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import {
    FileText,
    Award,
    Download,
    Eye,
    User,
    Calendar,
    TrendingUp,
    CheckCircle2,
    AlertCircle,
    Loader2,
    QrCode,
    Sparkles
} from 'lucide-react';
import QRCode from 'qrcode';
import { generateArbeitszeugnisPDF } from '@/lib/arbeitszeugnis/pdfGenerator';
import { SkillRadarChart } from './SkillRadarChart';
import html2canvas from 'html2canvas';
import { EvidenceSection } from './EvidenceSection';

interface Trainee {
    id: string;
    fullName: string;
    email: string;
    startDate: string;
}

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
    periodStart: string;
    periodEnd: string;
    components: ComponentData[];
    overallAverage: number | null;
    shorteningEligible: boolean;
    gradeLegend: Record<string, { label: string; range: string; description: string }>;
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

export function ArbeitszeugnisGenerator() {
    const { profile } = useAuth();
    const { t } = useLanguage();

    const [trainees, setTrainees] = useState<Trainee[]>([]);
    const [selectedTrainee, setSelectedTrainee] = useState<string>('');
    const [ausbildungsjahr, setAusbildungsjahr] = useState<number>(1);
    const [loading, setLoading] = useState(false);
    const [aggregatedData, setAggregatedData] = useState<AggregatedData | null>(null);
    const [radarData, setRadarData] = useState<SkillRadarData | null>(null);
    const [issuing, setIssuing] = useState(false);
    const [gender, setGender] = useState<'male' | 'female' | 'neutral'>('neutral');
    const [certificateType, setCertificateType] = useState<'INTERIM' | 'FINAL'>('INTERIM');
    const [error, setError] = useState<string | null>(null);
    const [summary, setSummary] = useState('');

    // Date Range Logic
    const [mode, setMode] = useState<'YEAR' | 'CUSTOM'>('YEAR');
    const [customStart, setCustomStart] = useState<string>('');
    const [customEnd, setCustomEnd] = useState<string>('');

    const evidenceQuery = useMemo(() => {
        if (mode === 'CUSTOM' && customStart && customEnd) {
            return `?startDate=${customStart}&endDate=${customEnd}`;
        }
        return `?ausbildungsjahr=${ausbildungsjahr}`;
    }, [mode, customStart, customEnd, ausbildungsjahr]);

    const radarRef = useRef<HTMLDivElement>(null);

    // Load trainees
    useEffect(() => {
        async function loadTrainees() {
            try {
                const res = await fetch('/api/trainer/trainees');
                if (res.ok) {
                    const data = await res.json();
                    setTrainees(data.trainees || []);
                }
            } catch (err) {
                console.error('Error loading trainees:', err);
            }
        }
        loadTrainees();
    }, []);

    // Load aggregated data when trainee/year changes
    useEffect(() => {
        if (!selectedTrainee) {
            setAggregatedData(null);
            setRadarData(null);
            return;
        }

        async function loadData() {
            setLoading(true);
            setError(null);

            try {
                let query = `?ausbildungsjahr=${ausbildungsjahr}`;
                if (mode === 'CUSTOM' && customStart && customEnd) {
                    query = `?startDate=${customStart}&endDate=${customEnd}`;
                }

                const [aggRes, radarRes] = await Promise.all([
                    fetch(`/api/trainer/arbeitszeugnis/aggregate/${selectedTrainee}${query}`),
                    fetch(`/api/trainer/arbeitszeugnis/skill-radar/${selectedTrainee}${query}`),
                ]);

                if (aggRes.ok) {
                    const aggData = await aggRes.json();
                    setAggregatedData(aggData);

                    // Set default summary text only if empty or generic
                    if (!summary || summary.startsWith('Person') || summary.startsWith('Herr') || summary.startsWith('Frau')) {
                        const initialPronoun = 'Person';
                        setSummary(`${initialPronoun} ${aggData.traineeName} hat die ihm übertragenen Aufgaben stets zu unserer vollen Zufriedenheit erledigt. Wir danken für die angenehme Zusammenarbeit und wünschen für die berufliche und private Zukunft alles Gute.`);
                    }
                }

                if (radarRes.ok) {
                    const radarResult = await radarRes.json();
                    setRadarData(radarResult);
                }
            } catch (err) {
                setError('Fehler beim Laden der Daten');
            } finally {
                setLoading(false);
            }
        }

        if (mode === 'YEAR' || (mode === 'CUSTOM' && customStart && customEnd)) {
            loadData();
        }
    }, [selectedTrainee, ausbildungsjahr, mode, customStart, customEnd]);

    // Update summary when gender changes
    useEffect(() => {
        if (!aggregatedData) return;
        const pronoun = gender === 'male' ? 'Herr' : gender === 'female' ? 'Frau' : 'Person';
        setSummary(prev => prev.replace(/^(Herr|Frau|Person)/, pronoun));
    }, [gender, aggregatedData]);


    const handleIssueCertificate = async () => {
        if (!selectedTrainee || !aggregatedData) return;

        setIssuing(true);
        setError(null);

        try {
            // Capture Skill Radar Image
            let radarImageBase64: string | undefined;
            if (radarRef.current) {
                const canvas = await html2canvas(radarRef.current, {
                    backgroundColor: '#ffffff',
                    scale: 2 // Higher resolution
                });
                radarImageBase64 = canvas.toDataURL('image/png');
            }

            const res = await fetch(`/api/trainer/arbeitszeugnis/issue/${selectedTrainee}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ausbildungsjahr,
                    certificateType,
                    gender,
                    radarImage: radarImageBase64,
                    startDate: aggregatedData.periodStart,
                    endDate: aggregatedData.periodEnd
                }),
            });

            if (!res.ok) {
                throw new Error('Failed to issue certificate');
            }

            const data = await res.json();

            // Generate QR Code Image
            let qrImageBase64: string | undefined;
            if (data.certificate.qrVerificationUrl) {
                try {
                    qrImageBase64 = await QRCode.toDataURL(data.certificate.qrVerificationUrl, {
                        errorCorrectionLevel: 'H',
                        margin: 1,
                        width: 200,
                        color: {
                            dark: '#000000',
                            light: '#ffffff',
                        },
                    });
                } catch (e) {
                    console.error('Error generating QR code:', e);
                }
            }

            // Generate PDF Blob
            const pdfBlob = await generateArbeitszeugnisPDF({
                traineeName: aggregatedData.traineeName,
                // traineeBirthDate: '...', // TODO: Add to aggregation API if needed
                startDate: aggregatedData.periodStart,
                endDate: aggregatedData.periodEnd,
                izhkProfile: 'Fachinformatiker für Anwendungsentwicklung',
                companyName: 'WAMOCON GmbH',
                components: aggregatedData.components.map(c => ({
                    title: c.componentTitle,
                    grade: c.finalGrade
                })),
                averageGrade: aggregatedData.overallAverage || 0,
                qrCodeUrl: qrImageBase64 || data.certificate.qrVerificationUrl, // Pass the image data URI
                verificationCode: data.certificate.qrVerificationCode,
                issuedAt: new Date(data.certificate.issuedAt),
                signerName: profile?.full_name || 'Ausbilder',
                gender: gender,
                summary: summary,
                radarImage: radarImageBase64
            });

            // Trigger Download
            const url = window.URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Arbeitszeugnis_${aggregatedData.traineeName}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            alert(`Zeugnis erfolgreich erstellt und heruntergeladen!`);

        } catch (err) {
            console.error(err);
            setError('Fehler beim Ausstellen des Zeugnisses');
        } finally {
            setIssuing(false);
        }
    };

    const getGradeColor = (grade: number | null) => {
        if (grade === null) return 'text-muted-foreground';
        if (grade <= 1.5) return 'text-emerald-600';
        if (grade <= 2.5) return 'text-green-600';
        if (grade <= 3.5) return 'text-yellow-600';
        if (grade <= 4.5) return 'text-orange-600';
        return 'text-red-600';
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20">
                        <Award className="h-6 w-6 text-amber-600" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold">Azubi Arbeitszeugnis</h2>
                        <p className="text-sm text-muted-foreground">
                            Automatische Zeugniserstellung basierend auf Tätigkeitsnachweisen
                        </p>
                    </div>
                </div>
            </div>

            {/* Selection Controls */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                    <label className="block text-sm font-medium mb-2">Auszubildende/r</label>
                    <select
                        value={selectedTrainee}
                        onChange={(e) => setSelectedTrainee(e.target.value)}
                        className="w-full px-4 py-2.5 rounded-xl bg-background border border-border"
                    >
                        <option value="">Bitte wählen...</option>
                        {trainees.map((trainee) => (
                            <option key={trainee.id} value={trainee.id}>
                                {trainee.fullName}
                            </option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-medium mb-2">Zeitraum</label>
                    <div className="flex bg-muted p-1 rounded-xl mb-3">
                        <button
                            onClick={() => setMode('YEAR')}
                            className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition ${mode === 'YEAR' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            Ausbildungsjahr
                        </button>
                        <button
                            onClick={() => setMode('CUSTOM')}
                            className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition ${mode === 'CUSTOM' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            Benutzerdefiniert
                        </button>
                    </div>

                    {mode === 'YEAR' ? (
                        <select
                            value={ausbildungsjahr}
                            onChange={(e) => setAusbildungsjahr(parseInt(e.target.value))}
                            className="w-full px-4 py-2.5 rounded-xl bg-background border border-border"
                        >
                            <option value={1}>1. Ausbildungsjahr</option>
                            <option value={2}>2. Ausbildungsjahr</option>
                            <option value={3}>3. Ausbildungsjahr</option>
                        </select>
                    ) : (
                        <div className="flex gap-2">
                            <input
                                type="date"
                                value={customStart}
                                onChange={(e) => setCustomStart(e.target.value)}
                                className="w-1/2 px-3 py-2.5 rounded-xl bg-background border border-border text-sm"
                            />
                            <input
                                type="date"
                                value={customEnd}
                                onChange={(e) => setCustomEnd(e.target.value)}
                                className="w-1/2 px-3 py-2.5 rounded-xl bg-background border border-border text-sm"
                            />
                        </div>
                    )}
                </div>

                <div>
                    <label className="block text-sm font-medium mb-2">Zeugnistyp</label>
                    <select
                        value={certificateType}
                        onChange={(e) => setCertificateType(e.target.value as 'INTERIM' | 'FINAL')}
                        className="w-full px-4 py-2.5 rounded-xl bg-background border border-border"
                    >
                        <option value="INTERIM">Zwischenzeugnis</option>
                        <option value="FINAL">Ausbildungszeugnis</option>
                    </select>
                </div>
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
                <>
                    {/* Overview Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="p-4 rounded-xl bg-card border border-border">
                            <div className="flex items-center gap-3 mb-2">
                                <User className="h-5 w-5 text-accent" />
                                <span className="text-sm font-medium">Auszubildende/r</span>
                            </div>
                            <p className="text-lg font-bold">{aggregatedData.traineeName}</p>
                        </div>

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
                        <div ref={radarRef} className="p-6 rounded-2xl bg-card border border-border">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                                <TrendingUp className="h-5 w-5 text-accent" />
                                Skill-Radar (Kompetenzprofil)
                            </h3>
                            <SkillRadarChart data={radarData.radarData} size={400} />
                        </div>
                    )}

                    {/* Components Detail */}
                    <div className="p-6 rounded-2xl bg-card border border-border">
                        <h3 className="text-lg font-bold mb-4">Bewertung nach IHK-Komponenten</h3>
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

                    {/* Evidence Generator (V2 Feature) */}
                    <div className="p-6 rounded-2xl bg-card border border-border">
                        <EvidenceSection
                            traineeId={selectedTrainee}
                            query={evidenceQuery}
                            onCopy={(text) => setSummary(prev => prev + '\n' + text)}
                        />
                    </div>

                    {/* Summary Editor (V2 Feature) */}
                    <div className="p-6 rounded-2xl bg-card border border-border">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <FileText className="h-5 w-5 text-accent" />
                            Abschließende Worte
                        </h3>
                        <p className="text-sm text-muted-foreground mb-3">
                            Dieser Text erscheint am Ende des Zeugnisses. Sie können ihn frei bearbeiten oder unsere Vorlage verwenden.
                        </p>
                        <textarea
                            value={summary}
                            onChange={(e) => setSummary(e.target.value)}
                            className="w-full min-h-[120px] p-4 rounded-xl bg-background border border-border focus:ring-2 focus:ring-accent focus:border-accent transition-all resize-y font-serif text-lg leading-relaxed"
                            placeholder="Hier Zeugnistext eingeben..."
                        />
                    </div>

                    {/* Gender Selection + Issue Button */}
                    <div className="p-6 rounded-2xl bg-card border border-border">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <FileText className="h-5 w-5 text-accent" />
                            Zeugnis ausstellen
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium mb-2">Anrede/Pronomen</label>
                                <div className="flex gap-2">
                                    {(['male', 'female', 'neutral'] as const).map((g) => (
                                        <button
                                            key={g}
                                            onClick={() => setGender(g)}
                                            className={`flex-1 px-4 py-2 rounded-xl font-medium transition ${gender === g
                                                ? 'bg-accent text-accent-foreground'
                                                : 'bg-muted border border-border hover:bg-muted/80'
                                                }`}
                                        >
                                            {g === 'male' ? 'Herr' : g === 'female' ? 'Frau' : 'Neutral'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-end">
                                <button
                                    onClick={handleIssueCertificate}
                                    disabled={issuing || !aggregatedData.overallAverage}
                                    className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold shadow-lg hover:shadow-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {issuing ? (
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                    ) : (
                                        <>
                                            <QrCode className="h-5 w-5" />
                                            Zeugnis mit QR-Code ausstellen
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        <p className="text-xs text-muted-foreground mt-4">
                            Das Zeugnis wird mit einem einzigartigen QR-Code versehen, der die Echtheit verifiziert.
                            Gemäß §126a BGB i.V.m. eIDAS ist das digitale Zeugnis rechtsverbindlich.
                        </p>
                    </div>
                </>
            )}
        </div>
    );
}
