'use client';

import { useState, useCallback, useEffect } from 'react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  X,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  Download,
  ExternalLink,
  BookOpen,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface FlipbookViewerProps {
  pdfUrl: string;
  title: string;
  isOpen: boolean;
  onClose: () => void;
}

export function FlipbookViewer({
  pdfUrl,
  title,
  isOpen,
  onClose,
}: FlipbookViewerProps) {
  const { t } = useLanguage();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scale, setScale] = useState(100);
  const [isLoading, setIsLoading] = useState(true);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
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
    },
    [isOpen, isFullscreen, onClose]
  );

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
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`relative flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 shadow-2xl transition-all duration-500 ${isFullscreen ? 'h-[98vh] w-[99vw] max-w-none' : 'h-[85vh] w-[95vw] max-w-6xl'} `}
      >
        {/* Premium Header */}
        <div className="flex items-center justify-between border-b border-white/10 bg-gradient-to-r from-red-900/30 to-transparent px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-gradient-to-br from-red-500 to-red-700 p-2 shadow-lg">
              <BookOpen className="text-foreground h-5 w-5" />
            </div>
            <div>
              <h2 className="text-foreground text-lg font-bold tracking-tight">
                {title}
              </h2>
              <p className="text-xs text-gray-400">
                {t('flipbook.theoryDocument')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Zoom controls */}
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2 py-1">
              <button
                onClick={() => setScale(s => Math.max(50, s - 10))}
                className="hover:text-foreground rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/10"
                title={t('flipbook.zoomOut')}
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="min-w-[3rem] text-center text-xs font-medium text-gray-300">
                {scale}%
              </span>
              <button
                onClick={() => setScale(s => Math.min(200, s + 10))}
                className="hover:text-foreground rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/10"
                title={t('flipbook.zoomIn')}
              >
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>

            <div className="mx-1 h-6 w-px bg-white/10" />

            {/* Actions */}
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground rounded-xl border border-transparent p-2 text-gray-400 transition-colors hover:border-white/10 hover:bg-white/10"
              title={t('flipbook.openNewTab')}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
            <a
              href={pdfUrl}
              download
              className="hover:text-foreground rounded-xl border border-transparent p-2 text-gray-400 transition-colors hover:border-white/10 hover:bg-white/10"
              title={t('flipbook.download')}
            >
              <Download className="h-4 w-4" />
            </a>

            <div className="mx-1 h-6 w-px bg-white/10" />

            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="hover:text-foreground rounded-xl border border-transparent p-2 text-gray-400 transition-colors hover:border-white/10 hover:bg-white/10"
              title={
                isFullscreen
                  ? t('flipbook.exitFullscreen')
                  : t('flipbook.enterFullscreen')
              }
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={onClose}
              className="rounded-xl border border-red-500/20 bg-red-500/10 p-2 text-red-400 transition-colors hover:bg-red-500/20 hover:text-red-300"
              title={t('flipbook.close')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* PDF Viewer */}
        <div className="relative flex-1 overflow-hidden bg-slate-950">
          {/* Loading overlay */}
          {isLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/90">
              <div className="flex flex-col items-center gap-4">
                <LoadingSpinner size="xl" />
              </div>
            </div>
          )}

          {/* PDF Container with shadow effect */}
          <div
            className="flex h-full w-full items-center justify-center p-4"
            style={{
              transform: `scale(${scale / 100})`,
              transformOrigin: 'center top',
            }}
          >
            <div className="h-full w-full overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10">
              <iframe
                src={`${pdfUrl}#toolbar=1&navpanes=1&view=FitH`}
                className="h-full w-full border-0 bg-white"
                title={title}
                onLoad={() => setIsLoading(false)}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center border-t border-white/10 bg-black/30 px-6 py-3">
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-gray-400">
                Esc
              </kbd>
              {t('flipbook.keyboard.close')}
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-gray-400">
                +
              </kbd>
              <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-gray-400">
                -
              </kbd>
              {t('flipbook.keyboard.zoom')}
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-gray-400">
                ↑
              </kbd>
              <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-gray-400">
                ↓
              </kbd>
              {t('flipbook.keyboard.scroll')}
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
