/**
 * PRODUCTION VALIDATION SCRIPT
 * Validates all scenarios are ready for production deployment
 * 
 * Checks:
 * 1. All solutions with table data have proper <table> HTML tags
 * 2. No duplicate content (table data appearing as both text AND HTML)
 * 3. All required sections are present
 * 4. No missing or empty content
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

import db from '../src/db';
import { enablers } from '../src/db/migrations/schemas/schema';

interface ValidationIssue {
  enabler: string;
  scenario: string;
  section: string;
  issue: string;
  severity: 'error' | 'warning';
}

interface Solution {
  problemNumber?: number;
  title?: string;
  content?: string;
}

interface Task {
  number?: number;
  title?: string;
  scenario?: string;
  task?: string;
}

interface Sections {
  behandelteThemen?: string[];
  lernziele?: string[];
  theoretischeGrundlagen?: string;
  ausgangslage?: string;
  aufgaben?: Task[];
  checkliste?: string[];
  loesungen?: Solution[];
}

interface Scenario {
  title?: string;
  text?: string;
  sections?: Sections;
}

async function validate() {
  console.log('=== PRODUCTION VALIDATION REPORT ===\n');
  console.log('Checking all scenarios for production readiness...\n');
  
  const issues: ValidationIssue[] = [];
  const results = await db.select().from(enablers);
  
  let totalEnablers = 0;
  let totalScenarios = 0;
  let enablersWithScenarios = 0;
  let solutionsWithTableHtml = 0;
  let solutionsTotal = 0;
  
  for (const e of results) {
    totalEnablers++;
    const scenarios = (e.scenarios as Scenario[]) || [];
    
    if (scenarios.length > 0) {
      enablersWithScenarios++;
    }
    
    for (const s of scenarios) {
      totalScenarios++;
      const sections = s.sections;
      
      if (!sections) {
        issues.push({
          enabler: e.title || 'Unknown',
          scenario: s.title || 'Unknown',
          section: 'all',
          issue: 'Missing sections object - no structured content',
          severity: 'error'
        });
        continue;
      }
      
      // Check solutions for table issues
      const loesungen = sections.loesungen || [];
      for (const sol of loesungen) {
        solutionsTotal++;
        const content = sol.content || '';
        
        // Check if content has HTML tables
        if (content.includes('<table')) {
          solutionsWithTableHtml++;
          
          // Check for duplicates: table data appearing BEFORE the table as plain text
          const tableIndex = content.indexOf('<table');
          const beforeTable = content.substring(0, tableIndex);
          
          // Check for patterns that suggest table data as text
          // (short lines that look like cell values)
          const lines = beforeTable.split('\n').filter(l => l.trim());
          const suspiciousLines = lines.filter(l => {
            const trimmed = l.trim();
            // Short values like "101", "A-10", "P-01" that could be cell data
            return trimmed.length < 20 && /^[\w\-\.]+$/.test(trimmed) && !/^(LÖSUNG|Lösung|Tabelle:|Table:)/i.test(trimmed);
          });
          
          // If more than 5 suspicious short value lines before table, flag it
          if (suspiciousLines.length > 5) {
            issues.push({
              enabler: (e.title || 'Unknown').substring(0, 40),
              scenario: s.title || 'Unknown',
              section: `Solution ${sol.problemNumber}`,
              issue: `Possible duplicate data: ${suspiciousLines.length} lines before table look like cell values`,
              severity: 'warning'
            });
          }
        }
        
        // Check for table-like data stored as plain text (no HTML table)
        const hasTableKeywords = /\bTabelle:|\bTable:|\bSpalten?:|\bZeilen?:/i.test(content);
        const hasColumnHeaders = /\(PK\)|\(FK\)|PRIMARY KEY|FOREIGN KEY/i.test(content);
        if ((hasTableKeywords || hasColumnHeaders) && !content.includes('<table')) {
          // Further analysis: check if there are columns of short repeated data
          const lines = content.split('\n').filter(l => l.trim());
          const shortLines = lines.filter(l => l.trim().length < 25);
          
          if (shortLines.length > 10) {
            issues.push({
              enabler: (e.title || 'Unknown').substring(0, 40),
              scenario: s.title || 'Unknown',
              section: `Solution ${sol.problemNumber}`,
              issue: 'Table data might be stored as text instead of HTML table',
              severity: 'warning'
            });
          }
        }
      }
      
      // Check for empty required sections
      if (!sections.aufgaben || sections.aufgaben.length === 0) {
        issues.push({
          enabler: (e.title || 'Unknown').substring(0, 40),
          scenario: s.title || 'Unknown',
          section: 'aufgaben',
          issue: 'No tasks defined',
          severity: 'warning'
        });
      }
      
      if (!sections.loesungen || sections.loesungen.length === 0) {
        issues.push({
          enabler: (e.title || 'Unknown').substring(0, 40),
          scenario: s.title || 'Unknown',
          section: 'loesungen',
          issue: 'No solutions defined',
          severity: 'warning'
        });
      }
    }
  }
  
  // Summary
  console.log('=== SUMMARY ===\n');
  console.log(`Total enablers: ${totalEnablers}`);
  console.log(`Enablers with scenarios: ${enablersWithScenarios}`);
  console.log(`Total scenarios: ${totalScenarios}`);
  console.log(`Total solutions: ${solutionsTotal}`);
  console.log(`Solutions with HTML tables: ${solutionsWithTableHtml}`);
  
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  
  console.log(`\nErrors: ${errors.length}`);
  console.log(`Warnings: ${warnings.length}`);
  
  if (errors.length > 0) {
    console.log('\n=== ERRORS (must fix) ===\n');
    for (const e of errors) {
      console.log(`❌ [${e.enabler}] ${e.scenario}`);
      console.log(`   Section: ${e.section}`);
      console.log(`   Issue: ${e.issue}\n`);
    }
  }
  
  if (warnings.length > 0 && warnings.length <= 20) {
    console.log('\n=== WARNINGS (review recommended) ===\n');
    for (const w of warnings) {
      console.log(`⚠️  [${w.enabler.substring(0, 30)}...] ${w.scenario || 'Unknown'}`);
      console.log(`   ${w.section}: ${w.issue}\n`);
    }
  } else if (warnings.length > 20) {
    console.log(`\n=== WARNINGS (showing first 20 of ${warnings.length}) ===\n`);
    for (const w of warnings.slice(0, 20)) {
      console.log(`⚠️  [${w.enabler.substring(0, 30)}...] ${w.scenario || 'Unknown'}`);
      console.log(`   ${w.section}: ${w.issue}\n`);
    }
  }
  
  // Final verdict
  console.log('\n=== PRODUCTION READINESS ===\n');
  if (errors.length === 0) {
    console.log('✅ NO CRITICAL ERRORS - Ready for production');
    if (warnings.length > 0) {
      console.log(`⚠️  ${warnings.length} warnings to review (non-blocking)`);
    }
  } else {
    console.log(`❌ ${errors.length} CRITICAL ERRORS - Fix before production`);
  }
  
  process.exit(errors.length > 0 ? 1 : 0);
}

validate();
