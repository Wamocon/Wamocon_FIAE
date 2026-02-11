/**
 * Scenario Text Parser - v3
 * Parses raw scenario text into structured sections for display
 * Consolidates related content into logical groups (merged version)
 * Flow: Overview → Theory → Tasks → Checklist → Solutions (gated)
 */

export type ContentType = 'bullets' | 'numbered' | 'paragraph' | 'checklist' | 'problem-solution' | 'problems-only' | 'solutions-only' | 'mixed';

export interface ScenarioSection {
  key: string;
  title: string;
  titleKey: string; // Translation key for the title
  icon: string;
  content: string;
  type: ContentType;
  order: number;
  isGated?: boolean; // If true, section is locked until checklist is complete
  subSections?: Array<{
    key: string;
    title: string;
    titleKey: string;
    content: string;
    type: ContentType;
  }>;
}

export interface ParsedScenario {
  sections: ScenarioSection[];
  hint?: string;
  rawText: string;
}

// Original section definitions for parsing
const SECTION_DEFINITIONS = [
  {
    key: 'behandelteThemen',
    title: 'Behandelte Themen',
    titleKey: 'scenario.section.topicsCovered',
    icon: 'Tags',
    order: 1,
    headerPatterns: [/^behandelte\s*themen\s*:?$/i],
    defaultType: 'bullets' as ContentType,
    mergeGroup: 'overviewAndGoals',
  },
  {
    key: 'lernziele',
    title: 'Lernziele',
    titleKey: 'scenario.section.learningObjectives',
    icon: 'Target',
    order: 2,
    headerPatterns: [
      /^lernziele?\s*:?$/i,
      /^nach\s*diesem\s*szenario\s*können\s*sie\s*:?$/i,
    ],
    defaultType: 'bullets' as ContentType,
    mergeGroup: 'overviewAndGoals',
  },
  {
    key: 'theoretischeGrundlagen',
    title: 'Theoretische Grundlagen',
    titleKey: 'scenario.section.theoreticalFoundations',
    icon: 'BookOpen',
    order: 3,
    headerPatterns: [/^theoretische\s*grundlagen\s*:?$/i],
    defaultType: 'paragraph' as ContentType,
    mergeGroup: 'theoryAndContext',
  },
  {
    key: 'ausgangslage',
    title: 'Ausgangslage',
    titleKey: 'scenario.section.initialSituation',
    icon: 'Compass',
    order: 4,
    headerPatterns: [/^ausgangslage\s*:?$/i, /^kontext\s*:?$/i],
    defaultType: 'paragraph' as ContentType,
    mergeGroup: 'theoryAndContext',
  },
  {
    key: 'problemLoesungPaare',
    title: 'Aufgaben & Lösungen',
    titleKey: 'scenario.section.tasksAndSolutions',
    icon: 'Lightbulb',
    order: 5,
    headerPatterns: [/^problem[\s-]*l[öo]sung[\s-]*paare?\s*:?$/i],
    defaultType: 'problem-solution' as ContentType,
    mergeGroup: 'tasks', // Now only tasks go here
  },
  {
    key: 'lernzielCheckliste',
    title: 'Lernziel-Checkliste',
    titleKey: 'scenario.section.learningGoalChecklist',
    icon: 'CheckSquare',
    order: 6,
    headerPatterns: [
      /^lernziel[\s-]*checkliste\s*:?$/i,
      /^k[öo]nnen\s*sie\s*jetzt[\s.]*\??\s*$/i,
    ],
    defaultType: 'checklist' as ContentType,
    mergeGroup: 'checklist', // Separate checklist section
  },
];

// Merged group definitions - 4 sections for better learning flow
const MERGED_GROUPS = {
  overviewAndGoals: {
    key: 'overviewAndGoals',
    titleKey: 'scenario.section.overviewAndGoals',
    icon: 'Target',
    order: 1,
  },
  theoryAndContext: {
    key: 'theoryAndContext',
    titleKey: 'scenario.section.theoryAndContext',
    icon: 'BookOpen',
    order: 2,
  },
  tasks: {
    key: 'tasks',
    titleKey: 'scenario.section.tasks',
    icon: 'ClipboardList',
    order: 3,
  },
  checklist: {
    key: 'checklist',
    titleKey: 'scenario.section.checklist',
    icon: 'CheckSquare',
    order: 4,
  },
  solutions: {
    key: 'solutions',
    titleKey: 'scenario.section.solutions',
    icon: 'Lightbulb',
    order: 5,
    isGated: true, // Locked until checklist is complete
  },
};

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

  // Check for problem-solution patterns (PROBLEM or numbered with LOESUNG/LÖSUNG)
  if (/PROBLEM\s*\d+/i.test(trimmed)) {
    return 'problem-solution';
  }

  // Check for numbered format with LOESUNG (e.g., "1. Title\nSzenario\n...\nLOESUNG")
  if (/^\d+\.\s+.+/m.test(trimmed) && /L[OÖ][E]?SUNG/i.test(trimmed)) {
    return 'problem-solution';
  }

  return defaultType;
}

/**
 * Check if text contains problem-solution patterns anywhere
 */
function containsProblemSolutionPatterns(text: string): boolean {
  // Check for PROBLEM markers or numbered items with LOESUNG/Lösung
  return /PROBLEM\s*\d+/i.test(text) ||
    (/^\d+\.\s+.+/m.test(text) && /L[OÖ][E]?SUNG/i.test(text)) ||
    /Aufgabe\s*:?\s*\n/i.test(text);
}

/**
 * Extract problem-solution content from text (even if embedded in other sections)
 */
function extractProblemSolutionContent(text: string): string | null {
  // Try to find PROBLEM blocks
  const problemMatches = text.match(/PROBLEM\s*\d+[\s\S]*?(?=PROBLEM\s*\d+|$)/gi);
  if (problemMatches && problemMatches.length > 0) {
    return problemMatches.join('\n\n');
  }

  // Try numbered format with LOESUNG
  if (/^\d+\.\s+.+/m.test(text) && /L[OÖ][E]?SUNG/i.test(text)) {
    return text;
  }

  return null;
}

/**
 * Parse raw scenario text into consolidated sections (merged groups)
 * Now provides meaningful structure for ALL scenarios, even without specific headers
 * Automatically detects and extracts PROBLEM/LOESUNG content from anywhere in the text
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

  // IMPORTANT: Check the ENTIRE text for problem-solution patterns
  // This ensures we always create Tasks/Solutions sections when problems exist
  const fullText = text.trim();
  const hasProblemSolutionAnywhere = containsProblemSolutionPatterns(fullText);
  let extractedProblemContent = hasProblemSolutionAnywhere ? extractProblemSolutionContent(fullText) : null;

  // Build merged sections
  const mergedGroups: Map<string, {
    groupDef: typeof MERGED_GROUPS[keyof typeof MERGED_GROUPS];
    subSections: Array<{
      key: string;
      title: string;
      titleKey: string;
      content: string;
      type: ContentType;
    }>;
  }> = new Map();

  // Track if we found explicit problem-solution section
  let hasExplicitProblems = false;
  let originalProblemContent = '';

  // Group sections by their merge group
  for (const [, { def, content }] of foundSections) {
    const contentText = content.join('\n').trim();
    if (!contentText) continue;

    const mergeGroup = def.mergeGroup;
    const groupDef = MERGED_GROUPS[mergeGroup as keyof typeof MERGED_GROUPS];

    // Special handling for explicit problem-solution pairs section
    if (def.key === 'problemLoesungPaare') {
      originalProblemContent = contentText;
      hasExplicitProblems = true;

      // Add tasks to the tasks group
      if (!mergedGroups.has('tasks')) {
        mergedGroups.set('tasks', {
          groupDef: MERGED_GROUPS.tasks,
          subSections: [],
        });
      }
      mergedGroups.get('tasks')!.subSections.push({
        key: 'aufgaben',
        title: 'Aufgaben',
        titleKey: 'scenario.section.tasks',
        content: contentText,
        type: 'problems-only' as ContentType,
      });
      continue;
    }

    if (!mergedGroups.has(mergeGroup)) {
      mergedGroups.set(mergeGroup, {
        groupDef,
        subSections: [],
      });
    }

    mergedGroups.get(mergeGroup)!.subSections.push({
      key: def.key,
      title: def.title,
      titleKey: def.titleKey,
      content: contentText,
      type: detectContentType(contentText, def.defaultType),
    });
  }

  // Build final sections array
  const sections: ScenarioSection[] = [];

  // Add preamble as introduction if exists and has meaningful content
  const preambleText = preambleContent.join('\n').trim();
  const preambleLines = preambleText.split('\n').filter(l => l.trim());

  // CASE 1: Structured scenario (with section headers found)
  if (foundSections.size > 0) {
    if (preambleLines.length > 2) {
      sections.push({
        key: 'einleitung',
        title: 'Einleitung',
        titleKey: 'scenario.section.introduction',
        icon: 'Info',
        content: preambleText,
        type: 'paragraph',
        order: 0,
      });
    }

    // Convert merged groups to sections
    for (const [groupKey, { groupDef, subSections }] of mergedGroups) {
      if (subSections.length === 0) continue;

      // Sort subsections by their original order
      subSections.sort((a, b) => {
        const aOrder = SECTION_DEFINITIONS.find(d => d.key === a.key)?.order || 0;
        const bOrder = SECTION_DEFINITIONS.find(d => d.key === b.key)?.order || 0;
        return aOrder - bOrder;
      });

      // Combine content from subsections
      const combinedContent = subSections.map(s => s.content).join('\n\n');

      // Determine primary type
      const types = [...new Set(subSections.map(s => s.type))];
      const primaryType: ContentType = types.length === 1 ? types[0] : 'mixed';

      sections.push({
        key: groupDef.key,
        title: groupDef.key,
        titleKey: groupDef.titleKey,
        icon: groupDef.icon,
        content: combinedContent,
        type: primaryType,
        order: groupDef.order,
        subSections,
      });
    }

    // If we found problem-solution content anywhere but no explicit section, add Tasks/Solutions
    if (!hasExplicitProblems && hasProblemSolutionAnywhere && extractedProblemContent) {
      // Add Tasks section
      sections.push({
        key: 'tasks',
        title: 'Aufgaben',
        titleKey: 'scenario.section.tasks',
        icon: 'ClipboardList',
        content: extractedProblemContent,
        type: 'problems-only' as ContentType,
        order: MERGED_GROUPS.tasks.order,
      });

      originalProblemContent = extractedProblemContent;
      hasExplicitProblems = true;
    }

    // Always add Checklist section for structured scenarios
    if (!sections.find(s => s.key === 'checklist')) {
      sections.push({
        key: 'checklist',
        title: 'Checkliste',
        titleKey: 'scenario.section.checklist',
        icon: 'CheckSquare',
        content: generateDefaultChecklist(fullText),
        type: 'checklist',
        order: MERGED_GROUPS.checklist.order,
      });
    }

    // Add Solutions section if we have problems (this section is gated)
    if (hasExplicitProblems && originalProblemContent) {
      sections.push({
        key: 'solutions',
        title: 'Lösungen',
        titleKey: 'scenario.section.solutions',
        icon: 'Lightbulb',
        content: originalProblemContent,
        type: 'solutions-only' as ContentType,
        order: MERGED_GROUPS.solutions.order,
        isGated: true,
      });
    }
  } else {
    // CASE 2: NO section headers - Create smart default structure

    // Check if plain text has problem-solution patterns
    if (hasProblemSolutionAnywhere && extractedProblemContent) {
      // Section 1: Overview
      sections.push({
        key: 'overviewAndGoals',
        title: 'Überblick & Lernziele',
        titleKey: 'scenario.section.overviewAndGoals',
        icon: 'Target',
        content: fullText,
        type: 'paragraph',
        order: 1,
      });

      // Section 2: Tasks (extracted problems)
      sections.push({
        key: 'tasks',
        title: 'Aufgaben',
        titleKey: 'scenario.section.tasks',
        icon: 'ClipboardList',
        content: extractedProblemContent,
        type: 'problems-only' as ContentType,
        order: MERGED_GROUPS.tasks.order,
      });

      // Section 3: Checklist
      sections.push({
        key: 'checklist',
        title: 'Checkliste',
        titleKey: 'scenario.section.checklist',
        icon: 'CheckSquare',
        content: generateDefaultChecklist(fullText),
        type: 'checklist',
        order: MERGED_GROUPS.checklist.order,
      });

      // Section 4: Solutions (gated)
      sections.push({
        key: 'solutions',
        title: 'Lösungen',
        titleKey: 'scenario.section.solutions',
        icon: 'Lightbulb',
        content: extractedProblemContent,
        type: 'solutions-only' as ContentType,
        order: MERGED_GROUPS.solutions.order,
        isGated: true,
      });
    } else {
      // Simple scenario without problems - create basic structure
      sections.push({
        key: 'overviewAndGoals',
        title: 'Überblick & Lernziele',
        titleKey: 'scenario.section.overviewAndGoals',
        icon: 'Target',
        content: fullText,
        type: 'paragraph',
        order: 1,
      });

      sections.push({
        key: 'tasks',
        title: 'Aufgabe',
        titleKey: 'scenario.section.tasks',
        icon: 'ClipboardList',
        content: fullText,
        type: 'paragraph',
        order: MERGED_GROUPS.tasks.order,
      });

      sections.push({
        key: 'checklist',
        title: 'Checkliste',
        titleKey: 'scenario.section.checklist',
        icon: 'CheckSquare',
        content: generateDefaultChecklist(fullText),
        type: 'checklist',
        order: MERGED_GROUPS.checklist.order,
      });
    }
  }

  // Sort by order
  sections.sort((a, b) => a.order - b.order);

  return { sections, hint, rawText: text };
}

/**
 * Generate a default checklist for scenarios without explicit checklists
 */
function generateDefaultChecklist(scenarioText: string): string {
  // Create a generic but useful checklist based on common learning patterns
  const checklistItems = [
    '[ ] Ich habe das Szenario vollständig gelesen und verstanden',
    '[ ] Ich habe die Kernkonzepte identifiziert',
    '[ ] Ich habe die Aufgabenstellung verstanden',
    '[ ] Ich habe mögliche Lösungsansätze überlegt',
    '[ ] Ich bin bereit, die Aufgabe zu bearbeiten',
  ];

  return checklistItems.join('\n');
}

/**
 * Separate problem-solution content into tasks-only and solutions-only
 */
function separateTasksAndSolutions(content: string): { tasksText: string; solutionsText: string } {
  const pairs = parseProblemSolutionPairs(content);

  if (pairs.length === 0) {
    // Fallback: try to split by LOESUNG/LÖSUNG markers
    return fallbackSeparation(content);
  }

  const tasksLines: string[] = [];
  const solutionsLines: string[] = [];

  pairs.forEach((pair, index) => {
    const num = index + 1;
    // Tasks: Problem title + scenario (without solution)
    tasksLines.push(`${num}. ${pair.problem}`);

    tasksLines.push('');

    // Solutions: Problem number + solution
    solutionsLines.push(`${num}. ${pair.problem}`);
    solutionsLines.push(`Lösung: ${pair.solution}`);
    solutionsLines.push('');
  });

  return {
    tasksText: tasksLines.join('\n').trim(),
    solutionsText: solutionsLines.join('\n').trim(),
  };
}

/**
 * Fallback separation when pairs parsing doesn't work
 */
function fallbackSeparation(content: string): { tasksText: string; solutionsText: string } {
  const lines = content.split('\n');
  const tasksLines: string[] = [];
  const solutionsLines: string[] = [];

  let inSolution = false;
  let currentTaskBlock: string[] = [];
  let currentSolutionBlock: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Check if this line starts a solution
    if (/^L[OÖ][E]?SUNG\s*:?/i.test(trimmed)) {
      inSolution = true;
      if (currentTaskBlock.length > 0) {
        tasksLines.push(...currentTaskBlock);
        tasksLines.push('');
        currentTaskBlock = [];
      }
      currentSolutionBlock.push(trimmed.replace(/^L[OÖ][E]?SUNG\s*:?\s*/i, 'Lösung: '));
      continue;
    }

    // Check if this line starts a new problem/task
    if (/^\d+\.\s+\w/.test(trimmed)) {
      // Save previous blocks
      if (currentTaskBlock.length > 0) {
        tasksLines.push(...currentTaskBlock);
        tasksLines.push('');
      }
      if (currentSolutionBlock.length > 0) {
        solutionsLines.push(...currentSolutionBlock);
        solutionsLines.push('');
      }
      currentTaskBlock = [trimmed];
      currentSolutionBlock = [trimmed]; // Solution also needs the problem reference
      inSolution = false;
      continue;
    }

    // Add to appropriate block
    if (inSolution) {
      currentSolutionBlock.push(line);
    } else {
      currentTaskBlock.push(line);
    }
  }

  // Don't forget the last blocks
  if (currentTaskBlock.length > 0) {
    tasksLines.push(...currentTaskBlock);
  }
  if (currentSolutionBlock.length > 0) {
    solutionsLines.push(...currentSolutionBlock);
  }

  return {
    tasksText: tasksLines.join('\n').trim(),
    solutionsText: solutionsLines.join('\n').trim(),
  };
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
 * Handles multiple formats: PROBLEM/LÖSUNG, LOESUNG, Szenario/Aufgabe/Lösung
 */
export function parseProblemSolutionPairs(content: string): Array<{
  problemTitle: string;
  problem: string;
  solution: string;
}> {
  const pairs: Array<{ problemTitle: string; problem: string; solution: string }> = [];

  // Check if content uses numbered format (1. Title\nSzenario\n...\nLOESUNG)
  const numberedMatch = content.match(/^(\d+)\.\s+([^\n]+)/m);
  if (numberedMatch && content.includes('LOESUNG')) {
    // Parse numbered scenario format
    const blocks = content.split(/(?=^\d+\.\s+)/m).filter(b => b.trim());

    for (const block of blocks) {
      const titleMatch = block.match(/^(\d+)\.\s+([^\n]+)/);
      if (!titleMatch) continue;

      const problemTitle = titleMatch[2].trim();
      const afterTitle = block.slice(titleMatch[0].length);

      // Find LOESUNG marker (handles LOESUNG, LÖSUNG, Lösung)
      const loesungIndex = afterTitle.search(/L[OÖ][E]?SUNG\s*\d*\s*:?/i);

      let problemContent = '';
      let solutionContent = '';

      if (loesungIndex >= 0) {
        problemContent = afterTitle.slice(0, loesungIndex).trim();
        const loesungMatch = afterTitle.slice(loesungIndex).match(/L[OÖ][E]?SUNG\s*\d*\s*:?\s*([^\n]*)([\s\S]*)/i);
        if (loesungMatch) {
          solutionContent = (loesungMatch[1] + '\n' + (loesungMatch[2] || '')).trim();
        }
      } else {
        problemContent = afterTitle.trim();
      }

      if (problemContent || solutionContent) {
        pairs.push({
          problemTitle,
          problem: problemContent,
          solution: solutionContent,
        });
      }
    }

    if (pairs.length > 0) return pairs;
  }

  // Fallback: Split content by PROBLEM markers
  const blocks = content.split(/(?=PROBLEM\s*\d+)/i);

  for (const block of blocks) {
    if (!block.trim()) continue;

    // Extract problem number and content
    const problemHeaderMatch = block.match(/^PROBLEM\s*(\d+)\s*:?\s*([^\n]*)/i);
    if (!problemHeaderMatch) continue;

    const problemNum = problemHeaderMatch[1];
    const problemTitle = problemHeaderMatch[2].trim() || `Problem ${problemNum}`;

    // Find the content between PROBLEM header and LÖSUNG/LOESUNG
    const afterHeader = block.slice(problemHeaderMatch[0].length);
    const loesungIndex = afterHeader.search(/L[OÖ][E]?SUNG\s*\d*/i);

    let problemContent = '';
    let solutionContent = '';

    if (loesungIndex >= 0) {
      problemContent = afterHeader.slice(0, loesungIndex).trim();
      const loesungMatch = afterHeader.slice(loesungIndex).match(/L[OÖ][E]?SUNG\s*\d*\s*:?\s*([^\n]*)([\s\S]*)/i);
      if (loesungMatch) {
        solutionContent = (loesungMatch[1] + '\n' + (loesungMatch[2] || '')).trim();
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
