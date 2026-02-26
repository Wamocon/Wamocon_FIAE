'use client';

import { useEffect, useState, use } from 'react';
import toast from 'react-hot-toast';
import {
  CheckCircle2,
  XCircle,
  Download,
  FileText,
  Calendar,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

interface VerificationResult {
  valid: boolean;
  verified?: boolean;
  certificate?: {
    type: string;
    type_en: string;
    issueDate: string;
    trainingYear: number;
    isAuthentic: boolean;
    approvedAt: string;
  };
  legalNote?: {
    de: string;
    en: string;
  };
  issuer?: string;
  verificationTimestamp?: string;
  message?: string;
}

export default function VerificationPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [downloading, setDownloading] = useState(false);

  const downloadPdf = async (verificationCode: string) => {
    const res = await fetch(`/api/verify/${verificationCode}/download`, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('Download failed');

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Arbeitszeugnis_${verificationCode}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const loadVerificationAndDownload = async () => {
    if (!code || downloading) return;
    setDownloading(true);
    try {
      const verifyRes = await fetch(`/api/verify/${code}`, {
        cache: 'no-store',
      });
      if (!verifyRes.ok) {
        const errorPayload = await verifyRes.json().catch(() => null);
        setResult({
          valid: false,
          message:
            errorPayload?.message ||
            'Der angegebene Code ist ungültig oder das Zeugnis existiert nicht.',
        });
        return;
      }

      const verifyData = (await verifyRes.json()) as VerificationResult;
      setResult(verifyData);

      await downloadPdf(code);
    } catch (error) {
      console.error('Download error:', error);
      setResult({
        valid: false,
        message: 'Fehler beim Herunterladen des Zeugnisses',
      });
    } finally {
      setDownloading(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    // Auto-download PDF immediately when page loads
    loadVerificationAndDownload();
  }, [code]);

  const handleDownload = async () => {
    if (!code) return;
    setDownloading(true);
    try {
      await downloadPdf(code);
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Fehler beim Herunterladen des Zeugnisses.');
    } finally {
      setDownloading(false);
    }
  };

  if (loading || downloading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
        <p className="text-lg font-medium text-gray-700">
          {downloading
            ? 'Arbeitszeugnis wird heruntergeladen...'
            : 'Zertifikat wird verifiziert...'}
        </p>
        <p className="text-sm text-gray-500">Bitte warten Sie einen Moment.</p>
      </div>
    );
  }

  if (!result?.valid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md space-y-6 rounded-2xl bg-white p-8 text-center shadow-xl">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-red-100">
            <XCircle className="h-10 w-10 text-red-600" />
          </div>
          <div>
            <h1 className="mb-2 text-2xl font-bold text-gray-900">
              Verifikation fehlgeschlagen
            </h1>
            <p className="text-gray-500">
              {result?.message ||
                'Der angegebene Code ist ungültig oder das Zeugnis existiert nicht.'}
            </p>
          </div>
          <div className="rounded-xl bg-gray-50 p-4 text-sm break-all text-gray-400">
            Code: {code}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-8">
        {/* Header Card */}
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="flex items-center justify-between bg-green-600 px-6 py-4">
            <div className="flex items-center space-x-2 text-white">
              <ShieldCheck className="h-6 w-6" />
              <span className="font-semibold">Offizielles Dokument</span>
            </div>
            <span className="text-sm text-green-100">
              Verifiziert am {format(new Date(), 'dd.MM.yyyy HH:mm')}
            </span>
          </div>

          <div className="space-y-6 p-8 text-center">
            <div className="animate-in fade-in zoom-in mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-green-50 duration-500">
              <CheckCircle2 className="h-12 w-12 text-green-600" />
            </div>

            <div>
              <h1 className="mb-2 text-3xl font-bold text-gray-900">
                PDF heruntergeladen!
              </h1>
              <p className="text-lg text-gray-500">
                Das Arbeitszeugnis ist authentisch und wurde von{' '}
                {result.issuer || 'Wamocon'} ausgestellt.
              </p>
            </div>

            <div className="flex flex-col justify-center gap-4 pt-4 sm:flex-row">
              <div className="min-w-[160px] rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="mb-1 flex items-center justify-center gap-2 text-gray-500">
                  <FileText className="h-4 w-4" />
                  <span className="text-sm font-medium">Dokumententyp</span>
                </div>
                <p className="text-lg font-bold text-gray-900">
                  {result.certificate?.type}
                </p>
              </div>

              <div className="min-w-[160px] rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="mb-1 flex items-center justify-center gap-2 text-gray-500">
                  <Calendar className="h-4 w-4" />
                  <span className="text-sm font-medium">Ausstellungsdatum</span>
                </div>
                <p className="text-lg font-bold text-gray-900">
                  {result.certificate?.issueDate
                    ? format(
                      new Date(result.certificate.issueDate),
                      'dd.MM.yyyy'
                    )
                    : '-'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Legal & Actions */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <h3 className="mb-4 flex items-center gap-2 font-semibold text-gray-900">
              <ShieldCheck className="h-5 w-5 text-gray-500" />
              Rechtsverbindlichkeit
            </h3>
            <p className="mb-4 text-sm leading-relaxed text-gray-600">
              {result.legalNote?.de}
            </p>
            <p className="text-xs text-gray-400">{result.legalNote?.en}</p>
          </div>

          <div className="flex flex-col justify-center space-y-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <h3 className="mb-2 font-semibold text-gray-900">
              Dokumentenaktionen
            </h3>

            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex w-full items-center justify-center space-x-2 rounded-xl bg-blue-600 px-4 py-3 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {downloading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Download className="h-5 w-5" />
              )}
              <span className="font-medium">PDF erneut herunterladen</span>
            </button>

            <p className="text-center text-xs text-gray-400">
              Das PDF wurde automatisch heruntergeladen. Klicken Sie hier um es
              erneut zu laden.
            </p>
          </div>
        </div>

        <div className="text-center">
          <p className="font-mono text-xs text-gray-300">
            Verification ID: {code}
          </p>
        </div>
      </div>
    </div>
  );
}
