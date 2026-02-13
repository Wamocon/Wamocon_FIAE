/**
 * Find solution with "Table: Projects" text
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

import db from '../src/db';
import { enablers } from '../src/db/migrations/schemas/schema';

async function check() {
  const results = await db.select().from(enablers).limit(300);
  
  for (const e of results) {
    const scenarios = (e.scenarios as Array<{
      title?: string;
      sections?: { loesungen?: Array<{ content?: string; title?: string; problemNumber?: number }> };
    }>) || [];
    
    for (const s of scenarios) {
      const loesungen = s.sections?.loesungen || [];
      for (const l of loesungen) {
        if (l.content?.includes('Table: Projects') || l.content?.includes('Table: Employees') || l.content?.includes('Tabelle: Projekte')) {
          console.log('=== FOUND in scenario:', s.title);
          console.log('Solution #:', l.problemNumber, 'Title:', l.title);
          console.log('\nContent (first 1200 chars):');
          console.log(l.content?.substring(0, 1200));
          console.log('\n--- HAS TABLE HTML:', l.content?.includes('<table'));
          process.exit(0);
        }
      }
    }
  }
  
  console.log('Not found');
  process.exit(0);
}

check();
