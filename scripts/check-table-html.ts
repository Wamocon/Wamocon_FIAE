import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import db from '../src/db';
import { sql } from 'drizzle-orm';

async function main() {
  const result = await db.execute(sql`
    SELECT e.title, 
           e.scenarios
    FROM enablers e 
    WHERE e.scenarios::text LIKE '%<table%'
    LIMIT 1
  `);

  console.log('\n=== FULL SCENARIO STRUCTURE ===\n');
  
  const row = (result as any[])[0];
  if (row) {
    console.log('Title:', row.title);
    console.log('\nScenarios structure:');
    const scenarios = row.scenarios;
    if (Array.isArray(scenarios) && scenarios.length > 0) {
      const s = scenarios[0];
      console.log('Keys:', Object.keys(s));
      
      // Check where tables are
      const text = s.text || '';
      const sections = s.sections || {};
      
      console.log('\n--- Has table in "text" field:', text.includes('<table'));
      console.log('--- Has table in "theoretischeGrundlagen":', (sections.theoretischeGrundlagen || '').includes('<table'));
      
      // Show loesungen structure
      console.log('\n--- Loesungen structure:');
      if (sections.loesungen?.length > 0) {
        console.log('First solution keys:', Object.keys(sections.loesungen[0]));
        console.log('First solution content (200 chars):', sections.loesungen[0].content?.substring(0, 200));
      }
      
      // Find where table actually is
      const scenarioStr = JSON.stringify(s);
      const tableIdx = scenarioStr.indexOf('<table');
      if (tableIdx >= 0) {
        console.log('\n--- Table context:');
        console.log(scenarioStr.substring(Math.max(0, tableIdx - 50), tableIdx + 100));
      }
    }
  }

  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
