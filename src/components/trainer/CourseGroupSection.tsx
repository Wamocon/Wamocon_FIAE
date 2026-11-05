'use client';

import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  courseHeading,
  type CourseGroup,
} from '@/lib/trainer/trainee-detail-view';

/**
 * A list of items grouped by course: every course is a section that opens and
 * closes, with a counter next to the title. Used on the trainee detail page
 * for the lesson quizzes, the use cases and the summaries, which can have
 * hundreds of entries. The groups arrive in the order of the training plan.
 */
export function CourseGroupSection<T>({
  groups,
  defaultOpen,
  counter,
  children,
  testIdPrefix,
}: {
  groups: CourseGroup<T>[];
  /** Whether a course starts open (the user can still toggle every one). */
  defaultOpen: boolean;
  /** The text next to the title of a course, for example "3 von 9 bearbeitet". */
  counter: (items: T[]) => string;
  children: (items: T[]) => ReactNode;
  testIdPrefix: string;
}) {
  // the courses the user flipped away from the default
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setFlipped(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-3">
      {groups.map(group => {
        const isOpen = defaultOpen !== flipped.has(group.key);
        const panelId = `${testIdPrefix}-${group.key}`;
        return (
          <div
            key={group.key}
            data-testid={`${testIdPrefix}-group`}
            className="border-accent/20 rounded-xl border"
          >
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => toggle(group.key)}
              className="hover:bg-accent/5 flex w-full cursor-pointer items-center gap-3 rounded-xl p-3 text-left transition-colors"
            >
              <ChevronRight
                className={`text-muted-foreground h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
              />
              <span className="text-foreground min-w-0 flex-1 text-sm font-semibold">
                {courseHeading(group, groups)}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {counter(group.items)}
              </span>
            </button>
            {isOpen && (
              <div id={panelId} className="px-3 pb-3">
                {children(group.items)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
