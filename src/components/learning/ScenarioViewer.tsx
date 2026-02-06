'use client';

import { useState, useMemo } from 'react';
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
} from 'lucide-react';
import { parseScenarioText, ParsedScenario } from '@/lib/scenario-parser';
import { ScenarioModal } from './ScenarioModal';

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
};

// Section colors for visual distinction
const SECTION_COLORS: Record<string, { bg: string; icon: string; border: string }> = {
  behandelteThemen: { bg: 'bg-blue-500/10', icon: 'text-blue-400', border: 'border-blue-500/20' },
  lernziele: { bg: 'bg-emerald-500/10', icon: 'text-emerald-400', border: 'border-emerald-500/20' },
  theoretischeGrundlagen: { bg: 'bg-purple-500/10', icon: 'text-purple-400', border: 'border-purple-500/20' },
  ausgangslage: { bg: 'bg-amber-500/10', icon: 'text-amber-400', border: 'border-amber-500/20' },
  problemLoesungPaare: { bg: 'bg-rose-500/10', icon: 'text-rose-400', border: 'border-rose-500/20' },
  lernzielCheckliste: { bg: 'bg-cyan-500/10', icon: 'text-cyan-400', border: 'border-cyan-500/20' },
  einleitung: { bg: 'bg-slate-500/10', icon: 'text-slate-400', border: 'border-slate-500/20' },
  content: { bg: 'bg-slate-500/10', icon: 'text-slate-400', border: 'border-slate-500/20' },
};

/**
 * Clean, list-based scenario viewer
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

  if (normalizedScenarios.length === 0) {
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
              Szenario {currentIndex + 1}
              {normalizedScenarios.length > 1 && (
                <span className="text-muted-foreground font-normal">
                  {' '}von {normalizedScenarios.length}
                </span>
              )}
            </h3>
            {hasSections && (
              <p className="text-xs text-muted-foreground">
                {parsedScenario.sections.length} Abschnitte zum Lernen
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
              title="Vorheriges Szenario"
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
                  title={`Zu Szenario ${idx + 1} wechseln`}
                  aria-label={`Zu Szenario ${idx + 1} wechseln`}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={() => onIndexChange(Math.min(normalizedScenarios.length - 1, currentIndex + 1))}
              disabled={!canGoNext}
              className="p-2 rounded-lg border border-accent/20 hover:bg-accent/10 hover:border-accent/40 hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer"
              title="Nächstes Szenario"
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
          Szenario {currentIndex + 1} starten
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-accent rotate-[-90deg] transition-all group-hover:translate-x-1" />
      </button>

      {/* Section List - Clean vertical layout */}
      {hasSections && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wide px-1">
            Oder direkt zu einem Abschnitt springen:
          </p>
          <div className="space-y-1.5">
            {parsedScenario.sections.map((section, idx) => {
              const IconComponent = ICON_MAP[section.icon] || FileText;
              const colors = SECTION_COLORS[section.key] || SECTION_COLORS.content;

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
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-background/50 text-xs font-semibold text-muted-foreground group-hover:bg-accent/20 group-hover:text-accent transition-all">
                    {idx + 1}
                  </span>

                  {/* Icon */}
                  <div className={`flex-shrink-0 ${colors.icon} group-hover:scale-110 transition-transform`}>
                    <IconComponent className="h-4 w-4" />
                  </div>

                  {/* Title */}
                  <span className="flex-1 font-medium text-foreground/90 group-hover:text-foreground transition-colors">
                    {section.title}
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
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 rounded-lg bg-amber-500/20 p-1.5">
              <Info className="h-4 w-4 text-amber-400" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-amber-400 mb-1">Hinweis</h4>
              <p className="text-sm text-amber-200/80 leading-relaxed">
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
          title: 'Szenario-Inhalt',
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
