'use client';

import { useState, useCallback, useEffect } from 'react';
import { X, Maximize2, Minimize2, ZoomIn, ZoomOut, Download, ExternalLink, BookOpen } from 'lucide-react';

interface FlipbookViewerProps {
    pdfUrl: string;
    title: string;
    isOpen: boolean;
    onClose: () => void;
}

export function FlipbookViewer({ pdfUrl, title, isOpen, onClose }: FlipbookViewerProps) {
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [scale, setScale] = useState(100);
    const [isLoading, setIsLoading] = useState(true);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (!isOpen) return;

        switch (e.key) {
            case 'Escape':
                if (isFullscreen) {
                    setIsFullscreen(false);
                } else {
                    onClose();
                }
                break;
            case '+':
            case '=':
                setScale(s => Math.min(200, s + 10));
                break;
            case '-':
                setScale(s => Math.max(50, s - 10));
                break;
        }
    }, [isOpen, isFullscreen, onClose]);

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            setIsLoading(true);
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div
                className={`
                    relative flex flex-col 
                    bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900
                    rounded-3xl shadow-2xl overflow-hidden transition-all duration-500
                    border border-white/10
                    ${isFullscreen ? 'fixed inset-2' : 'w-[95vw] max-w-6xl h-[92vh]'}
                `}
            >
                {/* Premium Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-gradient-to-r from-red-900/30 to-transparent">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-gradient-to-br from-red-500 to-red-700 shadow-lg">
                            <BookOpen className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white tracking-tight">
                                {title}
                            </h2>
                            <p className="text-xs text-gray-400">Theorie-Dokument</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                        {/* Zoom controls */}
                        <div className="flex items-center gap-1 px-2 py-1 rounded-xl bg-white/5 border border-white/10">
                            <button
                                onClick={() => setScale(s => Math.max(50, s - 10))}
                                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
                                title="Verkleinern (-)"
                            >
                                <ZoomOut className="w-4 h-4" />
                            </button>
                            <span className="text-xs text-gray-300 min-w-[3rem] text-center font-medium">
                                {scale}%
                            </span>
                            <button
                                onClick={() => setScale(s => Math.min(200, s + 10))}
                                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
                                title="Vergrößern (+)"
                            >
                                <ZoomIn className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="w-px h-6 bg-white/10 mx-1" />

                        {/* Actions */}
                        <a
                            href={pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 rounded-xl hover:bg-white/10 transition-colors text-gray-400 hover:text-white border border-transparent hover:border-white/10"
                            title="In neuem Tab öffnen"
                        >
                            <ExternalLink className="w-4 h-4" />
                        </a>
                        <a
                            href={pdfUrl}
                            download
                            className="p-2 rounded-xl hover:bg-white/10 transition-colors text-gray-400 hover:text-white border border-transparent hover:border-white/10"
                            title="Herunterladen"
                        >
                            <Download className="w-4 h-4" />
                        </a>

                        <div className="w-px h-6 bg-white/10 mx-1" />

                        <button
                            onClick={() => setIsFullscreen(!isFullscreen)}
                            className="p-2 rounded-xl hover:bg-white/10 transition-colors text-gray-400 hover:text-white border border-transparent hover:border-white/10"
                            title={isFullscreen ? 'Vollbild beenden (Esc)' : 'Vollbild'}
                        >
                            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 transition-colors text-red-400 hover:text-red-300 border border-red-500/20"
                            title="Schließen (Esc)"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* PDF Viewer */}
                <div className="flex-1 relative overflow-hidden bg-slate-950">
                    {/* Loading overlay */}
                    {isLoading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 z-10">
                            <div className="flex flex-col items-center gap-4">
                                <div className="relative">
                                    <div className="w-16 h-16 border-4 border-red-500/20 rounded-full" />
                                    <div className="absolute inset-0 w-16 h-16 border-4 border-transparent border-t-red-500 rounded-full animate-spin" />
                                </div>
                                <span className="text-gray-400 font-medium">PDF wird geladen...</span>
                            </div>
                        </div>
                    )}

                    {/* PDF Container with shadow effect */}
                    <div
                        className="w-full h-full flex items-center justify-center p-4"
                        style={{ transform: `scale(${scale / 100})`, transformOrigin: 'center top' }}
                    >
                        <div className="w-full h-full rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10">
                            <iframe
                                src={`${pdfUrl}#toolbar=1&navpanes=1&view=FitH`}
                                className="w-full h-full border-0 bg-white"
                                title={title}
                                onLoad={() => setIsLoading(false)}
                            />
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-center px-6 py-3 border-t border-white/10 bg-black/30">
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1.5">
                            <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-gray-400">Esc</kbd>
                            Schließen
                        </span>
                        <span className="flex items-center gap-1.5">
                            <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-gray-400">+</kbd>
                            <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-gray-400">-</kbd>
                            Zoom
                        </span>
                        <span className="flex items-center gap-1.5">
                            <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-gray-400">↑</kbd>
                            <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-gray-400">↓</kbd>
                            Scrollen
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Hook to manage flipbook viewer state
 */
export function useFlipbookViewer() {
    const [state, setState] = useState<{
        isOpen: boolean;
        pdfUrl: string;
        title: string;
    }>({
        isOpen: false,
        pdfUrl: '',
        title: '',
    });

    const openPdf = useCallback((title: string, pdfUrl: string) => {
        setState({ isOpen: true, title, pdfUrl });
    }, []);

    const closePdf = useCallback(() => {
        setState(prev => ({ ...prev, isOpen: false }));
    }, []);

    return { ...state, openPdf, closePdf };
}
