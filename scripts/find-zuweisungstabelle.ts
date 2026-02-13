/**
 * Find the specific scenario with 101, P-01, P-02 data
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

import db from '../src/db';
import { enablers } from '../src/db/migrations/schemas/schema';

async function find() {
  const results = await db.select().from(enablers);
  
  for (const e of results) {
    const scenarios = (e.scenarios as Array<{
      title?: string;
      sections?: { loesungen?: Array<{ content?: string; title?: string; problemNumber?: number }> };
    }>) || [];
    
    for (const s of scenarios) {
      const loesungen = s.sections?.loesungen || [];
      for (const sol of loesungen) {
        const content = sol.content || '';
        
        // Look for the Zuweisungstabelle pattern
        if (content.includes('Zuweisungstabelle') || 
            content.includes('m:n-Beziehung')) {
          console.log('=== FOUND ===');
          console.log('Enabler:', e.title?.substring(0, 60));
          console.log('Solution #:', sol.problemNumber, '-', sol.title);
          console.log('\n--- Content (full): ---');
          console.log(content);
          console.log('\n--- HAS TABLE HTML:', content.includes('<table'));
          console.log('--- TABLE COUNT:', (content.match(/<table/g) || []).length);
          process.exit(0);
        }
      }
    }
  }
  
  console.log('Not found');
  process.exit(0);
}

find();
