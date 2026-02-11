'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Database, RefreshCw, CheckCircle, AlertCircle, XCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';

// ============================================================================
// TYPES
// ============================================================================

interface ReindexJob {
    id: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    forceReindex: boolean;
    progress: {
        totalSources: number;
        processedSources: number;
        totalChunksIndexed: number;
        totalChunksSkipped: number;
        failedSources: number;
        errors: string[];
        currentSource: string | null;
        enablersProcessed: number;
        documentsProcessed: number;
    };
    startedAt: string | null;
    completedAt: string | null;
    error: string | null;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function HaiAdminWidget() {
    const { user } = useAuth();
    const { t } = useLanguage();
    const [isStarting, setIsStarting] = useState(false);
    const [activeJob, setActiveJob] = useState<ReindexJob | null>(null);
    const [message, setMessage] = useState('');
    const [isCancelling, setIsCancelling] = useState(false);
    const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // --- Status helpers ---
    const isJobActive = activeJob?.status === 'pending' || activeJob?.status === 'running';
    const progressPercent = activeJob?.progress?.totalSources
        ? Math.round((activeJob.progress.processedSources / activeJob.progress.totalSources) * 100)
        : 0;

    // --- Poll for job status ---
    const pollJobStatus = useCallback(async (jobId: string) => {
        if (!user) return;
        try {
            const response = await fetch(`/api/hai/embed?userId=${user.id}&jobId=${jobId}`);
            const data = await response.json();

            if (data.success && data.job) {
                setActiveJob(data.job);

                // Stop polling if job is done
                if (['completed', 'failed', 'cancelled'].includes(data.job.status)) {
                    if (pollIntervalRef.current) {
                        clearInterval(pollIntervalRef.current);
                        pollIntervalRef.current = null;
                    }
                }
            }
        } catch {
            // Silently fail polling — will retry on next interval
        }
    }, [user]);

    // --- Start polling ---
    const startPolling = useCallback((jobId: string) => {
        // Clear existing interval
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
        }

        // Poll every 2 seconds
        pollIntervalRef.current = setInterval(() => {
            pollJobStatus(jobId);
        }, 2000);

        // Also poll immediately
        pollJobStatus(jobId);
    }, [pollJobStatus]);

    // --- Check for existing job on mount ---
    useEffect(() => {
        if (!user) return;

        const checkLatestJob = async () => {
            try {
                const response = await fetch(`/api/hai/embed?userId=${user.id}`);
                const data = await response.json();

                if (data.latestJob) {
                    setActiveJob(data.latestJob);

                    // Resume polling if job is still active
                    if (['pending', 'running'].includes(data.latestJob.status)) {
                        startPolling(data.latestJob.id);
                    }
                }
            } catch {
                // Ignore — not critical
            }
        };

        checkLatestJob();

        return () => {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
            }
        };
    }, [user, startPolling]);

    // --- Start indexing ---
    const startIndexing = async (forceReindex: boolean = false) => {
        if (!user || isStarting || isJobActive) return;
        setIsStarting(true);
        setMessage('');

        try {
            const response = await fetch(`/api/hai/embed?userId=${user.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'index_all', forceReindex }),
            });

            const data = await response.json();

            if (response.ok && data.jobId) {
                // Start polling the job
                setActiveJob({
                    id: data.jobId,
                    status: 'pending',
                    forceReindex,
                    progress: {
                        totalSources: 0,
                        processedSources: 0,
                        totalChunksIndexed: 0,
                        totalChunksSkipped: 0,
                        failedSources: 0,
                        errors: [],
                        currentSource: null,
                        enablersProcessed: 0,
                        documentsProcessed: 0,
                    },
                    startedAt: null,
                    completedAt: null,
                    error: null,
                });
                startPolling(data.jobId);
            } else {
                setMessage(data.error || t('hai.admin.indexError'));
            }
        } catch {
            setMessage(t('hai.admin.networkError'));
        } finally {
            setIsStarting(false);
        }
    };

    // --- Cancel job ---
    const cancelJob = async () => {
        if (!user || !isJobActive) return;
        setIsCancelling(true);

        try {
            await fetch(`/api/hai/embed?userId=${user.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'cancel_job' }),
            });
        } catch {
            // Ignore — cancellation is best-effort
        } finally {
            setIsCancelling(false);
        }
    };

    return (
        <div className="glass-effect rounded-2xl p-6 shadow-lg bg-gradient-to-br from-[#0f1117]/80 to-[#161b22]/80 border border-white/5">
            <h3 className="text-white mb-6 flex items-center text-xl font-bold gap-3">
                <span className="text-2xl filter drop-shadow-md">🦈</span>
                {t('hai.admin.title')}
            </h3>

            <div className="bg-black/20 rounded-xl p-6 border border-white/5">
                {/* Header Row */}
                <div className="flex items-start justify-between gap-6">
                    <div>
                        <h4 className="text-white font-semibold mb-2 flex items-center gap-2">
                            <Database className="w-5 h-5 text-cyan-400" />
                            {t('hai.admin.knowledgeBase')}
                        </h4>
                        <p className="text-gray-400 text-sm leading-relaxed max-w-md">
                            {t('hai.admin.description')}
                        </p>
                    </div>

                    <div className="flex gap-2">
                        {isJobActive ? (
                            <button
                                onClick={cancelJob}
                                disabled={isCancelling}
                                className="px-4 py-3 rounded-xl font-bold text-sm transition-all shadow-lg flex items-center gap-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
                            >
                                <XCircle className="w-4 h-4" />
                                {isCancelling ? t('hai.admin.cancelling') : t('hai.admin.cancel')}
                            </button>
                        ) : (
                            <>
                                <button
                                    onClick={() => startIndexing(false)}
                                    disabled={isStarting}
                                    className={`
                                        px-6 py-3 rounded-xl font-bold text-sm transition-all shadow-lg flex items-center gap-2
                                        ${isStarting
                                            ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                            : 'bg-cyan-500 hover:bg-cyan-400 text-black hover:scale-105'
                                        }
                                    `}
                                >
                                    {isStarting ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            {t('hai.admin.starting')}
                                        </>
                                    ) : (
                                        <>
                                            <RefreshCw className="w-4 h-4" />
                                            {t('hai.admin.indexNow')}
                                        </>
                                    )}
                                </button>
                                <button
                                    onClick={() => startIndexing(true)}
                                    disabled={isStarting}
                                    className={`
                                        px-4 py-3 rounded-xl font-bold text-sm transition-all shadow-lg flex items-center gap-2
                                        ${isStarting
                                            ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                            : 'bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/30'
                                        }
                                    `}
                                    title={t('hai.admin.forceReindexTooltip')}
                                >
                                    <RefreshCw className="w-4 h-4" />
                                    {t('hai.admin.forceReindex')}
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Progress Bar (active job) */}
                {isJobActive && activeJob && (
                    <div className="mt-4 space-y-3 animate-in fade-in">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-cyan-400 flex items-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                {activeJob.progress.currentSource || 'Starte...'}
                            </span>
                            <span className="text-gray-400">
                                {activeJob.progress.processedSources}/{activeJob.progress.totalSources} Quellen
                                ({progressPercent}%)
                            </span>
                        </div>

                        <div className="w-full bg-gray-700/50 rounded-full h-2.5">
                            <div
                                className="bg-gradient-to-r from-cyan-500 to-cyan-400 h-2.5 rounded-full transition-all duration-500"
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>

                        <div className="flex gap-4 text-xs text-gray-500">
                            <span>{activeJob.progress.totalChunksIndexed} Chunks indexiert</span>
                            <span>{activeJob.progress.totalChunksSkipped} übersprungen</span>
                            {activeJob.progress.failedSources > 0 && (
                                <span className="text-red-400">{activeJob.progress.failedSources} Fehler</span>
                            )}
                        </div>
                    </div>
                )}

                {/* Completed Job Status */}
                {activeJob?.status === 'completed' && (
                    <div className="mt-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg flex items-center gap-3 text-green-400 text-sm animate-in fade-in">
                        <CheckCircle className="w-5 h-5 flex-shrink-0" />
                        <span>
                            Erfolgreich: {activeJob.progress.totalChunksIndexed} Chunks indexiert,{' '}
                            {activeJob.progress.totalChunksSkipped} übersprungen.
                            ({activeJob.progress.enablersProcessed} Enablers, {activeJob.progress.documentsProcessed} Dokumente)
                        </span>
                    </div>
                )}

                {/* Failed Job Status */}
                {activeJob?.status === 'failed' && (
                    <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm animate-in fade-in">
                        <div className="flex items-center gap-3">
                            <AlertCircle className="w-5 h-5 flex-shrink-0" />
                            <span>Fehler: {activeJob.error || 'Unbekannter Fehler'}</span>
                        </div>
                        {activeJob.progress.totalChunksIndexed > 0 && (
                            <div className="mt-2 ml-8 text-gray-400">
                                Vor dem Fehler: {activeJob.progress.totalChunksIndexed} Chunks indexiert,{' '}
                                {activeJob.progress.processedSources}/{activeJob.progress.totalSources} Quellen verarbeitet.
                            </div>
                        )}
                    </div>
                )}

                {/* Cancelled Job Status */}
                {activeJob?.status === 'cancelled' && (
                    <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex items-center gap-3 text-yellow-400 text-sm animate-in fade-in">
                        <XCircle className="w-5 h-5 flex-shrink-0" />
                        <span>
                            Abgebrochen. {activeJob.progress.totalChunksIndexed} Chunks wurden bis zum Abbruch indexiert.
                            ({activeJob.progress.processedSources}/{activeJob.progress.totalSources} Quellen)
                        </span>
                    </div>
                )}

                {/* Error message (non-job) */}
                {message && !isJobActive && !activeJob?.status && (
                    <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-3 text-red-400 text-sm animate-in fade-in">
                        <AlertCircle className="w-5 h-5" />
                        {message}
                    </div>
                )}
            </div>
        </div>
    );
}
