'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  BookMarked,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Play,
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
} from 'lucide-react';
import { parseScenarioText, ParsedScenario } from '@/lib/scenario-parser';
import { ScenarioModal } from './ScenarioModal';
import { useLanguage } from '@/contexts/LanguageContext';

interface Scenario {
  text: string;
  hint?: string;
}

interface ScenarioViewerProps {
  scenarios: Scenario[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  scenarioText?: string;
  hintText?: string;
}

// Icon mapping
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

// Section colors for visual distinction (light mode compatible)
const SECTION_COLORS: Record<string, { bg: string; icon: string; border: string }> = {
  overviewAndGoals: { bg: 'bg-emerald-500/10 dark:bg-emerald-500/10', icon: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/30 dark:border-emerald-500/20' },
  theoryAndContext: { bg: 'bg-purple-500/10 dark:bg-purple-500/10', icon: 'text-purple-600 dark:text-purple-400', border: 'border-purple-500/30 dark:border-purple-500/20' },
  tasks: { bg: 'bg-amber-500/10 dark:bg-amber-500/10', icon: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/30 dark:border-amber-500/20' },
  checklist: { bg: 'bg-rose-500/10 dark:bg-rose-500/10', icon: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/30 dark:border-rose-500/20' },
  solutions: { bg: 'bg-green-500/10 dark:bg-green-500/10', icon: 'text-green-600 dark:text-green-400', border: 'border-green-500/30 dark:border-green-500/20' },
  // Legacy support
  tasksAndChecklist: { bg: 'bg-rose-500/10 dark:bg-rose-500/10', icon: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/30 dark:border-rose-500/20' },
  einleitung: { bg: 'bg-slate-500/10 dark:bg-slate-500/10', icon: 'text-slate-600 dark:text-slate-400', border: 'border-slate-500/30 dark:border-slate-500/20' },
  content: { bg: 'bg-slate-500/10 dark:bg-slate-500/10', icon: 'text-slate-600 dark:text-slate-400', border: 'border-slate-500/30 dark:border-slate-500/20' },
};

/**
 * Clean, list-based scenario viewer with translations and light mode support
 */
export function ScenarioViewer({
  scenarios,
  currentIndex,
  onIndexChange,
  scenarioText,
  hintText,
}: ScenarioViewerProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSectionIndex, setModalSectionIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const { t } = useLanguage();

  // Fix hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Normalize scenarios
  const normalizedScenarios: Scenario[] = useMemo(() => {
    if (Array.isArray(scenarios) && scenarios.length > 0) {
      return scenarios;
    }
    if (scenarioText) {
      return [{ text: scenarioText, hint: hintText }];
    }
    return [];
  }, [scenarios, scenarioText, hintText]);

  // Parse current scenario
  const currentScenario = normalizedScenarios[currentIndex];
  const parsedScenario: ParsedScenario = useMemo(() => {
    if (!currentScenario) {
      return { sections: [], rawText: '', hint: undefined };
    }
    return parseScenarioText(currentScenario.text, currentScenario.hint);
  }, [currentScenario]);

  // Open modal at specific section
  const openSection = (sectionIndex: number) => {
    setModalSectionIndex(sectionIndex);
    setModalOpen(true);
  };

  // Start learning - open modal at first section
  const startLearning = () => {
    setModalSectionIndex(0);
    setModalOpen(true);
  };

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < normalizedScenarios.length - 1;

  if (!mounted || normalizedScenarios.length === 0) {
    return null;
  }

  const hasSections = parsedScenario.sections.length > 0;

  return (
    <div className="space-y-4">
      {/* Header with scenario navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent/30 to-accent/10">
            <BookMarked className="h-5 w-5 text-accent" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">
              {t('scenario.title')} {currentIndex + 1}
              {normalizedScenarios.length > 1 && (
                <span className="text-muted-foreground font-normal">
                  {' '}{t('scenario.of')} {normalizedScenarios.length}
                </span>
              )}
            </h3>
            {hasSections && (
              <p className="text-xs text-muted-foreground">
                {t('scenario.sectionsForLearning').replace('{count}', String(parsedScenario.sections.length))}
              </p>
            )}
          </div>
        </div>

        {/* Scenario navigation (multiple scenarios) */}
        {normalizedScenarios.length > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onIndexChange(Math.max(0, currentIndex - 1))}
              disabled={!canGoPrev}
              className="p-2 rounded-lg border border-accent/20 hover:bg-accent/10 hover:border-accent/40 hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer"
              title={t('scenario.previousScenario')}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-1.5">
              {normalizedScenarios.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onIndexChange(idx)}
                  className={`rounded-full transition-all duration-200 cursor-pointer ${
                    idx === currentIndex
                      ? 'w-6 h-2 bg-accent'
                      : 'w-2 h-2 bg-accent/20 hover:bg-accent/50 hover:scale-125'
                  }`}
                  title={t('scenario.goToScenario').replace('{number}', String(idx + 1))}
                  aria-label={t('scenario.goToScenario').replace('{number}', String(idx + 1))}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={() => onIndexChange(Math.min(normalizedScenarios.length - 1, currentIndex + 1))}
              disabled={!canGoNext}
              className="p-2 rounded-lg border border-accent/20 hover:bg-accent/10 hover:border-accent/40 hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer"
              title={t('scenario.nextScenario')}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Start Learning Button */}
      <button
        type="button"
        onClick={startLearning}
        className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-gradient-to-r from-accent/20 via-accent/10 to-transparent border border-accent/30 hover:border-accent/50 hover:from-accent/30 hover:shadow-lg hover:shadow-accent/10 hover:scale-[1.01] transition-all duration-200 group cursor-pointer"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20 group-hover:bg-accent/30 transition-colors">
          <Play className="h-5 w-5 text-accent group-hover:scale-110 transition-transform" />
        </div>
        <span className="font-semibold text-foreground group-hover:text-accent transition-colors">
          {t('scenario.startScenario').replace('{number}', String(currentIndex + 1))}
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-accent rotate-[-90deg] transition-all group-hover:translate-x-1" />
      </button>

      {/* Section List - Clean vertical layout */}
      {hasSections && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wide px-1">
            {t('scenario.jumpToSection')}
          </p>
          <div className="space-y-1.5">
            {parsedScenario.sections.map((section, idx) => {
              const IconComponent = ICON_MAP[section.icon] || FileText;
              const colors = SECTION_COLORS[section.key] || SECTION_COLORS.content;
              const sectionTitle = t(section.titleKey) || section.title;

              return (
                <button
                  key={`${section.key}-${idx}`}
                  type="button"
                  onClick={() => openSection(idx)}
                  className={`
                    w-full flex items-center gap-3 px-4 py-3 rounded-xl
                    border ${colors.border} ${colors.bg}
                    hover:bg-opacity-20 hover:border-accent/40
                    hover:shadow-md hover:shadow-accent/5
                    hover:scale-[1.01]
                    transition-all duration-200 group text-left cursor-pointer
                  `}
                >
                  {/* Section number */}
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-background/50 dark:bg-background/50 text-xs font-semibold text-muted-foreground group-hover:bg-accent/20 group-hover:text-accent transition-all">
                    {idx + 1}
                  </span>

                  {/* Icon */}
                  <div className={`flex-shrink-0 ${colors.icon} group-hover:scale-110 transition-transform`}>
                    <IconComponent className="h-4 w-4" />
                  </div>

                  {/* Title */}
                  <span className="flex-1 font-medium text-foreground/90 group-hover:text-foreground transition-colors">
                    {sectionTitle}
                  </span>

                  {/* Arrow */}
                  <ChevronDown className="h-4 w-4 text-muted-foreground/50 rotate-[-90deg] group-hover:text-accent group-hover:translate-x-1 transition-all" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Hint display */}
      {parsedScenario.hint && (
        <div className="rounded-xl border border-amber-500/30 dark:border-amber-500/20 bg-amber-500/10 dark:bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 rounded-lg bg-amber-500/20 p-1.5">
              <Info className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-amber-700 dark:text-amber-400 mb-1">{t('scenario.hint')}</h4>
              <p className="text-sm text-amber-800/80 dark:text-amber-200/80 leading-relaxed">
                {parsedScenario.hint}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      <ScenarioModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        sections={parsedScenario.sections.length > 0 ? parsedScenario.sections : [{
          key: 'content',
          title: t('scenario.scenarioContent'),
          titleKey: 'scenario.scenarioContent',
          icon: 'FileText',
          content: currentScenario?.text || '',
          type: 'paragraph',
          order: 0,
        }]}
        initialSection={modalSectionIndex}
        scenarioNumber={currentIndex + 1}
      />
    </div>
  );
}

export default ScenarioViewer;
