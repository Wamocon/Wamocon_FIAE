/**
 * Verify that solutions now contain HTML tables
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

import db from '../src/db';
import { enablers } from '../src/db/migrations/schemas/schema';

async function main() {
  const allEnablers = await db.select().from(enablers).limit(100);
  
  let scenariosWithTables = 0;
  let totalSolutions = 0;
  let solutionsWithTables = 0;
  
  for (const e of allEnablers) {
    const scenarios = (e.scenarios as Array<{ 
      title: string;
      sections?: { 
        loesungen?: Array<{ content: string }> 
      } 
    }>) || [];
    
    for (const s of scenarios) {
      const solutions = s.sections?.loesungen || [];
      let hasTable = false;
      
      for (const sol of solutions) {
        totalSolutions++;
        if (sol.content?.includes('<table')) {
          solutionsWithTables++;
          hasTable = true;
        }
      }
      
      if (hasTable) {
        scenariosWithTables++;
        console.log(`✓ ${s.title?.substring(0, 60)} - Has tables in solutions`);
      }
    }
  }
  
  console.log('\n========================================');
  console.log(`Enablers checked: ${allEnablers.length}`);
  console.log(`Scenarios with tables in solutions: ${scenariosWithTables}`);
  console.log(`Total solutions: ${totalSolutions}`);
  console.log(`Solutions with tables: ${solutionsWithTables}`);
  
  process.exit(0);
}

main();
