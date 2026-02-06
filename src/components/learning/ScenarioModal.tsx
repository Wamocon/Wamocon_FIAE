'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Tags,
  Target,
  BookOpen,
  Compass,
  Lightbulb,
  CheckSquare,
  FileText,
  Info,
} from 'lucide-react';
import { ScenarioSection } from '@/lib/scenario-parser';
import { ScenarioSectionContent } from './ScenarioSectionContent';

interface ScenarioModalProps {
  isOpen: boolean;
  onClose: () => void;
  sections: ScenarioSection[];
  initialSection?: number;
  scenarioNumber?: number;
}

// Map icon names to components
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Tags,
  Target,
  BookOpen,
  Compass,
  Lightbulb,
  CheckSquare,
  FileText,
  Info,
};

/**
 * Get icon background color based on section type
 */
function getIconBgColor(key: string): string {
  const colorMap: Record<string, string> = {
    behandelteThemen: 'from-blue-500 to-blue-600',
    lernziele: 'from-emerald-500 to-emerald-600',
    theoretischeGrundlagen: 'from-purple-500 to-purple-600',
    ausgangslage: 'from-amber-500 to-amber-600',
    problemLoesungPaare: 'from-rose-500 to-rose-600',
    lernzielCheckliste: 'from-cyan-500 to-cyan-600',
  };

  return colorMap[key] || 'from-accent to-red-600';
}

/**
 * Full-screen modal for viewing scenario section details
 */
export function ScenarioModal({
  isOpen,
  onClose,
  sections,
  initialSection = 0,
  scenarioNumber,
}: ScenarioModalProps) {
  const [currentIndex, setCurrentIndex] = useState(initialSection);

  // Reset to initial section when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(initialSection);
    }
  }, [isOpen, initialSection]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          setCurrentIndex((i) => Math.max(0, i - 1));
          break;
        case 'ArrowRight':
          setCurrentIndex((i) => Math.min(sections.length - 1, i + 1));
          break;
        // Number keys to jump to section
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          const num = parseInt(e.key, 10) - 1;
          if (num < sections.length) {
            setCurrentIndex(num);
          }
          break;
      }
    },
    [isOpen, onClose, sections.length]
  );

  // Add/remove keyboard listener
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Body scroll lock
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen || sections.length === 0) return null;

  const currentSection = sections[currentIndex];
  const IconComponent = ICON_MAP[currentSection.icon] || FileText;
  const iconBgColor = getIconBgColor(currentSection.key);

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < sections.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="
          relative flex flex-col
          w-[95vw] max-w-4xl h-[90vh] max-h-[900px]
          bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900
          rounded-3xl shadow-2xl overflow-hidden
          border border-white/10
        "
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-gradient-to-r from-accent/20 to-transparent flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl bg-gradient-to-br ${iconBgColor} shadow-lg`}>
              <IconComponent className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground tracking-tight">
                {currentSection.title}
              </h2>
              <p className="text-xs text-gray-400">
                {scenarioNumber ? `Szenario ${scenarioNumber} · ` : ''}
                Abschnitt {currentIndex + 1} von {sections.length}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-white/10 transition-colors text-gray-400 hover:text-foreground"
            title="Schließen (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress dots */}
        <div className="px-6 py-3 border-b border-white/5 bg-black/20 flex-shrink-0">
          <div className="flex items-center justify-center gap-2">
            {sections.map((section, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setCurrentIndex(idx)}
                className={`
                  transition-all duration-300 rounded-full
                  ${
                    idx === currentIndex
                      ? 'w-8 h-2 bg-accent'
                      : idx < currentIndex
                      ? 'w-2 h-2 bg-accent/50 hover:bg-accent/70'
                      : 'w-2 h-2 bg-white/20 hover:bg-white/40'
                  }
                `}
                title={`${section.title} (${idx + 1})`}
                aria-label={`Gehe zu ${section.title}`}
              />
            ))}
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
          <div className="max-w-3xl mx-auto">
            <ScenarioSectionContent
              content={currentSection.content}
              type={currentSection.type}
            />
          </div>
        </div>

        {/* Navigation footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 bg-black/30 flex-shrink-0">
          <button
            type="button"
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            disabled={!canGoPrev}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-xl
              transition-all duration-200
              ${
                canGoPrev
                  ? 'bg-white/10 hover:bg-white/20 text-foreground'
                  : 'bg-white/5 text-gray-500 cursor-not-allowed'
              }
            `}
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="text-sm font-medium">Zurück</span>
          </button>

          {/* Section title hint */}
          <div className="hidden sm:flex items-center gap-4 text-sm text-gray-400">
            {canGoPrev && (
              <span className="text-right max-w-[150px] truncate">
                ← {sections[currentIndex - 1].title}
              </span>
            )}
            {canGoPrev && canGoNext && <span className="text-gray-600">|</span>}
            {canGoNext && (
              <span className="text-left max-w-[150px] truncate">
                {sections[currentIndex + 1].title} →
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setCurrentIndex((i) => Math.min(sections.length - 1, i + 1))}
            disabled={!canGoNext}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-xl
              transition-all duration-200
              ${
                canGoNext
                  ? 'bg-accent hover:bg-accent/80 text-foreground'
                  : 'bg-white/5 text-gray-500 cursor-not-allowed'
              }
            `}
          >
            <span className="text-sm font-medium">Weiter</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Keyboard hint */}
        <div className="absolute bottom-20 right-6 text-xs text-gray-500 hidden lg:block">
          Tastatur: ← → zum Navigieren, Esc zum Schließen
        </div>
      </div>
    </div>
  );
}

export default ScenarioModal;
