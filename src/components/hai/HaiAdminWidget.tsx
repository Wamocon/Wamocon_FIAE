'use client';

import { useState } from 'react';
import { Database, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';

export default function HaiAdminWidget() {
    const { user } = useAuth();
    const { t } = useLanguage();
    const [isIndexing, setIsIndexing] = useState(false);
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState('');

    const startIndexing = async () => {
        if (!user) return;
        setIsIndexing(true);
        setStatus('idle');
        setMessage('');

        try {
            const response = await fetch(`/api/hai/embed?userId=${user.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'index_all' }) // Assuming API handles this
            });

            const data = await response.json();

            if (response.ok) {
                setStatus('success');
                setMessage(t('hai.admin.indexSuccess').replace('{chunks}', data.result.totalChunksIndexed).replace('{enablers}', data.result.enablersProcessed).replace('{docs}', data.result.documentsProcessed));
            } else {
                setStatus('error');
                setMessage(data.error || t('hai.admin.indexError'));
            }
        } catch (error) {
            setStatus('error');
            setMessage(t('hai.admin.networkError'));
        } finally {
            setIsIndexing(false);
        }
    };

    return (
        <div className="glass-effect rounded-2xl p-6 shadow-lg bg-gradient-to-br from-[#0f1117]/80 to-[#161b22]/80 border border-white/5">
            <h3 className="text-white mb-6 flex items-center text-xl font-bold gap-3">
                <span className="text-2xl filter drop-shadow-md">🦈</span>
                {t('hai.admin.title')}
            </h3>

            <div className="bg-black/20 rounded-xl p-6 border border-white/5">
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

                    <button
                        onClick={startIndexing}
                        disabled={isIndexing}
                        className={`
                            px-6 py-3 rounded-xl font-bold text-sm transition-all shadow-lg flex items-center gap-2
                            ${isIndexing
                                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                : 'bg-cyan-500 hover:bg-cyan-400 text-black hover:scale-105'
                            }
                        `}
                    >
                        {isIndexing ? (
                            <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                {t('hai.admin.indexing')}
                            </>
                        ) : (
                            <>
                                <RefreshCw className="w-4 h-4" />
                                {t('hai.admin.indexNow')}
                            </>
                        )}
                    </button>
                </div>

                {/* Status Messages */}
                {status === 'success' && (
                    <div className="mt-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg flex items-center gap-3 text-green-400 text-sm animate-in fade-in">
                        <CheckCircle className="w-5 h-5" />
                        {message}
                    </div>
                )}

                {status === 'error' && (
                    <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-3 text-red-400 text-sm animate-in fade-in">
                        <AlertCircle className="w-5 h-5" />
                        {message}
                    </div>
                )}
            </div>
        </div>
    );
}
