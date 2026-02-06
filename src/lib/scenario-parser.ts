/**
 * Scenario Text Parser - v2
 * Parses raw scenario text into structured sections for display
 * Consolidates related content into logical groups
 */

export type ContentType = 'bullets' | 'numbered' | 'paragraph' | 'checklist' | 'problem-solution';

export interface ScenarioSection {
  key: string;
  title: string;
  icon: string;
  content: string;
  type: ContentType;
  order: number;
}

export interface ParsedScenario {
  sections: ScenarioSection[];
  hint?: string;
  rawText: string;
}

// Logical section groups with their detection patterns
// Order determines display order
const SECTION_DEFINITIONS = [
  {
    key: 'behandelteThemen',
    title: 'Behandelte Themen',
    icon: 'Tags',
    order: 1,
    headerPatterns: [/^behandelte\s*themen\s*:?$/i],
    defaultType: 'bullets' as ContentType,
  },
  {
    key: 'lernziele',
    title: 'Lernziele',
    icon: 'Target',
    order: 2,
    headerPatterns: [
      /^lernziele?\s*:?$/i,
      /^nach\s*diesem\s*szenario\s*können\s*sie\s*:?$/i,
    ],
    defaultType: 'bullets' as ContentType,
  },
  {
    key: 'theoretischeGrundlagen',
    title: 'Theoretische Grundlagen',
    icon: 'BookOpen',
    order: 3,
    headerPatterns: [/^theoretische\s*grundlagen\s*:?$/i],
    defaultType: 'paragraph' as ContentType,
  },
  {
    key: 'ausgangslage',
    title: 'Ausgangslage',
    icon: 'Compass',
    order: 4,
    headerPatterns: [/^ausgangslage\s*:?$/i, /^kontext\s*:?$/i],
    defaultType: 'paragraph' as ContentType,
  },
  {
    key: 'problemLoesungPaare',
    title: 'Aufgaben & Lösungen',
    icon: 'Lightbulb',
    order: 5,
    headerPatterns: [/^problem[\s-]*l[öo]sung[\s-]*paare?\s*:?$/i],
    defaultType: 'problem-solution' as ContentType,
  },
  {
    key: 'lernzielCheckliste',
    title: 'Lernziel-Checkliste',
    icon: 'CheckSquare',
    order: 6,
    headerPatterns: [
      /^lernziel[\s-]*checkliste\s*:?$/i,
      /^k[öo]nnen\s*sie\s*jetzt[\s.]*\??\s*$/i,
    ],
    defaultType: 'checklist' as ContentType,
  },
];

/**
 * Check if a line is a main section header
 */
function matchSectionHeader(line: string): typeof SECTION_DEFINITIONS[0] | null {
  const trimmed = line.trim();
  for (const def of SECTION_DEFINITIONS) {
    for (const pattern of def.headerPatterns) {
      if (pattern.test(trimmed)) {
        return def;
      }
    }
  }
  return null;
}

/**
 * Check if line is a separator (---, ___, etc.)
 */
function isSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  return /^[-_=]{3,}$/.test(trimmed);
}

/**
 * Detect content type from content
 */
function detectContentType(content: string, defaultType: ContentType): ContentType {
  const trimmed = content.trim();

  // Check for checklist markers
  if (/•\s*\[\s*\]|^\s*\[\s*\]/m.test(trimmed)) {
    return 'checklist';
  }

  // Check for problem-solution patterns
  if (/PROBLEM\s*\d+/i.test(trimmed)) {
    return 'problem-solution';
  }

  return defaultType;
}

/**
 * Parse raw scenario text into consolidated sections
 */
export function parseScenarioText(text: string, hint?: string): ParsedScenario {
  if (!text || typeof text !== 'string') {
    return { sections: [], hint, rawText: text || '' };
  }

  const lines = text.split('\n');
  const foundSections: Map<string, { def: typeof SECTION_DEFINITIONS[0]; content: string[] }> = new Map();

  let currentSection: { def: typeof SECTION_DEFINITIONS[0]; content: string[] } | null = null;
  const preambleContent: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Skip empty lines and separators
    if (!trimmedLine || isSeparatorLine(trimmedLine)) {
      if (currentSection && trimmedLine) {
        // Keep non-empty lines for content
      }
      continue;
    }

    // Check if this is a section header
    const matchedDef = matchSectionHeader(trimmedLine);

    if (matchedDef) {
      // Start new section or append to existing
      if (foundSections.has(matchedDef.key)) {
        currentSection = foundSections.get(matchedDef.key)!;
      } else {
        currentSection = { def: matchedDef, content: [] };
        foundSections.set(matchedDef.key, currentSection);
      }
    } else if (currentSection) {
      // Add line to current section
      currentSection.content.push(line);
    } else {
      // No section yet - this is preamble
      preambleContent.push(line);
    }
  }

  // Build sections array
  const sections: ScenarioSection[] = [];

  // Add preamble as introduction if exists
  const preambleText = preambleContent.join('\n').trim();
  if (preambleText && !foundSections.has('behandelteThemen')) {
    // Only add preamble if it's substantial and we don't have treated topics
    const lines = preambleText.split('\n').filter(l => l.trim());
    if (lines.length > 2) {
      sections.push({
        key: 'einleitung',
        title: 'Einleitung',
        icon: 'Info',
        content: preambleText,
        type: 'paragraph',
        order: 0,
      });
    }
  }

  // Convert found sections to array
  for (const [, { def, content }] of foundSections) {
    const contentText = content.join('\n').trim();
    if (contentText) {
      sections.push({
        key: def.key,
        title: def.title,
        icon: def.icon,
        content: contentText,
        type: detectContentType(contentText, def.defaultType),
        order: def.order,
      });
    }
  }

  // Sort by order
  sections.sort((a, b) => a.order - b.order);

  // If no sections found, return entire text as single section
  if (sections.length === 0) {
    sections.push({
      key: 'content',
      title: 'Inhalt',
      icon: 'FileText',
      content: text.trim(),
      type: 'paragraph',
      order: 0,
    });
  }

  return { sections, hint, rawText: text };
}

/**
 * Parse bullet list content into array of items
 */
export function parseBulletList(content: string): string[] {
  const lines = content.split('\n');
  const items: string[] = [];
  let currentItem = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[•\-\*]\s+/.test(trimmed)) {
      if (currentItem) items.push(currentItem.trim());
      currentItem = trimmed.replace(/^[•\-\*]\s+/, '');
    } else if (trimmed && currentItem) {
      currentItem += ' ' + trimmed;
    }
  }
  if (currentItem) items.push(currentItem.trim());
  return items;
}

/**
 * Parse numbered list content
 */
export function parseNumberedList(content: string): Array<{ number: string; text: string }> {
  const lines = content.split('\n');
  const items: Array<{ number: string; text: string }> = [];
  let currentItem: { number: string; text: string } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (match) {
      if (currentItem) items.push(currentItem);
      currentItem = { number: match[1], text: match[2] };
    } else if (trimmed && currentItem) {
      currentItem.text += ' ' + trimmed;
    }
  }
  if (currentItem) items.push(currentItem);
  return items;
}

/**
 * Parse checklist content
 */
export function parseChecklist(content: string): Array<{ text: string; checked: boolean }> {
  const lines = content.split('\n');
  const items: Array<{ text: string; checked: boolean }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^[•\-\*]?\s*\[\s*([xX])?\s*\]\s*(.*)$/);
    if (match) {
      items.push({ checked: !!match[1], text: match[2].trim() });
    }
  }
  return items;
}

/**
 * Parse problem-solution pairs - improved version
 */
export function parseProblemSolutionPairs(content: string): Array<{
  problemTitle: string;
  problem: string;
  solution: string;
}> {
  const pairs: Array<{ problemTitle: string; problem: string; solution: string }> = [];

  // Split content by PROBLEM markers
  const blocks = content.split(/(?=PROBLEM\s*\d+)/i);

  for (const block of blocks) {
    if (!block.trim()) continue;

    // Extract problem number and content
    const problemHeaderMatch = block.match(/^PROBLEM\s*(\d+)\s*:?\s*([^\n]*)/i);
    if (!problemHeaderMatch) continue;

    const problemNum = problemHeaderMatch[1];
    const problemTitle = problemHeaderMatch[2].trim() || `Problem ${problemNum}`;

    // Find the content between PROBLEM header and LÖSUNG
    const afterHeader = block.slice(problemHeaderMatch[0].length);
    const loesungIndex = afterHeader.search(/LÖSUNG\s*\d+/i);

    let problemContent = '';
    let solutionContent = '';

    if (loesungIndex >= 0) {
      problemContent = afterHeader.slice(0, loesungIndex).trim();
      const loesungMatch = afterHeader.slice(loesungIndex).match(/LÖSUNG\s*\d+\s*:?\s*([^\n]*)([\s\S]*)/i);
      if (loesungMatch) {
        solutionContent = (loesungMatch[1] + loesungMatch[2]).trim();
      }
    } else {
      problemContent = afterHeader.trim();
    }

    if (problemContent) {
      pairs.push({
        problemTitle,
        problem: problemContent,
        solution: solutionContent,
      });
    }
  }

  return pairs;
}

/**
 * Truncate text for preview
 */
export function truncateForPreview(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > maxLength * 0.7 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

/**
 * Get section icon
 */
export function getSectionIcon(key: string): string {
  const def = SECTION_DEFINITIONS.find(d => d.key === key);
  return def?.icon || 'FileText';
}
