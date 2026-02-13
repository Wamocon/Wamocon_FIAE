/**
 * Debug: Check what's stored for the Einzeltabellen solution
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
      sections?: {
        loesungen?: Array<{ content?: string; title?: string }>;
      };
    }>) || [];
    
    for (const s of scenarios) {
      const loesungen = s.sections?.loesungen || [];
      for (const l of loesungen) {
        if (l.content?.includes('Beispieltabelle') || l.content?.includes('MitarbeiterID')) {
          console.log('=== FOUND in enabler:', e.title);
          console.log('Solution title:', l.title);
          console.log('\nSolution content (first 2000 chars):');
          console.log(l.content?.substring(0, 2000));
          console.log('\n--- HAS TABLE TAG:', l.content?.includes('<table'));
          process.exit(0);
        }
      }
    }
  }
  
  console.log('Not found');
  process.exit(0);
}

check();
