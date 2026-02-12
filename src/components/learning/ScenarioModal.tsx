'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  X, ChevronLeft, ChevronRight, Tags, Target, BookOpen, Compass,
  Lightbulb, CheckSquare, FileText, Info, Lock, Unlock, Check,
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
  initialAnswer?: string;
  visitedSections: Set<number>;
  onSectionVisit: (idx: number) => void;
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Tags, Target, BookOpen, Compass, Lightbulb, CheckSquare, FileText, Info, ClipboardList: FileText, Lock,
};

function getIconBgColor(key: string, isLocked?: boolean): string {
  if (isLocked) return 'from-slate-400 to-slate-500';
  const m: Record<string, string> = {
    overviewAndGoals: 'from-emerald-500 to-emerald-600',
    theoryAndContext: 'from-purple-500 to-purple-600',
    tasks: 'from-amber-500 to-amber-600',
    checklist: 'from-rose-500 to-rose-600',
    solutions: 'from-green-500 to-green-600',
    tasksAndChecklist: 'from-rose-500 to-rose-600',
    einleitung: 'from-slate-500 to-slate-600',
    content: 'from-slate-500 to-slate-600',
  };
  return m[key] || 'from-accent to-red-600';
}

export function ScenarioModal({
  isOpen, onClose, sections, initialSection = 0, scenarioNumber, initialAnswer = '',
  visitedSections, onSectionVisit,
}: ScenarioModalProps) {
  const [currentIndex, setCurrentIndex] = useState(initialSection);
  const [mounted, setMounted] = useState(false);
  const [checklistCompleted, setChecklistCompleted] = useState(false);
  const { t } = useLanguage();

  const solutionsSectionIndex = useMemo(() =>
    sections.findIndex(s => s.key === 'solutions' && s.isGated), [sections]);
  const checklistSectionIndex = useMemo(() =>
    sections.findIndex(s => s.key === 'checklist'), [sections]);

  useEffect(() => { setMounted(true); }, []);

  // Update when initialSection changes
  useEffect(() => {
    setCurrentIndex(initialSection);
  }, [initialSection]);

  // Track visited
  useEffect(() => {
    if (isOpen && currentIndex >= 0) {
      if (!visitedSections.has(currentIndex)) {
        onSectionVisit(currentIndex);
      }
    }
  }, [currentIndex, isOpen, visitedSections, onSectionVisit]);

  const handleChecklistComplete = useCallback((completed: boolean) => {
    setChecklistCompleted(completed);
  }, []);

  // Sequential + gating logic
  const canNavigateToSection = useCallback((idx: number) => {
    if (idx === 0) return true;
    if (!visitedSections.has(idx - 1)) return false;
    // Solutions unlock only after checklist is done AND an answer exists in parent state
    if (idx === solutionsSectionIndex) return checklistCompleted && !!initialAnswer;
    return true;
  }, [visitedSections, solutionsSectionIndex, checklistCompleted, initialAnswer]);

  const navigateToSection = useCallback((idx: number) => {
    if (canNavigateToSection(idx)) setCurrentIndex(idx);
  }, [canNavigateToSection]);

  // Keyboard
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isOpen) return;
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowLeft') navigateToSection(Math.max(0, currentIndex - 1));
    if (e.key === 'ArrowRight') {
      const next = Math.min(sections.length - 1, currentIndex + 1);
      if (canNavigateToSection(next)) navigateToSection(next);
    }
  }, [isOpen, onClose, sections.length, currentIndex, canNavigateToSection, navigateToSection]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!mounted || !isOpen || sections.length === 0) return null;

  const cur = sections[currentIndex];
  // Solutions are locked if it's the solutions section AND (checklist not done OR no answer submitted)
  const isSolLocked = cur.key === 'solutions' && cur.isGated && (!checklistCompleted || !initialAnswer);
  const Icon = isSolLocked ? Lock : (ICON_MAP[cur.icon] || FileText);
  const iconBg = getIconBgColor(cur.key, isSolLocked);
  const title = t(cur.titleKey) || cur.title;
  const canPrev = currentIndex > 0;
  const canNext = currentIndex < sections.length - 1 && canNavigateToSection(currentIndex + 1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/80 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="relative flex flex-col w-[95vw] max-w-4xl h-[90vh] max-h-[900px] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl bg-gradient-to-br ${iconBg} shadow-lg`}>
              <Icon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">{title}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {scenarioNumber ? `${t('scenario.title')} ${scenarioNumber} · ` : ''}
                {t('scenario.section').replace('{current}', String(currentIndex + 1)).replace('{total}', String(sections.length))}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl hover:bg-slate-200 dark:hover:bg-white/10 transition-colors text-slate-500 dark:text-slate-400" title={t('scenario.close')}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress steps */}
        <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/50 flex-shrink-0">
          <div className="flex items-center justify-center gap-1">
            {sections.map((sec, idx) => {
              const dotTitle = t(sec.titleKey) || sec.title;
              const visited = visitedSections.has(idx);
              const accessible = canNavigateToSection(idx);
              const isCur = idx === currentIndex;
              return (
                <div key={idx} className="flex items-center">
                  <button type="button" onClick={() => accessible && navigateToSection(idx)} disabled={!accessible}
                    className={`relative flex items-center justify-center transition-all duration-300 ${isCur ? 'w-9 h-9 rounded-xl bg-accent text-white shadow-lg shadow-accent/30 scale-105'
                      : !accessible ? 'w-7 h-7 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
                        : visited ? 'w-7 h-7 rounded-lg bg-accent/20 text-accent hover:bg-accent/30 cursor-pointer'
                          : 'w-7 h-7 rounded-lg bg-slate-200 dark:bg-slate-700/50 text-slate-500 hover:bg-slate-300 cursor-pointer'
                      }`}
                    title={!accessible ? `🔒 ${dotTitle}` : `${dotTitle} (${idx + 1})`}
                    aria-label={!accessible ? t('scenario.sectionLocked') : t('scenario.goToSection').replace('{title}', dotTitle)}>
                    {!accessible ? <Lock className="w-3 h-3" /> : visited && !isCur ? <Check className="w-3.5 h-3.5" /> : <span className="text-xs font-bold">{idx + 1}</span>}
                  </button>
                  {idx < sections.length - 1 && (
                    <div className={`w-4 h-0.5 mx-0.5 transition-colors ${visited && canNavigateToSection(idx + 1) ? 'bg-accent/40' : 'bg-slate-200 dark:border-slate-700'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 scroll-smooth bg-white dark:bg-slate-900">
          <div className="max-w-3xl mx-auto">
            {isSolLocked ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="p-6 rounded-full bg-slate-100 dark:bg-slate-800 mb-6"><Lock className="w-12 h-12 text-slate-400" /></div>
                <h3 className="text-xl font-bold text-slate-700 dark:text-slate-300 mb-3">{t('scenario.solutionsLocked')}</h3>
                <p className="text-slate-500 dark:text-slate-400 max-w-md mb-6">
                  {!checklistCompleted ? t('scenario.completeChecklistToUnlock') : t('scenario.submitAnswerToUnlock')}
                </p>
                {!checklistCompleted && checklistSectionIndex >= 0 && (
                  <button type="button" onClick={() => navigateToSection(checklistSectionIndex)}
                    className="flex items-center gap-2 px-6 py-3 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-medium transition-colors">
                    <CheckSquare className="w-5 h-5" />{t('scenario.goToChecklist')}
                  </button>
                )}
              </div>
            ) : (
              <>
                <ScenarioSectionContent content={cur.content} type={cur.type} subSections={cur.subSections}
                  sectionKey={cur.key} onChecklistComplete={cur.key === 'checklist' ? handleChecklistComplete : undefined} />

                {cur.key === 'checklist' && !!initialAnswer && (
                  <div className="mt-6 p-4 rounded-xl bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20">
                    <p className="text-green-700 dark:text-green-400 font-medium flex items-center gap-2">
                      <Unlock className="w-5 h-5" />{t('scenario.answerSubmittedSolutionsUnlocked')}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/50 flex-shrink-0">
          <button type="button" onClick={() => navigateToSection(Math.max(0, currentIndex - 1))} disabled={!canPrev}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-200 ${canPrev ? 'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-white'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed'}`}>
            <ChevronLeft className="w-4 h-4" /><span className="text-sm font-medium">{t('scenario.back')}</span>
          </button>
          <div className="hidden sm:flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
            {canPrev && <span className="text-right max-w-[150px] truncate">← {t(sections[currentIndex - 1].titleKey) || sections[currentIndex - 1].title}</span>}
            {canPrev && canNext && <span className="text-slate-300 dark:text-gray-600">|</span>}
            {canNext && <span className="text-left max-w-[150px] truncate">{t(sections[currentIndex + 1].titleKey) || sections[currentIndex + 1].title} →</span>}
            {!canNext && currentIndex < sections.length - 1 && (
              <span className="flex items-center gap-1 text-slate-400"><Lock className="w-3 h-3" />{t(sections[currentIndex + 1].titleKey) || sections[currentIndex + 1].title}</span>
            )}
          </div>
          <button type="button" onClick={() => navigateToSection(Math.min(sections.length - 1, currentIndex + 1))} disabled={!canNext}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-200 ${canNext ? 'bg-accent hover:bg-accent/80 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed'}`}>
            <span className="text-sm font-medium">{t('scenario.next')}</span><ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="absolute bottom-20 right-6 text-xs text-slate-400 dark:text-slate-500 hidden lg:block">{t('scenario.keyboard')}</div>
      </div>
    </div>
  );
}

export default ScenarioModal;
