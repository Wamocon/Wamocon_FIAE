'use client';

import { useEffect, useState, use } from 'react';
import toast from 'react-hot-toast';
import { notFound } from 'next/navigation';
import { CheckCircle2, XCircle, Download, FileText, Calendar, ShieldCheck, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { generateArbeitszeugnisPDF } from '@/lib/arbeitszeugnis/pdfGenerator';
import QRCode from 'qrcode';

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

export default function VerificationPage({ params }: { params: Promise<{ code: string }> }) {
    const { code } = use(params);
    const [loading, setLoading] = useState(true);
    const [result, setResult] = useState<VerificationResult | null>(null);
    const [downloading, setDownloading] = useState(false);

    const triggerDownload = async () => {
        if (!code || downloading) return;
        setDownloading(true);
        try {
            const res = await fetch(`/api/verify/${code}/download`);
            if (!res.ok) throw new Error('Download failed');

            const data = await res.json();

            // Generate QR Code for the PDF
            const qrUrl = `${window.location.origin}/verify/${code}`;

            const blob = await generateArbeitszeugnisPDF({
                ...data,
                qrVerificationCode: code,
                qrCodeUrl: qrUrl,
                radarImage: data.radarImage || undefined
            });

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Arbeitszeugnis_${code}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            // Show success and update state
            setResult({ valid: true, message: 'PDF wurde heruntergeladen' });
        } catch (error) {
            console.error('Download error:', error);
            setResult({ valid: false, message: 'Fehler beim Herunterladen des Zeugnisses' });
        } finally {
            setDownloading(false);
            setLoading(false);
        }
    };

    useEffect(() => {
        // Auto-download PDF immediately when page loads
        triggerDownload();
    }, [code]);

    const handleDownload = async () => {
        if (!code) return;
        setDownloading(true);
        try {
            // we need to fetch the full certificate data to regenerate the PDF
            // Since the public verify API is lightweight, we might need a specialized endpoint 
            // OR we can simple re-use the issue/snapshot logic if we had a public "download" endpoint.
            // However, allowing public download of full personal data via just the code is sensitive but standard for these verifications.
            // Let's check if we can get the data. 
            // Actually, for security, usually you don't allow downloading the FULL detailed PDF without auth, 
            // but the user asked for it. "downloads it right ?".
            // So we need an endpoint to get the snapshot data by code.

            const res = await fetch(`/api/verify/${code}/download`);
            if (!res.ok) throw new Error('Download failed');

            const data = await res.json();

            // Generate QR Code for the PDF
            const qrUrl = `${window.location.origin}/verify/${code}`;
            const qrImageBase64 = await QRCode.toDataURL(qrUrl, {
                errorCorrectionLevel: 'H',
                margin: 1,
                width: 200,
                color: {
                    dark: '#000000',
                    light: '#ffffff',
                },
            });

            const blob = await generateArbeitszeugnisPDF({
                ...data,
                qrVerificationCode: code,
                qrCodeUrl: qrUrl,
                // We reuse the snapshot data which should match CertificateData interface
                // We might need to map some fields if the API returns raw DB columns
                radarImage: data.radarImage || undefined
            });

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Arbeitszeugnis_${code}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

        } catch (error) {
            console.error('Download error:', error);
            toast.error('Fehler beim Herunterladen des Zeugnisses.');
        } finally {
            setDownloading(false);
        }
    };

    if (loading || downloading) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-4">
                <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
                <p className="text-lg font-medium text-gray-700">
                    {downloading ? 'Arbeitszeugnis wird heruntergeladen...' : 'Zertifikat wird verifiziert...'}
                </p>
                <p className="text-sm text-gray-500">Bitte warten Sie einen Moment.</p>
            </div>
        );
    }

    if (!result?.valid) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
                <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center space-y-6">
                    <div className="mx-auto h-20 w-20 bg-red-100 rounded-full flex items-center justify-center">
                        <XCircle className="h-10 w-10 text-red-600" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 mb-2">Verifikation fehlgeschlagen</h1>
                        <p className="text-gray-500">
                            {result?.message || 'Der angegebene Code ist ungültig oder das Zeugnis existiert nicht.'}
                        </p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-xl text-sm text-gray-400 break-all">
                        Code: {code}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto space-y-8">
                {/* Header Card */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="bg-green-600 px-6 py-4 flex items-center justify-between">
                        <div className="flex items-center space-x-2 text-white">
                            <ShieldCheck className="h-6 w-6" />
                            <span className="font-semibold">Offizielles Dokument</span>
                        </div>
                        <span className="text-green-100 text-sm">
                            Verifiziert am {format(new Date(), 'dd.MM.yyyy HH:mm')}
                        </span>
                    </div>

                    <div className="p-8 text-center space-y-6">
                        <div className="mx-auto h-24 w-24 bg-green-50 rounded-full flex items-center justify-center animate-in fade-in zoom-in duration-500">
                            <CheckCircle2 className="h-12 w-12 text-green-600" />
                        </div>

                        <div>
                            <h1 className="text-3xl font-bold text-gray-900 mb-2">PDF heruntergeladen!</h1>
                            <p className="text-gray-500 text-lg">
                                Das Arbeitszeugnis ist authentisch und wurde von {result.issuer || 'Wamocon'} ausgestellt.
                            </p>
                        </div>

                        <div className="flex flex-col sm:flex-row justify-center gap-4 pt-4">
                            <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 min-w-[160px]">
                                <div className="flex items-center justify-center gap-2 text-gray-500 mb-1">
                                    <FileText className="h-4 w-4" />
                                    <span className="text-sm font-medium">Dokumententyp</span>
                                </div>
                                <p className="text-lg font-bold text-gray-900">{result.certificate?.type}</p>
                            </div>

                            <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 min-w-[160px]">
                                <div className="flex items-center justify-center gap-2 text-gray-500 mb-1">
                                    <Calendar className="h-4 w-4" />
                                    <span className="text-sm font-medium">Ausstellungsdatum</span>
                                </div>
                                <p className="text-lg font-bold text-gray-900">
                                    {result.certificate?.issueDate ? format(new Date(result.certificate.issueDate), 'dd.MM.yyyy') : '-'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Legal & Actions */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                            <ShieldCheck className="h-5 w-5 text-gray-500" />
                            Rechtsverbindlichkeit
                        </h3>
                        <p className="text-sm text-gray-600 leading-relaxed mb-4">
                            {result.legalNote?.de}
                        </p>
                        <p className="text-xs text-gray-400">
                            {result.legalNote?.en}
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col justify-center space-y-4">
                        <h3 className="font-semibold text-gray-900 mb-2">Dokumentenaktionen</h3>

                        <button
                            onClick={handleDownload}
                            disabled={downloading}
                            className="w-full flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {downloading ? (
                                <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                                <Download className="h-5 w-5" />
                            )}
                            <span className="font-medium">PDF erneut herunterladen</span>
                        </button>

                        <p className="text-xs text-center text-gray-400">
                            Das PDF wurde automatisch heruntergeladen. Klicken Sie hier um es erneut zu laden.
                        </p>
                    </div>
                </div>

                <div className="text-center">
                    <p className="text-xs text-gray-300 font-mono">
                        Verification ID: {code}
                    </p>
                </div>
            </div>
        </div>
    );
}
