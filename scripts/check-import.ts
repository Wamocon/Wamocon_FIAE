import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import db from '../src/db';
import { enablers } from '../src/db/migrations/schemas/schema';
import { ilike } from 'drizzle-orm';

async function main() {
  try {
    const result = await db
      .select({ 
        title: enablers.title, 
        scenarios: enablers.scenarios,
      })
      .from(enablers)
      .where(ilike(enablers.title, '%Datenschutz und Datensicherheit%'))
      .limit(1);
    
    if (result[0]?.scenarios) {
      const s = (result[0].scenarios as any[])[0];
      console.log('Enabler:', result[0].title);
      console.log('Text length:', s.text?.length);
      
      // Check for PROBLEM/LÖSUNG markers in text
      const text = s.text || '';
      const problemMatches = text.match(/PROBLEM\s*\d+/gi) || [];
      const loesungMatches = text.match(/L[ÖO]SUNG\s*\d+/gi) || [];
      
      console.log('\nMarkers found in text:');
      console.log('- PROBLEM markers:', problemMatches.length);
      console.log('- LÖSUNG markers:', loesungMatches.length);
      
      // Show a snippet around first PROBLEM
      const firstProblem = text.search(/PROBLEM\s*1/i);
      if (firstProblem >= 0) {
        console.log('\nSnippet around PROBLEM 1:');
        console.log(text.substring(firstProblem, firstProblem + 300));
      }
      
      // Show snippet around first LÖSUNG
      const firstLoesung = text.search(/L[ÖO]SUNG\s*1/i);
      if (firstLoesung >= 0) {
        console.log('\nSnippet around LÖSUNG 1:');
        console.log(text.substring(firstLoesung, firstLoesung + 300));
      }
    }
  } catch (err) {
    console.error('Error:', err);
  }
  
  process.exit(0);
}

main().catch(console.error);
