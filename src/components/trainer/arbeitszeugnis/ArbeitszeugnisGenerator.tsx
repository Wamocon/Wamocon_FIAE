'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import toast from 'react-hot-toast';
import {
    FileText,
    Award,
    User,
    Calendar,
    TrendingUp,
    CheckCircle2,
    AlertCircle,
    Loader2,
    QrCode,
    Sparkles,
    ChevronRight,
    ArrowLeft,
    FileCheck,
    Clock,
    Star,
    Users,
    GraduationCap
} from 'lucide-react';
import QRCode from 'qrcode';
import { generateArbeitszeugnisPDF } from '@/lib/arbeitszeugnis/pdfGenerator';
import { SkillRadarChart, renderRadarChartForPDF } from './SkillRadarChart';
import { EvidenceSection } from './EvidenceSection';

interface Trainee {
    id: string;
    full_name: string;
    fullName?: string;
    firstName?: string;
    lastName?: string;
    email: string;
    avatar_url?: string;
    progress?: number;
    isActive?: boolean;
    approvedReports?: number;
    pendingReports?: number;
    totalHours?: number;
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

interface SoftSkillCriterion {
    code: string;
    name: string;
    competencyArea: string;
    kLevel: string | null;
    averageGrade: number | null;
    ratingCount: number;
}

interface SoftSkillsData {
    averages: {
        fachkompetenz: number | null;
        methodenkompetenz: number | null;
        sozialkompetenz: number | null;
        personalkompetenz: number | null;
    };
    overallAverage: number | null;
    criteria: SoftSkillCriterion[];
    totalRatings: number;
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
    softSkills?: SoftSkillsData;
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

type Step = 'select-trainee' | 'configure' | 'review';

export function ArbeitszeugnisGenerator() {
    const { profile } = useAuth();
    const { t } = useLanguage();

    // Step management
    const [step, setStep] = useState<Step>('select-trainee');

    const [trainees, setTrainees] = useState<Trainee[]>([]);
    const [traineesLoading, setTraineesLoading] = useState(true);
    const [selectedTrainee, setSelectedTrainee] = useState<string>('');
    const [selectedTraineeData, setSelectedTraineeData] = useState<Trainee | null>(null);
    const [ausbildungsjahr, setAusbildungsjahr] = useState<number>(1);
    const [loading, setLoading] = useState(false);
    const [aggregatedData, setAggregatedData] = useState<AggregatedData | null>(null);
    const [radarData, setRadarData] = useState<SkillRadarData | null>(null);
    const [issuing, setIssuing] = useState(false);
    const [gender, setGender] = useState<'male' | 'female' | 'neutral'>('neutral');
    const [certificateType, setCertificateType] = useState<'INTERIM' | 'FINAL'>('INTERIM');
    const [error, setError] = useState<string | null>(null);
    const [summary, setSummary] = useState('');
    const [existingCertificate, setExistingCertificate] = useState<{
        id: string;
        qrVerificationUrl: string | null;
        qrVerificationCode: string | null;
    } | null>(null);
    const [certificateQrImage, setCertificateQrImage] = useState<string | null>(null);

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

    // Load trainees with activity report stats (single API call)
    useEffect(() => {
        async function loadTrainees() {
            setTraineesLoading(true);
            try {
                // Use batch endpoint to get trainees WITH stats in one call
                const res = await fetch(`/api/trainer/trainees/with-stats?trainerProfileId=${profile?.id}`);
                if (res.ok) {
                    const data = await res.json();
                    setTrainees(data.trainees || []);
                }
            } catch (err) {
                console.error('Error loading trainees:', err);
            } finally {
                setTraineesLoading(false);
            }
        }
        if (profile?.id) {
            loadTrainees();
        }
    }, [profile?.id]);

    // Load aggregated data when trainee/year changes
    useEffect(() => {
        if (!selectedTrainee || step !== 'review') {
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

                    const name = aggData.traineeName || selectedTraineeData?.full_name || 'Person';
                    setSummary(`Person ${name} hat die ihm übertragenen Aufgaben stets zu unserer vollen Zufriedenheit erledigt. Wir danken für die angenehme Zusammenarbeit und wünschen für die berufliche und private Zukunft alles Gute.`);
                } else {
                    setError(t('arbeitszeugnis.noData'));
                }

                if (radarRes.ok) {
                    const radarResult = await radarRes.json();
                    setRadarData(radarResult);
                }

                // Fetch existing certificates for this trainee/period
                try {
                    const certRes = await fetch(`/api/trainer/arbeitszeugnis/certificates/${selectedTrainee}?ausbildungsjahr=${ausbildungsjahr}`);
                    if (certRes.ok) {
                        const certData = await certRes.json();
                        if (certData.latestCertificate) {
                            setExistingCertificate(certData.latestCertificate);
                            // Generate QR code image if URL exists
                            if (certData.latestCertificate.qrVerificationUrl) {
                                const qrImg = await QRCode.toDataURL(certData.latestCertificate.qrVerificationUrl, {
                                    errorCorrectionLevel: 'H',
                                    margin: 1,
                                    width: 200,
                                    color: { dark: '#000000', light: '#ffffff' },
                                });
                                setCertificateQrImage(qrImg);
                            }
                        } else {
                            setExistingCertificate(null);
                            setCertificateQrImage(null);
                        }
                    }
                } catch (e) {
                    console.error('Error fetching existing certificates:', e);
                }
            } catch (err) {
                setError(t('arbeitszeugnis.loadError'));
            } finally {
                setLoading(false);
            }
        }

        loadData();
    }, [selectedTrainee, ausbildungsjahr, mode, customStart, customEnd, step, selectedTraineeData?.full_name]);

    // Update summary when gender changes
    useEffect(() => {
        if (!aggregatedData) return;
        const pronoun = gender === 'male' ? 'Herr' : gender === 'female' ? 'Frau' : 'Person';
        setSummary(prev => prev.replace(/^(Herr|Frau|Person)/, pronoun));
    }, [gender, aggregatedData]);

    const handleSelectTrainee = (trainee: Trainee) => {
        setSelectedTrainee(trainee.id);
        setSelectedTraineeData(trainee);
        setStep('configure');
    };

    const handleContinueToReview = () => {
        if (mode === 'CUSTOM' && (!customStart || !customEnd)) {
            setError(t('arbeitszeugnis.invalidPeriod'));
            return;
        }
        setStep('review');
    };

    const handleIssueCertificate = async () => {
        if (!selectedTrainee || !aggregatedData) return;

        setIssuing(true);
        setError(null);

        try {
            let radarImageBase64: string | undefined;
            if (radarData && radarData.radarData && radarData.radarData.length >= 1) {
                // Render chart with white background specifically for PDF
                radarImageBase64 = await renderRadarChartForPDF(radarData.radarData, 500);
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
                    endDate: aggregatedData.periodEnd,
                    trainerId: profile?.id
                }),
            });

            if (!res.ok) {
                throw new Error('Failed to issue certificate');
            }

            const data = await res.json();

            let qrImageBase64: string | undefined;
            if (data.certificate.qrVerificationUrl) {
                try {
                    qrImageBase64 = await QRCode.toDataURL(data.certificate.qrVerificationUrl, {
                        errorCorrectionLevel: 'H',
                        margin: 1,
                        width: 200,
                        color: { dark: '#000000', light: '#ffffff' },
                    });
                } catch (e) {
                    console.error('Error generating QR code:', e);
                }
            }

            // Load company logo
            let logoImageBase64: string | undefined;
            try {
                const logoResponse = await fetch('/WMC_Logo.png');
                const logoBlob = await logoResponse.blob();
                logoImageBase64 = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.readAsDataURL(logoBlob);
                });
            } catch (e) {
                console.error('Error loading logo:', e);
            }

            const pdfBlob = await generateArbeitszeugnisPDF({
                traineeName: aggregatedData.traineeName,
                startDate: aggregatedData.periodStart,
                endDate: aggregatedData.periodEnd,
                izhkProfile: 'Fachinformatiker für Anwendungsentwicklung',
                companyName: 'WAMOCON GmbH',
                components: aggregatedData.components.map(c => ({
                    title: c.componentTitle,
                    grade: c.finalGrade
                })),
                averageGrade: aggregatedData.overallAverage || 0,
                qrCodeUrl: qrImageBase64 || data.certificate.qrVerificationUrl,
                verificationCode: data.certificate.qrVerificationCode,
                issuedAt: new Date(data.certificate.issueDate),
                signerName: profile?.full_name || 'Ausbilder',
                gender: gender,
                summary: summary,
                radarImage: radarImageBase64,
                logoImage: logoImageBase64,
                softSkills: aggregatedData.softSkills ? {
                    averages: aggregatedData.softSkills.averages,
                    overallAverage: aggregatedData.softSkills.overallAverage
                } : undefined
            });

            const url = window.URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Arbeitszeugnis_${aggregatedData.traineeName}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            toast.success(t('arbeitszeugnis.issueSuccess'));

        } catch (err) {
            console.error(err);
            setError(t('arbeitszeugnis.issueError'));
        } finally {
            setIssuing(false);
        }
    };

    const getGradeColor = (grade: number | null) => {
        if (grade === null) return 'text-muted-foreground';
        if (grade <= 1.5) return 'text-emerald-500';
        if (grade <= 2.5) return 'text-green-500';
        if (grade <= 3.5) return 'text-yellow-500';
        if (grade <= 4.5) return 'text-orange-500';
        return 'text-red-500';
    };

    const getTraineeName = (trainee: Trainee) => {
        return trainee.full_name || trainee.fullName || `${trainee.firstName || ''} ${trainee.lastName || ''}`.trim() || trainee.email;
    };

    const getInitials = (trainee: Trainee) => {
        const name = getTraineeName(trainee);
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    };

    // Sort trainees by approved reports (suggestions first)
    const sortedTrainees = useMemo(() => {
        return [...trainees].sort((a, b) => (b.approvedReports || 0) - (a.approvedReports || 0));
    }, [trainees]);

    const suggestedTrainees = sortedTrainees.filter(t => (t.approvedReports || 0) >= 3);
    const otherTrainees = sortedTrainees.filter(t => (t.approvedReports || 0) < 3);

    // ==================== RENDER ====================

    // Step 1: Select Trainee
    if (step === 'select-trainee') {
        return (
            <div className="space-y-6 max-w-5xl mx-auto">
                {/* Header */}
                <div className="text-center py-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 mb-4 shadow-lg shadow-amber-500/25">
                        <Award className="h-8 w-8 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-amber-500 to-orange-600 bg-clip-text text-transparent">
                        {t('arbeitszeugnis.title')}
                    </h1>
                    <p className="text-muted-foreground mt-2 max-w-md mx-auto">
                        {t('arbeitszeugnis.subtitle')}
                    </p>
                </div>

                {traineesLoading ? (
                    <div className="flex flex-col items-center justify-center py-16">
                        <Loader2 className="h-10 w-10 animate-spin text-amber-500 mb-4" />
                        <p className="text-muted-foreground">{t('arbeitszeugnis.loadingTrainees')}</p>
                    </div>
                ) : trainees.length === 0 ? (
                    <div className="text-center py-16">
                        <Users className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-medium">{t('arbeitszeugnis.noTrainees')}</h3>
                        <p className="text-muted-foreground mt-1">{t('arbeitszeugnis.noTraineesDesc')}</p>
                    </div>
                ) : (
                    <>
                        {/* Suggestions Section */}
                        {suggestedTrainees.length > 0 && (
                            <div className="space-y-4">
                                <div className="flex items-center gap-2">
                                    <Sparkles className="h-5 w-5 text-amber-500" />
                                    <h2 className="text-lg font-semibold">{t('arbeitszeugnis.recommended')}</h2>
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-600">
                                        {t('arbeitszeugnis.enoughData')}
                                    </span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {suggestedTrainees.map((trainee) => (
                                        <button
                                            key={trainee.id}
                                            onClick={() => handleSelectTrainee(trainee)}
                                            className="group relative p-5 rounded-2xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-2 border-amber-500/30 hover:border-amber-500 hover:shadow-lg hover:shadow-amber-500/10 transition-all text-left"
                                        >
                                            <div className="absolute top-3 right-3">
                                                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-amber-500/20 text-amber-600">
                                                    <Star className="h-3 w-3" />
                                                    {t('arbeitszeugnis.recommended')}
                                                </span>
                                            </div>
                                            <div className="flex items-start gap-4">
                                                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-lg shadow-md">
                                                    {getInitials(trainee)}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h3 className="font-semibold text-foreground truncate">
                                                        {getTraineeName(trainee)}
                                                    </h3>
                                                    <p className="text-sm text-muted-foreground truncate">{trainee.email}</p>
                                                    <div className="flex items-center gap-4 mt-3">
                                                        <div className="flex items-center gap-1.5">
                                                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                                                            <span className="text-sm font-medium text-green-600">{trainee.approvedReports || 0}</span>
                                                            <span className="text-xs text-muted-foreground">{t('arbeitszeugnis.approved')}</span>
                                                        </div>
                                                        {(trainee.pendingReports || 0) > 0 && (
                                                            <div className="flex items-center gap-1.5">
                                                                <Clock className="h-4 w-4 text-amber-500" />
                                                                <span className="text-sm font-medium text-amber-600">{trainee.pendingReports}</span>
                                                                <span className="text-xs text-muted-foreground">{t('arbeitszeugnis.pending')}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <ChevronRight className="h-5 w-5 text-amber-500" />
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* All Other Trainees */}
                        {otherTrainees.length > 0 && (
                            <div className="space-y-4">
                                <div className="flex items-center gap-2">
                                    <Users className="h-5 w-5 text-muted-foreground" />
                                    <h2 className="text-lg font-semibold">{t('arbeitszeugnis.allTrainees')}</h2>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {otherTrainees.map((trainee) => (
                                        <button
                                            key={trainee.id}
                                            onClick={() => handleSelectTrainee(trainee)}
                                            className="group relative p-5 rounded-2xl bg-card border border-border hover:border-accent hover:shadow-lg transition-all text-left"
                                        >
                                            <div className="flex items-start gap-4">
                                                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center text-white font-bold text-lg">
                                                    {getInitials(trainee)}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h3 className="font-semibold text-foreground truncate">
                                                        {getTraineeName(trainee)}
                                                    </h3>
                                                    <p className="text-sm text-muted-foreground truncate">{trainee.email}</p>
                                                    <div className="flex items-center gap-4 mt-3">
                                                        <div className="flex items-center gap-1.5">
                                                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                                                            <span className="text-sm font-medium">{trainee.approvedReports || 0}</span>
                                                            <span className="text-xs text-muted-foreground">{t('arbeitszeugnis.approved')}</span>
                                                        </div>
                                                        {(trainee.pendingReports || 0) > 0 && (
                                                            <div className="flex items-center gap-1.5">
                                                                <Clock className="h-4 w-4 text-amber-500" />
                                                                <span className="text-sm font-medium">{trainee.pendingReports}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            {(trainee.approvedReports || 0) < 1 && (
                                                <div className="mt-3 p-2 rounded-lg bg-amber-500/10 text-amber-600 text-xs">
                                                    {t('arbeitszeugnis.noApprovedReports')}
                                                </div>
                                            )}
                                            <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <ChevronRight className="h-5 w-5 text-accent" />
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        );
    }

    // Step 2: Configure Period
    if (step === 'configure') {
        return (
            <div className="space-y-6 max-w-2xl mx-auto">
                {/* Back Button */}
                <button
                    onClick={() => setStep('select-trainee')}
                    className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition"
                >
                    <ArrowLeft className="h-4 w-4" />
                    {t('arbeitszeugnis.backToSelection')}
                </button>

                {/* Selected Trainee Card */}
                <div className="p-6 rounded-2xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/30">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-xl shadow-lg">
                            {selectedTraineeData && getInitials(selectedTraineeData)}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold">{selectedTraineeData && getTraineeName(selectedTraineeData)}</h2>
                            <p className="text-muted-foreground">{selectedTraineeData?.email}</p>
                            <div className="flex items-center gap-2 mt-2">
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                                <span className="text-sm text-green-600 font-medium">
                                    {selectedTraineeData?.approvedReports || 0} {t('arbeitszeugnis.approvedReports')}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Configuration Card */}
                <div className="p-6 rounded-2xl bg-card border border-border space-y-6">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-accent/20">
                            <Calendar className="h-5 w-5 text-accent" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold">{t('arbeitszeugnis.selectPeriod')}</h3>
                            <p className="text-sm text-muted-foreground">{t('arbeitszeugnis.selectPeriodDesc')}</p>
                        </div>
                    </div>

                    {/* Mode Toggle */}
                    <div className="flex p-1 bg-muted rounded-xl">
                        <button
                            onClick={() => setMode('YEAR')}
                            className={`flex-1 py-3 px-4 text-sm font-medium rounded-lg transition-all ${
                                mode === 'YEAR' 
                                    ? 'bg-background shadow-md text-foreground' 
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            <GraduationCap className="h-4 w-4 inline mr-2" />
                            {t('arbeitszeugnis.byYear')}
                        </button>
                        <button
                            onClick={() => setMode('CUSTOM')}
                            className={`flex-1 py-3 px-4 text-sm font-medium rounded-lg transition-all ${
                                mode === 'CUSTOM' 
                                    ? 'bg-background shadow-md text-foreground' 
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            <Calendar className="h-4 w-4 inline mr-2" />
                            {t('arbeitszeugnis.custom')}
                        </button>
                    </div>

                    {mode === 'YEAR' ? (
                        <div className="grid grid-cols-3 gap-3">
                            {[1, 2, 3].map((year) => (
                                <button
                                    key={year}
                                    onClick={() => setAusbildungsjahr(year)}
                                    className={`p-4 rounded-xl border-2 transition-all ${
                                        ausbildungsjahr === year
                                            ? 'border-amber-500 bg-amber-500/10 text-amber-600'
                                            : 'border-border hover:border-accent bg-background'
                                    }`}
                                >
                                    <p className="text-2xl font-bold">{year}.</p>
                                    <p className="text-sm">{t('arbeitszeugnis.trainingYear')}</p>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">{t('arbeitszeugnis.from')}</label>
                                <input
                                    type="date"
                                    value={customStart}
                                    onChange={(e) => setCustomStart(e.target.value)}
                                    className="w-full px-4 py-3 rounded-xl bg-background border border-border focus:ring-2 focus:ring-amber-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-2">{t('arbeitszeugnis.to')}</label>
                                <input
                                    type="date"
                                    value={customEnd}
                                    onChange={(e) => setCustomEnd(e.target.value)}
                                    className="w-full px-4 py-3 rounded-xl bg-background border border-border focus:ring-2 focus:ring-amber-500"
                                />
                            </div>
                        </div>
                    )}

                    {/* Certificate Type */}
                    <div>
                        <label className="block text-sm font-medium mb-3">{t('arbeitszeugnis.certificateType')}</label>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => setCertificateType('INTERIM')}
                                className={`p-4 rounded-xl border-2 transition-all text-left ${
                                    certificateType === 'INTERIM'
                                        ? 'border-amber-500 bg-amber-500/10'
                                        : 'border-border hover:border-accent'
                                }`}
                            >
                                <FileCheck className="h-5 w-5 text-amber-500 mb-2" />
                                <p className="font-semibold">{t('arbeitszeugnis.interim')}</p>
                                <p className="text-xs text-muted-foreground">{t('arbeitszeugnis.interimDesc')}</p>
                            </button>
                            <button
                                onClick={() => setCertificateType('FINAL')}
                                className={`p-4 rounded-xl border-2 transition-all text-left ${
                                    certificateType === 'FINAL'
                                        ? 'border-amber-500 bg-amber-500/10'
                                        : 'border-border hover:border-accent'
                                }`}
                            >
                                <Award className="h-5 w-5 text-amber-500 mb-2" />
                                <p className="font-semibold">{t('arbeitszeugnis.final')}</p>
                                <p className="text-xs text-muted-foreground">{t('arbeitszeugnis.finalDesc')}</p>
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-center gap-2">
                            <AlertCircle className="h-4 w-4" />
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleContinueToReview}
                        className="w-full py-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-semibold shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
                    >
                        {t('arbeitszeugnis.continueToPreview')}
                        <ChevronRight className="h-5 w-5" />
                    </button>
                </div>
            </div>
        );
    }

    // Step 3: Review & Generate
    return (
        <div className="space-y-6">
            {/* Back Button */}
            <button
                onClick={() => setStep('configure')}
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition"
            >
                <ArrowLeft className="h-4 w-4" />
                {t('arbeitszeugnis.backToConfig')}
            </button>

            {/* Header with Trainee Info */}
            <div className="flex items-center justify-between p-6 rounded-2xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/30">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-lg shadow-lg">
                        {selectedTraineeData && getInitials(selectedTraineeData)}
                    </div>
                    <div>
                        <h2 className="text-xl font-bold">{aggregatedData?.traineeName || (selectedTraineeData && getTraineeName(selectedTraineeData))}</h2>
                        <p className="text-sm text-muted-foreground">
                            {mode === 'YEAR' ? `${ausbildungsjahr}. ${t('arbeitszeugnis.trainingYear')}` : `${customStart} - ${customEnd}`}
                            {' • '}{certificateType === 'INTERIM' ? t('arbeitszeugnis.interim') : t('arbeitszeugnis.final')}
                        </p>
                    </div>
                </div>
            </div>

            {loading && (
                <div className="flex flex-col items-center justify-center py-16">
                    <Loader2 className="h-10 w-10 animate-spin text-amber-500 mb-4" />
                    <p className="text-muted-foreground">{t('arbeitszeugnis.analyzing')}</p>
                </div>
            )}

            {error && !loading && (
                <div className="p-6 rounded-2xl bg-destructive/10 border border-destructive/30 text-center">
                    <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-3" />
                    <h3 className="text-lg font-semibold text-destructive">{error}</h3>
                    <p className="text-sm text-destructive/80 mt-1">{t('arbeitszeugnis.noDataDesc')}</p>
                </div>
            )}

            {aggregatedData && !loading && (
                <>
                    {/* Overview Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-4 rounded-xl bg-card border border-border">
                            <TrendingUp className="h-5 w-5 text-accent mb-2" />
                            <p className="text-xs text-muted-foreground">{t('arbeitszeugnis.overallAverage')}</p>
                            <p className={`text-2xl font-bold ${getGradeColor(aggregatedData.overallAverage)}`}>
                                {aggregatedData.overallAverage?.toFixed(2) || '–'}
                            </p>
                        </div>
                        <div className="p-4 rounded-xl bg-card border border-border">
                            <CheckCircle2 className="h-5 w-5 text-green-500 mb-2" />
                            <p className="text-xs text-muted-foreground">{t('arbeitszeugnis.gradedComponents')}</p>
                            <p className="text-2xl font-bold">
                                {aggregatedData.components.filter(c => c.finalGrade !== null).length}/{aggregatedData.components.length}
                            </p>
                        </div>
                        <div className="p-4 rounded-xl bg-card border border-border">
                            <Clock className="h-5 w-5 text-blue-500 mb-2" />
                            <p className="text-xs text-muted-foreground">{t('arbeitszeugnis.totalHours')}</p>
                            <p className="text-2xl font-bold">
                                {aggregatedData.components.reduce((sum, c) => sum + c.totalHours, 0)}h
                            </p>
                        </div>
                        {aggregatedData.shorteningEligible && (
                            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                                <Sparkles className="h-5 w-5 text-emerald-600 mb-2" />
                                <p className="text-xs text-emerald-600">{t('arbeitszeugnis.shorteningPossible')}</p>
                                <p className="text-lg font-bold text-emerald-600">{'< 2,45'}</p>
                            </div>
                        )}
                    </div>

                    {/* Skill Radar */}
                    {radarData && radarData.radarData.length >= 1 && (
                        <div ref={radarRef} className="p-6 rounded-2xl bg-card border border-border">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-bold flex items-center gap-2">
                                    <TrendingUp className="h-5 w-5 text-accent" />
                                    {t('arbeitszeugnis.competencyProfile')}
                                </h3>
                                {certificateQrImage ? (
                                    <div className="flex items-center gap-3">
                                        <div className="text-right">
                                            <p className="text-xs text-muted-foreground">{t('arbeitszeugnis.verificationQR')}</p>
                                            <p className="text-xs text-green-600 font-medium">{t('arbeitszeugnis.certificateIssued')}</p>
                                        </div>
                                        <img 
                                            src={certificateQrImage} 
                                            alt="QR Code" 
                                            className="w-16 h-16 rounded border border-border"
                                            title={existingCertificate?.qrVerificationUrl || ''}
                                        />
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <QrCode className="h-4 w-4" />
                                        <span>{t('arbeitszeugnis.qrInPDF')}</span>
                                    </div>
                                )}
                            </div>
                            <SkillRadarChart data={radarData.radarData} size={400} />
                        </div>
                    )}

                    {/* Components */}
                    <div className="p-6 rounded-2xl bg-card border border-border">
                        <h3 className="text-lg font-bold mb-4">{t('arbeitszeugnis.componentGrades')}</h3>
                        <div className="space-y-2">
                            {aggregatedData.components.map((comp) => (
                                <div key={comp.componentId} className="flex items-center justify-between p-3 rounded-xl bg-muted/50 hover:bg-muted transition">
                                    <div className="flex-1">
                                        <p className="font-medium">{comp.componentTitle}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {comp.componentCode} • {comp.totalHours} {t('arbeitszeugnis.hours')} • {comp.gradedCount}/{comp.totalUseCases} {t('arbeitszeugnis.graded')}
                                        </p>
                                    </div>
                                    <span className={`text-2xl font-bold ${getGradeColor(comp.averageGrade)}`}>
                                        {comp.finalGrade || '–'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Soft Skills */}
                    {aggregatedData.softSkills && aggregatedData.softSkills.totalRatings > 0 && (
                        <div className="p-6 rounded-2xl bg-card border border-border">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                                <Award className="h-5 w-5 text-accent" />
                                {t('arbeitszeugnis.softSkills')}
                                <span className="text-xs font-normal text-muted-foreground ml-2">
                                    ({aggregatedData.softSkills.totalRatings} {t('arbeitszeugnis.ratings')})
                                </span>
                            </h3>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                {[
                                    { key: 'fachkompetenz', label: t('arbeitszeugnis.fach') },
                                    { key: 'methodenkompetenz', label: t('arbeitszeugnis.methodic') },
                                    { key: 'sozialkompetenz', label: t('arbeitszeugnis.social') },
                                    { key: 'personalkompetenz', label: t('arbeitszeugnis.personal') },
                                ].map(({ key, label }) => {
                                    const avg = aggregatedData.softSkills?.averages[key as keyof typeof aggregatedData.softSkills.averages];
                                    return (
                                        <div key={key} className="p-3 rounded-xl bg-muted/50 text-center">
                                            <p className="text-xs text-muted-foreground mb-1">{label}</p>
                                            <p className={`text-xl font-bold ${getGradeColor(avg ?? null)}`}>
                                                {avg?.toFixed(1) || '–'}
                                            </p>
                                        </div>
                                    );
                                })}
                                <div className="p-3 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30 text-center">
                                    <p className="text-xs text-amber-600 mb-1">{t('arbeitszeugnis.total')}</p>
                                    <p className={`text-xl font-bold ${getGradeColor(aggregatedData.softSkills.overallAverage)}`}>
                                        {aggregatedData.softSkills.overallAverage?.toFixed(1) || '–'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Soft Skills - Show message when no ratings */}
                    {aggregatedData.softSkills && aggregatedData.softSkills.totalRatings === 0 && (
                        <div className="p-6 rounded-2xl bg-card border border-border border-dashed">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                                <Award className="h-5 w-5 text-muted-foreground" />
                                {t('arbeitszeugnis.softSkills')}
                            </h3>
                            <div className="text-center py-4 text-muted-foreground">
                                <Award className="h-12 w-12 mx-auto mb-3 opacity-30" />
                                <p>{t('arbeitszeugnis.noSoftSkillRatings')}</p>
                                <p className="text-sm mt-2">{t('arbeitszeugnis.softSkillHint')}</p>
                            </div>
                        </div>
                    )}

                    {/* Evidence */}
                    <div className="p-6 rounded-2xl bg-card border border-border">
                        <EvidenceSection
                            traineeId={selectedTrainee}
                            query={evidenceQuery}
                            onCopy={(text) => setSummary(prev => prev + '\n' + text)}
                        />
                    </div>

                    {/* Summary Text */}
                    <div className="p-6 rounded-2xl bg-card border border-border">
                        <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
                            <FileText className="h-5 w-5 text-accent" />
                            {t('arbeitszeugnis.closingWords')}
                        </h3>
                        <textarea
                            value={summary}
                            onChange={(e) => setSummary(e.target.value)}
                            className="w-full min-h-[120px] p-4 rounded-xl bg-background border border-border focus:ring-2 focus:ring-amber-500 resize-y"
                            placeholder={t('arbeitszeugnis.textPlaceholder')}
                        />
                    </div>

                    {/* Gender & Issue */}
                    <div className="p-6 rounded-2xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/30">
                        <div className="flex flex-col md:flex-row gap-6">
                            <div className="flex-1">
                                <label className="block text-sm font-medium mb-3">{t('arbeitszeugnis.salutation')}</label>
                                <div className="flex gap-2">
                                    {(['male', 'female', 'neutral'] as const).map((g) => (
                                        <button
                                            key={g}
                                            onClick={() => setGender(g)}
                                            className={`flex-1 py-3 rounded-xl font-medium transition-all ${
                                                gender === g
                                                    ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg'
                                                    : 'bg-background border border-border hover:border-amber-500'
                                            }`}
                                        >
                                            {g === 'male' ? t('arbeitszeugnis.male') : g === 'female' ? t('arbeitszeugnis.female') : t('arbeitszeugnis.neutral')}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex-1 flex items-end">
                                <button
                                    onClick={handleIssueCertificate}
                                    disabled={issuing || !aggregatedData.overallAverage}
                                    className="w-full py-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2"
                                >
                                    {issuing ? (
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                    ) : (
                                        <>
                                            <QrCode className="h-5 w-5" />
                                            {t('arbeitszeugnis.issueAndDownload')}
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-4 text-center">
                            {t('arbeitszeugnis.qrNote')}
                        </p>
                    </div>
                </>
            )}
        </div>
    );
}
