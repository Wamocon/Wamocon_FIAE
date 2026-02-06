'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Check } from 'lucide-react';
import {
  ContentType,
  parseBulletList,
  parseNumberedList,
  parseChecklist,
  parseProblemSolutionPairs,
} from '@/lib/scenario-parser';

interface ScenarioSectionContentProps {
  content: string;
  type: ContentType;
}

/**
 * Renders bullet list content with styled bullets
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
          <span className="text-foreground/90 leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Renders numbered list content with styled numbers
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
          <span className="text-foreground/90 leading-relaxed pt-0.5">{item.text}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Renders paragraph content with proper formatting
 */
function ParagraphContent({ content }: { content: string }) {
  // Split by double newlines to create paragraphs
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim());

  return (
    <div className="space-y-4">
      {paragraphs.map((paragraph, idx) => (
        <p key={idx} className="text-foreground/90 leading-relaxed whitespace-pre-wrap">
          {paragraph.trim()}
        </p>
      ))}
    </div>
  );
}

/**
 * Renders checklist with interactive checkboxes (local state only)
 */
function ChecklistContent({ content }: { content: string }) {
  const initialItems = parseChecklist(content);
  const [checkedStates, setCheckedStates] = useState<boolean[]>(
    initialItems.map(item => item.checked)
  );

  if (initialItems.length === 0) {
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

  return (
    <div className="space-y-4">
      {/* Progress indicator */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <div className="h-2 flex-1 rounded-full bg-accent/10 overflow-hidden">
          <div
            className="h-full bg-accent/60 transition-all duration-300"
            style={{ width: `${(completedCount / initialItems.length) * 100}%` }}
          />
        </div>
        <span>{completedCount} von {initialItems.length}</span>
      </div>

      {/* Checklist items */}
      <ul className="space-y-3">
        {initialItems.map((item, idx) => (
          <li key={idx} className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => toggleItem(idx)}
              className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-all ${
                checkedStates[idx]
                  ? 'border-accent bg-accent text-foreground'
                  : 'border-accent/40 hover:border-accent/60'
              }`}
            >
              {checkedStates[idx] && <Check className="h-3 w-3" />}
            </button>
            <span
              className={`leading-relaxed transition-colors ${
                checkedStates[idx] ? 'text-muted-foreground line-through' : 'text-foreground/90'
              }`}
            >
              {item.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Renders problem-solution pairs with collapsible solutions
 */
function ProblemSolutionContent({ content }: { content: string }) {
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
          className="rounded-xl border border-rose-500/20 bg-rose-500/5 overflow-hidden"
        >
          {/* Problem header */}
          <div className="p-4 border-b border-rose-500/10">
            <div className="flex items-center gap-2 mb-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/20 text-xs font-bold text-rose-400">
                {idx + 1}
              </span>
              <span className="font-semibold text-foreground">
                {pair.problemTitle || `Aufgabe ${idx + 1}`}
              </span>
            </div>
            <p className="text-foreground/90 leading-relaxed whitespace-pre-wrap pl-9">
              {pair.problem}
            </p>
          </div>

          {/* Solution toggle */}
          {pair.solution && (
            <div>
              <button
                type="button"
                onClick={() => toggleSolution(idx)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-green-500/5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-green-500/20 text-xs font-bold text-green-400">
                    ✓
                  </span>
                  <span className="text-sm font-medium text-green-400">Lösung anzeigen</span>
                </div>
                {expandedSolutions.has(idx) ? (
                  <ChevronDown className="h-4 w-4 text-green-400" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-green-400" />
                )}
              </button>

              {/* Solution content */}
              <div
                className={`overflow-hidden transition-all duration-300 ${
                  expandedSolutions.has(idx) ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <div className="px-4 pb-4 border-t border-green-500/10 pt-3 bg-green-500/5">
                  <p className="text-foreground/90 leading-relaxed whitespace-pre-wrap">
                    {pair.solution}
                  </p>
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
 * Main component that renders section content based on type
 */
export function ScenarioSectionContent({ content, type }: ScenarioSectionContentProps) {
  if (!content) {
    return (
      <p className="text-muted-foreground italic">Kein Inhalt verfügbar</p>
    );
  }

  switch (type) {
    case 'bullets':
      return <BulletListContent content={content} />;
    case 'numbered':
      return <NumberedListContent content={content} />;
    case 'checklist':
      return <ChecklistContent content={content} />;
    case 'problem-solution':
      return <ProblemSolutionContent content={content} />;
    case 'paragraph':
    default:
      return <ParagraphContent content={content} />;
  }
}

export default ScenarioSectionContent;
