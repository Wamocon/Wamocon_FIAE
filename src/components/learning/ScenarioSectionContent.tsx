'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Check, Tags, Target, BookOpen, Compass, Lightbulb, CheckSquare, ClipboardList, Unlock } from 'lucide-react';
import {
  ContentType,
  parseBulletList,
  parseNumberedList,
  parseChecklist,
  parseProblemSolutionPairs,
} from '@/lib/scenario-parser';
import { useLanguage } from '@/contexts/LanguageContext';

interface SubSection {
  key: string;
  title: string;
  titleKey: string;
  content: string;
  type: ContentType;
}

interface ScenarioSectionContentProps {
  content: string;
  type: ContentType;
  subSections?: SubSection[];
  sectionKey?: string;
  onChecklistComplete?: (completed: boolean) => void;
}

// Icon mapping for subsections
const SUB_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  behandelteThemen: Tags,
  lernziele: Target,
  theoretischeGrundlagen: BookOpen,
  ausgangslage: Compass,
  problemLoesungPaare: Lightbulb,
  lernzielCheckliste: CheckSquare,
  aufgaben: ClipboardList,
};

// Color mapping for subsections (light mode compatible)
const SUB_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  behandelteThemen: { bg: 'bg-blue-50 dark:bg-blue-500/10', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-200 dark:border-blue-500/20' },
  lernziele: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-500/20' },
  theoretischeGrundlagen: { bg: 'bg-purple-50 dark:bg-purple-500/10', text: 'text-purple-700 dark:text-purple-400', border: 'border-purple-200 dark:border-purple-500/20' },
  ausgangslage: { bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-500/20' },
  problemLoesungPaare: { bg: 'bg-rose-50 dark:bg-rose-500/10', text: 'text-rose-700 dark:text-rose-400', border: 'border-rose-200 dark:border-rose-500/20' },
  lernzielCheckliste: { bg: 'bg-cyan-50 dark:bg-cyan-500/10', text: 'text-cyan-700 dark:text-cyan-400', border: 'border-cyan-200 dark:border-cyan-500/20' },
  aufgaben: { bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-500/20' },
};

/**
 * Renders bullet list content with styled bullets (light mode compatible)
 */
function BulletListContent({ content }: { content: string }) {
  const items = parseBulletList(content);

  if (items.length === 0) {
    return <ParagraphContent content={content} />;
  }

  return (
    <ul className="space-y-3">
      {items.map((item, idx) => (
        <li key={idx} className="flex items-start gap-3">
          <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-accent/60" />
          <span className="text-slate-800 dark:text-slate-200 leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Renders numbered list content with styled numbers (light mode compatible)
 */
function NumberedListContent({ content }: { content: string }) {
  const items = parseNumberedList(content);

  if (items.length === 0) {
    return <ParagraphContent content={content} />;
  }

  return (
    <ol className="space-y-4">
      {items.map((item, idx) => (
        <li key={idx} className="flex items-start gap-4">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-accent/20 text-sm font-semibold text-accent">
            {item.number}
          </span>
          <span className="text-slate-800 dark:text-slate-200 leading-relaxed pt-0.5">{item.text}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Check if content contains HTML tags that need to be rendered
 */
function containsHtml(content: string): boolean {
  return /<(table|ul|ol|p|div|br|strong|em|b|i|h[1-6])[^>]*>/i.test(content);
}

/**
 * Renders HTML content safely (for imported tables etc.)
 */
function HtmlContent({ content }: { content: string }) {
  return (
    <div 
      className="prose prose-slate dark:prose-invert max-w-none text-slate-800 dark:text-slate-200 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_th]:bg-slate-100 [&_th]:dark:bg-slate-700 [&_th]:border [&_th]:border-slate-300 [&_th]:dark:border-slate-600 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-slate-300 [&_td]:dark:border-slate-600 [&_td]:px-3 [&_td]:py-2 [&_tr:nth-child(even)]:bg-slate-50 [&_tr:nth-child(even)]:dark:bg-slate-800/50"
      dangerouslySetInnerHTML={{ __html: content }} 
    />
  );
}

/**
 * Renders text that may contain HTML - used for inline content in cards
 */
function TextOrHtml({ content, className }: { content: string; className?: string }) {
  if (containsHtml(content)) {
    return (
      <div 
        className={`prose prose-slate dark:prose-invert max-w-none [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_th]:bg-slate-100 [&_th]:dark:bg-slate-700 [&_th]:border [&_th]:border-slate-300 [&_th]:dark:border-slate-600 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-slate-300 [&_td]:dark:border-slate-600 [&_td]:px-3 [&_td]:py-2 [&_tr:nth-child(even)]:bg-slate-50 [&_tr:nth-child(even)]:dark:bg-slate-800/50 ${className || ''}`}
        dangerouslySetInnerHTML={{ __html: content }} 
      />
    );
  }
  return (
    <p className={`whitespace-pre-wrap ${className || ''}`}>
      {content}
    </p>
  );
}

/**
 * Renders paragraph content with proper formatting (light mode compatible)
 * Supports HTML content like tables
 */
function ParagraphContent({ content }: { content: string }) {
  // If content contains HTML, render it as HTML
  if (containsHtml(content)) {
    return <HtmlContent content={content} />;
  }

  // Split by double newlines to create paragraphs
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim());

  return (
    <div className="space-y-4">
      {paragraphs.map((paragraph, idx) => (
        <p key={idx} className="text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
          {paragraph.trim()}
        </p>
      ))}
    </div>
  );
}

/**
 * Renders checklist with interactive checkboxes (light mode compatible)
 * With special "Have you answered all questions?" item for gating
 */
function ChecklistContent({
  content,
  onChecklistComplete,
  includeFinalQuestion = false
}: {
  content: string;
  onChecklistComplete?: (completed: boolean) => void;
  includeFinalQuestion?: boolean;
}) {
  const { t } = useLanguage();
  const initialItems = parseChecklist(content);

  // Add the special "answered all questions" item if needed
  const allItems = includeFinalQuestion
    ? [...initialItems, { text: t('scenario.haveYouAnsweredAll'), checked: false }]
    : initialItems;

  const [checkedStates, setCheckedStates] = useState<boolean[]>(
    allItems.map(item => item.checked)
  );

  // Report completion status to parent
  useEffect(() => {
    if (onChecklistComplete) {
      const allChecked = checkedStates.every(Boolean);
      onChecklistComplete(allChecked);
    }
  }, [checkedStates, onChecklistComplete]);

  if (allItems.length === 0) {
    return <ParagraphContent content={content} />;
  }

  const toggleItem = (index: number) => {
    setCheckedStates(prev => {
      const newStates = [...prev];
      newStates[index] = !newStates[index];
      return newStates;
    });
  };

  const completedCount = checkedStates.filter(Boolean).length;
  const allCompleted = checkedStates.every(Boolean);

  return (
    <div className="space-y-4">
      {/* Progress indicator */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <div className="h-2 flex-1 rounded-full bg-accent/10 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${allCompleted ? 'bg-green-500' : 'bg-accent/60'}`}
            style={{ width: `${(completedCount / allItems.length) * 100}%` }}
          />
        </div>
        <span className={allCompleted ? 'text-green-600 dark:text-green-400 font-medium' : ''}>
          {allCompleted
            ? `✓ ${t('scenario.checklistComplete')}`
            : t('scenario.completed').replace('{count}', String(completedCount)).replace('{total}', String(allItems.length))
          }
        </span>
      </div>

      {/* Checklist items */}
      <ul className="space-y-3">
        {allItems.map((item, idx) => {
          const isSpecialItem = includeFinalQuestion && idx === allItems.length - 1;
          return (
            <li key={idx} className={`flex items-start gap-3 ${isSpecialItem ? 'mt-4 pt-4 border-t border-slate-200 dark:border-slate-700' : ''}`}>
              <button
                type="button"
                onClick={() => toggleItem(idx)}
                className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-all ${checkedStates[idx]
                    ? isSpecialItem ? 'border-green-500 bg-green-500 text-white' : 'border-accent bg-accent text-white'
                    : isSpecialItem ? 'border-green-400/60 hover:border-green-500 bg-white dark:bg-transparent' : 'border-accent/40 hover:border-accent/60 bg-white dark:bg-transparent'
                  }`}
              >
                {checkedStates[idx] && <Check className="h-3 w-3" />}
              </button>
              <span
                className={`leading-relaxed transition-colors ${checkedStates[idx]
                    ? 'text-slate-400 dark:text-slate-500 line-through'
                    : isSpecialItem
                      ? 'text-slate-900 dark:text-slate-100 font-medium'
                      : 'text-slate-800 dark:text-slate-200'
                  }`}
              >
                {item.text}
                {isSpecialItem && !checkedStates[idx] && (
                  <span className="ml-2 text-xs text-green-600 dark:text-green-400">
                    ({t('scenario.unlocksSolutions')})
                  </span>
                )}
                {isSpecialItem && checkedStates[idx] && (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                    <Unlock className="w-3 h-3" />
                    {t('scenario.solutionsUnlocked')}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Completion celebration message */}
      {allCompleted && includeFinalQuestion && (
        <div className="mt-4 p-4 rounded-xl bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20">
          <p className="text-green-700 dark:text-green-400 font-medium flex items-center gap-2">
            <Unlock className="w-5 h-5" />
            {t('scenario.solutionsNowAvailable')}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Renders problem-solution pairs with collapsible solutions (light mode compatible)
 */
function ProblemSolutionContent({ content }: { content: string }) {
  const { t } = useLanguage();
  const pairs = parseProblemSolutionPairs(content);
  const [expandedSolutions, setExpandedSolutions] = useState<Set<number>>(new Set());

  // If no pairs found, try to display as paragraph
  if (pairs.length === 0) {
    return <ParagraphContent content={content} />;
  }

  const toggleSolution = (index: number) => {
    setExpandedSolutions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  return (
    <div className="space-y-5">
      {pairs.map((pair, idx) => (
        <div
          key={idx}
          className="rounded-xl border border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/5 overflow-hidden"
        >
          {/* Problem header */}
          <div className="p-4 border-b border-rose-200 dark:border-rose-500/10">
            <div className="flex items-center gap-2 mb-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-200 dark:bg-rose-500/20 text-xs font-bold text-rose-700 dark:text-rose-400">
                {idx + 1}
              </span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {pair.problemTitle || t('scenario.task').replace('{number}', String(idx + 1))}
              </span>
            </div>
            <div className="pl-9">
              <TextOrHtml content={pair.problem} className="text-slate-700 dark:text-slate-300 leading-relaxed" />
            </div>
          </div>

          {/* Solution toggle */}}
          {pair.solution && (
            <div>
              <button
                type="button"
                onClick={() => toggleSolution(idx)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-green-50 dark:hover:bg-green-500/5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-green-200 dark:bg-green-500/20 text-xs font-bold text-green-700 dark:text-green-400">
                    ✓
                  </span>
                  <span className="text-sm font-medium text-green-700 dark:text-green-400">{t('scenario.showSolution')}</span>
                </div>
                {expandedSolutions.has(idx) ? (
                  <ChevronDown className="h-4 w-4 text-green-700 dark:text-green-400" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-green-700 dark:text-green-400" />
                )}
              </button>

              {/* Solution content */}
              <div
                className={`overflow-hidden transition-all duration-300 ${expandedSolutions.has(idx) ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
                  }`}
              >
                <div className="px-4 pb-4 border-t border-green-200 dark:border-green-500/10 pt-3 bg-green-50 dark:bg-green-500/5">
                  <TextOrHtml content={pair.solution} className="text-slate-700 dark:text-slate-300 leading-relaxed" />
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Renders only the problems/tasks without solutions (for Tasks section)
 */
function ProblemsOnlyContent({ content }: { content: string }) {
  const { t } = useLanguage();
  const pairs = parseProblemSolutionPairs(content);

  // If no pairs found, try to display as numbered list or paragraph
  if (pairs.length === 0) {
    // EXTRA SAFETY: If we find any variation of "LÖSUNG" in the text, 
    // split the content and only show the part before it.
    const loesungRegex = /\n?\s*L[OÖ][E]?SUNG\s*:?/i;
    if (loesungRegex.test(content)) {
      const parts = content.split(loesungRegex);
      return <ParagraphContent content={parts[0]} />;
    }

    const lines = content.split('\n').filter(l => l.trim());
    const hasNumbers = lines.some(l => /^\d+\.\s+/.test(l.trim()));

    if (hasNumbers) {
      return <NumberedListContent content={content} />;
    }
    return <ParagraphContent content={content} />;
  }

  return (
    <div className="space-y-5">
      {pairs.map((pair, idx) => (
        <div
          key={idx}
          className="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/5 overflow-hidden"
        >
          {/* Task header */}
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-200 dark:bg-amber-500/20 text-xs font-bold text-amber-700 dark:text-amber-400">
                {idx + 1}
              </span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {pair.problemTitle || t('scenario.task').replace('{number}', String(idx + 1))}
              </span>
            </div>
            {/* Show the problem/task description - NOT the solution */}
            {pair.problem && (
              <div className="pl-9">
                <TextOrHtml content={pair.problem} className="text-slate-700 dark:text-slate-300 leading-relaxed" />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Renders only the solutions (for Solutions section, after unlock)
 */
function SolutionsOnlyContent({ content }: { content: string }) {
  const { t } = useLanguage();
  const pairs = parseProblemSolutionPairs(content);

  // If no pairs found, try to display as paragraph
  if (pairs.length === 0) {
    return <ParagraphContent content={content} />;
  }

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-xl bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 mb-6">
        <p className="text-green-700 dark:text-green-400 font-medium flex items-center gap-2">
          <Check className="w-5 h-5" />
          {t('scenario.solutionsHeader')}
        </p>
      </div>

      {pairs.map((pair, idx) => (
        <div
          key={idx}
          className="rounded-xl border border-green-200 dark:border-green-500/20 bg-green-50 dark:bg-green-500/5 overflow-hidden"
        >
          {/* Solution header */}
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-green-200 dark:bg-green-500/20 text-xs font-bold text-green-700 dark:text-green-400">
                {idx + 1}
              </span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {pair.problemTitle || t('scenario.solution').replace('{number}', String(idx + 1))}
              </span>
            </div>
            {pair.solution && (
              <div className="pl-9">
                <TextOrHtml content={pair.solution} className="text-slate-700 dark:text-slate-300 leading-relaxed" />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Renders content for a single subsection
 */
function SubSectionContent({
  subSection,
  isInChecklistSection = false,
  onChecklistComplete
}: {
  subSection: SubSection;
  isInChecklistSection?: boolean;
  onChecklistComplete?: (completed: boolean) => void;
}) {
  const { t } = useLanguage();
  const IconComponent = SUB_ICON_MAP[subSection.key];
  const colors = SUB_COLORS[subSection.key] || { bg: 'bg-slate-50 dark:bg-slate-500/10', text: 'text-slate-700 dark:text-slate-400', border: 'border-slate-200 dark:border-slate-500/20' };
  const title = t(subSection.titleKey) || subSection.title;

  return (
    <div className={`rounded-xl border ${colors.border} ${colors.bg} p-4`}>
      <div className="flex items-center gap-2 mb-3">
        {IconComponent && <IconComponent className={`h-5 w-5 ${colors.text}`} />}
        <h4 className={`font-semibold ${colors.text}`}>{title}</h4>
      </div>
      <div className="pl-7">
        {subSection.type === 'bullets' && <BulletListContent content={subSection.content} />}
        {subSection.type === 'numbered' && <NumberedListContent content={subSection.content} />}
        {subSection.type === 'checklist' && (
          <ChecklistContent
            content={subSection.content}
            onChecklistComplete={isInChecklistSection ? onChecklistComplete : undefined}
            includeFinalQuestion={isInChecklistSection}
          />
        )}
        {/* IMPORTANT: problem-solution in subsections should render as paragraph (no toggle) */}
        {/* Solution toggles should ONLY appear in the dedicated Solutions section */}
        {subSection.type === 'problem-solution' && <ParagraphContent content={subSection.content} />}
        {subSection.type === 'problems-only' && <ProblemsOnlyContent content={subSection.content} />}
        {subSection.type === 'solutions-only' && <SolutionsOnlyContent content={subSection.content} />}
        {(subSection.type === 'paragraph' || subSection.type === 'mixed') && <ParagraphContent content={subSection.content} />}
      </div>
    </div>
  );
}

/**
 * Main component that renders section content based on type (with subsection support)
 */
export function ScenarioSectionContent({
  content,
  type,
  subSections,
  sectionKey,
  onChecklistComplete
}: ScenarioSectionContentProps) {
  const { t } = useLanguage();

  if (!content && (!subSections || subSections.length === 0)) {
    return (
      <p className="text-slate-400 dark:text-slate-500 italic">{t('scenario.noContent')}</p>
    );
  }

  // If we have subsections, render them grouped nicely
  if (subSections && subSections.length > 0) {
    const isChecklistSection = sectionKey === 'checklist';
    return (
      <div className="space-y-6">
        {subSections.map((subSection, idx) => (
          <SubSectionContent
            key={`${subSection.key}-${idx}`}
            subSection={subSection}
            isInChecklistSection={isChecklistSection}
            onChecklistComplete={isChecklistSection ? onChecklistComplete : undefined}
          />
        ))}
      </div>
    );
  }

  // Otherwise render content based on type
  switch (type) {
    case 'bullets':
      return <BulletListContent content={content} />;
    case 'numbered':
      return <NumberedListContent content={content} />;
    case 'checklist':
      // If this is the checklist section, include the special final question
      const isChecklistSection = sectionKey === 'checklist';
      return (
        <ChecklistContent
          content={content}
          onChecklistComplete={onChecklistComplete}
          includeFinalQuestion={isChecklistSection}
        />
      );
    case 'problem-solution':
      return <ProblemSolutionContent content={content} />;
    case 'problems-only':
      return <ProblemsOnlyContent content={content} />;
    case 'solutions-only':
      return <SolutionsOnlyContent content={content} />;
    case 'paragraph':
    case 'mixed':
    default:
      return <ParagraphContent content={content} />;
  }
}

export default ScenarioSectionContent;
