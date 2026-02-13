'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  BookMarked, ChevronLeft, ChevronRight, ChevronDown, Play, Tags, Target,
  BookOpen, Compass, Lightbulb, CheckSquare, FileText, Info, ClipboardList, Lock,
} from 'lucide-react';
import { parseScenarioText, ParsedScenario, ScenarioSection, ContentType } from '@/lib/scenario-parser';
import { ScenarioModal } from './ScenarioModal';
import { useLanguage } from '@/contexts/LanguageContext';

// Task structure from database
interface DbTask {
  task: string;
  title: string;
  number: number;
  scenario: string;
}

// Solution structure from database
interface DbSolution {
  problemNumber: number;
  title: string;
  content: string;
}

// Database sections structure
interface DbSections {
  behandelteThemen?: string[];
  lernziele?: string[];
  theoretischeGrundlagen?: string;  // May contain HTML tables
  ausgangslage?: string;
  aufgaben?: DbTask[];
  checkliste?: string[];
  loesungen?: DbSolution[];
}

interface Scenario {
  text: string;
  hint?: string;
  sections?: DbSections;  // Pre-structured sections from DB
}

interface ScenarioViewerProps {
  scenarios: Scenario[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  scenarioText?: string;
  hintText?: string;
  initialAnswers?: Array<{ scenarioIndex: number; text: string }>;
  traineeId: string;
  enablerId: string;
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Tags, Target, BookOpen, Compass, Lightbulb, CheckSquare, FileText, Info, ClipboardList, Lock,
};

const SECTION_COLORS: Record<string, { bg: string; icon: string; border: string }> = {
  overviewAndGoals: { bg: 'bg-emerald-500/10', icon: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/30' },
  theoryAndContext: { bg: 'bg-purple-500/10', icon: 'text-purple-600 dark:text-purple-400', border: 'border-purple-500/30' },
  tasks: { bg: 'bg-amber-500/10', icon: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/30' },
  checklist: { bg: 'bg-rose-500/10', icon: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/30' },
  solutions: { bg: 'bg-green-500/10', icon: 'text-green-600 dark:text-green-400', border: 'border-green-500/30' },
  tasksAndChecklist: { bg: 'bg-rose-500/10', icon: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/30' },
  einleitung: { bg: 'bg-slate-500/10', icon: 'text-slate-600 dark:text-slate-400', border: 'border-slate-500/30' },
  content: { bg: 'bg-slate-500/10', icon: 'text-slate-600 dark:text-slate-400', border: 'border-slate-500/30' },
};

export function ScenarioViewer({
  scenarios, currentIndex, onIndexChange, scenarioText, hintText, initialAnswers,
  traineeId, enablerId
}: ScenarioViewerProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSectionIndex, setModalSectionIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [visitedMap, setVisitedMap] = useState<Record<string, number[]>>({}); // Key: "enablerId-scenarioIndex" Value: [sectionIndices]
  const { t } = useLanguage();

  const storageKey = useMemo(() => `visited-sections-${traineeId}`, [traineeId]);

  // Load from localStorage
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        setVisitedMap(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse visited sections from localStorage', e);
      }
    }
  }, [storageKey]);

  // Save to localStorage
  const updateVisited = useCallback((scenarioIdx: number, sectionIdx: number) => {
    const key = `${enablerId}-${scenarioIdx}`;
    setVisitedMap(prev => {
      const current = prev[key] || [0];
      if (current.includes(sectionIdx)) return prev;
      const next = { ...prev, [key]: [...current, sectionIdx] };
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  }, [enablerId, storageKey]);

  const normalizedScenarios: Scenario[] = useMemo(() => {
    if (Array.isArray(scenarios) && scenarios.length > 0) return scenarios;
    if (scenarioText) return [{ text: scenarioText, hint: hintText }];
    return [];
  }, [scenarios, scenarioText, hintText]);

  const currentScenario = normalizedScenarios[currentIndex];
  
  // Convert database sections to ParsedScenario format
  const parsedScenario: ParsedScenario = useMemo(() => {
    if (!currentScenario) return { sections: [], rawText: '', hint: undefined };
    
    // If we have pre-structured sections from DB, use them directly
    const dbSections = currentScenario.sections;
    if (dbSections && (dbSections.behandelteThemen?.length || dbSections.theoretischeGrundlagen || dbSections.aufgaben?.length)) {
      const sections: ScenarioSection[] = [];
      let order = 0;
      
      // Section 1: Overview & Goals
      const overviewContent: string[] = [];
      if (dbSections.behandelteThemen?.length) {
        overviewContent.push('**Behandelte Themen:**\n' + dbSections.behandelteThemen.map(t => `• ${t}`).join('\n'));
      }
      if (dbSections.lernziele?.length) {
        overviewContent.push('**Lernziele:**\n' + dbSections.lernziele.map(l => `• ${l}`).join('\n'));
      }
      if (overviewContent.length > 0) {
        sections.push({
          key: 'overviewAndGoals',
          title: 'Überblick & Lernziele',
          titleKey: 'scenario.section.overviewAndGoals',
          icon: 'Target',
          content: overviewContent.join('\n\n'),
          type: 'mixed' as ContentType,
          order: order++,
        });
      }
      
      // Section 2: Theory & Context (with HTML tables!)
      const theoryContent: string[] = [];
      if (dbSections.theoretischeGrundlagen) {
        theoryContent.push(dbSections.theoretischeGrundlagen);
      }
      if (dbSections.ausgangslage) {
        theoryContent.push('**Ausgangslage:**\n' + dbSections.ausgangslage);
      }
      if (theoryContent.length > 0) {
        sections.push({
          key: 'theoryAndContext',
          title: 'Theorie & Kontext',
          titleKey: 'scenario.section.theoryAndContext',
          icon: 'BookOpen',
          content: theoryContent.join('\n\n'),
          type: 'paragraph' as ContentType,
          order: order++,
        });
      }
      
      // Section 3: Tasks (without solutions!)
      if (dbSections.aufgaben?.length) {
        const tasksContent = dbSections.aufgaben.map((task, i) => {
          const parts: string[] = [];
          parts.push(`**${task.title || `Aufgabe ${task.number}`}**`);
          if (task.scenario) parts.push(task.scenario);
          if (task.task) parts.push('**Aufgabe:** ' + task.task);
          return parts.join('\n');
        }).join('\n\n---\n\n');
        
        sections.push({
          key: 'tasks',
          title: 'Aufgaben',
          titleKey: 'scenario.section.tasks',
          icon: 'ClipboardList',
          content: tasksContent,
          type: 'paragraph' as ContentType,
          order: order++,
        });
      }
      
      // Section 4: Checklist
      const checklistItems = dbSections.checkliste?.length ? dbSections.checkliste : [
        'Ich habe das Szenario vollständig gelesen und verstanden',
        'Ich habe die Kernkonzepte identifiziert',
        'Ich habe die Aufgabenstellung verstanden',
        'Ich habe mögliche Lösungsansätze überlegt',
        'Ich bin bereit, die Aufgabe zu bearbeiten',
      ];
      sections.push({
        key: 'checklist',
        title: 'Checkliste',
        titleKey: 'scenario.section.checklist',
        icon: 'CheckSquare',
        content: checklistItems.map(item => `[ ] ${item}`).join('\n'),
        type: 'checklist' as ContentType,
        order: order++,
      });
      
      // Section 5: Solutions (GATED - with HTML tables!)
      if (dbSections.loesungen?.length) {
        const solutionsContent = dbSections.loesungen.map((sol, i) => {
          return `**Lösung ${sol.problemNumber}: ${sol.title}**\n${sol.content}`;
        }).join('\n\n---\n\n');
        
        sections.push({
          key: 'solutions',
          title: 'Lösungen',
          titleKey: 'scenario.section.solutions',
          icon: 'Lightbulb',
          content: solutionsContent,
          type: 'paragraph' as ContentType,
          order: order++,
          isGated: true,
        });
      }
      
      return { sections, rawText: currentScenario.text, hint: currentScenario.hint };
    }
    
    // Fallback: parse text if no structured sections
    return parseScenarioText(currentScenario.text, currentScenario.hint);
  }, [currentScenario]);

  const currentVisitedSet = useMemo(() => {
    const key = `${enablerId}-${currentIndex}`;
    return new Set(visitedMap[key] || [0]);
  }, [visitedMap, enablerId, currentIndex]);

  const currentAnswer = useMemo(() =>
    initialAnswers?.find(a => a.scenarioIndex === currentIndex)?.text || '',
    [initialAnswers, currentIndex]);

  const canNavigateToSection = useCallback((idx: number) => {
    if (idx === 0) return true;
    return currentVisitedSet.has(idx - 1);
  }, [currentVisitedSet]);

  const openSection = (sectionIndex: number) => {
    setModalSectionIndex(sectionIndex);
    setModalOpen(true);
  };

  const startLearning = () => {
    setModalSectionIndex(0);
    setModalOpen(true);
  };


  if (!mounted) return null;
  if (normalizedScenarios.length === 0) return (
    <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-500">
      {t('scenario.noScenariosFound')}
    </div>
  );

  const hasSections = parsedScenario.sections.length > 0;

  return (
    <div className="space-y-4">
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

        {normalizedScenarios.length > 1 && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => onIndexChange(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0}
              className="p-2 rounded-lg border border-accent/20 hover:bg-accent/10 disabled:opacity-40 transition-all cursor-pointer">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1.5">
              {normalizedScenarios.map((_, idx) => (
                <button key={idx} type="button" onClick={() => onIndexChange(idx)}
                  className={`rounded-full transition-all cursor-pointer ${idx === currentIndex ? 'w-6 h-2 bg-accent' : 'w-2 h-2 bg-accent/20'}`} />
              ))}
            </div>
            <button type="button" onClick={() => onIndexChange(Math.min(normalizedScenarios.length - 1, currentIndex + 1))}
              disabled={currentIndex === normalizedScenarios.length - 1}
              className="p-2 rounded-lg border border-accent/20 hover:bg-accent/10 disabled:opacity-40 transition-all cursor-pointer">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <button type="button" onClick={startLearning}
        className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-gradient-to-r from-accent/20 via-accent/10 to-transparent border border-accent/30 hover:border-accent/50 hover:scale-[1.01] transition-all group cursor-pointer"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20 group-hover:bg-accent/30 transition-colors">
          <Play className="h-5 w-5 text-accent" />
        </div>
        <span className="font-semibold text-foreground group-hover:text-accent">
          {t('scenario.startScenario').replace('{number}', String(currentIndex + 1))}
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-accent transition-all group-hover:translate-x-1" />
      </button>

      {hasSections && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wide px-1">{t('scenario.sectionsOverview')}</p>
          <div className="space-y-1.5">
            {parsedScenario.sections.map((sec, idx) => {
              const Icon = ICON_MAP[sec.icon] || FileText;
              const clr = SECTION_COLORS[sec.key] || SECTION_COLORS.content;
              const title = t(sec.titleKey) || sec.title;
              const locked = !canNavigateToSection(idx);

              return (
                <button key={idx} type="button" onClick={() => !locked && openSection(idx)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${locked ? 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 opacity-70 cursor-not-allowed'
                    : `${clr.border} ${clr.bg} hover:bg-opacity-20 hover:hover:border-accent/40 hover:scale-[1.01] cursor-pointer`
                    }`} disabled={locked}>
                  <span className={`flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold ${locked ? 'bg-slate-200 dark:bg-slate-700 text-slate-400' : 'bg-background/50 text-muted-foreground'}`}>{idx + 1}</span>
                  <div className={`flex-shrink-0 ${locked ? 'text-slate-400' : clr.icon}`}>{locked ? <Lock className="h-4 w-4" /> : <Icon className="h-4 w-4" />}</div>
                  <span className={`flex-1 font-medium ${locked ? 'text-slate-400' : 'text-foreground/90'}`}>{title}</span>
                  {locked ? <Lock className="h-3.5 w-3.5 text-slate-300" /> : <ChevronRight className="h-4 w-4 text-muted-foreground/50" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {parsedScenario.hint && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
          <Info className="h-5 w-5 text-amber-600 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-amber-700 mb-1">{t('scenario.hint')}</h4>
            <p className="text-sm text-amber-800/80">{parsedScenario.hint}</p>
          </div>
        </div>
      )}

      <ScenarioModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        sections={parsedScenario.sections.length > 0 ? parsedScenario.sections : [{
          key: 'content', title: t('scenario.scenarioContent'), titleKey: 'scenario.scenarioContent', icon: 'FileText',
          content: currentScenario?.text || '', type: 'paragraph', order: 0,
        }]}
        initialSection={modalSectionIndex}
        scenarioNumber={currentIndex + 1}
        initialAnswer={currentAnswer}
        visitedSections={currentVisitedSet}
        onSectionVisit={(idx) => updateVisited(currentIndex, idx)}
      />
    </div>
  );
}

export default ScenarioViewer;
