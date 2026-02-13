/**
 * Full analysis of all scenarios with tables - find all issues
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

import db from '../src/db';
import { enablers } from '../src/db/migrations/schemas/schema';

interface Solution {
  problemNumber?: number;
  title?: string;
  content?: string;
}

interface Scenario {
  title?: string;
  sections?: {
    loesungen?: Solution[];
    theoretischeGrundlagen?: string;
  };
}

async function analyze() {
  console.log('=== FULL SCENARIO TABLE ANALYSIS ===\n');
  
  const results = await db.select().from(enablers);
  
  let totalScenarios = 0;
  let scenariosWithTables = 0;
  let solutionsWithTableHtml = 0;
  let solutionsWithTableText = 0;
  let problematicSolutions: Array<{ enabler: string; scenario: string; solution: number; issue: string; sample: string }> = [];
  
  for (const e of results) {
    const scenarios = (e.scenarios as Scenario[]) || [];
    
    for (const s of scenarios) {
      totalScenarios++;
      const loesungen = s.sections?.loesungen || [];
      
      for (const sol of loesungen) {
        const content = sol.content || '';
        
        const hasTableHtml = content.includes('<table');
        const hasTableTextPattern = /^([\w-]+)\n([\w-]+)\n([\w-]+)\n\d+\n/m.test(content) ||
                                    /\n\d+\n[A-Z][\w-]+\n[\w\s]+\n\d+\n/m.test(content);
        
        // Check for patterns like "101\nP-01\n2\n102" which indicate table data as text
        const looksLikeTableDataAsText = /^\d+\n[A-Z]?-?\d+\n\d+\n\d+\n/m.test(content) ||
                                          /\n\d+\n\n[A-Z]+-\d+\n/m.test(content);
        
        if (hasTableHtml) {
          solutionsWithTableHtml++;
          
          // Check if there's ALSO plain text that looks like table data BEFORE the HTML table
          const tableIndex = content.indexOf('<table');
          const beforeTable = content.substring(0, tableIndex);
          
          // Pattern: multiple short lines that could be table cell values
          const lines = beforeTable.split('\n').filter(l => l.trim());
          const shortValueLines = lines.filter(l => l.trim().length < 30 && /^[\w\s-]+$/.test(l.trim()));
          
          if (shortValueLines.length > 5) {
            problematicSolutions.push({
              enabler: e.title || 'Unknown',
              scenario: s.title || 'Unknown',
              solution: sol.problemNumber || 0,
              issue: 'Has table HTML but ALSO plain text table data before it',
              sample: beforeTable.substring(0, 300)
            });
          }
        } else if (looksLikeTableDataAsText || hasTableTextPattern) {
          solutionsWithTableText++;
          problematicSolutions.push({
            enabler: e.title || 'Unknown',
            scenario: s.title || 'Unknown',
            solution: sol.problemNumber || 0,
            issue: 'Table data stored as plain text (no HTML)',
            sample: content.substring(0, 300)
          });
        }
      }
    }
  }
  
  console.log('Summary:');
  console.log(`  Total scenarios: ${totalScenarios}`);
  console.log(`  Solutions with proper HTML tables: ${solutionsWithTableHtml}`);
  console.log(`  Solutions with table data as text: ${solutionsWithTableText}`);
  console.log(`  Problematic solutions found: ${problematicSolutions.length}`);
  
  if (problematicSolutions.length > 0) {
    console.log('\n=== PROBLEMATIC SOLUTIONS ===\n');
    for (const p of problematicSolutions.slice(0, 10)) {
      console.log(`Enabler: ${p.enabler.substring(0, 50)}`);
      console.log(`Scenario: ${p.scenario}`);
      console.log(`Solution #: ${p.solution}`);
      console.log(`Issue: ${p.issue}`);
      console.log(`Sample:\n${p.sample}\n`);
      console.log('---');
    }
    
    if (problematicSolutions.length > 10) {
      console.log(`\n... and ${problematicSolutions.length - 10} more problematic solutions`);
    }
  }
  
  process.exit(0);
}

analyze();
