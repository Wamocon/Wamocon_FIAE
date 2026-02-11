'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
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
  ClipboardList,
  Lock,
  Unlock,
} from 'lucide-react';
import { ScenarioSection } from '@/lib/scenario-parser';
import { ScenarioSectionContent } from './ScenarioSectionContent';
import { useLanguage } from '@/contexts/LanguageContext';

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
  ClipboardList,
  Lock,
};

/**
 * Get icon background color based on section type (light mode compatible)
 */
function getIconBgColor(key: string, isLocked?: boolean): string {
  if (isLocked) {
    return 'from-slate-400 to-slate-500';
  }
  
  const colorMap: Record<string, string> = {
    overviewAndGoals: 'from-emerald-500 to-emerald-600',
    theoryAndContext: 'from-purple-500 to-purple-600',
    tasks: 'from-amber-500 to-amber-600',
    checklist: 'from-rose-500 to-rose-600',
    solutions: 'from-green-500 to-green-600',
    // Legacy support
    tasksAndChecklist: 'from-rose-500 to-rose-600',
    einleitung: 'from-slate-500 to-slate-600',
    content: 'from-slate-500 to-slate-600',
  };

  return colorMap[key] || 'from-accent to-red-600';
}

/**
 * Full-screen modal for viewing scenario section details with translations and light mode
 * Supports gating of solutions section until checklist is complete
 */
export function ScenarioModal({
  isOpen,
  onClose,
  sections,
  initialSection = 0,
  scenarioNumber,
}: ScenarioModalProps) {
  const [currentIndex, setCurrentIndex] = useState(initialSection);
  const [mounted, setMounted] = useState(false);
  const [checklistCompleted, setChecklistCompleted] = useState(false);
  const { t } = useLanguage();

  // Find if we have a solutions section that's gated
  const solutionsSectionIndex = useMemo(() => {
    return sections.findIndex(s => s.key === 'solutions' && s.isGated);
  }, [sections]);

  // Find checklist section
  const checklistSectionIndex = useMemo(() => {
    return sections.findIndex(s => s.key === 'checklist');
  }, [sections]);

  // Fix hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset to initial section when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(initialSection);
      // Reset checklist completion when modal opens
      setChecklistCompleted(false);
    }
  }, [isOpen, initialSection]);

  // Handle checklist completion callback
  const handleChecklistComplete = useCallback((completed: boolean) => {
    setChecklistCompleted(completed);
  }, []);

  // Can navigate to a section?
  const canNavigateToSection = useCallback((idx: number) => {
    // If it's the gated solutions section and checklist not completed, block
    if (idx === solutionsSectionIndex && !checklistCompleted) {
      return false;
    }
    return true;
  }, [solutionsSectionIndex, checklistCompleted]);

  // Modified setCurrentIndex that respects gating
  const navigateToSection = useCallback((idx: number) => {
    if (canNavigateToSection(idx)) {
      setCurrentIndex(idx);
    }
  }, [canNavigateToSection]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          navigateToSection(Math.max(0, currentIndex - 1));
          break;
        case 'ArrowRight':
          const nextIdx = Math.min(sections.length - 1, currentIndex + 1);
          if (canNavigateToSection(nextIdx)) {
            navigateToSection(nextIdx);
          }
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
          if (num < sections.length && canNavigateToSection(num)) {
            navigateToSection(num);
          }
          break;
      }
    },
    [isOpen, onClose, sections.length, currentIndex, canNavigateToSection, navigateToSection]
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

  if (!mounted || !isOpen || sections.length === 0) return null;

  const currentSection = sections[currentIndex];
  const isCurrentSectionLocked = currentSection.isGated && !checklistCompleted;
  const IconComponent = isCurrentSectionLocked ? Lock : (ICON_MAP[currentSection.icon] || FileText);
  const iconBgColor = getIconBgColor(currentSection.key, isCurrentSectionLocked);
  const sectionTitle = t(currentSection.titleKey) || currentSection.title;

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < sections.length - 1 && canNavigateToSection(currentIndex + 1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/80 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="
          relative flex flex-col
          w-[95vw] max-w-4xl h-[90vh] max-h-[900px]
          bg-white dark:bg-slate-900
          rounded-3xl shadow-2xl overflow-hidden
          border border-slate-200 dark:border-slate-700
        "
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl bg-gradient-to-br ${iconBgColor} shadow-lg`}>
              <IconComponent className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                {sectionTitle}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {scenarioNumber ? `${t('scenario.title')} ${scenarioNumber} · ` : ''}
                {t('scenario.section').replace('{current}', String(currentIndex + 1)).replace('{total}', String(sections.length))}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-200 dark:hover:bg-white/10 transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white"
            title={t('scenario.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress dots */}
        <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/50 flex-shrink-0">
          <div className="flex items-center justify-center gap-2">
            {sections.map((section, idx) => {
              const dotTitle = t(section.titleKey) || section.title;
              const isLocked = section.isGated && !checklistCompleted;
              const isAccessible = canNavigateToSection(idx);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => isAccessible && navigateToSection(idx)}
                  disabled={!isAccessible}
                  className={`
                    transition-all duration-300 rounded-full relative
                    ${
                      isLocked
                        ? 'w-2 h-2 bg-slate-400 dark:bg-slate-600 cursor-not-allowed'
                        : idx === currentIndex
                        ? 'w-8 h-2 bg-accent'
                        : idx < currentIndex
                        ? 'w-2 h-2 bg-accent/50 hover:bg-accent/70 cursor-pointer'
                        : 'w-2 h-2 bg-slate-300 dark:bg-white/20 hover:bg-slate-400 dark:hover:bg-white/40 cursor-pointer'
                    }
                  `}
                  title={isLocked ? `🔒 ${dotTitle} (${t('scenario.completeChecklistFirst')})` : `${dotTitle} (${idx + 1})`}
                  aria-label={isLocked ? t('scenario.sectionLocked') : t('scenario.goToSection').replace('{title}', dotTitle)}
                />
              );
            })}
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-6 scroll-smooth bg-white dark:bg-slate-900">
          <div className="max-w-3xl mx-auto">
            {isCurrentSectionLocked ? (
              /* Locked solutions section - show unlock message */
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="p-6 rounded-full bg-slate-100 dark:bg-slate-800 mb-6">
                  <Lock className="w-12 h-12 text-slate-400 dark:text-slate-500" />
                </div>
                <h3 className="text-xl font-bold text-slate-700 dark:text-slate-300 mb-3">
                  {t('scenario.solutionsLocked')}
                </h3>
                <p className="text-slate-500 dark:text-slate-400 max-w-md mb-6">
                  {t('scenario.completeChecklistToUnlock')}
                </p>
                {checklistSectionIndex >= 0 && (
                  <button
                    type="button"
                    onClick={() => navigateToSection(checklistSectionIndex)}
                    className="flex items-center gap-2 px-6 py-3 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-medium transition-colors"
                  >
                    <CheckSquare className="w-5 h-5" />
                    {t('scenario.goToChecklist')}
                  </button>
                )}
              </div>
            ) : (
              <ScenarioSectionContent
                content={currentSection.content}
                type={currentSection.type}
                subSections={currentSection.subSections}
                sectionKey={currentSection.key}
                onChecklistComplete={currentSection.key === 'checklist' ? handleChecklistComplete : undefined}
              />
            )}
          </div>
        </div>

        {/* Navigation footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/50 flex-shrink-0">
          <button
            type="button"
            onClick={() => navigateToSection(Math.max(0, currentIndex - 1))}
            disabled={!canGoPrev}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-xl
              transition-all duration-200
              ${
                canGoPrev
                  ? 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
              }
            `}
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="text-sm font-medium">{t('scenario.back')}</span>
          </button>

          {/* Section title hint */}
          <div className="hidden sm:flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
            {canGoPrev && (
              <span className="text-right max-w-[150px] truncate">
                ← {t(sections[currentIndex - 1].titleKey) || sections[currentIndex - 1].title}
              </span>
            )}
            {canGoPrev && canGoNext && <span className="text-slate-300 dark:text-gray-600">|</span>}
            {canGoNext && (
              <span className="text-left max-w-[150px] truncate flex items-center gap-1">
                {t(sections[currentIndex + 1].titleKey) || sections[currentIndex + 1].title}
                {sections[currentIndex + 1].isGated && !checklistCompleted && <Lock className="w-3 h-3" />}
                →
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => navigateToSection(Math.min(sections.length - 1, currentIndex + 1))}
            disabled={!canGoNext}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-xl
              transition-all duration-200
              ${
                canGoNext
                  ? 'bg-accent hover:bg-accent/80 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
              }
            `}
          >
            <span className="text-sm font-medium">{t('scenario.next')}</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Keyboard hint */}
        <div className="absolute bottom-20 right-6 text-xs text-slate-400 dark:text-slate-500 hidden lg:block">
          {t('scenario.keyboard')}
        </div>
      </div>
    </div>
  );
}

export default ScenarioModal;
