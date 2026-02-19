import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import db from '../src/db';
import { sql } from 'drizzle-orm';

async function main() {
  const result = await db.execute(sql`
    SELECT e.title, c.id as course_id
    FROM enablers e
    JOIN courses c ON e.course_id = c.id
    WHERE e.scenarios IS NOT NULL
    AND e.scenarios::text LIKE '%<table%'
    ORDER BY c.id, e.title
  `);

  console.log('\n=== ENABLERS WITH TABLES IN SCENARIOS ===\n');
  
  const rows = (result as any[]) || [];
  for (const r of rows) {
    console.log(`- [${r.course_id}] ${r.title}`);
  }
  
  console.log(`\nTotal: ${rows.length} enablers with tables`);
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
