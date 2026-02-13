import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import db from '../src/db';
import { sql } from 'drizzle-orm';

async function main() {
  // Get an enabler with tables
  const result = await db.execute(sql`
    SELECT title, scenarios 
    FROM enablers 
    WHERE scenarios::text LIKE '%<table%' 
    LIMIT 1
  `);

  const row = (result as any[])[0];
  if (!row) {
    console.log('No enablers with tables found');
    process.exit(0);
  }

  console.log('\nEnabler:', row.title);
  
  const scenarios = row.scenarios;
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    console.log('No scenarios array');
    process.exit(0);
  }

  console.log('Number of scenarios:', scenarios.length);

  // Search each field for <table
  function searchForTable(obj: any, path: string = ''): void {
    if (typeof obj === 'string') {
      if (obj.includes('<table')) {
        console.log(`\n✓ FOUND <table> in: ${path}`);
        console.log('  Content preview:', obj.substring(obj.indexOf('<table'), obj.indexOf('<table') + 150));
      }
    } else if (Array.isArray(obj)) {
      obj.forEach((item, i) => searchForTable(item, `${path}[${i}]`));
    } else if (obj && typeof obj === 'object') {
      Object.keys(obj).forEach(key => searchForTable(obj[key], `${path}.${key}`));
    }
  }

  console.log('\nSearching all scenarios for <table>...');
  scenarios.forEach((scenario: any, i: number) => {
    console.log(`\n--- Scenario ${i}:`, scenario.text?.substring(0, 50) || 'no text');
    searchForTable(scenario, `scenarios[${i}]`);
  });

  // Also raw stringify search
  const fullStr = JSON.stringify(scenarios);
  const tableIdx = fullStr.indexOf('<table');
  if (tableIdx >= 0) {
    console.log('\n\n=== RAW STRING SEARCH ===');
    console.log('Found at index:', tableIdx);
    console.log('Context:', fullStr.substring(Math.max(0, tableIdx - 50), tableIdx + 100));
  } else {
    console.log('\n\n=== NO <table> found in stringified scenarios ===');
  }

  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
