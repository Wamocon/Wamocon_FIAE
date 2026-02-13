/**
 * Deep Analysis of DOCX Problem-Solution Structure
 * Analyzes multiple files to understand ALL patterns
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import mammoth from 'mammoth';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

const SZENARIEN_DIR = 'D:/FIAE UI/Wamocon_FIAE/Szenarien';

interface ProblemSolution {
  problemNumber: number;
  problemTitle: string;
  scenario: string;
  task: string;
  solution: string;
}

interface AnalysisResult {
  file: string;
  hasProblems: boolean;
  problemCount: number;
  solutionCount: number;
  patterns: string[];
  problems: ProblemSolution[];
  warnings: string[];
  rawSample: string;
}

async function analyzeFile(filePath: string): Promise<AnalysisResult> {
  const result: AnalysisResult = {
    file: path.basename(filePath),
    hasProblems: false,
    problemCount: 0,
    solutionCount: 0,
    patterns: [],
    problems: [],
    warnings: [],
    rawSample: '',
  };

  try {
    const textResult = await mammoth.extractRawText({ path: filePath });
    const text = textResult.value;
    result.rawSample = text.substring(0, 500);

    // Detect patterns used in this file
    if (/PROBLEM\s*\d+/i.test(text)) result.patterns.push('PROBLEM N');
    if (/Problem\s*\d+/i.test(text)) result.patterns.push('Problem N');
    if (/LÖSUNG\s*\d+/i.test(text)) result.patterns.push('LÖSUNG N');
    if (/Lösung\s*\d+/i.test(text)) result.patterns.push('Lösung N');
    if (/LOESUNG/i.test(text)) result.patterns.push('LOESUNG');
    if (/Aufgabe\s*:/i.test(text)) result.patterns.push('Aufgabe:');
    if (/Szenario\s*:/i.test(text) || /Szenario\n/i.test(text)) result.patterns.push('Szenario');
    if (/PROBLEM-LÖSUNG-PAARE/i.test(text)) result.patterns.push('PROBLEM-LÖSUNG-PAARE header');

    // Count problems and solutions
    const problemMatches = text.match(/PROBLEM\s*\d+|Problem\s*\d+/gi) || [];
    const solutionMatches = text.match(/LÖSUNG\s*\d+|Lösung\s*\d+|LOESUNG\s*\d*/gi) || [];
    
    result.problemCount = problemMatches.length;
    result.solutionCount = solutionMatches.length;
    result.hasProblems = result.problemCount > 0;

    // Verify counts match
    if (result.problemCount !== result.solutionCount) {
      result.warnings.push(`MISMATCH: ${result.problemCount} problems vs ${result.solutionCount} solutions`);
    }

    // Try to extract each problem-solution pair
    // Pattern 1: PROBLEM N: Title ... LÖSUNG N: ...
    const blocks = text.split(/(?=PROBLEM\s*\d+|Problem\s*\d+)/i);
    
    for (const block of blocks) {
      if (!block.trim()) continue;
      
      // Extract problem header
      const problemHeaderMatch = block.match(/^(PROBLEM|Problem)\s*(\d+)\s*:?\s*([^\n]*)/i);
      if (!problemHeaderMatch) continue;

      const problemNum = parseInt(problemHeaderMatch[2]);
      const problemTitle = problemHeaderMatch[3].trim();

      // Find the solution marker
      const loesungRegex = /(LÖSUNG|Lösung|LOESUNG)\s*(\d+)?\s*:?\s*/i;
      const loesungMatch = block.match(loesungRegex);
      
      let scenario = '';
      let task = '';
      let solution = '';

      if (loesungMatch) {
        const loesungIndex = block.indexOf(loesungMatch[0]);
        const beforeSolution = block.substring(problemHeaderMatch[0].length, loesungIndex);
        const afterSolution = block.substring(loesungIndex + loesungMatch[0].length);

        // Extract Szenario and Aufgabe from beforeSolution
        const szenarioMatch = beforeSolution.match(/Szenario\s*:?\s*([\s\S]*?)(?=Aufgabe|$)/i);
        const aufgabeMatch = beforeSolution.match(/Aufgabe\s*:?\s*([\s\S]*?)$/i);

        if (szenarioMatch) scenario = szenarioMatch[1].trim();
        if (aufgabeMatch) task = aufgabeMatch[1].trim();

        // If no explicit markers, the whole beforeSolution is the problem content
        if (!scenario && !task) {
          task = beforeSolution.trim();
        }

        solution = afterSolution.trim();
        
        // Remove next problem marker if accidentally included
        solution = solution.split(/(?=PROBLEM\s*\d+|Problem\s*\d+)/i)[0].trim();
      } else {
        result.warnings.push(`Problem ${problemNum} has no LÖSUNG marker!`);
      }

      result.problems.push({
        problemNumber: problemNum,
        problemTitle,
        scenario,
        task,
        solution,
      });
    }

  } catch (err: any) {
    result.warnings.push(`Parse error: ${err.message}`);
  }

  return result;
}

async function main() {
  console.log('='.repeat(100));
  console.log('DEEP ANALYSIS: Problem-Solution Extraction Patterns');
  console.log('='.repeat(100));

  // Get sample files from different courses
  const sampleFiles: string[] = [];
  
  const courses = fs.readdirSync(SZENARIEN_DIR).filter(f => f.startsWith('K') && !f.startsWith('.'));
  
  for (const course of courses.slice(0, 10)) { // First 10 courses
    const coursePath = path.join(SZENARIEN_DIR, course);
    const enablers = fs.readdirSync(coursePath).filter(f => !f.startsWith('.') && fs.statSync(path.join(coursePath, f)).isDirectory());
    
    if (enablers.length > 0) {
      const enablerPath = path.join(coursePath, enablers[0]);
      const partsDir = fs.readdirSync(enablerPath).find(f => f.toLowerCase().includes('szenario') || f.toLowerCase().includes('part'));
      
      if (partsDir) {
        const partsPath = path.join(enablerPath, partsDir);
        if (fs.statSync(partsPath).isDirectory()) {
          const docxFiles = fs.readdirSync(partsPath).filter(f => f.endsWith('.docx') && !f.startsWith('~'));
          if (docxFiles.length > 0) {
            sampleFiles.push(path.join(partsPath, docxFiles[0]));
          }
        }
      }
    }
  }

  console.log(`\nAnalyzing ${sampleFiles.length} sample files...\n`);

  const allPatterns = new Set<string>();
  const allWarnings: string[] = [];
  let totalProblems = 0;
  let totalSolutions = 0;
  let filesWithMismatch = 0;

  for (const file of sampleFiles) {
    const result = await analyzeFile(file);
    
    console.log('\n' + '-'.repeat(80));
    console.log(`FILE: ${result.file}`);
    console.log(`Patterns: ${result.patterns.join(', ')}`);
    console.log(`Problems: ${result.problemCount}, Solutions: ${result.solutionCount}`);
    
    if (result.warnings.length > 0) {
      console.log(`⚠️ WARNINGS: ${result.warnings.join('; ')}`);
      allWarnings.push(...result.warnings.map(w => `${result.file}: ${w}`));
      filesWithMismatch++;
    }

    if (result.problems.length > 0) {
      console.log('\nExtracted Problems:');
      for (const p of result.problems) {
        console.log(`  Problem ${p.problemNumber}: "${p.problemTitle.substring(0, 50)}..."`);
        console.log(`    Scenario: ${p.scenario.substring(0, 80)}...`);
        console.log(`    Task: ${p.task.substring(0, 80)}...`);
        console.log(`    Solution: ${p.solution.substring(0, 80)}...`);
      }
    }

    result.patterns.forEach(p => allPatterns.add(p));
    totalProblems += result.problemCount;
    totalSolutions += result.solutionCount;
  }

  console.log('\n' + '='.repeat(100));
  console.log('SUMMARY');
  console.log('='.repeat(100));
  console.log(`Files analyzed: ${sampleFiles.length}`);
  console.log(`Total problems found: ${totalProblems}`);
  console.log(`Total solutions found: ${totalSolutions}`);
  console.log(`Files with mismatches: ${filesWithMismatch}`);
  console.log(`\nAll patterns detected: ${Array.from(allPatterns).join(', ')}`);
  
  if (allWarnings.length > 0) {
    console.log('\n⚠️ ALL WARNINGS:');
    allWarnings.forEach(w => console.log(`  - ${w}`));
  }

  process.exit(0);
}

main().catch(console.error);
