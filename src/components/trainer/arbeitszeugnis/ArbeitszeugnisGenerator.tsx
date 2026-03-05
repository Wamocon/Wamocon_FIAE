'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import toast from 'react-hot-toast';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
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
  GraduationCap,
  Download,
} from 'lucide-react';
import QRCode from 'qrcode';

import { SkillRadarChart, renderRadarChartForPDF } from './SkillRadarChart';

interface Trainee {
  id: string;
  full_name: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email: string;
  avatar_url?: string;
  birth_date?: string;
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
  gradeLegend: Record<
    string,
    { label: string; range: string; description: string }
  >;
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
  const [selectedTraineeData, setSelectedTraineeData] =
    useState<Trainee | null>(null);
  const [ausbildungsjahr, setAusbildungsjahr] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [aggregatedData, setAggregatedData] = useState<AggregatedData | null>(
    null
  );
  const [radarData, setRadarData] = useState<SkillRadarData | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [gender, setGender] = useState<'male' | 'female' | 'neutral'>(
    'neutral'
  );
  const [certificateType, setCertificateType] = useState<'INTERIM' | 'FINAL'>(
    'INTERIM'
  );
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [existingCertificate, setExistingCertificate] = useState<{
    id: string;
    qrVerificationUrl: string | null;
    qrVerificationCode: string | null;
  } | null>(null);
  const [certificateQrImage, setCertificateQrImage] = useState<string | null>(
    null
  );

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
        const res = await fetch(
          `/api/trainer/trainees/with-stats?trainerProfileId=${profile?.id}`,
          { cache: 'no-store' }
        );
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
          fetch(
            `/api/trainer/arbeitszeugnis/aggregate/${selectedTrainee}${query}`,
            { cache: 'no-store' }
          ),
          fetch(
            `/api/trainer/arbeitszeugnis/skill-radar/${selectedTrainee}${query}`,
            { cache: 'no-store' }
          ),
        ]);

        if (aggRes.ok) {
          const aggData = await aggRes.json();
          setAggregatedData(aggData);

          const name =
            aggData.traineeName || selectedTraineeData?.full_name || 'Person';
          setSummary(
            `Person ${name} hat die ihm übertragenen Aufgaben stets zu unserer vollen Zufriedenheit erledigt. Wir danken für die angenehme Zusammenarbeit und wünschen für die berufliche und private Zukunft alles Gute.`
          );
        } else {
          setError(t('arbeitszeugnis.noData'));
        }

        if (radarRes.ok) {
          const radarResult = await radarRes.json();
          setRadarData(radarResult);
        }

        // Fetch existing certificates for this trainee/period
        try {
          const certRes = await fetch(
            `/api/trainer/arbeitszeugnis/certificates/${selectedTrainee}?ausbildungsjahr=${ausbildungsjahr}`,
            { cache: 'no-store' }
          );
          if (certRes.ok) {
            const certData = await certRes.json();
            if (certData.latestCertificate) {
              setExistingCertificate(certData.latestCertificate);
              // Generate QR code image if URL exists
              if (certData.latestCertificate.qrVerificationUrl) {
                const qrImg = await QRCode.toDataURL(
                  certData.latestCertificate.qrVerificationUrl,
                  {
                    errorCorrectionLevel: 'H',
                    margin: 1,
                    width: 200,
                    color: { dark: '#000000', light: '#ffffff' },
                  }
                );
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
  }, [
    selectedTrainee,
    ausbildungsjahr,
    mode,
    customStart,
    customEnd,
    step,
    selectedTraineeData?.full_name,
  ]);

  // Update summary when gender changes
  useEffect(() => {
    if (!aggregatedData) return;
    const pronoun =
      gender === 'male' ? 'Herr' : gender === 'female' ? 'Frau' : 'Person';
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
    if (
      mode === 'CUSTOM' &&
      customStart &&
      customEnd &&
      new Date(customStart) >= new Date(customEnd)
    ) {
      setError(t('arbeitszeugnis.startBeforeEnd'));
      return;
    }
    setError(null);
    setStep('review');
  };

  const handleIssueCertificate = async () => {
    if (!selectedTrainee || !aggregatedData) return;

    setIssuing(true);
    setError(null);

    try {
      // Ensure radar data is available — re-fetch if the initial load failed
      let currentRadarData = radarData;
      if (!currentRadarData?.radarData?.length) {
        try {
          let query = `?ausbildungsjahr=${ausbildungsjahr}`;
          if (mode === 'CUSTOM' && customStart && customEnd) {
            query = `?startDate=${customStart}&endDate=${customEnd}`;
          }
          const radarRes = await fetch(
            `/api/trainer/arbeitszeugnis/skill-radar/${selectedTrainee}${query}`,
            { cache: 'no-store' }
          );
          if (radarRes.ok) {
            currentRadarData = await radarRes.json();
            setRadarData(currentRadarData);
          }
        } catch (e) {
          console.warn('Failed to re-fetch radar data:', e);
        }
      }

      let radarImageBase64: string | undefined;
      if (
        currentRadarData?.radarData &&
        currentRadarData.radarData.length >= 1
      ) {
        // Render chart with white background specifically for PDF
        radarImageBase64 = await renderRadarChartForPDF(
          currentRadarData.radarData,
          650
        );
      }

      const res = await fetch(
        `/api/trainer/arbeitszeugnis/issue/${selectedTrainee}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ausbildungsjahr,
            certificateType,
            customSummary: summary,
            gender,
            radarImage: radarImageBase64,
            startDate: aggregatedData.periodStart,
            endDate: aggregatedData.periodEnd,
            trainerId: profile?.id,
            traineeBirthDate: selectedTraineeData?.birth_date || null,
            softSkills: aggregatedData.softSkills
              ? {
                  averages: aggregatedData.softSkills.averages,
                  overallAverage: aggregatedData.softSkills.overallAverage,
                }
              : null,
          }),
        }
      );

      if (!res.ok) {
        throw new Error('Failed to issue certificate');
      }

      const data = await res.json();

      let qrImageBase64: string | undefined;
      if (data.certificate.qrVerificationUrl) {
        try {
          qrImageBase64 = await QRCode.toDataURL(
            data.certificate.qrVerificationUrl,
            {
              errorCorrectionLevel: 'H',
              margin: 1,
              width: 200,
              color: { dark: '#000000', light: '#ffffff' },
            }
          );
        } catch (e) {
          console.error('Error generating QR code:', e);
        }
      }

      // Load company logo
      let logoImageBase64: string | undefined;
      try {
        const logoResponse = await fetch('/WMC_Logo.png');
        const logoBlob = await logoResponse.blob();
        logoImageBase64 = await new Promise<string>(resolve => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(logoBlob);
        });
      } catch (e) {
        console.error('Error loading logo:', e);
      }

      const { generateArbeitszeugnisPDF } =
        await import('@/lib/arbeitszeugnis/pdfGenerator');
      const pdfBlob = await generateArbeitszeugnisPDF({
        traineeName: aggregatedData.traineeName,
        traineeBirthDate: selectedTraineeData?.birth_date,
        startDate: aggregatedData.periodStart,
        endDate: aggregatedData.periodEnd,
        izhkProfile: 'Fachinformatiker für Anwendungsentwicklung',
        companyName: 'WAMOCON GmbH',
        components: aggregatedData.components.map(c => ({
          title: c.componentTitle,
          grade: c.finalGrade,
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
        softSkills: aggregatedData.softSkills
          ? {
              averages: aggregatedData.softSkills.averages,
              overallAverage: aggregatedData.softSkills.overallAverage,
            }
          : undefined,
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

  const [redownloading, setRedownloading] = useState(false);

  const handleRedownloadCertificate = async () => {
    if (!existingCertificate || !selectedTrainee) return;

    setRedownloading(true);
    try {
      // Fetch the certificate with snapshot data
      const certRes = await fetch(
        `/api/trainer/arbeitszeugnis/certificates/${selectedTrainee}?ausbildungsjahr=${ausbildungsjahr}`,
        { cache: 'no-store' }
      );
      if (!certRes.ok) throw new Error('Failed to fetch certificate');
      const certData = await certRes.json();
      const cert = certData.latestCertificate;
      if (!cert?.snapshotData) throw new Error('No snapshot data found');

      const snapshot = cert.snapshotData as Record<string, unknown>;

      // Use birthdate from snapshot, fallback to selectedTraineeData
      const birthDate =
        (snapshot.traineeBirthDate as string) ||
        selectedTraineeData?.birth_date ||
        null;

      let qrImageBase64: string | undefined;
      if (cert.qrVerificationUrl) {
        try {
          qrImageBase64 = await QRCode.toDataURL(cert.qrVerificationUrl, {
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
        logoImageBase64 = await new Promise<string>(resolve => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(logoBlob);
        });
      } catch (e) {
        console.error('Error loading logo:', e);
      }

      const snapshotComponents =
        (snapshot.components as Array<{
          title: string;
          finalGrade: number | null;
        }>) || [];
      const snapshotSoftSkills = snapshot.softSkills as
        | {
            averages: {
              fachkompetenz: number | null;
              methodenkompetenz: number | null;
              personalkompetenz: number | null;
            };
            overallAverage: number | null;
          }
        | undefined;

      const { generateArbeitszeugnisPDF } =
        await import('@/lib/arbeitszeugnis/pdfGenerator');
      const pdfBlob = await generateArbeitszeugnisPDF({
        traineeName:
          (snapshot.traineeName as string) ||
          aggregatedData?.traineeName ||
          selectedTraineeData?.full_name ||
          'Auszubildende/r',
        traineeBirthDate: birthDate || undefined,
        startDate: (snapshot.periodStart as string) || cert.periodStart,
        endDate: (snapshot.periodEnd as string) || cert.periodEnd,
        izhkProfile: 'Fachinformatiker für Anwendungsentwicklung',
        companyName: 'WAMOCON GmbH',
        components: snapshotComponents.map(
          (c: { title: string; finalGrade: number | null }) => ({
            title: c.title,
            grade: c.finalGrade,
          })
        ),
        averageGrade: (snapshot.overallAverage as number) || 0,
        qrCodeUrl: qrImageBase64 || cert.qrVerificationUrl,
        verificationCode: cert.qrVerificationCode,
        issuedAt: new Date(cert.issueDate),
        signerName: profile?.full_name || 'Ausbilder',
        gender: (cert.gender as 'male' | 'female' | 'neutral') || 'neutral',
        summary: cert.customSummary || undefined,
        radarImage: (snapshot.radarImage as string) || undefined,
        logoImage: logoImageBase64,
        softSkills:
          snapshotSoftSkills?.overallAverage != null
            ? snapshotSoftSkills
            : undefined,
      });

      const url = window.URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Arbeitszeugnis_${(snapshot.traineeName as string) || 'Zeugnis'}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success('PDF erfolgreich heruntergeladen');
    } catch (err) {
      console.error('Error re-downloading certificate:', err);
      toast.error('Fehler beim Herunterladen des Zeugnisses');
    } finally {
      setRedownloading(false);
    }
  };

  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });

  const handleBulkRedownloadAll = async () => {
    setBulkDownloading(true);
    setBulkProgress({ current: 0, total: 0 });

    try {
      // Fetch all certificates
      const res = await fetch('/api/trainer/arbeitszeugnis/certificates/all', {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Failed to fetch certificates');
      const data = await res.json();
      const certificates = data.certificates || [];

      if (certificates.length === 0) {
        toast.error('Keine Zeugnisse gefunden');
        return;
      }

      setBulkProgress({ current: 0, total: certificates.length });

      // Load company logo once
      let logoImageBase64: string | undefined;
      try {
        const logoResponse = await fetch('/WMC_Logo.png');
        const logoBlob = await logoResponse.blob();
        logoImageBase64 = await new Promise<string>(resolve => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(logoBlob);
        });
      } catch (e) {
        console.error('Error loading logo:', e);
      }

      const { generateArbeitszeugnisPDF } =
        await import('@/lib/arbeitszeugnis/pdfGenerator');

      let successCount = 0;
      for (let i = 0; i < certificates.length; i++) {
        const cert = certificates[i];
        setBulkProgress({ current: i + 1, total: certificates.length });

        try {
          const snapshot = (cert.snapshotData || {}) as Record<string, unknown>;
          const birthDate = (snapshot.traineeBirthDate as string) || null;

          let qrImageBase64: string | undefined;
          if (cert.qrVerificationUrl) {
            try {
              qrImageBase64 = await QRCode.toDataURL(cert.qrVerificationUrl, {
                errorCorrectionLevel: 'H',
                margin: 1,
                width: 200,
                color: { dark: '#000000', light: '#ffffff' },
              });
            } catch (e) {
              console.error('Error generating QR code:', e);
            }
          }

          const snapshotComponents =
            (snapshot.components as Array<{
              title: string;
              finalGrade: number | null;
            }>) || [];
          const snapshotSoftSkills = snapshot.softSkills as
            | {
                averages: {
                  fachkompetenz: number | null;
                  methodenkompetenz: number | null;
                  personalkompetenz: number | null;
                };
                overallAverage: number | null;
              }
            | undefined;

          const pdfBlob = await generateArbeitszeugnisPDF({
            traineeName:
              (snapshot.traineeName as string) ||
              cert.traineeName ||
              'Auszubildende/r',
            traineeBirthDate: birthDate || undefined,
            startDate: (snapshot.periodStart as string) || cert.periodStart,
            endDate: (snapshot.periodEnd as string) || cert.periodEnd,
            izhkProfile: 'Fachinformatiker für Anwendungsentwicklung',
            companyName: 'WAMOCON GmbH',
            components: snapshotComponents.map(
              (c: { title: string; finalGrade: number | null }) => ({
                title: c.title,
                grade: c.finalGrade,
              })
            ),
            averageGrade: (snapshot.overallAverage as number) || 0,
            qrCodeUrl: qrImageBase64 || cert.qrVerificationUrl || '',
            verificationCode: cert.qrVerificationCode || '',
            issuedAt: new Date(cert.issueDate),
            signerName: profile?.full_name || 'Ausbilder',
            gender: (cert.gender as 'male' | 'female' | 'neutral') || 'neutral',
            summary: cert.customSummary || undefined,
            radarImage: (snapshot.radarImage as string) || undefined,
            logoImage: logoImageBase64,
            softSkills:
              snapshotSoftSkills?.overallAverage != null
                ? snapshotSoftSkills
                : undefined,
          });

          const url = window.URL.createObjectURL(pdfBlob);
          const a = document.createElement('a');
          a.href = url;
          const traineeName =
            (snapshot.traineeName as string) || cert.traineeName || 'Zeugnis';
          const dateStr = new Date(cert.issueDate).toISOString().slice(0, 10);
          a.download = `Arbeitszeugnis_${traineeName}_${dateStr}.pdf`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
          successCount++;

          // Small delay between downloads to avoid browser blocking
          await new Promise(r => setTimeout(r, 500));
        } catch (err) {
          console.error(
            `Error generating PDF for certificate ${cert.id}:`,
            err
          );
        }
      }

      toast.success(
        `${successCount} von ${certificates.length} Zeugnisse erfolgreich heruntergeladen`
      );
    } catch (err) {
      console.error('Error bulk downloading certificates:', err);
      toast.error('Fehler beim Herunterladen der Zeugnisse');
    } finally {
      setBulkDownloading(false);
      setBulkProgress({ current: 0, total: 0 });
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
    return (
      trainee.full_name ||
      trainee.fullName ||
      `${trainee.firstName || ''} ${trainee.lastName || ''}`.trim() ||
      trainee.email
    );
  };

  const getInitials = (trainee: Trainee) => {
    const name = getTraineeName(trainee);
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Sort trainees by approved reports (suggestions first)
  const sortedTrainees = useMemo(() => {
    return [...trainees].sort(
      (a, b) => (b.approvedReports || 0) - (a.approvedReports || 0)
    );
  }, [trainees]);

  const suggestedTrainees = sortedTrainees.filter(
    t => (t.approvedReports || 0) >= 3
  );
  const otherTrainees = sortedTrainees.filter(
    t => (t.approvedReports || 0) < 3
  );

  // ==================== RENDER ====================

  // Step 1: Select Trainee
  if (step === 'select-trainee') {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="py-8 text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/25">
            <Award className="h-8 w-8 text-white" />
          </div>
          <h1 className="bg-gradient-to-r from-amber-500 to-orange-600 bg-clip-text text-3xl font-bold text-transparent">
            {t('arbeitszeugnis.title')}
          </h1>
          <p className="text-muted-foreground mx-auto mt-2 max-w-md">
            {t('arbeitszeugnis.subtitle')}
          </p>
          {/* Bulk Re-download All Certificates Button */}
          <div className="mt-4">
            <button
              onClick={handleBulkRedownloadAll}
              disabled={bulkDownloading}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-600 transition-all hover:border-amber-500 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {bulkDownloading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Herunterladen... ({bulkProgress.current}/{bulkProgress.total})
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Alle Zeugnisse neu herunterladen
                </>
              )}
            </button>
          </div>
        </div>

        {traineesLoading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <LoadingSpinner size="lg" />
          </div>
        ) : trainees.length === 0 ? (
          <div className="py-16 text-center">
            <Users className="text-muted-foreground mx-auto mb-4 h-16 w-16" />
            <h3 className="text-lg font-medium">
              {t('arbeitszeugnis.noTrainees')}
            </h3>
            <p className="text-muted-foreground mt-1">
              {t('arbeitszeugnis.noTraineesDesc')}
            </p>
          </div>
        ) : (
          <>
            {/* Suggestions Section */}
            {suggestedTrainees.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-amber-500" />
                  <h2 className="text-lg font-semibold">
                    {t('arbeitszeugnis.recommended')}
                  </h2>
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-600">
                    {t('arbeitszeugnis.enoughData')}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {suggestedTrainees.map(trainee => (
                    <button
                      key={trainee.id}
                      onClick={() => handleSelectTrainee(trainee)}
                      className="group relative rounded-2xl border-2 border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-orange-500/10 p-5 text-left transition-all hover:border-amber-500 hover:shadow-lg hover:shadow-amber-500/10"
                    >
                      <div className="absolute top-3 right-3">
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-1 text-xs font-medium text-amber-600">
                          <Star className="h-3 w-3" />
                          {t('arbeitszeugnis.recommended')}
                        </span>
                      </div>
                      <div className="flex items-start gap-4">
                        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-lg font-bold text-white shadow-md">
                          {getInitials(trainee)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-foreground truncate font-semibold">
                            {getTraineeName(trainee)}
                          </h3>
                          <p className="text-muted-foreground truncate text-sm">
                            {trainee.email}
                          </p>
                          <div className="mt-3 flex items-center gap-4">
                            <div className="flex items-center gap-1.5">
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                              <span className="text-sm font-medium text-green-600">
                                {trainee.approvedReports || 0}
                              </span>
                              <span className="text-muted-foreground text-xs">
                                {t('arbeitszeugnis.approved')}
                              </span>
                            </div>
                            {(trainee.pendingReports || 0) > 0 && (
                              <div className="flex items-center gap-1.5">
                                <Clock className="h-4 w-4 text-amber-500" />
                                <span className="text-sm font-medium text-amber-600">
                                  {trainee.pendingReports}
                                </span>
                                <span className="text-muted-foreground text-xs">
                                  {t('arbeitszeugnis.pending')}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="absolute right-3 bottom-3 opacity-0 transition-opacity group-hover:opacity-100">
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
                  <Users className="text-muted-foreground h-5 w-5" />
                  <h2 className="text-lg font-semibold">
                    {t('arbeitszeugnis.allTrainees')}
                  </h2>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {otherTrainees.map(trainee => (
                    <button
                      key={trainee.id}
                      onClick={() => handleSelectTrainee(trainee)}
                      className="group bg-card border-border hover:border-accent relative rounded-2xl border p-5 text-left transition-all hover:shadow-lg"
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-slate-600 to-slate-700 text-lg font-bold text-white">
                          {getInitials(trainee)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-foreground truncate font-semibold">
                            {getTraineeName(trainee)}
                          </h3>
                          <p className="text-muted-foreground truncate text-sm">
                            {trainee.email}
                          </p>
                          <div className="mt-3 flex items-center gap-4">
                            <div className="flex items-center gap-1.5">
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                              <span className="text-sm font-medium">
                                {trainee.approvedReports || 0}
                              </span>
                              <span className="text-muted-foreground text-xs">
                                {t('arbeitszeugnis.approved')}
                              </span>
                            </div>
                            {(trainee.pendingReports || 0) > 0 && (
                              <div className="flex items-center gap-1.5">
                                <Clock className="h-4 w-4 text-amber-500" />
                                <span className="text-sm font-medium">
                                  {trainee.pendingReports}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {(trainee.approvedReports || 0) < 1 && (
                        <div className="mt-3 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-600">
                          {t('arbeitszeugnis.noApprovedReports')}
                        </div>
                      )}
                      <div className="absolute right-3 bottom-3 opacity-0 transition-opacity group-hover:opacity-100">
                        <ChevronRight className="text-accent h-5 w-5" />
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
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Back Button */}
        <button
          onClick={() => setStep('select-trainee')}
          className="text-muted-foreground hover:text-foreground flex items-center gap-2 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('arbeitszeugnis.backToSelection')}
        </button>

        {/* Selected Trainee Card */}
        <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-orange-500/10 p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-xl font-bold text-white shadow-lg">
              {selectedTraineeData && getInitials(selectedTraineeData)}
            </div>
            <div>
              <h2 className="text-xl font-bold">
                {selectedTraineeData && getTraineeName(selectedTraineeData)}
              </h2>
              <p className="text-muted-foreground">
                {selectedTraineeData?.email}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium text-green-600">
                  {selectedTraineeData?.approvedReports || 0}{' '}
                  {t('arbeitszeugnis.approvedReports')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Configuration Card */}
        <div className="bg-card border-border space-y-6 rounded-2xl border p-6">
          <div className="flex items-center gap-3">
            <div className="bg-accent/20 rounded-xl p-2">
              <Calendar className="text-accent h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">
                {t('arbeitszeugnis.selectPeriod')}
              </h3>
              <p className="text-muted-foreground text-sm">
                {t('arbeitszeugnis.selectPeriodDesc')}
              </p>
            </div>
          </div>

          {/* Mode Toggle */}
          <div className="bg-muted flex rounded-xl p-1">
            <button
              onClick={() => setMode('YEAR')}
              className={`flex-1 rounded-lg px-4 py-3 text-sm font-medium transition-all ${
                mode === 'YEAR'
                  ? 'bg-background text-foreground shadow-md'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <GraduationCap className="mr-2 inline h-4 w-4" />
              {t('arbeitszeugnis.byYear')}
            </button>
            <button
              onClick={() => setMode('CUSTOM')}
              className={`flex-1 rounded-lg px-4 py-3 text-sm font-medium transition-all ${
                mode === 'CUSTOM'
                  ? 'bg-background text-foreground shadow-md'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Calendar className="mr-2 inline h-4 w-4" />
              {t('arbeitszeugnis.custom')}
            </button>
          </div>

          {mode === 'YEAR' ? (
            <div className="grid grid-cols-3 gap-3">
              {[1, 2, 3].map(year => (
                <button
                  key={year}
                  onClick={() => setAusbildungsjahr(year)}
                  className={`rounded-xl border-2 p-4 transition-all ${
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
                <label className="mb-2 block text-sm font-medium">
                  {t('arbeitszeugnis.from')}
                </label>
                <input
                  type="date"
                  value={customStart}
                  onChange={e => setCustomStart(e.target.value)}
                  className="bg-background border-border w-full rounded-xl border px-4 py-3 focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">
                  {t('arbeitszeugnis.to')}
                </label>
                <input
                  type="date"
                  value={customEnd}
                  onChange={e => setCustomEnd(e.target.value)}
                  className="bg-background border-border w-full rounded-xl border px-4 py-3 focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>
          )}

          {/* Certificate Type */}
          <div>
            <label className="mb-3 block text-sm font-medium">
              {t('arbeitszeugnis.certificateType')}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setCertificateType('INTERIM')}
                className={`rounded-xl border-2 p-4 text-left transition-all ${
                  certificateType === 'INTERIM'
                    ? 'border-amber-500 bg-amber-500/10'
                    : 'border-border hover:border-accent'
                }`}
              >
                <FileCheck className="mb-2 h-5 w-5 text-amber-500" />
                <p className="font-semibold">{t('arbeitszeugnis.interim')}</p>
                <p className="text-muted-foreground text-xs">
                  {t('arbeitszeugnis.interimDesc')}
                </p>
              </button>
              <button
                onClick={() => setCertificateType('FINAL')}
                className={`rounded-xl border-2 p-4 text-left transition-all ${
                  certificateType === 'FINAL'
                    ? 'border-amber-500 bg-amber-500/10'
                    : 'border-border hover:border-accent'
                }`}
              >
                <Award className="mb-2 h-5 w-5 text-amber-500" />
                <p className="font-semibold">{t('arbeitszeugnis.final')}</p>
                <p className="text-muted-foreground text-xs">
                  {t('arbeitszeugnis.finalDesc')}
                </p>
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-destructive/10 border-destructive/30 text-destructive flex items-center gap-2 rounded-xl border p-3 text-sm">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <button
            onClick={handleContinueToReview}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 py-4 font-semibold text-white shadow-lg transition-all hover:scale-[1.02] hover:shadow-xl"
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
        className="text-muted-foreground hover:text-foreground flex items-center gap-2 transition"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('arbeitszeugnis.backToConfig')}
      </button>

      {/* Header with Trainee Info */}
      <div className="flex items-center justify-between rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-orange-500/10 p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-lg font-bold text-white shadow-lg">
            {selectedTraineeData && getInitials(selectedTraineeData)}
          </div>
          <div>
            <h2 className="text-xl font-bold">
              {aggregatedData?.traineeName ||
                (selectedTraineeData && getTraineeName(selectedTraineeData))}
            </h2>
            <p className="text-muted-foreground text-sm">
              {mode === 'YEAR'
                ? `${ausbildungsjahr}. ${t('arbeitszeugnis.trainingYear')}`
                : `${customStart} - ${customEnd}`}
              {' • '}
              {certificateType === 'INTERIM'
                ? t('arbeitszeugnis.interim')
                : t('arbeitszeugnis.final')}
            </p>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="mb-4">
            <LoadingSpinner size="lg" />
          </div>
          <p className="text-muted-foreground">
            {t('arbeitszeugnis.analyzing')}
          </p>
        </div>
      )}

      {error && !loading && (
        <div className="bg-destructive/10 border-destructive/30 rounded-2xl border p-6 text-center">
          <AlertCircle className="text-destructive mx-auto mb-3 h-12 w-12" />
          <h3 className="text-destructive text-lg font-semibold">{error}</h3>
          <p className="text-destructive/80 mt-1 text-sm">
            {t('arbeitszeugnis.noDataDesc')}
          </p>
        </div>
      )}

      {aggregatedData && !loading && (
        <>
          {/* Overview Cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="bg-card border-border rounded-xl border p-4">
              <TrendingUp className="text-accent mb-2 h-5 w-5" />
              <p className="text-muted-foreground text-xs">
                {t('arbeitszeugnis.overallAverage')}
              </p>
              <p
                className={`text-2xl font-bold ${getGradeColor(aggregatedData.overallAverage)}`}
              >
                {aggregatedData.overallAverage?.toFixed(2) || '–'}
              </p>
            </div>
            <div className="bg-card border-border rounded-xl border p-4">
              <CheckCircle2 className="mb-2 h-5 w-5 text-green-500" />
              <p className="text-muted-foreground text-xs">
                {t('arbeitszeugnis.gradedComponents')}
              </p>
              <p className="text-2xl font-bold">
                {
                  aggregatedData.components.filter(c => c.finalGrade !== null)
                    .length
                }
                /{aggregatedData.components.length}
              </p>
            </div>
            <div className="bg-card border-border rounded-xl border p-4">
              <Clock className="mb-2 h-5 w-5 text-blue-500" />
              <p className="text-muted-foreground text-xs">
                {t('arbeitszeugnis.totalHours')}
              </p>
              <p className="text-2xl font-bold">
                {aggregatedData.components.reduce(
                  (sum, c) => sum + c.totalHours,
                  0
                )}
                h
              </p>
            </div>
            {aggregatedData.shorteningEligible && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                <Sparkles className="mb-2 h-5 w-5 text-emerald-600" />
                <p className="text-xs text-emerald-600">
                  {t('arbeitszeugnis.shorteningPossible')}
                </p>
                <p className="text-lg font-bold text-emerald-600">{'< 2,45'}</p>
              </div>
            )}
          </div>

          {/* Skill Radar */}
          {radarData && radarData.radarData.length >= 1 && (
            <div
              ref={radarRef}
              className="bg-card border-border rounded-2xl border p-6"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-lg font-bold">
                  <TrendingUp className="text-accent h-5 w-5" />
                  {t('arbeitszeugnis.competencyProfile')}
                </h3>
                {certificateQrImage ? (
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-muted-foreground text-xs">
                        {t('arbeitszeugnis.verificationQR')}
                      </p>
                      <p className="text-xs font-medium text-green-600">
                        {t('arbeitszeugnis.certificateIssued')}
                      </p>
                      <button
                        onClick={handleRedownloadCertificate}
                        disabled={redownloading}
                        className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-600 hover:text-amber-700 disabled:opacity-50"
                      >
                        {redownloading ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <FileText className="h-3 w-3" />
                        )}
                        PDF erneut herunterladen
                      </button>
                    </div>
                    <img
                      src={certificateQrImage}
                      alt="QR Code"
                      className="border-border h-16 w-16 rounded border"
                      title={existingCertificate?.qrVerificationUrl || ''}
                    />
                  </div>
                ) : (
                  <div className="text-muted-foreground flex items-center gap-2 text-xs">
                    <QrCode className="h-4 w-4" />
                    <span>{t('arbeitszeugnis.qrInPDF')}</span>
                  </div>
                )}
              </div>
              <SkillRadarChart data={radarData.radarData} size={400} />
            </div>
          )}

          {/* Components */}
          <div className="bg-card border-border rounded-2xl border p-6">
            <h3 className="mb-4 text-lg font-bold">
              {t('arbeitszeugnis.componentGrades')}
            </h3>
            <div className="space-y-2">
              {aggregatedData.components.map(comp => (
                <div
                  key={comp.componentId}
                  className="bg-muted/50 hover:bg-muted flex items-center justify-between rounded-xl p-3 transition"
                >
                  <div className="flex-1">
                    <p className="font-medium">{comp.componentTitle}</p>
                    <p className="text-muted-foreground text-xs">
                      {comp.componentCode} • {comp.totalHours}{' '}
                      {t('arbeitszeugnis.hours')} • {comp.gradedCount}/
                      {comp.totalUseCases} {t('arbeitszeugnis.graded')}
                    </p>
                  </div>
                  <span
                    className={`text-2xl font-bold ${getGradeColor(comp.averageGrade)}`}
                  >
                    {comp.finalGrade || '–'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Soft Skills */}
          {aggregatedData.softSkills &&
            aggregatedData.softSkills.totalRatings > 0 && (
              <div className="bg-card border-border rounded-2xl border p-6">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-bold">
                  <Award className="text-accent h-5 w-5" />
                  {t('arbeitszeugnis.softSkills')}
                  <span className="text-muted-foreground ml-2 text-xs font-normal">
                    ({aggregatedData.softSkills.totalRatings}{' '}
                    {t('arbeitszeugnis.ratings')})
                  </span>
                </h3>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  {[
                    { key: 'fachkompetenz', label: t('arbeitszeugnis.fach') },
                    {
                      key: 'methodenkompetenz',
                      label: t('arbeitszeugnis.methodic'),
                    },
                    {
                      key: 'personalkompetenz',
                      label: t('arbeitszeugnis.personal'),
                    },
                  ].map(({ key, label }) => {
                    const avg =
                      aggregatedData.softSkills?.averages[
                        key as keyof typeof aggregatedData.softSkills.averages
                      ];
                    return (
                      <div
                        key={key}
                        className="bg-muted/50 rounded-xl p-3 text-center"
                      >
                        <p className="text-muted-foreground mb-1 text-xs">
                          {label}
                        </p>
                        <p
                          className={`text-xl font-bold ${getGradeColor(avg ?? null)}`}
                        >
                          {avg?.toFixed(1) || '–'}
                        </p>
                      </div>
                    );
                  })}
                  <div className="rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/20 to-orange-500/20 p-3 text-center">
                    <p className="mb-1 text-xs text-amber-600">
                      {t('arbeitszeugnis.total')}
                    </p>
                    <p
                      className={`text-xl font-bold ${getGradeColor(aggregatedData.softSkills.overallAverage)}`}
                    >
                      {aggregatedData.softSkills.overallAverage?.toFixed(1) ||
                        '–'}
                    </p>
                  </div>
                </div>
              </div>
            )}

          {/* Soft Skills - Show message when no ratings */}
          {aggregatedData.softSkills &&
            aggregatedData.softSkills.totalRatings === 0 && (
              <div className="bg-card border-border rounded-2xl border border-dashed p-6">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-bold">
                  <Award className="text-muted-foreground h-5 w-5" />
                  {t('arbeitszeugnis.softSkills')}
                </h3>
                <div className="text-muted-foreground py-4 text-center">
                  <Award className="mx-auto mb-3 h-12 w-12 opacity-30" />
                  <p>{t('arbeitszeugnis.noSoftSkillRatings')}</p>
                  <p className="mt-2 text-sm">
                    {t('arbeitszeugnis.softSkillHint')}
                  </p>
                </div>
              </div>
            )}

          {/* Summary Text */}
          <div className="bg-card border-border rounded-2xl border p-6">
            <h3 className="mb-3 flex items-center gap-2 text-lg font-bold">
              <FileText className="text-accent h-5 w-5" />
              {t('arbeitszeugnis.closingWords')}
            </h3>
            <textarea
              value={summary}
              onChange={e => setSummary(e.target.value)}
              className="bg-background border-border min-h-[120px] w-full resize-y rounded-xl border p-4 focus:ring-2 focus:ring-amber-500"
              placeholder={t('arbeitszeugnis.textPlaceholder')}
            />
          </div>

          {/* Gender & Issue */}
          <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-orange-500/10 p-6">
            <div className="flex flex-col gap-6 md:flex-row">
              <div className="flex-1">
                <label className="mb-3 block text-sm font-medium">
                  {t('arbeitszeugnis.salutation')}
                </label>
                <div className="flex gap-2">
                  {(['male', 'female', 'neutral'] as const).map(g => (
                    <button
                      key={g}
                      onClick={() => setGender(g)}
                      className={`flex-1 rounded-xl py-3 font-medium transition-all ${
                        gender === g
                          ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg'
                          : 'bg-background border-border border hover:border-amber-500'
                      }`}
                    >
                      {g === 'male'
                        ? t('arbeitszeugnis.male')
                        : g === 'female'
                          ? t('arbeitszeugnis.female')
                          : t('arbeitszeugnis.neutral')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-1 items-end">
                <button
                  onClick={handleIssueCertificate}
                  disabled={issuing || !aggregatedData.overallAverage}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 py-4 font-bold text-white shadow-lg transition-all hover:scale-[1.02] hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
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
            <p className="text-muted-foreground mt-4 text-center text-xs">
              {t('arbeitszeugnis.qrNote')}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
