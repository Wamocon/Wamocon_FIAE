/**
 * Bulk Import Scenarios from DOCX Files
 * 
 * This script:
 * 1. Scans the Szenarien/ folder for DOCX files
 * 2. Parses each file into structured sections (5 sections)
 * 3. Separates PROBLEMS from SOLUTIONS (solutions are gated in UI)
 * 4. Maps to correct courses/enablers in database
 * 5. Updates the enablers.scenarios JSONB field
 * 
 * Usage:
 *   npx tsx scripts/bulk-import-scenarios.ts --env=qa --dry-run
 *   npx tsx scripts/bulk-import-scenarios.ts --env=prod
 * 
 * Options:
 *   --env=qa|prod       Target environment (default: qa)
 *   --dry-run           Preview without database writes
 *   --course=K01        Import only specific course
 *   --verbose           Detailed logging
 *   --skip-existing     Don't overwrite existing scenarios
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import mammoth from 'mammoth';

// Parse command line args first
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isVerbose = args.includes('--verbose');
const skipExisting = args.includes('--skip-existing');
const envArg = args.find(a => a.startsWith('--env='));
const targetEnv = envArg ? envArg.split('=')[1] : 'qa';
const courseFilter = args.find(a => a.startsWith('--course='))?.split('=')[1];

// Load environment
const envFile = targetEnv === 'prod' ? '.env.prod' : '.env.local';
dotenv.config({ path: path.resolve(process.cwd(), envFile), override: true });

import db from '../src/db';
import { courses, enablers } from '../src/db/migrations/schemas/schema';
import { eq, ilike, and, sql } from 'drizzle-orm';

// ==========================================
// CONFIGURATION
// ==========================================
const CONFIG = {
  scenarienFolder: 'D:/FIAE UI/Wamocon_FIAE/Szenarien',
  
  // Folder patterns
  coursePattern: /^K(\d+)[_\s](.+)$/,  // K01_Name or K01 Name
  enablerPattern: /^(\d+)_(\d+)[_\s](.+)$/,  // 01_01_Name
  partsFolder: /^szenari(?:o|en)\s*(?:parts?)?$/i,  // Match "Szenario parts", "Szenarien parts", "Szenarien", or "Szenario"
  partFile: /Part\s*(\d+)/i,
};

// ==========================================
// TYPES
// ==========================================
interface ProblemTask {
  number: number;
  title: string;
  scenario: string;
  task: string;
}

interface Solution {
  problemNumber: number;
  title: string;
  content: string;
}

interface StructuredScenario {
  // Backward compatible field
  text: string;
  hint?: string;
  
  // Structured sections
  sections: {
    behandelteThemen: string[];
    lernziele: string[];
    theoretischeGrundlagen: string;  // May contain HTML for tables
    ausgangslage: string;
    aufgaben: ProblemTask[];
    checkliste: string[];
    loesungen: Solution[];
  };
}

interface ImportResult {
  course: string;
  enabler: string;
  scenarioCount: number;
  success: boolean;
  error?: string;
}

// ==========================================
// COURSE MAPPING (Folder name -> DB course title)
// ==========================================
const COURSE_MAPPING: Record<string, string> = {
  // Year 1 courses
  'K01': 'Planen, Vorbereiten und Durchführen von Arbeitsaufgaben',
  'K02': 'Informieren und Beraten von Kunden',
  'K03': 'Beurteilen marktgängiger IT-Systeme',
  'K04': 'Entwickeln, Erstellen und Betreuen von IT-Lösungen',
  'K05': 'Durchführen von qualitätssichernden Maßnahmen',
  'K06': 'Maßnahmen zur IT-Sicherheit und zum Datenschutz',
  'K07': 'Erbringen der Leistungen und Auftragsabschluss',
  'K08': 'Betreiben von IT-Systemen',
  'K09': 'Programmieren von Softwarelösungen',
  'K10': 'Konzipieren und Umsetzen von Softwareanwendungen',
  'K11': 'Sicherstellen der Qualität von Softwareanwendungen',
  'K12': 'Vernetztes Zusammenarbeiten',
  
  // Year 2 courses (Vertiefung)
  'K13': 'Informieren und Beraten von Kunden',  // Will match Vertiefung
  'K14': 'Beurteilen marktgängiger IT-Systeme',
  'K15': 'Entwickeln von IT-Lösungen',
  'K16': 'Durchführen von QS-Maßnahmen',
  'K17': 'IT-Sicherheit & Datenschutz',
  'K18': 'Betreiben von IT-Systemen',
  'K19': 'Inbetriebnehmen von Speicherlösungen',
  'K20': 'Programmieren von Softwarelösungen',
  'K21': 'Konzipieren von Softwareanwendungen',
  'K22': 'Sicherstellen der Qualität',
  
  // Non-technical courses
  'K23': 'Berufsbildung, Arbeits- und Tarifrecht',
  'K24': 'Aufbau und Organisation des Ausbildungsbetriebes',
  'K25': 'Sicherheit und Gesundheitsschutz bei der Arbeit',
  'K26': 'Umweltschutz',
};

// ==========================================
// PARSING FUNCTIONS
// ==========================================

/**
 * Extract text and HTML from DOCX file
 */
async function extractFromDocx(filePath: string): Promise<{ text: string; html: string }> {
  const textResult = await mammoth.extractRawText({ path: filePath });
  const htmlResult = await mammoth.convertToHtml({ path: filePath });
  return { text: textResult.value, html: htmlResult.value };
}

/**
 * Parse bullet list from text
 */
function parseBulletList(text: string): string[] {
  const items: string[] = [];
  const lines = text.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    // Match various bullet formats: •, -, *, or lines starting with lowercase after header
    const match = trimmed.match(/^[•\-\*]\s*(.+)$/) || trimmed.match(/^[-]\s*(.+)$/);
    if (match) {
      items.push(match[1].trim());
    } else if (trimmed && !trimmed.endsWith(':') && items.length > 0) {
      // Continuation of previous item
      items[items.length - 1] += ' ' + trimmed;
    } else if (trimmed && !trimmed.endsWith(':')) {
      // Standalone line that looks like a list item
      items.push(trimmed);
    }
  }
  
  return items.filter(item => item.length > 0);
}

/**
 * Parse checklist items
 */
function parseChecklistItems(text: string): string[] {
  const items: string[] = [];
  const lines = text.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    // Match [ ] or [x] or • [ ] patterns
    const match = trimmed.match(/^[•\-\*]?\s*\[[\sxX]?\]\s*(.+)$/) || 
                  trimmed.match(/^[•\-\*]\s*(.+)$/) ||
                  trimmed.match(/^[-]\s*(.+)$/);
    if (match) {
      items.push(match[1].trim());
    }
  }
  
  // If no items found, try splitting by newlines
  if (items.length === 0) {
    const cleanLines = text.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.toLowerCase().includes('checkliste') && l.length > 10);
    return cleanLines;
  }
  
  return items;
}

/**
 * Extract tables from HTML and convert to styled HTML
 */
function extractAndStyleTables(html: string): string {
  const tableMatches = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi);
  if (!tableMatches) return '';
  
  return tableMatches.map(table => {
    // Add Tailwind classes for styling
    return table
      .replace(/<table/g, '<table class="min-w-full divide-y divide-slate-200 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden my-4"')
      .replace(/<thead/g, '<thead class="bg-slate-50 dark:bg-slate-800"')
      .replace(/<th/g, '<th class="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider"')
      .replace(/<td/g, '<td class="px-4 py-3 text-sm text-slate-700 dark:text-slate-300 border-t border-slate-100 dark:border-slate-700"')
      .replace(/<tr/g, '<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"');
  }).join('\n\n');
}

/**
 * MAIN PARSER: Extract problems and solutions separately
 * THIS IS CRITICAL - Solutions must NEVER appear in Tasks section
 */
function extractProblemsAndSolutions(text: string, html: string): { tasks: ProblemTask[]; solutions: Solution[] } {
  const tasks: ProblemTask[] = [];
  const solutions: Solution[] = [];
  
  // First, find where PROBLEM-LÖSUNG-PAARE section starts
  const paareSectionStart = text.search(/PROBLEM[-\s]*L[ÖO]SUNG[-\s]*PAARE/i);
  const contentToProcess = paareSectionStart >= 0 ? text.substring(paareSectionStart) : text;
  
  // Split by PROBLEM markers
  const problemBlocks = contentToProcess.split(/(?=PROBLEM\s*\d+|Problem\s*\d+)/i);
  
  const seenProblems = new Set<number>();
  
  for (const block of problemBlocks) {
    if (!block.trim()) continue;
    
    // Extract problem number and title
    const headerMatch = block.match(/^(PROBLEM|Problem)\s*(\d+)\s*:?\s*([^\n]*)/i);
    if (!headerMatch) continue;
    
    const problemNum = parseInt(headerMatch[2]);
    
    // Skip duplicates (some files have 2 versions)
    if (seenProblems.has(problemNum)) continue;
    seenProblems.add(problemNum);
    
    const problemTitle = headerMatch[3].trim();
    const afterHeader = block.substring(headerMatch[0].length);
    
    // Find LÖSUNG/LOESUNG marker - this is where we SPLIT
    const loesungRegex = /(LÖSUNG|Lösung|LOESUNG)\s*(\d+)?\s*:?\s*/i;
    const loesungMatch = afterHeader.match(loesungRegex);
    const loesungIndex = afterHeader.search(loesungRegex);
    
    let taskContent = afterHeader;
    let solutionContent = '';
    
    if (loesungIndex >= 0) {
      // SPLIT: Everything BEFORE LÖSUNG goes to tasks
      taskContent = afterHeader.substring(0, loesungIndex).trim();
      // Everything AFTER LÖSUNG goes to solutions
      solutionContent = afterHeader.substring(loesungIndex + (loesungMatch?.[0].length || 0)).trim();
      
      // Clean solution: remove any trailing PROBLEM markers
      solutionContent = solutionContent.split(/(?=PROBLEM\s*\d+|Problem\s*\d+)/i)[0].trim();
    }
    
    // Parse task content for Szenario and Aufgabe
    let scenario = '';
    let task = '';
    
    // Try to find explicit Szenario: and Aufgabe: markers
    const szenarioMatch = taskContent.match(/Szenario\s*:?\s*([\s\S]*?)(?=Aufgabe|$)/i);
    const aufgabeMatch = taskContent.match(/Aufgabe\s*:?\s*([\s\S]*?)$/i);
    
    if (szenarioMatch && aufgabeMatch) {
      scenario = szenarioMatch[1].trim();
      task = aufgabeMatch[1].trim();
    } else if (aufgabeMatch) {
      // Only Aufgabe found
      scenario = taskContent.substring(0, taskContent.search(/Aufgabe/i)).trim();
      task = aufgabeMatch[1].trim();
    } else {
      // No explicit markers - use full content as task
      task = taskContent;
    }
    
    // Add to tasks (NO SOLUTION HERE!)
    tasks.push({
      number: problemNum,
      title: problemTitle,
      scenario: scenario,
      task: task,
    });
    
    // Add solution separately (GATED IN UI)
    if (solutionContent) {
      // Find corresponding HTML section for this solution to extract tables
      // Look for Lösung marker followed by problem number in HTML
      // IMPORTANT: Must require the number to avoid matching "PROBLEM-LÖSUNG-PAARE" header
      const loesungHtmlRegex = new RegExp(`(LÖSUNG|Lösung|LOESUNG)\\s*${problemNum}\\s*:`, 'i');
      const loesungHtmlMatch = html.search(loesungHtmlRegex);
      
      if (loesungHtmlMatch >= 0) {
        // Find end of this solution section (next PROBLEM marker or end)
        const nextProblemInHtml = html.substring(loesungHtmlMatch).search(/PROBLEM\s*\d+/i);
        const loesungEndPos = nextProblemInHtml >= 0 
          ? loesungHtmlMatch + nextProblemInHtml 
          : html.length;
        
        const solutionHtml = html.substring(loesungHtmlMatch, loesungEndPos);
        
        // If this solution has tables, use HTML content (with styled tables) instead of plain text
        // This prevents duplication (table data appearing twice: once as text, once as HTML)
        if (solutionHtml.includes('<table')) {
          // Convert HTML to text but preserve tables
          // 1. Style the tables first
          const styledHtml = solutionHtml
            .replace(/<table/g, '<table class="min-w-full divide-y divide-slate-200 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden my-4"')
            .replace(/<thead/g, '<thead class="bg-slate-50 dark:bg-slate-800"')
            .replace(/<th/g, '<th class="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider"')
            .replace(/<td/g, '<td class="px-4 py-3 text-sm text-slate-700 dark:text-slate-300 border-t border-slate-100 dark:border-slate-700"')
            .replace(/<tr/g, '<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"');
          
          // 2. Convert non-table HTML to text, preserve tables
          // Split by tables, process non-table parts
          const parts = styledHtml.split(/(<table[\s\S]*?<\/table>)/gi);
          const processedParts = parts.map(part => {
            if (part.startsWith('<table')) {
              return part; // Keep tables as-is
            }
            // Convert HTML to plain text for non-table parts
            return part
              .replace(/<br\s*\/?>/gi, '\n')
              .replace(/<\/p>/gi, '\n\n')
              .replace(/<\/li>/gi, '\n')
              .replace(/<\/h[1-6]>/gi, '\n\n')
              .replace(/<[^>]+>/g, '') // Remove remaining tags
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/\n{3,}/g, '\n\n') // Normalize multiple newlines
              .trim();
          });
          
          solutionContent = processedParts.join('\n\n').trim();
        }
      }
      
      solutions.push({
        problemNumber: problemNum,
        title: problemTitle,
        content: solutionContent,
      });
    }
  }
  
  // Sort by problem number
  tasks.sort((a, b) => a.number - b.number);
  solutions.sort((a, b) => a.problemNumber - b.problemNumber);
  
  return { tasks, solutions };
}

/**
 * Parse a single DOCX file into structured scenario
 */
async function parseScenarioDoc(filePath: string): Promise<StructuredScenario> {
  const { text, html } = await extractFromDocx(filePath);
  
  // Initialize sections
  const sections: StructuredScenario['sections'] = {
    behandelteThemen: [],
    lernziele: [],
    theoretischeGrundlagen: '',
    ausgangslage: '',
    aufgaben: [],
    checkliste: [],
    loesungen: [],
  };
  
  // Extract Behandelte Themen
  const themenMatch = text.match(/Behandelte\s*Themen[\s\S]*?(?=Lernziele|$)/i);
  if (themenMatch) {
    sections.behandelteThemen = parseBulletList(themenMatch[0].replace(/Behandelte\s*Themen\s*:?/i, ''));
  }
  
  // Extract Lernziele
  const lernzieleMatch = text.match(/Lernziele[\s\S]*?(?=Theoretische\s*Grundlagen|Ausgangslage|PROBLEM|$)/i);
  if (lernzieleMatch) {
    const lernText = lernzieleMatch[0].replace(/Lernziele\s*:?/i, '').replace(/Nach diesem Szenario können Sie:?/i, '');
    sections.lernziele = parseBulletList(lernText);
  }
  
  // Extract Theoretische Grundlagen
  const theorieMatch = text.match(/Theoretische\s*Grundlagen[\s\S]*?(?=Ausgangslage|PROBLEM|$)/i);
  if (theorieMatch) {
    let theorie = theorieMatch[0].replace(/Theoretische\s*Grundlagen\s*:?/i, '').trim();
    
    // Check if there are tables in this section
    const theorieStartInHtml = html.indexOf('Theoretische Grundlagen');
    const theorieEndInHtml = html.search(/Ausgangslage|PROBLEM/i);
    if (theorieStartInHtml >= 0) {
      const theorieHtml = html.substring(theorieStartInHtml, theorieEndInHtml > theorieStartInHtml ? theorieEndInHtml : undefined);
      const tables = extractAndStyleTables(theorieHtml);
      if (tables) {
        theorie += '\n\n' + tables;
      }
    }
    
    sections.theoretischeGrundlagen = theorie;
  }
  
  // Extract Ausgangslage
  const ausgangslageMatch = text.match(/Ausgangslage[\s\S]*?(?=PROBLEM[-\s]*L[ÖO]SUNG|PROBLEM\s*\d|$)/i);
  if (ausgangslageMatch) {
    sections.ausgangslage = ausgangslageMatch[0].replace(/Ausgangslage\s*:?/i, '').trim();
  }
  
  // Extract Problems and Solutions SEPARATELY (pass HTML for table extraction)
  const { tasks, solutions } = extractProblemsAndSolutions(text, html);
  sections.aufgaben = tasks;
  sections.loesungen = solutions;
  
  // Extract Checklist
  const checklistMatch = text.match(/Lernziel[-\s]*Checkliste[\s\S]*$/i);
  if (checklistMatch) {
    sections.checkliste = parseChecklistItems(checklistMatch[0].replace(/Lernziel[-\s]*Checkliste\s*:?/i, ''));
  }
  
  // If no checklist found, generate default
  if (sections.checkliste.length === 0) {
    sections.checkliste = [
      'Ich habe das Szenario vollständig gelesen und verstanden',
      'Ich habe die Kernkonzepte identifiziert',
      'Ich habe die Aufgabenstellung verstanden',
      'Ich habe mögliche Lösungsansätze überlegt',
      'Ich bin bereit, die Aufgabe zu bearbeiten',
    ];
  }
  
  return {
    text: text,  // Keep full text for backward compatibility
    sections,
  };
}

// ==========================================
// DATABASE FUNCTIONS
// ==========================================

// Manual overrides for folder names with typos
const FOLDER_NAME_FIXES: Record<string, string> = {
  'Lerntechnicken': 'Lerntechniken',  // Typo in folder name
};

/**
 * Find course ID by searching for matching title
 */
async function findCourseId(courseFolderName: string): Promise<string | null> {
  // Extract course number
  const match = courseFolderName.match(/K(\d+)/i);
  if (!match) return null;
  
  const courseNum = `K${match[1].padStart(2, '0')}`;
  const searchTitle = COURSE_MAPPING[courseNum];
  
  if (!searchTitle) {
    console.log(`  ⚠️ No mapping for ${courseNum}`);
    return null;
  }
  
  // Search in database with fuzzy match
  const results = await db
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(ilike(courses.title, `%${searchTitle.substring(0, 20)}%`))
    .limit(5);
  
  if (results.length === 0) {
    console.log(`  ⚠️ Course not found: ${searchTitle}`);
    return null;
  }
  
  // Return first match
  if (isVerbose) {
    console.log(`  ✓ Found course: ${results[0].title}`);
  }
  return results[0].id;
}

/**
 * Normalize string for fuzzy matching
 */
function normalizeForMatching(str: string): string {
  return str
    .toLowerCase()
    .replace(/[_\-–—]/g, ' ')       // Dashes to space
    .replace(/[\(\)§]/g, '')         // Remove parens and section symbol
    .replace(/\s+/g, ' ')            // Collapse whitespace
    .replace(/[äöü]/gi, m => {       // German umlaut handling
      const map: Record<string, string> = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue' };
      return map[m] || m;
    })
    .trim();
}

/**
 * Find enabler ID by matching title within a course
 */
async function findEnablerId(courseId: string, enablerFolderName: string): Promise<string | null> {
  // Clean the folder name to extract topic
  // Format: "01_01_Name of topic" or "Name of topic"
  let searchTitle = enablerFolderName;
  
  // Remove numeric prefix
  const prefixMatch = enablerFolderName.match(/^\d+_\d+[_\s]+(.+)$/);
  if (prefixMatch) {
    searchTitle = prefixMatch[1];
  }
  
  // Apply manual folder name fixes (typos)
  for (const [typo, fix] of Object.entries(FOLDER_NAME_FIXES)) {
    if (searchTitle.includes(typo)) {
      searchTitle = searchTitle.replace(typo, fix);
      if (isVerbose) console.log(`    📝 Applied typo fix: ${typo} → ${fix}`);
    }
  }
  
  // Normalize for matching
  const normalizedSearch = normalizeForMatching(searchTitle);
  
  // Get all enablers for this course and do fuzzy match
  const allEnablers = await db
    .select({ id: enablers.id, title: enablers.title })
    .from(enablers)
    .where(eq(enablers.courseId, courseId));
  
  // Try to find best match
  for (const enabler of allEnablers) {
    const normalizedTitle = normalizeForMatching(enabler.title);
    
    // Check if search terms appear in enabler title (ignoring special chars)
    const searchWords = normalizedSearch.split(' ').filter(w => w.length > 3);
    const matchCount = searchWords.filter(word => normalizedTitle.includes(word)).length;
    
    // Match if at least 3 significant words match, or if first 3 words match
    if (matchCount >= 3 || matchCount >= searchWords.length * 0.7) {
      if (isVerbose) console.log(`    ✓ Found enabler: ${enabler.title}`);
      return enabler.id;
    }
  }
  
  // Fallback: try first 2 distinctive words
  const firstWords = normalizedSearch.split(' ').filter(w => w.length > 4).slice(0, 2);
  for (const enabler of allEnablers) {
    const normalizedTitle = normalizeForMatching(enabler.title);
    if (firstWords.every(word => normalizedTitle.includes(word))) {
      if (isVerbose) console.log(`    ✓ Found enabler (fuzzy): ${enabler.title}`);
      return enabler.id;
    }
  }
  
  // Last resort: SQL LIKE query
  const sqlSearchTitle = searchTitle
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 25);
  
  const results = await db
    .select({ id: enablers.id, title: enablers.title })
    .from(enablers)
    .where(and(
      eq(enablers.courseId, courseId),
      ilike(enablers.title, `%${sqlSearchTitle}%`)
    ))
    .limit(3);
  
  if (results.length > 0) {
    if (isVerbose) console.log(`    ✓ Found enabler (SQL): ${results[0].title}`);
    return results[0].id;
  }
  
  console.log(`    ⚠️ Enabler not found: ${searchTitle.substring(0, 40)}`);
  return null;
}

/**
 * Update enabler with structured scenarios
 */
async function updateEnablerScenarios(
  enablerId: string, 
  scenarios: StructuredScenario[]
): Promise<void> {
  // Convert to storage format
  const scenariosJson = scenarios.map(s => ({
    text: s.text,
    hint: s.hint,
    sections: s.sections,
  }));
  
  await db
    .update(enablers)
    .set({
      scenarios: scenariosJson,
      // Also set legacy fields for first scenario
      scenarioText: scenarios[0]?.text || null,
      hintText: scenarios[0]?.hint || null,
    })
    .where(eq(enablers.id, enablerId));
}

// ==========================================
// MAIN IMPORT LOGIC
// ==========================================

async function processEnablerFolder(
  coursePath: string,
  enablerFolder: string,
  courseId: string
): Promise<ImportResult> {
  const enablerPath = path.join(coursePath, enablerFolder);
  const result: ImportResult = {
    course: path.basename(coursePath),
    enabler: enablerFolder,
    scenarioCount: 0,
    success: false,
  };
  
  try {
    // Find enabler in database
    const enablerId = await findEnablerId(courseId, enablerFolder);
    if (!enablerId) {
      result.error = 'Enabler not found in database';
      return result;
    }
    
    // Check for existing scenarios if skip-existing
    if (skipExisting) {
      const existing = await db
        .select({ scenarios: enablers.scenarios })
        .from(enablers)
        .where(eq(enablers.id, enablerId))
        .limit(1);
      
      if (existing[0]?.scenarios && (existing[0].scenarios as any[]).length > 0) {
        result.success = true;
        result.scenarioCount = (existing[0].scenarios as any[]).length;
        result.error = 'Skipped (already has scenarios)';
        return result;
      }
    }
    
    // Find Szenario parts folder
    const contents = fs.readdirSync(enablerPath);
    const partsFolder = contents.find(f => 
      CONFIG.partsFolder.test(f) && 
      fs.statSync(path.join(enablerPath, f)).isDirectory()
    );
    
    if (!partsFolder) {
      result.error = 'No Szenario parts folder found';
      return result;
    }
    
    const partsPath = path.join(enablerPath, partsFolder);
    
    // Get all DOCX files
    const docxFiles = fs.readdirSync(partsPath)
      .filter(f => f.endsWith('.docx') && !f.startsWith('~'))
      .sort((a, b) => {
        // Sort by Part number
        const numA = a.match(/Part\s*(\d+)/i)?.[1] || '0';
        const numB = b.match(/Part\s*(\d+)/i)?.[1] || '0';
        return parseInt(numA) - parseInt(numB);
      });
    
    if (docxFiles.length === 0) {
      result.error = 'No DOCX files found';
      return result;
    }
    
    // Parse each DOCX file
    const scenarios: StructuredScenario[] = [];
    
    for (const docxFile of docxFiles) {
      const docxPath = path.join(partsPath, docxFile);
      
      try {
        const scenario = await parseScenarioDoc(docxPath);
        scenarios.push(scenario);
        
        if (isVerbose) {
          console.log(`      📄 ${docxFile}: ${scenario.sections.aufgaben.length} problems, ${scenario.sections.loesungen.length} solutions`);
        }
      } catch (err: any) {
        console.log(`      ❌ Error parsing ${docxFile}: ${err.message}`);
      }
    }
    
    result.scenarioCount = scenarios.length;
    
    if (scenarios.length === 0) {
      result.error = 'No scenarios could be parsed';
      return result;
    }
    
    // Update database (unless dry run)
    if (!isDryRun) {
      await updateEnablerScenarios(enablerId, scenarios);
    }
    
    result.success = true;
    return result;
    
  } catch (err: any) {
    result.error = err.message;
    return result;
  }
}

async function processCourseFolder(courseFolderName: string): Promise<ImportResult[]> {
  const coursePath = path.join(CONFIG.scenarienFolder, courseFolderName);
  const results: ImportResult[] = [];
  
  console.log(`\n📚 Processing: ${courseFolderName}`);
  
  // Find course in database
  const courseId = await findCourseId(courseFolderName);
  if (!courseId) {
    console.log(`  ❌ Course not found in database`);
    return results;
  }
  
  // Get enabler folders
  const enablerFolders = fs.readdirSync(coursePath)
    .filter(f => !f.startsWith('.') && fs.statSync(path.join(coursePath, f)).isDirectory());
  
  console.log(`  Found ${enablerFolders.length} enabler folders`);
  
  for (const enablerFolder of enablerFolders) {
    console.log(`  📁 ${enablerFolder.substring(0, 50)}...`);
    const result = await processEnablerFolder(coursePath, enablerFolder, courseId);
    results.push(result);
    
    if (result.success) {
      console.log(`    ✅ ${result.scenarioCount} scenarios ${isDryRun ? '(dry run)' : 'imported'}`);
    } else {
      console.log(`    ❌ ${result.error}`);
    }
  }
  
  return results;
}

async function main() {
  console.log('='.repeat(80));
  console.log('BULK IMPORT SCENARIOS');
  console.log('='.repeat(80));
  console.log(`Environment: ${targetEnv.toUpperCase()}`);
  console.log(`Dry run: ${isDryRun}`);
  console.log(`Skip existing: ${skipExisting}`);
  console.log(`Verbose: ${isVerbose}`);
  if (courseFilter) console.log(`Course filter: ${courseFilter}`);
  console.log('');
  
  // Get all course folders
  let courseFolders = fs.readdirSync(CONFIG.scenarienFolder)
    .filter(f => f.startsWith('K') && !f.startsWith('.'))
    .filter(f => fs.statSync(path.join(CONFIG.scenarienFolder, f)).isDirectory());
  
  // Apply filter if specified
  if (courseFilter) {
    courseFolders = courseFolders.filter(f => f.toUpperCase().startsWith(courseFilter.toUpperCase()));
  }
  
  console.log(`Found ${courseFolders.length} course folders to process`);
  
  const allResults: ImportResult[] = [];
  
  for (const courseFolder of courseFolders) {
    const results = await processCourseFolder(courseFolder);
    allResults.push(...results);
  }
  
  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  
  const successful = allResults.filter(r => r.success && !r.error?.includes('Skipped'));
  const skipped = allResults.filter(r => r.error?.includes('Skipped'));
  const failed = allResults.filter(r => !r.success);
  
  console.log(`✅ Successful: ${successful.length}`);
  console.log(`⏭️ Skipped: ${skipped.length}`);
  console.log(`❌ Failed: ${failed.length}`);
  console.log(`📊 Total scenarios: ${successful.reduce((sum, r) => sum + r.scenarioCount, 0)}`);
  
  if (failed.length > 0) {
    console.log('\n❌ Failed imports:');
    for (const r of failed) {
      console.log(`  - ${r.course}/${r.enabler}: ${r.error}`);
    }
  }
  
  if (isDryRun) {
    console.log('\n⚠️ This was a DRY RUN - no changes were made to the database');
    console.log('Run without --dry-run to actually import the scenarios');
  }
  
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
