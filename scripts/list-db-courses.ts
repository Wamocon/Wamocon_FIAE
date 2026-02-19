/**
 * List courses from database
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

import db from '../src/db';
import { courses, enablers } from '../src/db/migrations/schemas/schema';
import { eq, count } from 'drizzle-orm';

async function main() {
  console.log('='.repeat(80));
  console.log('COURSES IN DATABASE');
  console.log('='.repeat(80));
  
  const result = await db
    .select({
      id: courses.id,
      title: courses.title,
      chapter: courses.chapter,
      year: courses.year,
    })
    .from(courses)
    .orderBy(courses.chapter);
    
  for (const c of result) {
    // Count enablers for this course
    const enablerCount = await db
      .select({ count: count() })
      .from(enablers)
      .where(eq(enablers.courseId, c.id));
    
    const num = String(c.chapter || 0).padStart(2, '0');
    console.log(`K${num}: ${c.title?.substring(0, 55).padEnd(55)} | Year: ${c.year || '-'} | Enablers: ${enablerCount[0]?.count || 0}`);
  }
  
  console.log(`\nTotal courses in DB: ${result.length}`);
  
  // Get total enablers
  const totalEnablers = await db.select({ count: count() }).from(enablers);
  console.log(`Total enablers in DB: ${totalEnablers[0]?.count || 0}`);
  
  process.exit(0);
}

main().catch(console.error);
