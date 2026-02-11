'use client';

import {
  Tags,
  Target,
  BookOpen,
  Compass,
  Lightbulb,
  CheckSquare,
  FileText,
  Info,
  ChevronRight,
} from 'lucide-react';
import { ScenarioSection, truncateForPreview } from '@/lib/scenario-parser';

interface ScenarioSectionCardProps {
  section: ScenarioSection;
  index: number;
  onClick: () => void;
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
 * Get the appropriate icon component for a section
 */
function getSectionIconComponent(iconName: string) {
  return ICON_MAP[iconName] || FileText;
}

/**
 * Get accent color class based on section type
 */
function getSectionAccentColor(key: string): string {
  const colorMap: Record<string, string> = {
    behandelteThemen: 'from-blue-500/20 to-blue-600/20 border-blue-500/30',
    lernziele: 'from-emerald-500/20 to-emerald-600/20 border-emerald-500/30',
    theoretischeGrundlagen: 'from-purple-500/20 to-purple-600/20 border-purple-500/30',
    ausgangslage: 'from-amber-500/20 to-amber-600/20 border-amber-500/30',
    problemLoesungPaare: 'from-rose-500/20 to-rose-600/20 border-rose-500/30',
    lernzielCheckliste: 'from-cyan-500/20 to-cyan-600/20 border-cyan-500/30',
  };

  return colorMap[key] || 'from-accent/20 to-accent/30 border-accent/30';
}

/**
 * Get icon background color based on section type
 */
function getIconBgColor(key: string): string {
  const colorMap: Record<string, string> = {
    behandelteThemen: 'bg-blue-500/20 text-blue-400',
    lernziele: 'bg-emerald-500/20 text-emerald-400',
    theoretischeGrundlagen: 'bg-purple-500/20 text-purple-400',
    ausgangslage: 'bg-amber-500/20 text-amber-400',
    problemLoesungPaare: 'bg-rose-500/20 text-rose-400',
    lernzielCheckliste: 'bg-cyan-500/20 text-cyan-400',
  };

  return colorMap[key] || 'bg-accent/20 text-accent';
}

/**
 * Clickable preview card for a scenario section
 */
export function ScenarioSectionCard({ section, index, onClick }: ScenarioSectionCardProps) {
  const IconComponent = getSectionIconComponent(section.icon);
  const accentColor = getSectionAccentColor(section.key);
  const iconBgColor = getIconBgColor(section.key);
  const previewText = truncateForPreview(section.content, 100);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        group relative w-full text-left
        rounded-2xl border bg-gradient-to-br p-4
        transition-all duration-300
        hover:shadow-lg hover:shadow-accent/5
        hover:scale-[1.02] hover:border-accent/40
        focus:outline-none focus:ring-2 focus:ring-accent/50 focus:ring-offset-2 focus:ring-offset-background
        ${accentColor}
      `}
    >
      {/* Section number badge */}
      <div className="absolute -top-2 -left-2 flex h-6 w-6 items-center justify-center rounded-full bg-background border border-accent/30 text-xs font-bold text-accent shadow-md">
        {index + 1}
      </div>

      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`flex-shrink-0 rounded-xl p-2.5 ${iconBgColor}`}>
          <IconComponent className="h-5 w-5" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-foreground mb-1 group-hover:text-accent transition-colors">
            {section.title}
          </h4>
          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
            {previewText}
          </p>
        </div>

        {/* Arrow indicator */}
        <div className="flex-shrink-0 self-center opacity-0 group-hover:opacity-100 transition-opacity">
          <ChevronRight className="h-5 w-5 text-accent" />
        </div>
      </div>

      {/* Content type indicator */}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-muted-foreground/60 uppercase tracking-wide">
          {getContentTypeLabel(section.type)}
        </span>
      </div>
    </button>
  );
}

/**
 * Get human-readable label for content type
 */
function getContentTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    bullets: 'Liste',
    numbered: 'Nummeriert',
    paragraph: 'Text',
    checklist: 'Checkliste',
    'problem-solution': 'Aufgaben',
  };

  return labels[type] || 'Inhalt';
}

export default ScenarioSectionCard;
