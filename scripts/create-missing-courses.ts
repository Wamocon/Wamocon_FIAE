/**
 * Create missing courses for chapters 25 and 26
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({
  path: path.resolve(process.cwd(), '.env.local'),
  override: true,
});

import db from '../src/db';
import { courses, profiles } from '../src/db/migrations/schemas/schema';
import { eq } from 'drizzle-orm';

async function createMissingCourses() {
  console.log('Creating missing courses for chapters 25 and 26...\n');

  // Find a trainer to use as creator
  const [trainer] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.role, 'TRAINER'))
    .limit(1);

  if (!trainer) {
    console.log('❌ No trainer found');
    process.exit(1);
  }

  console.log('👤 Using trainer:', trainer.id);

  // Check existing courses for chapters 25 and 26
  const existing25 = await db
    .select({ chapter: courses.chapter, title: courses.title })
    .from(courses)
    .where(eq(courses.chapter, 25));

  const existing26 = await db
    .select({ chapter: courses.chapter, title: courses.title })
    .from(courses)
    .where(eq(courses.chapter, 26));

  console.log('Existing chapter 25 courses:', existing25.length);
  console.log('Existing chapter 26 courses:', existing26.length);

  // Create course for chapter 25 if missing
  if (existing25.length === 0) {
    const [c25] = await db
      .insert(courses)
      .values({
        title: 'Kapitel 25 - Zusätzliche Kompetenzen',
        description: 'Use Cases für zusätzliche LFA Kompetenzen',
        year: 3,
        chapter: 25,
        createdById: trainer.id,
        isActive: true,
        isPublished: true,
      })
      .returning();
    console.log('✅ Created course 25:', c25.id);
  } else {
    console.log('⏭️ Course 25 already exists');
  }

  // Create course for chapter 26 if missing
  if (existing26.length === 0) {
    const [c26] = await db
      .insert(courses)
      .values({
        title: 'Kapitel 26 - Erweiterte Kompetenzen',
        description: 'Use Cases für erweiterte LFA Kompetenzen',
        year: 3,
        chapter: 26,
        createdById: trainer.id,
        isActive: true,
        isPublished: true,
      })
      .returning();
    console.log('✅ Created course 26:', c26.id);
  } else {
    console.log('⏭️ Course 26 already exists');
  }

  console.log('\n✅ Done!');
  process.exit(0);
}

createMissingCourses().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
